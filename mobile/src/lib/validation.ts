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
