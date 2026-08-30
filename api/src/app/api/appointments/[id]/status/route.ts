import { handle, ok, readJsonBody, conflict, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { appointmentStatusSchema } from '@/lib/validation';
import { notifyUser } from '@/lib/push';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ id: string }> };

/** Legal staff-driven transitions (everything else → 409 INVALID_TRANSITION). */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  CONFIRMED: ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED: ['COMPLETED'],
  COMPLETED: [], // terminal
  CANCELLED: [], // terminal — never resurrect (v1 bug #7)
  NO_SHOW: [], // terminal
};

/**
 * POST /api/appointments/:id/status  (#18) — staff status machine.
 * Appointment must belong to the caller's scope (else 404). Audits
 * CANCELLED and NO_SHOW only (staff decisions).
 *
 * Push trigger (c) — AFTER the update commits, fire-and-forget: when staff
 * set CANCELLED, the patient is notified. Walk-ins without an account skip
 * silently; push failures never affect the status change.
 */
export const POST = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const { id } = await context.params;
  const body = appointmentStatusSchema.parse(await readJsonBody(request));

  const appointment = await db.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.doctorId !== doctorId) {
    throw notFound('Appointment not found');
  }

  const allowed = ALLOWED_TRANSITIONS[appointment.status] ?? [];
  if (!allowed.includes(body.status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `Cannot transition from ${appointment.status} to ${body.status}`,
    );
  }

  const updated = await db.appointment.update({
    where: { id },
    data: { status: body.status },
  });

  if (body.status === 'CANCELLED' || body.status === 'NO_SHOW') {
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: `APPOINTMENT_${body.status}`,
        target: `appointment:${id}`,
        detail: JSON.stringify({ previousStatus: appointment.status, newStatus: body.status }),
      },
    });
  }

  // Push trigger (c) — AFTER the update commits, fire-and-forget.
  if (body.status === 'CANCELLED') {
    notifyUser(appointment.patientId, {
      title: 'Appointment cancelled',
      body: 'Your appointment has been cancelled by the clinic',
      data: {
        type: 'APPOINTMENT_CANCELLED',
        appointmentId: appointment.id,
      },
    });
  }

  return ok({ appointment: updated });
});
