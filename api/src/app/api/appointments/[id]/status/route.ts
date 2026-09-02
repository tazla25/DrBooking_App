import { handle, ok, readJsonBody, conflict, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { appointmentStatusSchema } from '@/lib/validation';
import { notifyUser } from '@/lib/push';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ id: string }> };

/**
 * Legal staff-driven transitions (everything else → 409 INVALID_TRANSITION).
 *
 * Phase 11 B2: PENDING enters the machine — a staff CONFIRM lands the manual
 * confirmation (PENDING → CONFIRMED) and a staff REJECT cancels the booking
 * (PENDING → CANCELLED). PENDING → CALLED stays ILLEGAL (confirm first —
 * exactly the manual-confirmation law) and CONFIRMED → PENDING stays ILLEGAL
 * (confirmation is one-way; never un-confirm).
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED: ['COMPLETED'],
  COMPLETED: [], // terminal
  CANCELLED: [], // terminal — never resurrect (v1 bug #7)
  NO_SHOW: [], // terminal
};

/**
 * POST /api/appointments/:id/status  (#18) — staff status machine.
 * Appointment must belong to the caller's scope (else 404). Audits every
 * staff DECISION: CANCELLED, NO_SHOW, and (Phase 11) APPOINTMENT_CONFIRMED
 * (PENDING → CONFIRMED — the manual confirmation is a staff decision, same
 * weight as a cancellation). CALLED/COMPLETED stay unaudited (routine flow).
 *
 * Push triggers (fire-and-forget AFTER the update commits, failures never
 * affect the status change):
 *   - CANCELLED           → patient notified (existing behaviour).
 *   - PENDING → CONFIRMED → patient notified: "Appointment confirmed" with
 *     Serial #<queueNumber> and the IST date, data.type APPOINTMENT_CONFIRMED.
 *     Walk-ins without an account skip silently (notifyUser ignores null).
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

  const isConfirmAction = appointment.status === 'PENDING' && body.status === 'CONFIRMED';

  if (body.status === 'CANCELLED' || body.status === 'NO_SHOW' || isConfirmAction) {
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: isConfirmAction ? 'APPOINTMENT_CONFIRMED' : `APPOINTMENT_${body.status}`,
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

  // Push trigger (d), Phase 11 B2 — the manual confirmation. The serial is
  // unchanged by confirmation (queueNumber was allocated at booking and never
  // renumbers), so the patient sees the same Serial #N they were told at
  // booking time, now confirmed for the same IST business date.
  if (isConfirmAction) {
    notifyUser(appointment.patientId, {
      title: 'Appointment confirmed',
      body: `Serial #${appointment.queueNumber} confirmed for ${prettyISTDate(appointment.date)}`,
      data: {
        type: 'APPOINTMENT_CONFIRMED',
        appointmentId: appointment.id,
        queueNumber: String(appointment.queueNumber),
      },
    });
  }

  return ok({ appointment: updated });
});

/** '2026-09-02' → '2 Sep 2026' — display-only; input is already an IST date
 * string (TIME LAW: no timezone math, just month names). */
function prettyISTDate(dateISO: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const [y, m, d] = dateISO.split('-');
  if (!y || !m || !d) return dateISO;
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}
