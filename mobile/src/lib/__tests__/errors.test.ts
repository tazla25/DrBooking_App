import { ApiError, friendlyMessage, isApiError } from '../errors';
import { formatFee, formatRating, formatDateISO, dayName } from '../format';
import { isValidName, isValidPassword, isValidPhone, normalizePhoneInput } from '../validation';

describe('friendlyMessage — error code → English message map', () => {
  test('ACCOUNT_LOCKED explains the 15-minute lock', () => {
    expect(friendlyMessage({ code: 'ACCOUNT_LOCKED', status: 429 })).toContain('locked');
  });

  test('RATE_LIMITED includes retry seconds when present', () => {
    const msg = friendlyMessage({ code: 'RATE_LIMITED', status: 429, retryAfter: 42 });
    expect(msg).toContain('Too many requests');
    expect(msg).toContain('42s');
  });

  test('RATE_LIMITED without retry seconds still reads well', () => {
    expect(friendlyMessage({ code: 'RATE_LIMITED', status: 429 })).toContain('try again');
  });

  test('booking-family codes map to distinct friendly sentences', () => {
    expect(friendlyMessage({ code: 'ALREADY_BOOKED', status: 409 })).toContain('already');
    expect(friendlyMessage({ code: 'CAPACITY_FULL', status: 409 })).toContain('fully booked');
    expect(friendlyMessage({ code: 'SCHEDULE_CLOSED', status: 409 })).toContain('closed');
  });

  test('verification codes (both spellings) explain the pending state', () => {
    const expected = 'not been verified yet';
    expect(friendlyMessage({ code: 'DOCTOR_NOT_VERIFIED', status: 403 })).toContain(expected);
    expect(friendlyMessage({ code: 'ACCOUNT_NOT_VERIFIED', status: 403 })).toContain(expected);
  });

  test('VALIDATION_ERROR falls back to the server message when provided', () => {
    expect(
      friendlyMessage({ code: 'VALIDATION_ERROR', status: 422, message: 'Invalid phone number' }),
    ).toBe('Invalid phone number');
  });

  test('unknown codes fall back to the server message, then HTTP status', () => {
    expect(friendlyMessage({ code: 'SOME_NEW_CODE', status: 418, message: 'Teapot' })).toBe(
      'Teapot',
    );
    expect(friendlyMessage({ code: 'SOME_NEW_CODE', status: 418 })).toContain('418');
  });
});

describe('ApiError', () => {
  test('carries code, status, message and meta', () => {
    const err = new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter: 9 });
    expect(isApiError(err)).toBe(true);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.message).toBe('Too many requests');
    expect(err.meta).toEqual({ retryAfter: 9 });
  });

  test('isApiError rejects non-ApiError values', () => {
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError('string')).toBe(false);
  });
});

describe('format helpers', () => {
  test('formatFee renders rupees, decimals and null', () => {
    expect(formatFee(9)).toBe('₹9');
    expect(formatFee(9.5)).toBe('₹9.50');
    expect(formatFee(null)).toBe('—');
  });

  test('formatRating renders "New" for zero-rating doctors', () => {
    expect(formatRating(0)).toBe('New');
    expect(formatRating(4.55)).toBe('4.6');
  });

  test('formatDateISO slices the IST date string (no Date math)', () => {
    expect(formatDateISO('2026-08-30')).toBe('30 Aug 2026');
    expect(formatDateISO('bad')).toBe('bad');
  });

  test('dayName maps the api dayOfWeek convention (0 = Sunday)', () => {
    expect(dayName(0)).toBe('Sunday');
    expect(dayName(3, true)).toBe('Wed');
    expect(dayName(6)).toBe('Saturday');
  });
});

describe('client-side validation mirrors', () => {
  test('normalizePhoneInput accepts the Indian forms and rejects junk', () => {
    expect(normalizePhoneInput('9876543210')).toBe('+919876543210');
    expect(normalizePhoneInput('09876543210')).toBe('+919876543210');
    expect(normalizePhoneInput('919876543210')).toBe('+919876543210');
    expect(normalizePhoneInput('+919876543210')).toBe('+919876543210');
    expect(normalizePhoneInput('+9198765 43210')).toBe('+919876543210');
    expect(normalizePhoneInput('+8801712345678')).toBe('+8801712345678');
    expect(normalizePhoneInput('12345')).toBeNull();
    expect(normalizePhoneInput('not-a-phone')).toBeNull();
  });

  test('isValidPassword mirrors the api passwordSchema', () => {
    expect(isValidPassword('Test@1234')).toBe(true);
    expect(isValidPassword('short1')).toBe(false);
    expect(isValidPassword('nodigitshere')).toBe(false);
    expect(isValidPassword('12345678')).toBe(false);
  });

  test('isValidName and isValidPhone basics', () => {
    expect(isValidName('Priya Nair')).toBe(true);
    expect(isValidName('P')).toBe(false);
    expect(isValidPhone('+919876543210')).toBe(true);
    expect(isValidPhone('abc')).toBe(false);
  });
});
