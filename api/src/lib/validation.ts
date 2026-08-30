import { z } from 'zod';
import { validateDateStr, validateTimeHM } from '@/lib/time';

/**
 * Request validation — zod on EVERY request body (and query).
 *
 * Phone policy (India-first):
 *  - 10-digit mobile numbers (starting 6-9) are normalized to
 *    +<DEFAULT_COUNTRY_CODE>XXXXXXXXXX (default country code: 91)
 *  - Full international form is accepted as-is when already normalized:
 *    +91XXXXXXXXXX or +880XXXXXXXXXX
 *
 * Password policy: minimum 8 chars, at least one letter and one number.
 */

// -- Domain constants (DB stores plain Strings; these guard the boundary) ----

export const ROLES = ['PATIENT', 'DOCTOR', 'COMPOUNDER', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

export const APPOINTMENT_STATUSES = [
  'CONFIRMED',
  'CALLED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export const APPOINTMENT_SOURCES = ['ONLINE', 'WALK_IN'] as const;

export const SCHEDULE_OVERRIDE_TYPES = ['CLOSED', 'MODIFIED_HOURS', 'SPECIAL'] as const;

// -- Phone normalization ------------------------------------------------------

export function defaultCountryCode(): string {
  const cc = (process.env.DEFAULT_COUNTRY_CODE ?? '91').replace(/\D/g, '');
  return cc || '91';
}

/**
 * Normalize a phone number to '+<cc>XXXXXXXXXX' form.
 * Returns null when the input is not an accepted format.
 */
export function normalizePhone(input: string): string | null {
  const cc = defaultCountryCode();
  const s = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;

  const fullCcForm = new RegExp(`^${cc}[6-9]\\d{9}$`);

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (fullCcForm.test(digits)) return `+${digits}`; // e.g. +919876543210
    if (/^880\d{10}$/.test(digits)) return `+${digits}`; // e.g. +8801712345678
    return null;
  }

  if (/^0?[6-9]\d{9}$/.test(s)) return `+${cc}${s.replace(/^0/, '')}`; // 9876543210 / 09876543210
  if (fullCcForm.test(s)) return `+${s}`; // 919876543210
  return null;
}

// -- Primitive schemas ---------------------------------------------------------

export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
      return value;
    }
    return normalized;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const roleEnum = z.enum(ROLES);
export const appointmentStatusEnum = z.enum(APPOINTMENT_STATUSES);
export const appointmentSourceEnum = z.enum(APPOINTMENT_SOURCES);

// -- Request body schemas -------------------------------------------------------

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long'),
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(['PATIENT', 'DOCTOR'], {
    message: 'Role must be PATIENT or DOCTOR',
  }),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// -- Phase 2: doctor/compounder panel (contracts #13–25) ------------------------

/** Person/display name — same policy as self-registration names. */
export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name is too long');

/** IST business date 'YYYY-MM-DD' (calendar-checked, not just regex). */
export const dateSchema = z.string().refine(validateDateStr, 'Invalid date (expected YYYY-MM-DD)');

/** IST business time 'HH:mm' (00:00–23:59). */
export const timeSchema = z.string().refine(validateTimeHM, 'Invalid time (expected HH:mm)');

/** Statuses a staff member may SET on an appointment (CONFIRMED is book-only). */
export const settableStatusEnum = z.enum(['CALLED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], {
  message: 'Status must be one of CALLED, COMPLETED, CANCELLED, NO_SHOW',
});

// GET /api/queue/today — ?date & ?doctorId (doctorId honored for SUPER_ADMIN only)
export const queueTodayQuerySchema = z.object({
  date: dateSchema.optional(),
  doctorId: z.string().trim().min(1, 'doctorId must not be empty').optional(),
});

// GET /api/schedules — optional admin targeting
export const schedulesQuerySchema = z.object({
  doctorId: z.string().trim().min(1, 'doctorId must not be empty').optional(),
});

// POST /api/appointments/walk-in
export const walkInSchema = z.object({
  scheduleId: z.string().trim().min(1, 'scheduleId is required'),
  date: dateSchema,
  patientName: nameSchema,
  patientPhone: phoneSchema,
  notes: z.string().trim().max(2000, 'Notes are too long').optional(),
  fee: z.number().int('Fee must be an integer').min(0, 'Fee must be >= 0').max(1_000_000, 'Fee is too large').optional(),
});

// POST /api/appointments/:id/status
export const appointmentStatusSchema = z.object({
  status: settableStatusEnum,
});

