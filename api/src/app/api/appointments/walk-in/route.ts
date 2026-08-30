import { Prisma } from '@prisma/client';
import { handle, ok, readJsonBody, conflict, notFound, validationError } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { walkInSchema } from '@/lib/validation';
import { dayOfWeekIST, istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Retry a transaction on unique-violation / write-conflict races. */
const RETRYABLE_PRISMA_CODES = new Set(['P2002', 'P2034']);
const MAX_ATTEMPTS = 3;

/**
 * POST /api/appointments/walk-in  (#17) — staff books a patient without the app.
 *
 * One transaction (retried up to 3 attempts on queue-number unique races):
 *  - schedule must belong to the caller's scope (else 404 — never reveal
 *    another doctor's resources) and be active;
 *  - date must be today-or-future (IST) and match schedule.dayOfWeek;
 *  - no CLOSED override for (scheduleId, date) → 409 SCHEDULE_CLOSED;
 *  - duplicate guard INSIDE the transaction: same phone + schedule + date
 *    with status CONFIRMED/CALLED → 409 ALREADY_IN_QUEUE (v1 bug #4);
 *  - queueNumber = max(scheduleId+date) + 1;
 *  - fee defaults to the doctor's DoctorProfile.fee.
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

  const closedOverride = await db.scheduleOverride.findUnique({
    where: { scheduleId_date: { scheduleId: schedule.id, date: body.date } },
    select: { id: true, type: true },
  });
  if (closedOverride?.type === 'CLOSED') {
    throw conflict('SCHEDULE_CLOSED', 'The clinic is closed on this date');
  }

  const createWalkIn = () =>
    db.$transaction(async (tx) => {
      // Duplicate guard INSIDE the transaction (v1 bug #4 fix).
      const duplicate = await tx.appointment.findFirst({
        where: {
          scheduleId: schedule.id,
          date: body.date,
          patientPhone: body.patientPhone,
          status: { in: ['CONFIRMED', 'CALLED'] },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw conflict('ALREADY_IN_QUEUE', 'This patient is already in the queue for this schedule');
      }

      const last = await tx.appointment.findFirst({
        where: { scheduleId: schedule.id, date: body.date },
        orderBy: { queueNumber: 'desc' },
        select: { queueNumber: true },
      });
      const queueNumber = (last?.queueNumber ?? 0) + 1;

      return tx.appointment.create({
        data: {
          scheduleId: schedule.id,
          doctorId: schedule.doctorId, // trusted server-side, never from the body
          patientId: null,
          patientName: body.patientName,
          patientPhone: body.patientPhone,
          date: body.date,
          queueNumber,
          status: 'CONFIRMED',
          source: 'WALK_IN',
          fee: body.fee ?? schedule.doctor.fee,
          notes: body.notes ?? null,
        },
      });
    });

  let appointment: Awaited<ReturnType<typeof createWalkIn>> | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      appointment = await createWalkIn();
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        RETRYABLE_PRISMA_CODES.has(err.code) &&
        attempt < MAX_ATTEMPTS;
      if (!retryable) throw err;
    }
  }
  if (!appointment) throw lastError ?? new Error('walk-in transaction failed');

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
