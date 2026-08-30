import { handle, ok, validationError, notFound } from '@/lib/errors';
import { requireStaffOrAdmin, getDoctorScope } from '@/lib/rbac';
import { queueTodayQuerySchema } from '@/lib/validation';
import { istTodayISO } from '@/lib/time';
import { toStaffQueueView, countStatuses } from '@/lib/queue';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/queue/today  (#14) — DOCTOR/COMPOUNDER (scoped); SUPER_ADMIN must
 * target one doctor via ?doctorId=.
 *
 * Optional ?date=YYYY-MM-DD (validated; default = today in IST).
 * Returns the scoped doctor's appointments for that date ordered by
 * queueNumber, with full patient name/phone (masking only exists on the
 * PUBLIC queue endpoint — Phase 3) and estWaitMin per the exact formula.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireStaffOrAdmin(request);
  const url = new URL(request.url);
  const query = queueTodayQuerySchema.parse(Object.fromEntries(url.searchParams));
  const date = query.date ?? istTodayISO();

  // The ONLY trusted doctor filter (never a client-sent value for staff).
  let doctorId: string;
  if (user.role === 'SUPER_ADMIN') {
    if (!query.doctorId) {
      throw validationError('doctorId query parameter is required for SUPER_ADMIN');
    }
    const doctor = await db.doctorProfile.findUnique({
      where: { id: query.doctorId },
      select: { id: true, fullName: true },
    });
    if (!doctor) throw notFound('Doctor not found');
    doctorId = query.doctorId;
  } else {
    const scope = await getDoctorScope(user);
    doctorId = scope!.doctorId;
  }

  const doctor = await db.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { id: true, fullName: true },
  });
  if (!doctor) throw notFound('Doctor not found');

  const appointments = await db.appointment.findMany({
    where: { doctorId, date },
    orderBy: [{ queueNumber: 'asc' }, { createdAt: 'asc' }],
    include: { schedule: { select: { id: true, avgMinutesPerPatient: true } } },
  });

  return ok({
    date,
    doctor: { id: doctor.id, fullName: doctor.fullName },
    counts: countStatuses(appointments),
    appointments: toStaffQueueView(appointments),
  });
});
