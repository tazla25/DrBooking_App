/**
 * IST (Asia/Kolkata) time helpers — the ONLY source of "today" in the system.
 *
 * NON-NEGOTIABLE RULES (learned from the v1 WhatsApp bot bugs):
 *  1. Business dates are 'YYYY-MM-DD' strings; business times are 'HH:mm'
 *     strings. They are ALWAYS interpreted in Asia/Kolkata (IST, UTC+05:30).
 *  2. "Today" MUST come from `istTodayISO()` (Intl with timeZone
 *     'Asia/Kolkata'). NEVER use `new Date().toISOString()` (UTC) for
 *     business logic — IST is UTC+05:30, so toISOString() is "yesterday"
 *     between 18:30 and 00:00 UTC.
 *  3. IST has no daylight-saving time, so fixed '+05:30' anchoring at noon
 *     is safe for day arithmetic.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

/** 'YYYY-MM-DD' for a Date instant, formatted in IST (en-CA yields ISO order). */
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'HH:mm' (24h, h23) for a Date instant, formatted in IST. */
const istTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** Weekday abbreviation → 0 (Sunday) .. 6 (Saturday). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const istWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIME_ZONE,
  weekday: 'short',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Current instant. Returns a plain `Date` (an absolute point in time —
 * timezone-independent) suitable for timestamps like `expiresAt`.
 * For business "today"/"now time" use istTodayISO()/istTimeHM() instead.
 */
export function istNow(): Date {
  return new Date();
}

/** Today's business date in IST as 'YYYY-MM-DD'. The ONLY way to get "today". */
export function istTodayISO(): string {
  return istDateFormatter.format(istNow());
}

/** Current wall-clock time in IST as 'HH:mm'. */
export function istTimeHM(): string {
  return istTimeFormatter.format(istNow());
}

/** True when `value` is a real calendar date in 'YYYY-MM-DD' form. */
export function validateDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const anchored = istNoonOf(value);
  if (anchored.getTime() !== anchored.getTime()) return false; // NaN check
  // Round-trip: invalid calendar dates (2026-02-30) roll over and mismatch.
  return istDateFormatter.format(anchored) === value;
}

/** True when `value` is a valid 'HH:mm' time between 00:00 and 23:59. */
export function validateTimeHM(value: string): boolean {
  return TIME_RE.test(value);
}

/** Day of week (0 = Sunday … 6 = Saturday) of an IST 'YYYY-MM-DD' date. */
export function dayOfWeekIST(dateISO: string): number {
  if (!validateDateStr(dateISO)) {
    throw new Error(`dayOfWeekIST: invalid date string "${dateISO}"`);
  }
  const weekday = istWeekdayFormatter.format(istNoonOf(dateISO));
  const index = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  if (index < 0) throw new Error(`dayOfWeekIST: unexpected weekday "${weekday}"`);
  return index;
}

/** Add `days` (may be negative) to an IST business date, staying date-safe. */
export function addDaysISO(dateISO: string, days: number): string {
  if (!validateDateStr(dateISO)) {
    throw new Error(`addDaysISO: invalid date string "${dateISO}"`);
  }
  const anchored = istNoonOf(dateISO);
  anchored.setTime(anchored.getTime() + days * 86_400_000);
  return istDateFormatter.format(anchored);
}

/** Build a Date pinned to 12:00 IST of the given 'YYYY-MM-DD'. */
function istNoonOf(dateISO: string): Date {
  return new Date(`${dateISO}T12:00:00+05:30`);
}
