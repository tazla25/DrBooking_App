import { handle, ok, readJsonBody, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope, requireStaffOrAdmin, getDoctorScope } from '@/lib/rbac';
import { scheduleSchema, schedulesQuerySchema } from '@/lib/validation';
import { istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules  (#19) — the caller's schedules (including inactive
 * ones), each with today's override (if any) and today's queue count.
 * SUPER_ADMIN: read-only, optional ?doctorId= (without it: all doctors).
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireStaffOrAdmin(request);
  const url = new URL(request.url);
  const query = schedulesQuerySchema.parse(Object.fromEntries(url.searchParams));
  const today = istTodayISO();

  let doctorId: string | null;
  if (user.role === 'SUPER_ADMIN') {
    doctorId = query.doctorId ?? null; // null = across all doctors
    if (doctorId) {
      const doctor = await db.doctorProfile.findUnique({
        where: { id: doctorId },
        select: { id: true },
      });
      if (!doctor) throw notFound('Doctor not found');
    }
  } else {
    const scope = await getDoctorScope(user);
    doctorId = scope!.doctorId; // client-sent ?doctorId= is IGNORED for staff
  }

  const schedules = await db.schedule.findMany({
    where: doctorId ? { doctorId } : undefined,
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    include: {
      doctor: { select: { id: true, fullName: true } },
      overrides: { where: { date: today } },
      _count: {
        // Phase 11 B2 sweep: todayQueueCount counted CONFIRMED|CALLED → now
        // also counts PENDING (a pending booking occupies the schedule).
        select: {
          appointments: {
            where: { date: today, status: { in: ['PENDING', 'CONFIRMED', 'CALLED'] } },
          },
        },
      },
    },
  });

  return ok({
    today,
    schedules: schedules.map(({ overrides, _count, ...schedule }) => ({
      ...schedule,
      doctor: { id: schedule.doctor.id, fullName: schedule.doctor.fullName },
      todayOverride: overrides[0] ?? null,
      todayQueueCount: _count.appointments,
    })),
  });
});

/**
 * POST /api/schedules  (#19) — DOCTOR/COMPOUNDER create (SUPER_ADMIN is
 * read-only here by design). dayOfWeek 0–6, HH:mm times with start < end,
 * avgMinutesPerPatient 1–120, clinicName/clinicAddress required.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const body = scheduleSchema.parse(await readJsonBody(request));

  const schedule = await db.schedule.create({
    data: {
      doctorId,
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
      clinicName: body.clinicName,
      clinicAddress: body.clinicAddress,
      pinCode: body.pinCode ?? null,
      landmark: body.landmark ?? null,
      mapLink: body.mapLink ?? null,
      avgMinutesPerPatient: body.avgMinutesPerPatient,
      isActive: true,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'SCHEDULE_CHANGED',
      target: `schedule:${schedule.id}`,
      detail: JSON.stringify({ op: 'create', dayOfWeek: body.dayOfWeek, clinicName: body.clinicName }),
    },
  });

  return ok({ schedule }, 201);
});
