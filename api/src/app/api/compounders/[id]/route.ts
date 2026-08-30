import { handle, ok, notFound } from '@/lib/errors';
import { requireVerifiedDoctorScope } from '@/lib/rbac';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/compounders/:id  (#24) — DOCTOR-only, soft deactivate:
 *  - the target MUST be one of MY compounders (else 404);
 *  - isActive=false + ALL their sessions revoked (they cannot log in again —
 *    login also rejects inactive accounts);
 *  - history is kept (soft delete only). Audits COMPOUNDER_DEACTIVATED.
 */
export const DELETE = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user: doctor, doctorId } = await requireVerifiedDoctorScope(request);
  const { id } = await context.params;

  const compounder = await db.user.findFirst({
    where: { id, role: 'COMPOUNDER', delegatedDoctorId: doctorId },
  });
  if (!compounder) {
    throw notFound('Compounder not found');
  }

  const user = await db.$transaction(async (tx) => {
    const deactivated = await tx.user.update({
      where: { id: compounder.id },
      data: { isActive: false },
    });
    // Kill every active session immediately.
    await tx.session.deleteMany({ where: { userId: compounder.id } });
    await tx.auditLog.create({
      data: {
        actorId: doctor.id,
        action: 'COMPOUNDER_DEACTIVATED',
        target: `user:${compounder.id}`,
        detail: JSON.stringify({ phone: compounder.phone, revokedSessions: true }),
      },
    });
    return deactivated;
  });

  return ok({
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    },
  });
});
