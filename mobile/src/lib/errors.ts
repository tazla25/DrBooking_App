/**
 * ApiError + the error-code → friendly-English message map.
 *
 * The API envelope is `{ ok:false, error:{ code, message } }`. Codes are the
 * machine contract; users see the mapped English sentences below (the API's
 * own `message` is developer-facing phrasing, kept as a fallback).
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Extra context (e.g. retryAfter seconds for RATE_LIMITED). */
  readonly meta: Record<string, unknown>;

  constructor(status: number, code: string, message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Map any thrown value to the friendly English message (screens call this). */
export function toFriendlyMessage(err: unknown): string {
  return err instanceof ApiError
    ? friendlyMessage(err)
    : friendlyMessage({ code: 'NETWORK_ERROR', status: 0 });
}

/** Codes surfaced by api/ (see api/src/lib/errors.ts, rbac.ts, rate-limit.ts, auth.ts). */
type FriendlyInput = { code: string; status: number; message?: string; retryAfter?: number | null };

export function friendlyMessage({ code, status, message, retryAfter }: FriendlyInput): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Please sign in to continue.';
    case 'FORBIDDEN':
      return 'You do not have access to this.';
    case 'NOT_FOUND':
      return 'We could not find what you were looking for.';
    case 'VALIDATION_ERROR':
      return message ?? 'Please check the highlighted fields.';
    case 'PHONE_EXISTS':
      return 'An account with this phone number already exists.';
    case 'ACCOUNT_LOCKED':
      return 'Too many failed attempts. Your account is locked for 15 minutes.';
    case 'RATE_LIMITED': {
      const secs = retryAfter ?? null;
      const retry = secs && secs > 0 ? ` Please retry in ${secs}s.` : ' Please try again shortly.';
      return `Too many requests.${retry}`;
    }
    case 'ALREADY_BOOKED':
      return 'You already have an active booking for this schedule.';
    case 'ALREADY_IN_QUEUE':
      return 'This patient is already in the queue for this schedule.';
    case 'CAPACITY_FULL':
      return 'This schedule is fully booked for that day.';
    case 'SCHEDULE_CLOSED':
      return 'The clinic is closed on that day.';
    case 'SCHEDULE_INACTIVE':
      return 'This schedule has been deactivated. Reactivate it first.';
    case 'INVALID_TRANSITION':
      return message ?? 'This action is not allowed for the current status.';
    case 'ACCOUNT_NOT_VERIFIED':
    case 'DOCTOR_NOT_VERIFIED':
      return 'Your doctor account has not been verified yet.';
    case 'ALREADY_REVIEWED':
      return 'You have already reviewed this visit.';
    case 'NOT_COMPLETED':
      return 'You can review a visit only after it is completed.';
    case 'OVERRIDE_EXISTS':
      return 'An override already exists for this date — delete it first.';
    case 'INTERNAL_ERROR':
      return 'Something went wrong. Please try again.';
    case 'NETWORK_ERROR':
      return 'Cannot reach the server. Check your connection and try again.';
    default:
      return message ?? `Request failed (HTTP ${status}). Please try again.`;
  }
}
