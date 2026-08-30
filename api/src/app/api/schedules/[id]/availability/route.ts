import { handle, ok, validationError, notFound } from '@/lib/errors';
import { availabilityQuerySchema } from '@/lib/validation';
import { getQueueCapacity } from '@/lib/booking';
import { publicScheduleView } from '@/lib/public';
import { dayOfWeekIST, istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/schedules/:id/availability?date=YYYY-MM-DD  (#7, PUBLIC).
 *
 *  - date optional (default = IST today); past dates → 422.
 *  - Schedule must exist, be active and belong to a VERIFIED doctor → else 404.
 *  - Day mismatch          → { open: false, reason: 'NOT_SCHEDULED_DAY' }
 *  - CLOSED override       → { open: false, reason: 'SCHEDULE_CLOSED' }
 *  - MODIFIED_HOURS/SPECIAL → capacity computed from the override's times.
 *  - Open → { open, date, schedule, nextQueue, estWaitMin, capacityLeft,
 *             avgMinutesPerPatient }. capacityLeft may be 0 while open:true
 *            (a booking attempt would then fail 409 CAPACITY_FULL).
 */
export const GET = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const query = availabilityQuerySchema.parse(Object.fromEntries(url.searchParams));

  const today = istTodayISO();
  const date = query.date ?? today;
  if (date < today) {
    throw validationError('Date must be today or in the future');
  }

  const schedule = await db.schedule.findUnique({
    where: { id },
    include: {
      doctor: { include: { user: { select: { isActive: true, verificationStatus: true } } } },
    },
  });
  if (!schedule || !schedule.isActive) {
    throw notFound('Schedule not found');
  }
  const doctorUser = schedule.doctor.user;
  if (!doctorUser || !doctorUser.isActive || doctorUser.verificationStatus !== 'VERIFIED') {
    throw notFound('Schedule not found');
  }

  if (dayOfWeekIST(date) !== schedule.dayOfWeek) {
    return ok({ open: false, reason: 'NOT_SCHEDULED_DAY' });
  }

  const override = await db.scheduleOverride.findUnique({
    where: { scheduleId_date: { scheduleId: schedule.id, date } },
  });
  if (override?.type === 'CLOSED') {
    return ok({ open: false, reason: 'SCHEDULE_CLOSED' });
  }

  const stats = await getQueueCapacity(db, schedule, date, override);

  return ok({
    open: true,
    date,
    schedule: publicScheduleView(schedule),
    // The queue number the NEXT booking would get (cancelled numbers stay taken).
    nextQueue: stats.nextQueueNumber,
    // Everyone currently CONFIRMED/CALLED would be ahead of a new booking.
    estWaitMin: stats.activeCount * schedule.avgMinutesPerPatient,
    capacityLeft: stats.capacityLeft,
    avgMinutesPerPatient: schedule.avgMinutesPerPatient,
  });
});
