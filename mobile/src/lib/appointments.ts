/**
 * Patient booking-flow wrappers + payload types — mirror the frozen api/
 * contracts EXACTLY (Phase 3 routes, verified against api/src):
 *
 *  - GET  /api/schedules/:id/availability?date=YYYY-MM-DD   (public)
 *  - POST /api/appointments          (PATIENT only)
 *  - GET  /api/appointments/mine?range=upcoming|past         (PATIENT)
 *  - POST /api/appointments/:id/cancel                       (PATIENT)
 *  - GET  /api/queue/:scheduleId/:date                       (public, masked)
 *  - POST /api/feedback                                      (PATIENT)
 *
 * api/ is FROZEN for mobile phases: if a screen seems to need a shape change,
 * raise it as an "API GAP" in the PR instead of editing api/.
 */

import { apiRequest } from './api';
import type { ScheduleView } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * PENDING joins the machine in Phase 11 B2 — ONLINE bookings land PENDING
 * until staff confirm them (walk-ins go straight to CONFIRMED).
 */
export type AppointmentStatus =
  'PENDING' | 'CONFIRMED' | 'CALLED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type AppointmentSource = 'ONLINE' | 'WALK_IN';

/**
 * Raw Appointment row — exactly what POST /api/appointments and
 * POST /api/appointments/:id/cancel return inside `appointment`.
 */