// POST/PUT schedules — shared field set (PUT may omit nothing: full replace)
export const scheduleSchema = z
  .object({
    dayOfWeek: z.number().int().min(0, 'dayOfWeek must be 0 (Sun) to 6 (Sat)').max(6, 'dayOfWeek must be 0 (Sun) to 6 (Sat)'),
    startTime: timeSchema,
    endTime: timeSchema,
    clinicName: z.string().trim().min(1, 'clinicName is required'),
    clinicAddress: z.string().trim().min(1, 'clinicAddress is required'),
    pinCode: z.string().trim().max(12, 'pinCode is too long').optional(),
    landmark: z.string().trim().max(200, 'landmark is too long').optional(),
    mapLink: z.string().trim().max(500, 'mapLink is too long').optional(),
    avgMinutesPerPatient: z
      .number()
      .int('avgMinutesPerPatient must be an integer')
      .min(1, 'avgMinutesPerPatient must be between 1 and 120')
      .max(120, 'avgMinutesPerPatient must be between 1 and 120')
      .default(10),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

// POST /api/schedules/:id/overrides
export const overrideCreateSchema = z.object({
  date: dateSchema,
  type: z.enum(SCHEDULE_OVERRIDE_TYPES, {
    message: 'type must be CLOSED, MODIFIED_HOURS or SPECIAL',
  }),
  newStartTime: timeSchema.optional(),
  newEndTime: timeSchema.optional(),
  reason: z.string().trim().max(300, 'reason is too long').optional(),
});

// GET /api/patients — ?q, ?page, ?pageSize
export const patientsQuerySchema = z.object({
  q: z.string().trim().max(100, 'Search query is too long').optional(),
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1').default(1),
  pageSize: z.coerce.number().int('pageSize must be an integer').min(1, 'pageSize must be >= 1').max(100, 'pageSize must be <= 100').default(20),
});

// POST /api/patients/:phone/notes
export const noteCreateSchema = z.object({
  note: z.string().trim().min(1, 'Note is required').max(2000, 'Note is too long (max 2000 characters)'),
  isImportant: z.boolean().optional(),
});

// POST /api/compounders
export const compounderCreateSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
});

// PATCH /api/availability
export const availabilitySchema = z.object({
  isAvailableNow: z.boolean({ message: 'isAvailableNow must be a boolean' }),
});

// -- Phase 3: patient booking + public queue (contracts #6–12, 32, 33) ---------

// GET /api/doctors — ?q, ?pinCode, ?sort, ?page, ?pageSize (all optional)
export const doctorsQuerySchema = z.object({
  q: z.string().trim().max(100, 'Search query is too long').optional(),
  pinCode: z.string().trim().min(1, 'pinCode must not be empty').max(12, 'pinCode is too long').optional(),
  sort: z.enum(['rating', 'fee_asc', 'fee_desc'], {
    message: 'sort must be rating, fee_asc or fee_desc',
  }).default('rating'),
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1').default(1),
  pageSize: z.coerce
    .number()
    .int('pageSize must be an integer')
    .min(1, 'pageSize must be >= 1')
    .max(50, 'pageSize must be <= 50')
    .default(20),
});

// GET /api/schedules/:id/availability — ?date (optional, defaults to IST today)
export const availabilityQuerySchema = z.object({
  date: dateSchema.optional(),
});

// POST /api/appointments (patient booking) — identity comes from the session,
// so the body carries ONLY the slot. Any patientName/patientPhone in the body
// is stripped by zod and never read (v1 IDOR fix).
export const patientBookingSchema = z.object({
  scheduleId: z.string().trim().min(1, 'scheduleId is required'),
  date: dateSchema,
});

// GET /api/appointments/mine — ?range=upcoming|past, ?page, ?pageSize
export const mineQuerySchema = z.object({
  range: z.enum(['upcoming', 'past'], { message: 'range must be upcoming or past' }).default('upcoming'),
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1').default(1),
  pageSize: z.coerce
    .number()
    .int('pageSize must be an integer')
    .min(1, 'pageSize must be >= 1')
    .max(100, 'pageSize must be <= 100')
    .default(20),
});

// GET /api/queue/:scheduleId/:date — dynamic-route params
export const queuePublicParamsSchema = z.object({
  scheduleId: z.string().trim().min(1, 'scheduleId is required'),
  date: dateSchema,
});

// POST /api/feedback
export const feedbackSchema = z.object({
  appointmentId: z.string().trim().min(1, 'appointmentId is required'),
  rating: z
    .number()
    .int('Rating must be an integer')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  comment: z.string().trim().max(1000, 'Comment is too long (max 1000 characters)').optional(),
});

// POST /api/devices
export const deviceTokenSchema = z.object({
  token: z.string().trim().min(10, 'Device token is too short').max(512, 'Device token is too long'),
  platform: z.enum(['ios', 'android'], { message: "platform must be 'ios' or 'android'" }),
});

export type WalkInInput = z.infer<typeof walkInSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type OverrideCreateInput = z.infer<typeof overrideCreateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type CompounderCreateInput = z.infer<typeof compounderCreateSchema>;
