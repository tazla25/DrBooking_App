/**
 * Client-side validation mirrors of the api/ zod rules (instant feedback —
 * the server remains the authority; its VALIDATION_ERROR message is shown
 * when something slips past these).
 */

/** Default country code — matches the api's DEFAULT_COUNTRY_CODE (+91). */
export const DEFAULT_COUNTRY_CODE = '+91';

/**
 * Normalize an Indian phone number for the API: accepts
 * 9876543210 / 09876543210 / 919876543210 / +919876543210 (+880… kept).
 * Returns null when it cannot be normalized.
 */
export function normalizePhoneInput(input: string): string | null {
  const s = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
    if (/^880\d{10}$/.test(digits)) return `+${digits}`;
    return null;
  }
  if (/^0?[6-9]\d{9}$/.test(s)) return `+91${s.replace(/^0/, '')}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhoneInput(input) !== null;
}

/** ≥ 8 chars, ≤ 72, at least one letter and one number (api passwordSchema). */
export function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && pw.length <= 72 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

// -- Phase 7: staff console mirrors (api/src/lib/validation.ts) ---------------

/** 'HH:mm' 00:00–23:59 — mirror of the api's TIME_RE. */
const TIME_HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Calendar-checked 'YYYY-MM-DD' — mirror of the api's validateDateStr
 * (2026-02-30 rolls over and fails the round-trip; device timezone never
 * participates — the anchor is UTC noon, IST has no DST). */
export function isValidDateStr(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const anchored = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(anchored.getTime())) return false;
  const roundTrip = [
    anchored.getUTCFullYear(),
    String(anchored.getUTCMonth() + 1).padStart(2, '0'),
    String(anchored.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return roundTrip === value;
}

export function isValidTimeHM(value: string): boolean {
  return TIME_HM_RE.test(value);
}

/** Form values for the schedule create/edit modal (text fields are strings). */
export interface ScheduleFormValues {
  dayOfWeek: number | null; // 0 (Sun) … 6 (Sat)
  startTime: string;
  endTime: string;
  clinicName: string;
  clinicAddress: string;
  pinCode: string;
  landmark: string;
  mapLink: string;
  /** Raw text-field value — validated into an int 1–120. */
  avgMinutesPerPatient: string;
}

export type ScheduleFormErrors = Partial<Record<keyof ScheduleFormValues, string>>;

/** Errors are empty ⇔ the form may be submitted. */
export function validateScheduleForm(v: ScheduleFormValues): ScheduleFormErrors {
  const errors: ScheduleFormErrors = {};
  if (v.dayOfWeek === null || v.dayOfWeek < 0 || v.dayOfWeek > 6) {
    errors.dayOfWeek = 'Pick a day of the week';
  }
  if (!isValidTimeHM(v.startTime)) errors.startTime = 'Use HH:mm (e.g. 09:00)';
  if (!isValidTimeHM(v.endTime)) errors.endTime = 'Use HH:mm (e.g. 13:00)';
  if (!errors.startTime && !errors.endTime && v.startTime >= v.endTime) {
    errors.endTime = 'End time must be after start time';
  }
  if (!v.clinicName.trim()) errors.clinicName = 'Clinic name is required';
  if (!v.clinicAddress.trim()) errors.clinicAddress = 'Clinic address is required';
  if (v.pinCode.trim().length > 12) errors.pinCode = 'PIN code is too long';
  if (v.landmark.trim().length > 200) errors.landmark = 'Landmark is too long';
  if (v.mapLink.trim().length > 500) errors.mapLink = 'Map link is too long';
  const avg = Number(v.avgMinutesPerPatient.trim());
  if (
    !/^\d+$/.test(v.avgMinutesPerPatient.trim()) ||
    !Number.isInteger(avg) ||
    avg < 1 ||
    avg > 120
  ) {
    errors.avgMinutesPerPatient = 'Minutes per patient must be 1–120';
  }
  return errors;
}

export type OverrideTypeValue = 'CLOSED' | 'MODIFIED_HOURS' | 'SPECIAL';

/** Form values for the override add form. */
export interface OverrideFormValues {
  date: string;
  type: OverrideTypeValue | null;
  newStartTime: string;
  newEndTime: string;
  reason: string;
}

export type OverrideFormErrors = Partial<Record<keyof OverrideFormValues, string>>;

/**
 * TYPE-CONDITIONAL mirror of the api rules:
 *  - CLOSED must carry NO times;
 *  - MODIFIED_HOURS / SPECIAL REQUIRE both times with start < end.
 * The client rejects invalid forms BEFORE submit (the server re-checks).
 */
export function validateOverrideForm(v: OverrideFormValues): OverrideFormErrors {
  const errors: OverrideFormErrors = {};
  if (!isValidDateStr(v.date)) errors.date = 'Use a valid date (YYYY-MM-DD)';
  if (v.type === null) {
    errors.type = 'Pick an override type';
  } else if (v.type === 'CLOSED') {
    if (v.newStartTime.trim() || v.newEndTime.trim()) {
      errors.newStartTime = 'A CLOSED override cannot carry times';
    }
  } else {
    if (!isValidTimeHM(v.newStartTime)) errors.newStartTime = 'Use HH:mm (e.g. 09:00)';
    if (!isValidTimeHM(v.newEndTime)) errors.newEndTime = 'Use HH:mm (e.g. 13:00)';
    if (!errors.newStartTime && !errors.newEndTime && v.newStartTime >= v.newEndTime) {
      errors.newEndTime = 'End time must be after start time';
    }
  }
  if (v.reason.trim().length > 300) errors.reason = 'Reason is too long (max 300)';
  return errors;
}

/** Form values for the walk-in modal. */
export interface WalkInFormValues {
  patientName: string;
  patientPhone: string;
  /** Raw text-field value — blank means "use the doctor's fee" (omit). */
  fee: string;
  notes: string;
}

export type WalkInFormErrors = Partial<Record<keyof WalkInFormValues, string>>;

export function validateWalkInForm(v: WalkInFormValues): WalkInFormErrors {
  const errors: WalkInFormErrors = {};
  const name = v.patientName.trim();
  if (name.length < 2 || name.length > 100) errors.patientName = 'Enter the patient name (2–100)';
  if (!isValidPhone(v.patientPhone)) errors.patientPhone = 'Enter a valid phone number';
  const feeRaw = v.fee.trim();
  if (feeRaw !== '') {
    if (!/^\d+$/.test(feeRaw)) {
      errors.fee = 'Fee must be a whole number (₹)';
    } else {
      const fee = Number(feeRaw);
      if (fee > 1_000_000) errors.fee = 'Fee is too large';
    }
  }
  if (v.notes.trim().length > 2000) errors.notes = 'Notes are too long (max 2000)';
  return errors;
}

/** Note add form — 1..2000 chars after trim (mirror of noteCreateSchema). */
export function validateNoteForm(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed.length < 1) return 'Write the note first';
  if (trimmed.length > 2000) return 'Note is too long (max 2000 characters)';
  return null;
}