export interface AppointmentRecord {
  id: string;
  scheduleId: string;
  doctorId: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string;
  date: string; // YYYY-MM-DD IST — pass through, never convert
  queueNumber: number;
  status: AppointmentStatus | string;
  source: AppointmentSource | string;
  fee: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/appointments → 201 { appointment, position, estWaitMin }. */
export interface BookingResponse {
  appointment: AppointmentRecord;
  position: number;
  estWaitMin: number;
}

// -- Availability -----------------------------------------------------------

export type AvailabilityClosedReason = 'NOT_SCHEDULED_DAY' | 'SCHEDULE_CLOSED';

export interface AvailabilityOpen {
  open: true;
  date: string;
  schedule: ScheduleView;
  /** The queue number the NEXT booking would receive. */
  nextQueue: number;
  estWaitMin: number;
  capacityLeft: number;
  avgMinutesPerPatient: number;
}

export interface AvailabilityClosed {
  open: false;
  reason: AvailabilityClosedReason;
}

/** Discriminated on `open` — narrow with `data.open`. */
export type AvailabilityResponse = AvailabilityOpen | AvailabilityClosed;

/** Plain-English sentence for a closed-day reason (shown in the glass banner). */
export function availabilityClosedMessage(reason: AvailabilityClosedReason): string {
  switch (reason) {
    case 'NOT_SCHEDULED_DAY':
      return 'The doctor does not consult at this clinic on the selected day. Pick a date marked with the clinic’s day.';
    case 'SCHEDULE_CLOSED':
      return 'The clinic is closed on this date (holiday or a posted closure).';
  }
}

// -- My appointments --------------------------------------------------------

/** doctor/schedule sub-shapes of GET /api/appointments/mine items. */
export interface MineDoctor {
  id: string; // DoctorProfile id — safe to deep-link /doctor/:id
  fullName: string;
  specialization: string | null;
}

export interface MineSchedule {
  clinicName: string;
  clinicAddress: string;
  startTime: string; // HH:mm IST
  endTime: string;
}

/** One row of GET /api/appointments/mine (upcoming rows add estWaitMin). */
export interface MyAppointment {
  id: string;
  date: string; // YYYY-MM-DD IST
  queueNumber: number;
  status: AppointmentStatus | string;
  source: AppointmentSource | string;
  fee: number | null;
  doctor: MineDoctor;
  schedule: MineSchedule;
  /** Upcoming range only — approximate wait while waiting. */
  estWaitMin?: number;
}

export type AppointmentRange = 'upcoming' | 'past';

export interface MineResponse {
  total: number;
  page: number;
  pageSize: number;
  appointments: MyAppointment[];
}

// -- Live queue (public, masked) ---------------------------------------------

export interface LiveQueueCurrent {
  queueNumber: number;
  /** Masked name from the API ("Priya Nair" → "P***r") — display as-is. */
  patientName: string;
}

export interface LiveQueueUpNext {
  queueNumber: number;
  patientName: string; // masked
  estWaitMin: number;
}

/** Phase 11 B2: a masked PENDING row (awaiting clinic confirmation). */
export interface LiveQueuePending {
  queueNumber: number;
  patientName: string; // masked
}

export interface LiveQueueMy {
  id: string;
  queueNumber: number;
  status: AppointmentStatus | string;
  estWaitMin: number;
}

/** GET /api/queue/:scheduleId/:date — `my` is null unless the bearer token
 *  belongs to a PATIENT booked in THIS queue (anonymous-safe by design).
 *  Phase 11 B2: `pending` carries the masked PENDING rows + counts.pending. */
export interface LiveQueueResponse {
  date: string;
  schedule: {
    clinicName: string;
    clinicAddress: string;
    startTime: string;
    endTime: string;
    avgMinutesPerPatient: number;
  };
  doctor: {
    fullName: string;
    specialization: string | null;
  };
  current: LiveQueueCurrent | null;
  upNext: LiveQueueUpNext[];
  pending: LiveQueuePending[];
  counts: {
    completed: number;
    called: number;
    waiting: number;
    pending: number;
  };
  my: LiveQueueMy | null;
}

// -- Feedback -----------------------------------------------------------------

export interface FeedbackResponse {
  feedback: {
    id: string;
    appointmentId: string;
    rating: number;
    comment: string | null;
  };
  avgRating: number;
  reviewCount: number;
}

// ---------------------------------------------------------------------------
// Wrappers (every network call goes through the ONE api client)
// ---------------------------------------------------------------------------

/** GET /api/schedules/:id/availability — open/closed + queue metrics. */
export function fetchAvailability(scheduleId: string, date: string): Promise<AvailabilityResponse> {
  return apiRequest<AvailabilityResponse>(`/api/schedules/${scheduleId}/availability`, {
    query: { date },
  });
}

/** POST /api/appointments — PATIENT only; identity comes from the session. */
export function bookAppointment(scheduleId: string, date: string): Promise<BookingResponse> {
  return apiRequest<BookingResponse>('/api/appointments', {
    method: 'POST',
    body: { scheduleId, date },
  });
}

/** GET /api/appointments/mine — the caller's own upcoming/past visits. */
export function fetchMyAppointments(
  range: AppointmentRange,
  page: number,
  pageSize: number,
): Promise<MineResponse> {
  return apiRequest<MineResponse>('/api/appointments/mine', {
    query: { range, page, pageSize },
  });
}

/** POST /api/appointments/:id/cancel — CONFIRMED only (else 409 INVALID_TRANSITION). */
export function cancelAppointment(id: string): Promise<{ appointment: AppointmentRecord }> {
  return apiRequest<{ appointment: AppointmentRecord }>(`/api/appointments/${id}/cancel`, {
    method: 'POST',
  });
}

/**
 * GET /api/queue/:scheduleId/:date — public live queue (masked names).
 * The token is attached when present; a null/absent/invalid one simply means
 * `my: null` — this call NEVER throws a 401 (the route is public).
 */
export function fetchLiveQueue(scheduleId: string, date: string): Promise<LiveQueueResponse> {
  return apiRequest<LiveQueueResponse>(`/api/queue/${scheduleId}/${date}`);
}

/** POST /api/feedback — rate a COMPLETED visit; one review per visit. */
export function submitFeedback(
  appointmentId: string,
  rating: number,
  comment?: string,
): Promise<FeedbackResponse> {
  const trimmed = comment?.trim();
  return apiRequest<FeedbackResponse>('/api/feedback', {
    method: 'POST',
    body: {
      appointmentId,
      rating,
      // Omit instead of sending an empty string (server trims + validates).
      ...(trimmed ? { comment: trimmed } : {}),
    },
  });
}

/**
 * Resolve the scheduleId for an appointment from the public doctor detail.
 *
 * API GAP: GET /api/appointments/mine omits schedule.id, but the live-queue
 * route needs it. We match the doctor's active schedules by clinicName +
 * weekday of the appointment date (deterministic for a doctor's weekly
 * slots; if two schedules tie, the first is used). Null when nothing matches.
 */
export async function resolveScheduleId(appointment: MyAppointment): Promise<string | null> {
  const detail = await apiRequest<{ schedules: ScheduleView[] }>(
    `/api/doctors/${appointment.doctor.id}`,
  );
  const dow = new Date(`${appointment.date}T12:00:00Z`).getUTCDay();
  const match = detail.schedules.find(
    (s) => s.clinicName === appointment.schedule.clinicName && s.dayOfWeek === dow,
  );
  return match?.id ?? null;
}
