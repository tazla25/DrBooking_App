/**
 * Staff console wrappers + payload types — mirror the frozen api/ contracts
 * EXACTLY (Phase 2 routes, re-verified against api/src on main):
 *
 *  - GET  /api/queue/today?date=YYYY-MM-DD            (DOCTOR/COMPOUNDER, scoped)
 *  - POST /api/queue/next                              (DOCTOR/COMPOUNDER)
 *  - POST /api/appointments/:id/status                 (staff status machine,
 *        incl. the Phase 11 confirm/reject actions on PENDING rows)
 *  - POST /api/appointments/walk-in                    (staff books a patient)
 *  - GET  /api/schedules  ·  POST /api/schedules       (includes INACTIVE)
 *  - PUT  /api/schedules/:id  ·  DELETE /api/schedules/:id (soft delete)
 *  - GET/POST /api/schedules/:id/overrides · DELETE /api/schedules/:id/overrides/:date
 *  - GET  /api/patients?q=&page=&pageSize=             (scoped patient book)
 *  - GET/POST /api/patients/:phone/notes               (phone = path param → encoded)
 *  - PATCH /api/availability                           (optimistic toggle target)
 *  - GET/POST /api/compounders · DELETE /api/compounders/:id  (DOCTOR only)
 *  - GET/PATCH /api/doctors/me                         (Phase 11 doctor self-edit)
 *
 * SCOPING LAW: the server ignores client-sent doctorId for DOCTOR/COMPOUNDER —
 * these wrappers NEVER send one. SUPER_ADMIN is not part of the mobile staff
 * console (Phase 8); the role guard in app/(staff)/_layout.tsx is UX defense.
 *
 * api/ is FROZEN for mobile phases except the Phase 11 scope (doctor identity
 * + manual confirmation): if a screen seems to need a shape change outside
 * that scope, raise it as an "API GAP" in the PR instead of editing api/.
 */

