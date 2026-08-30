import { z } from 'zod';

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
