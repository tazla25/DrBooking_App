import { handle, ok, notFound } from '@/lib/errors';
import { queuePublicParamsSchema } from '@/lib/validation';
import { toStaffQueueView, type StaffAppointmentView } from '@/lib/queue';
import { maskPatientName } from '@/lib/public';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Route-handler context: Next.js 15+/16 passes params as a Promise. */
type RouteContext = { params: Promise<{ scheduleId: string; date: string }> };

/**
 * GET /api/queue/:scheduleId/:date  (#12, PUBLIC — the live queue screen).
 *
 *  - No auth required. Past dates are allowed (people check history) — the
 *    response is built from stored rows either way.
 *  - Invalid date → 422; unknown/inactive schedule → 404.
 *  - MASKING LAW: patient names are masked ("Priya Nair" → "P***r"); patient
 *    phones, patientIds, notes and fees NEVER appear in this response. This
 *    is the only place patients see other patients.
 *  - `my` is non-null only when a valid Bearer token belongs to a PATIENT
 *    with an appointment in THIS queue; anonymous/invalid/staff tokens →
 *    my: null (never an error — the screen stays public).
 */
export const GET = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const raw = await context.params;
  const params = queuePublicParamsSchema.parse(raw);

  const schedule = await db.schedule.findUnique({
    where: { id: params.scheduleId },
    include: { doctor: { select: { fullName: true, specialization: true } } },
  });
  if (!schedule || !schedule.isActive) {
    throw notFound('Schedule not found');
  }

  // Every appointment of this (schedule, date), queue order. The staff-view
  // mapper computes estWaitMin per the exact Phase 2 formula; the public view
  // below exposes ONLY masked names + queue numbers + wait times.
  const appointments = await db.appointment.findMany({
    where: { scheduleId: schedule.id, date: params.date },
    orderBy: [{ queueNumber: 'asc' }, { createdAt: 'asc' }],
    include: { schedule: { select: { id: true, avgMinutesPerPatient: true } } },
  });
  const views = toStaffQueueView(appointments);

  // The currently CALLED appointment (first in queue order if several).
  const calledViews = views.filter((v) => v.status === 'CALLED');
  const current = calledViews.length
    ? {
        queueNumber: calledViews[0].queueNumber,
        patientName: maskPatientName(calledViews[0].patientName),
      }
    : null;

  const confirmedViews = views.filter((v) => v.status === 'CONFIRMED');
  const upNext = confirmedViews.map((v) => ({
    queueNumber: v.queueNumber,
    patientName: maskPatientName(v.patientName),
    estWaitMin: v.estWaitMin,
  }));

  const counts = {
    completed: views.filter((v) => v.status === 'COMPLETED').length,
    called: calledViews.length,
    waiting: confirmedViews.length,
  };

  // Optional identity: never throws — an anonymous or invalid token simply
  // means my: null.
  let my: { id: string; queueNumber: number; status: string; estWaitMin: number } | null = null;
  const user = await getCurrentUser(request);
  if (user && user.role === 'PATIENT') {
    const mine = appointments.filter((a) => a.patientId === user.id);
    if (mine.length > 0) {
      // Prefer the caller's ACTIVE booking (lowest queue number); otherwise
      // show their most recent one (e.g. already cancelled today).
      const active = mine
        .filter((a) => a.status === 'CONFIRMED' || a.status === 'CALLED')
        .sort((a, b) => a.queueNumber - b.queueNumber);
      const chosen = active[0] ?? mine.sort((a, b) => b.queueNumber - a.queueNumber)[0];
      const view: StaffAppointmentView | undefined = views.find((v) => v.id === chosen.id);
      my = {
        id: chosen.id,
        queueNumber: chosen.queueNumber,
        status: chosen.status,
        estWaitMin: view?.estWaitMin ?? 0,
      };
    }
  }

  return ok({
    date: params.date,
    schedule: {
      clinicName: schedule.clinicName,
      clinicAddress: schedule.clinicAddress,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      avgMinutesPerPatient: schedule.avgMinutesPerPatient,
    },
    doctor: {
      fullName: schedule.doctor.fullName,
      specialization: schedule.doctor.specialization,
    },
    current,
    upNext,
    counts,
    my,
  });
});
