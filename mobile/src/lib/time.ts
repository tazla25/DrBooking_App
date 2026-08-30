/**
 * IST (Asia/Kolkata) date helpers — mirrors api/src/lib/time.ts semantics.
 *
 * TIME LAW (non-negotiable):
 *  1. Business dates are 'YYYY-MM-DD' strings interpreted in IST. They are
 *     passed through to/from the API VERBATIM — never timezone-converted.
 *  2. "Today" is computed in IST via Intl (NOT device timezone, NOT UTC).
 *     Between 18:30 and 00:00 UTC, device-local and UTC "today" are both
 *     wrong for the business.
 *  3. Day arithmetic anchors a date's noon in UTC (IST has no DST), so
 *     addDaysISO never drifts across device timezones.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

/** 'YYYY-MM-DD' for the current instant, formatted in IST (en-CA → ISO order). */
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's business date in IST as 'YYYY-MM-DD'. The ONLY way to get "today". */
export function istTodayISO(): string {
  return istDateFormatter.format(new Date());
}

/** Day of week (0 = Sunday … 6 = Saturday) of an IST 'YYYY-MM-DD' date. */
export function dayOfWeekISO(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}

/**
 * Add `days` (may be negative) to an IST business date, staying date-safe.
 * Pure string→UTC-noon→string math — no local timezone involved.
 */
export function addDaysISO(dateISO: string, days: number): string {
  const anchored = new Date(`${dateISO}T12:00:00Z`);
  anchored.setUTCDate(anchored.getUTCDate() + days);
  return anchored.toISOString().slice(0, 10);
}

/** The next `count` dates starting at (and including) `fromISO`. */
export function nextDates(fromISO: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysISO(fromISO, i));
}

/**
 * The first date within `days` (inclusive of `fromISO`) whose weekday matches
 * `dayOfWeek` — the natural next occurrence of a weekly schedule. Null when
 * none (only possible when days ≤ 6 for a weekly slot).
 */
export function firstDateForDay(fromISO: string, dayOfWeek: number, days = 7): string | null {
  for (const date of nextDates(fromISO, days)) {
    if (dayOfWeekISO(date) === dayOfWeek) return date;
  }
  return null;
}