import { apiRequest } from './api';
import type { AppointmentRecord } from './appointments';
import type { OverrideType, SafeUser } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettableStatus = 'CONFIRMED' | 'CALLED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/**
 * Legal staff-driven transitions (mirror of the api's ALLOWED_TRANSITIONS).
 * Phase 11 B2: PENDING → CONFIRMED (the manual confirm) and PENDING →
 * CANCELLED (the staff reject). CONFIRMED never goes back to PENDING
 * (one-way confirmation); terminal statuses are immutable.
 */
export const STATUS_TRANSITIONS: Record<string, readonly SettableStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CALLED', 'CANCELLED', 'NO_SHOW'],
  CALLED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// -- §3.1 Today queue ---------------------------------------------------------

/** One row of GET /api/queue/today — FULL name + phone (staff-only screen;
 * masking exists only on the public patient queue — by design, do not "fix"). */
export interface StaffQueueAppointment {
  id: string;
  queueNumber: number;
  status: string;
  source: string; // 'ONLINE' | 'WALK_IN'
  patientName: string;
  patientPhone: string;
  patientId: string | null;
  notes: string | null;
  fee: number | null;
  estWaitMin: number;
  createdAt: string;
}

export interface TodayQueueCounts {
  pending: number;
  confirmed: number;
  called: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface TodayQueueResponse {
  date: string; // YYYY-MM-DD IST — pass through, never convert
  doctor: { id: string; fullName: string };
  counts: TodayQueueCounts;
  appointments: StaffQueueAppointment[]; // queueNumber asc
}

// -- §3.2 Queue advance -------------------------------------------------------

/** POST /api/queue/next — ONE transaction: lowest CALLED → COMPLETED (if any),
 * lowest CONFIRMED → CALLED (if any). Always operates on IST TODAY server-side. */
export interface QueueNextResult {
  completed: AppointmentRecord | null;
  called: AppointmentRecord | null;
  queueEmpty: boolean;
}

/** Plain-English outcome for the post-advance toast. */
export function queueNextMessage(result: QueueNextResult): string {
  if (result.completed && result.called) {
    return `Completed #${result.completed.queueNumber}, called #${result.called.queueNumber}`;
  }
  if (result.called) return `Called #${result.called.queueNumber}`;
  if (result.completed) return `Completed #${result.completed.queueNumber} — queue is empty`;
  return 'Queue is empty';
}

// -- §3.5/3.6/3.7 Schedules ---------------------------------------------------

/** Full ScheduleOverride row — exactly what GET overrides / POST override and
 * `todayOverride` inside GET /api/schedules return. */
export interface StaffOverride {
  id: string;
  scheduleId: string;
  date: string; // YYYY-MM-DD IST — pass through, never convert
  type: OverrideType | string; // CLOSED | MODIFIED_HOURS | SPECIAL
  newStartTime: string | null; // HH:mm IST
  newEndTime: string | null;
  reason: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Raw Schedule row (what POST/PUT/DELETE /api/schedules return). */
export interface StaffScheduleRecord {
  id: string;
  doctorId: string;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday (IST)
  startTime: string; // HH:mm IST
  endTime: string;
  clinicName: string;
  clinicAddress: string;
  pinCode: string | null;
  landmark: string | null;
  mapLink: string | null;
  avgMinutesPerPatient: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/schedules item — raw row + doctor + today's context. */
export interface StaffSchedule extends StaffScheduleRecord {
  doctor: { id: string; fullName: string };
  todayOverride: StaffOverride | null;
  todayQueueCount: number; // CONFIRMED + CALLED today
}

export interface StaffSchedulesResponse {
  today: string;
  schedules: StaffSchedule[]; // dayOfWeek asc, startTime asc
}

/**
 * The FULL create/update body — POST and PUT share it (PUT = full replace,
 * omit nothing). Optional text fields are omitted when blank (server stores
 * null), never sent as empty strings.
 */
export interface ScheduleFormInput {
  dayOfWeek: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm (must be > startTime)
  clinicName: string;
  clinicAddress: string;
  pinCode?: string;
  landmark?: string;
  mapLink?: string;
  avgMinutesPerPatient: number; // 1–120
}

// -- §3.8 Overrides -----------------------------------------------------------

export interface OverrideFormInput {
  date: string; // YYYY-MM-DD
  type: OverrideType;
  /** CLOSED must carry NO times; MODIFIED_HOURS/SPECIAL REQUIRE both. */
  newStartTime?: string;
  newEndTime?: string;
  reason?: string;
}

// -- §3.9 Patients ------------------------------------------------------------

export interface PatientSummary {
  name: string;
  phone: string;
  lastVisit: string; // YYYY-MM-DD IST
  lastStatus: string;
  totalVisits: number; // excludes CANCELLED
}

export interface PatientsResponse {
  total: number;
  page: number;
  pageSize: number;
  patients: PatientSummary[];
}

// -- §3.10 Patient notes ------------------------------------------------------

export interface PatientNote {
  id: string;
  note: string;
  isImportant: boolean;
  author: { id: string; name: string; role: string } | null;
  createdAt: string;
}

// -- §3.12 Compounders --------------------------------------------------------

export interface CompounderRecord {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

/** POST /api/compounders → 201 { user, tempPassword } — the tempPassword is
 * 12 chars, shown EXACTLY ONCE, never retrievable again. */
export interface CompounderCreated {
  user: SafeUser;
  tempPassword: string;
}

// ---------------------------------------------------------------------------
// Wrappers (every network call goes through the ONE api client)
// ---------------------------------------------------------------------------

/**
 * GET /api/queue/today — the scoped doctor's queue for a date (default: IST
 * today server-side). Past dates ARE allowed (history browsing). The date is
 * passed VERBATIM (TIME LAW) — never timezone-converted.
 */
export function fetchTodayQueue(date?: string): Promise<TodayQueueResponse> {
  return apiRequest<TodayQueueResponse>('/api/queue/today', {
    query: { date },
  });
}

/**
 * POST /api/queue/next — advance the queue by one (single transaction).
 * Operates on IST TODAY regardless of the date the screen is viewing;
 * push notifications are sent server-side — nothing to pass.
 */
export function callNextPatient(): Promise<QueueNextResult> {
  return apiRequest<QueueNextResult>('/api/queue/next', { method: 'POST' });
}

/**
 * POST /api/appointments/:id/status — staff status machine. Illegal
 * transitions → 409 INVALID_TRANSITION; out-of-scope appointment → 404.
 */
export function setAppointmentStatus(
  id: string,
  status: SettableStatus,
): Promise<{ appointment: AppointmentRecord }> {
  return apiRequest<{ appointment: AppointmentRecord }>(`/api/appointments/${id}/status`, {
    method: 'POST',
    body: { status },
  });
}

// -- Phase 11 B3: manual confirmation actions -----------------------------------

/**
 * POST /api/appointments/:id/status { status: 'CONFIRMED' } — the manual
 * confirm action on a PENDING booking (PENDING → CONFIRMED). The server
 * pushes APPOINTMENT_CONFIRMED to the patient and audits the decision.
 */
export function confirmAppointment(id: string): Promise<{ appointment: AppointmentRecord }> {
  return setAppointmentStatus(id, 'CONFIRMED');
}

/**
 * The staff REJECT action — PENDING → CANCELLED via the existing status
 * route, followed by an optional note persisted as a PATIENT NOTE (the only
 * existing notes store, keyed by phone — works for walk-ins too). The note is
 * best-effort AFTER the cancellation: a note failure never rolls the
 * rejection back (surfaced as a non-blocking warning message returned by the
 * hook, while the cancellation itself stands).
 */
export async function rejectAppointment(
  id: string,
  patientPhone: string,
  note?: string,
): Promise<{ appointment: AppointmentRecord; noteWarning: string | null }> {
  const result = await setAppointmentStatus(id, 'CANCELLED');
  const trimmed = note?.trim();
  if (trimmed) {
    try {
      await addPatientNote(patientPhone, trimmed, true);
    } catch {
      return {
        appointment: result.appointment,
        noteWarning: 'Rejection saved, but the note could not be added to the patient record.',
      };
    }
  }
  return { appointment: result.appointment, noteWarning: null };
}

// -- Phase 11 A4: doctor self-service profile ------------------------------------

/** PATCH /api/doctors/me response — the publicDoctorView shape. */
export interface DoctorProfileView {
  id: string;
  fullName: string;
  specialization: string | null;
  fee: number | null;
  yearsExperience: number | null;
  bio?: string;
  registrationNumber: string | null;
  avatarUrl: string | null;
  avgRating: number;
  reviewCount: number;
  isAvailableNow: boolean;
}

/**
 * Editable fields for the profile form (fullName is NOT editable, A2). Null
 * clears the stored value server-side; an absent key leaves it untouched.
 */
export interface DoctorProfilePatchBody {
  specialization?: string | null;
  fee?: number | null;
  yearsExperience?: number | null;
  bio?: string | null;
  registrationNumber?: string | null;
  avatarUrl?: string | null;
}

/**
 * PATCH /api/doctors/me — doctor-only self-service profile update. Blank
 * optional identity fields are sent as null (clear) instead of empty
 * strings; a field absent from the body is left untouched server-side.
 */
export function updateDoctorProfile(body: DoctorProfilePatchBody): Promise<DoctorProfileView> {
  return apiRequest<DoctorProfileView>('/api/doctors/me', {
    method: 'PATCH',
    body,
  });
}

/**
 * POST /api/appointments/walk-in — staff books a patient without the app.
 * Blank notes are omitted; fee is omitted when not provided (server defaults
 * to the doctor's fee). The date is passed VERBATIM (TIME LAW).
 */
export function createWalkIn(input: {
  scheduleId: string;
  date: string;
  patientName: string;
  patientPhone: string;
  notes?: string;
  fee?: number;
}): Promise<{ appointment: AppointmentRecord }> {
  const trimmedNotes = input.notes?.trim();
  const body: Record<string, unknown> = {
    scheduleId: input.scheduleId,
    date: input.date,
    patientName: input.patientName.trim(),
    patientPhone: input.patientPhone,
  };
  if (trimmedNotes) body.notes = trimmedNotes;
  if (input.fee !== undefined) body.fee = input.fee;
  return apiRequest<{ appointment: AppointmentRecord }>('/api/appointments/walk-in', {
    method: 'POST',
    body,
  });
}

/** GET /api/schedules — the caller's schedules, INCLUDING inactive ones. */
export function fetchStaffSchedules(): Promise<StaffSchedulesResponse> {
  return apiRequest<StaffSchedulesResponse>('/api/schedules');
}

/** POST /api/schedules — create (same body as PUT). */
export function createSchedule(
  input: ScheduleFormInput,
): Promise<{ schedule: StaffScheduleRecord }> {
  return apiRequest<{ schedule: StaffScheduleRecord }>('/api/schedules', {
    method: 'POST',
    body: scheduleBody(input),
  });
}

/** PUT /api/schedules/:id — FULL replace (send the complete body, omit nothing). */
export function updateSchedule(
  id: string,
  input: ScheduleFormInput,
): Promise<{ schedule: StaffScheduleRecord }> {
  return apiRequest<{ schedule: StaffScheduleRecord }>(`/api/schedules/${id}`, {
    method: 'PUT',
    body: scheduleBody(input),
  });
}

/**
 * DELETE /api/schedules/:id — SOFT delete only (isActive=false), idempotent.
 * The UI must label this "Deactivate", never "Delete" (history survives).
 */
export function deactivateSchedule(id: string): Promise<{ schedule: StaffScheduleRecord }> {
  return apiRequest<{ schedule: StaffScheduleRecord }>(`/api/schedules/${id}`, {
    method: 'DELETE',
  });
}

/** GET /api/schedules/:id/overrides — that schedule's overrides, date-asc. */
export function fetchOverrides(scheduleId: string): Promise<{ overrides: StaffOverride[] }> {
  return apiRequest<{ overrides: StaffOverride[] }>(`/api/schedules/${scheduleId}/overrides`);
}

/**
 * POST /api/schedules/:id/overrides — client-side mirror of the server rules
 * runs in the form (validation.ts); here the body shape enforces them too:
 * CLOSED carries NO times; MODIFIED_HOURS/SPECIAL carry both.
 */
export function createOverride(
  scheduleId: string,
  input: OverrideFormInput,
): Promise<{ override: StaffOverride }> {
  const body: Record<string, unknown> = {
    date: input.date,
    type: input.type,
  };
  if (input.type !== 'CLOSED') {
    body.newStartTime = input.newStartTime;
    body.newEndTime = input.newEndTime;
  }
  const reason = input.reason?.trim();
  if (reason) body.reason = reason;
  return apiRequest<{ override: StaffOverride }>(`/api/schedules/${scheduleId}/overrides`, {
    method: 'POST',
    body,
  });
}

/** DELETE /api/schedules/:id/overrides/:date — remove the override for a date. */
export function deleteOverride(
  scheduleId: string,
  date: string,
): Promise<{ deleted: boolean; date: string }> {
  return apiRequest<{ deleted: boolean; date: string }>(
    `/api/schedules/${scheduleId}/overrides/${date}`,
    { method: 'DELETE' },
  );
}

/**
 * GET /api/patients — the scoped doctor's patient book (grouped by phone).
 * Blank q is omitted by the api client (server returns everyone).
 */
export function fetchPatients(
  q: string,
  page: number,
  pageSize: number,
): Promise<PatientsResponse> {
  return apiRequest<PatientsResponse>('/api/patients', {
    query: { q: q.trim(), page, pageSize },
  });
}

/**
 * GET /api/patients/:phone/notes — phones contain '+', so the path param is
 * ALWAYS encodeURIComponent-ed here (never build the URL by hand elsewhere).
 */
export function fetchPatientNotes(phone: string): Promise<{ notes: PatientNote[] }> {
  return apiRequest<{ notes: PatientNote[] }>(`/api/patients/${encodeURIComponent(phone)}/notes`);
}

/** POST /api/patients/:phone/notes — authorId is the calling staff user. */
export function addPatientNote(
  phone: string,
  note: string,
  isImportant: boolean,
): Promise<{ note: PatientNote }> {
  return apiRequest<{ note: PatientNote }>(`/api/patients/${encodeURIComponent(phone)}/notes`, {
    method: 'POST',
    body: { note: note.trim(), isImportant },
  });
}

/**
 * PATCH /api/availability — doctor toggles their own profile; a compounder
 * toggles their delegated doctor's profile (server-side scope either way).
 */
export function setAvailability(isAvailableNow: boolean): Promise<{ isAvailableNow: boolean }> {
  return apiRequest<{ isAvailableNow: boolean }>('/api/availability', {
    method: 'PATCH',
    body: { isAvailableNow },
  });
}

/** GET /api/compounders — my compounders, active AND deactivated. DOCTOR only. */
export function fetchCompounders(): Promise<{ compounders: CompounderRecord[] }> {
  return apiRequest<{ compounders: CompounderRecord[] }>('/api/compounders');
}

/**
 * POST /api/compounders — DOCTOR only (compounder callers get 403). The
 * tempPassword in the 201 response is shown EXACTLY ONCE by the UI.
 * 409 PHONE_EXISTS when the phone is already registered.
 */
export function createCompounder(name: string, phone: string): Promise<CompounderCreated> {
  return apiRequest<CompounderCreated>('/api/compounders', {
    method: 'POST',
    body: { name: name.trim(), phone },
  });
}

/**
 * DELETE /api/compounders/:id — soft deactivate + ALL sessions revoked
 * immediately. There is NO reactivate endpoint — this cannot be undone.
 */
export function deactivateCompounder(id: string): Promise<{ user: CompounderRecord }> {
  return apiRequest<{ user: CompounderRecord }>(`/api/compounders/${id}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------

/** Build the FULL schedule body (shared by POST create and PUT full-replace).
 * Blank optional text fields are omitted (server stores null). */
function scheduleBody(input: ScheduleFormInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    clinicName: input.clinicName.trim(),
    clinicAddress: input.clinicAddress.trim(),
    avgMinutesPerPatient: input.avgMinutesPerPatient,
  };
  const pinCode = input.pinCode?.trim();
  if (pinCode) body.pinCode = pinCode;
  const landmark = input.landmark?.trim();
  if (landmark) body.landmark = landmark;
  const mapLink = input.mapLink?.trim();
  if (mapLink) body.mapLink = mapLink;
  return body;
}
