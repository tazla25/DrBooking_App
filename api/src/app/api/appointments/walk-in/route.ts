import { handle, ok, readJsonBody, conflict, notFound, validationError } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { walkInSchema } from '@/lib/validation';
import { dayOfWeekIST, istTodayISO } from '@/lib/time';
import { bookInQueue, runBookingTransaction } from '@/lib/booking';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/appointments/walk-in  (#17) — staff books a patient without the app.
 *
 * The queue-insert itself lives in src/lib/booking.ts (bookInQueue) — the SAME
 * core the patient booking route uses (Phase 3 #8). Around it:
 *  - schedule must belong to the caller's scope (else 404 — never reveal
 *    another doctor's resources) and be active;
 *  - date must be today-or-future (IST) and match schedule.dayOfWeek;
 *  - duplicate guard (same phone + schedule + date, PENDING|CONFIRMED|CALLED —
 *    Phase 11 B2) and the CLOSED-override check run inside the transaction
 *    via bookInQueue;
 *  - queueNumber = max(scheduleId+date) + 1 with P2002/P2034 retries;
 *  - fee defaults to the doctor's DoctorProfile.fee;
 *  - status: WALK_IN → CONFIRMED immediately (Phase 11 B1 — desk-created
 *    bookings skip manual confirmation).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const body = walkInSchema.parse(await readJsonBody(request));
  const today = istTodayISO();

  if (body.date < today) {
    throw validationError('Date must be today or in the future');
  }

  const schedule = await db.schedule.findUnique({
    where: { id: body.scheduleId },
    include: { doctor: { select: { fee: true } } },
  });
  // Out-of-scope or unknown schedule → identical 404 (scoping law).
  if (!schedule || schedule.doctorId !== doctorId) {
    throw notFound('Schedule not found');
  }
  if (!schedule.isActive) {
    throw conflict('SCHEDULE_INACTIVE', 'This schedule has been deactivated');
  }
  if (dayOfWeekIST(body.date) !== schedule.dayOfWeek) {
    throw validationError('The schedule does not operate on this day of the week');
  }

  const appointment = await runBookingTransaction((tx) =>
    bookInQueue(tx, {
      scheduleId: schedule.id,
      date: body.date,
      patientId: null,
      patientName: body.patientName,
      patientPhone: body.patientPhone,
      source: 'WALK_IN',
      fee: body.fee ?? schedule.doctor.fee,
      notes: body.notes ?? null,
      duplicate: {
        code: 'ALREADY_IN_QUEUE',
        message: 'This patient is already in the queue for this schedule',
      },
    }),
  );

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'WALK_IN_CREATED',
      target: `appointment:${appointment.id}`,
      detail: JSON.stringify({
        scheduleId: schedule.id,
        date: body.date,
        queueNumber: appointment.queueNumber,
        patientPhone: body.patientPhone,
      }),
    },
  });

  return ok({ appointment }, 201);
});
