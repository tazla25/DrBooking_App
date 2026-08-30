import { handle, ok, readJsonBody, conflict, validationError, notFound } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { patientBookingSchema } from '@/lib/validation';
import { bookInQueue, runBookingTransaction, getQueueCapacity, ACTIVE_STATUSES } from '@/lib/booking';
import { dayOfWeekIST, istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/appointments  (#8, PATIENT only — staff use the walk-in route).
 *
 * IDENTITY LAW (v1 IDOR fix): the patient's identity comes ONLY from the
 * session — appointment.patientId = user.id, patientName = user.name,
 * patientPhone = user.phone. A body-supplied patientName/patientPhone is
 * stripped by zod and never read. DOCTOR/COMPOUNDER/SUPER_ADMIN → 403.
 *
 * ONE transaction (with the shared booking core, retried on queue-number
 * races): CLOSED → 409 SCHEDULE_CLOSED → capacityLeft ≤ 0 → 409 CAPACITY_FULL
 * → duplicate active booking → 409 ALREADY_BOOKED → insert (queueNumber =
 * max+1, fee = doctor's fee at booking time, source ONLINE, status CONFIRMED)
 * + DoctorProfile.appointmentCount increment in the SAME transaction.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request, ['PATIENT']);
  const body = patientBookingSchema.parse(await readJsonBody(request));

  const today = istTodayISO();
  if (body.date < today) {
    throw validationError('Date must be today or in the future');
  }

  const schedule = await db.schedule.findUnique({
    where: { id: body.scheduleId },
    include: {
      doctor: { include: { user: { select: { isActive: true, verificationStatus: true } } } },
    },
  });
  // Unknown, inactive, or belonging to a non-VERIFIED doctor → identical 404
  // (pending doctors are never revealed to patients).
  if (!schedule || !schedule.isActive) {
    throw notFound('Schedule not found');
  }
  const doctorUser = schedule.doctor.user;
  if (!doctorUser || !doctorUser.isActive || doctorUser.verificationStatus !== 'VERIFIED') {
    throw notFound('Schedule not found');
  }
  if (dayOfWeekIST(body.date) !== schedule.dayOfWeek) {
    throw validationError('The schedule does not operate on this day of the week');
  }

  const { appointment, estWaitMin } = await runBookingTransaction(async (tx) => {
    // CLOSED first, then capacity, then the shared duplicate guard + insert.
    const override = await tx.scheduleOverride.findUnique({
      where: { scheduleId_date: { scheduleId: schedule.id, date: body.date } },
      select: { type: true, newStartTime: true, newEndTime: true },
    });
    if (override?.type === 'CLOSED') {
      throw conflict('SCHEDULE_CLOSED', 'The clinic is closed on this date');
    }

    const stats = await getQueueCapacity(tx, schedule, body.date, override);
    if (stats.capacityLeft <= 0) {
      throw conflict('CAPACITY_FULL', 'This schedule is fully booked for the selected date');
    }

    const created = await bookInQueue(tx, {
      scheduleId: schedule.id,
      date: body.date,
      patientId: user.id, // session identity — the ONLY trusted source
      patientName: user.name,
      patientPhone: user.phone,
      source: 'ONLINE',
      fee: schedule.doctor.fee, // fee at booking time
      duplicate: {
        code: 'ALREADY_BOOKED',
        message: 'You already have an active booking for this schedule',
      },
    });

    await tx.doctorProfile.update({
      where: { id: schedule.doctorId },
      data: { appointmentCount: { increment: 1 } },
    });

    // estWaitMin: active appointments strictly ahead of the new one.
    const ahead = await tx.appointment.count({
      where: {
        scheduleId: schedule.id,
        date: body.date,
        status: { in: [...ACTIVE_STATUSES] },
        queueNumber: { lt: created.queueNumber },
      },
    });

    return { appointment: created, estWaitMin: ahead * schedule.avgMinutesPerPatient };
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'APPOINTMENT_BOOKED',
      target: `appointment:${appointment.id}`,
      detail: JSON.stringify({
        scheduleId: schedule.id,
        date: body.date,
        queueNumber: appointment.queueNumber,
        source: 'ONLINE',
      }),
    },
  });

  return ok({ appointment, position: appointment.queueNumber, estWaitMin }, 201);
});
