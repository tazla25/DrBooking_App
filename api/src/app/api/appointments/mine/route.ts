import { handle, ok } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { mineQuerySchema } from '@/lib/validation';
import { ACTIVE_STATUSES } from '@/lib/booking';
import { istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/appointments/mine  (#9, PATIENT) — the caller's own appointments.
 *
 *  - range=upcoming (default): date >= today AND status ∈ {CONFIRMED, CALLED},
 *    ordered date asc, queueNumber asc. estWaitMin is included per item.
 *  - range=past: (status ∈ {COMPLETED, CANCELLED, NO_SHOW}) OR date < today,
 *    ordered date desc, queueNumber desc. No estWaitMin.
 *
 * The status sets mirror EXACTLY what booking/cancel produce (v1 bug #4:
 * appointments vanished because the query used a different status list than
 * the booking flow wrote).
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request, ['PATIENT']);
  const url = new URL(request.url);
  const query = mineQuerySchema.parse(Object.fromEntries(url.searchParams));
  const today = istTodayISO();

  const where: Prisma.AppointmentWhereInput =
    query.range === 'past'
      ? {
          patientId: user.id,
          OR: [
            { status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] } },
            { date: { lt: today } },
          ],
        }
      : {
          patientId: user.id,
          date: { gte: today },
          status: { in: [...ACTIVE_STATUSES] },
        };

  const orderBy: Prisma.AppointmentOrderByWithRelationInput[] =
    query.range === 'past'
      ? [{ date: 'desc' }, { queueNumber: 'desc' }]
      : [{ date: 'asc' }, { queueNumber: 'asc' }];

  const [total, rows] = await Promise.all([
    db.appointment.count({ where }),
    db.appointment.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true } },
        schedule: {
          select: {
            clinicName: true,
            clinicAddress: true,
            startTime: true,
            endTime: true,
            avgMinutesPerPatient: true,
          },
        },
      },
    }),
  ]);

  const items = await Promise.all(
    rows.map(async (appt) => {
      const base = {
        id: appt.id,
        date: appt.date,
        queueNumber: appt.queueNumber,
        status: appt.status,
        source: appt.source,
        fee: appt.fee,
        doctor: appt.doctor,
        schedule: {
          clinicName: appt.schedule.clinicName,
          clinicAddress: appt.schedule.clinicAddress,
          startTime: appt.schedule.startTime,
          endTime: appt.schedule.endTime,
        },
      };
      if (query.range === 'past') return base;

      // estWaitMin (upcoming only): active appointments ahead of this one.
      const ahead = await db.appointment.count({
        where: {
          scheduleId: appt.scheduleId,
          date: appt.date,
          status: { in: [...ACTIVE_STATUSES] },
          queueNumber: { lt: appt.queueNumber },
        },
      });
      return { ...base, estWaitMin: ahead * appt.schedule.avgMinutesPerPatient };
    }),
  );

  return ok({ total, page: query.page, pageSize: query.pageSize, appointments: items });
});
