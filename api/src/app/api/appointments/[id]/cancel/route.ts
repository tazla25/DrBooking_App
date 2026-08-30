import { handle, ok, conflict, notFound } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/appointments/:id/cancel  (#10, PATIENT — own booking only).
 *
 *  - Ownership: appointment.patientId === session user.id, else 404 (never
 *    reveal another patient's appointment).
 *  - Same state machine as Phase 2: only CONFIRMED → CANCELLED. Anything else
 *    (including CALLED and terminal statuses) → 409 INVALID_TRANSITION.
 *    Terminal statuses are never resurrected (v1 bug #7).
 *  - Audit: APPOINTMENT_CANCELLED (actor = the patient, detail previousStatus).
 */
export const POST = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const user = await requireAuth(request, ['PATIENT']);
  const { id } = await context.params;

  const appointment = await db.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.patientId !== user.id) {
    throw notFound('Appointment not found');
  }

  if (appointment.status !== 'CONFIRMED') {
    throw conflict(
      'INVALID_TRANSITION',
      `Cannot transition from ${appointment.status} to CANCELLED`,
    );
  }

  const updated = await db.appointment.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'APPOINTMENT_CANCELLED',
      target: `appointment:${id}`,
      detail: JSON.stringify({
        previousStatus: appointment.status,
        newStatus: 'CANCELLED',
        by: 'PATIENT',
      }),
    },
  });

  return ok({ appointment: updated });
});
