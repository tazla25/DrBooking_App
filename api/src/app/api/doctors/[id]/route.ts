import { handle, ok, notFound } from '@/lib/errors';
import { publicDoctorView, publicScheduleView } from '@/lib/public';
import { istTodayISO, addDaysISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/doctors/:id  (#6, PUBLIC) — a VERIFIED doctor's public profile:
 * public doctor fields + ACTIVE schedules + overrides in [today, today+7]
 * (IST) so patients see closures and special days before booking.
 *
 * 404 when the doctor does not exist OR is not publicly visible (PENDING /
 * REJECTED / disabled account) — pending doctors are never revealed.
 */
export const GET = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { id } = await context.params;

  const doctor = await db.doctorProfile.findUnique({
    where: { id },
    include: {
      user: { select: { isActive: true, verificationStatus: true } },
      schedules: {
        where: { isActive: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      },
    },
  });

  if (
    !doctor ||
    !doctor.user.isActive ||
    doctor.user.verificationStatus !== 'VERIFIED'
  ) {
    throw notFound('Doctor not found');
  }

  // Overrides for the doctor's active schedules within the next 7 days
  // (inclusive of today) — the window a patient typically browses.
  const today = istTodayISO();
  const until = addDaysISO(today, 7);
  const overrides = doctor.schedules.length
    ? await db.scheduleOverride.findMany({
        where: {
          scheduleId: { in: doctor.schedules.map((s) => s.id) },
          date: { gte: today, lte: until },
        },
        orderBy: [{ date: 'asc' }, { scheduleId: 'asc' }],
        select: {
          id: true,
          scheduleId: true,
          date: true,
          type: true,
          newStartTime: true,
          newEndTime: true,
          reason: true,
        },
      })
    : [];

  return ok({
    // publicDoctorView picks only the public doctor fields; the `user` account
    // object included above is for the visibility check only and never leaves.
    ...publicDoctorView(doctor),
    schedules: doctor.schedules.map(publicScheduleView),
    overrides,
  });
});
