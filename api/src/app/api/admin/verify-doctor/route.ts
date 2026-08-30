import { handle, ok, readJsonBody, conflict, notFound } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { verifyDoctorSchema } from '@/lib/validation';
import { toSafeUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Legal verification transitions (everything else → 409 INVALID_TRANSITION):
 *   PENDING  → VERIFIED   (approval)
 *   PENDING  → REJECTED   (rejection)
 *   REJECTED → VERIFIED   (admin correction)
 *   VERIFIED → VERIFIED   (idempotent re-approval — ok)
 *   VERIFIED → REJECTED   (acts as suspension)
 *   REJECTED → REJECTED   is deliberately NOT allowed (spec lists no idempotent
 *   rejection; the admin must transition through VERIFIED first).
 */
const ALLOWED: Record<string, ReadonlySet<string>> = {
  PENDING: new Set(['VERIFIED', 'REJECTED']),
  REJECTED: new Set(['VERIFIED']),
  VERIFIED: new Set(['VERIFIED', 'REJECTED']),
};

/**
 * POST /api/admin/verify-doctor  (#27, SUPER_ADMIN only).
 *
 * Body: { userId, decision: 'VERIFIED'|'REJECTED', note? }.
 * 404 when the user is missing or not a DOCTOR. The status update and the
 * AuditLog row are written in the SAME transaction (action DOCTOR_VERIFIED /
 * DOCTOR_REJECTED, actorId = admin, target `user:<id>`; the spec's
 * "targetUserId" is carried by `target` + the detail JSON because the
 * AuditLog model has no separate targetUserId column — SCHEMA LAW).
 *
 * Rejected (suspended) doctors are then blocked by the EXISTING
 * requireVerifiedStaff gate — no extra code anywhere else.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const admin = await requireAuth(request, ['SUPER_ADMIN']);
  const body = verifyDoctorSchema.parse(await readJsonBody(request));

  const target = await db.user.findUnique({
    where: { id: body.userId },
    include: { doctorProfile: { select: { id: true, fullName: true } } },
  });
  if (!target || target.role !== 'DOCTOR') {
    throw notFound('Doctor user not found');
  }

  const allowed = ALLOWED[target.verificationStatus] ?? new Set<string>();
  if (!allowed.has(body.decision)) {
    throw conflict(
      'INVALID_TRANSITION',
      `Cannot transition doctor from ${target.verificationStatus} to ${body.decision}`,
    );
  }

  const previousStatus = target.verificationStatus;

  // Same transaction: status update + audit row (never one without the other).
  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: { verificationStatus: body.decision },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: body.decision === 'VERIFIED' ? 'DOCTOR_VERIFIED' : 'DOCTOR_REJECTED',
        target: `user:${target.id}`,
        detail: JSON.stringify({
          targetUserId: target.id,
          decision: body.decision,
          previousStatus,
          note: body.note ?? null,
        }),
      },
    });

    return user;
  });

  return ok({
    user: toSafeUser(updated),
    previousStatus,
    doctorProfile: target.doctorProfile
      ? { id: target.doctorProfile.id, fullName: target.doctorProfile.fullName }
      : null,
  });
});
