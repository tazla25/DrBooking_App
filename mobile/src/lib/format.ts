/** Display helpers. TIME LAW: business dates/times are plain IST strings —
 * these functions only PRETTIFY for display; they never convert or do
 * timezone math. */

import { istDateOfISO, istTimeOfISO } from './time';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** dayOfWeek index (0 = Sunday … 6 = Saturday, matching api time.ts). */
export function dayName(dayOfWeek: number, short = false): string {
  const list = short ? DAY_SHORT : DAY_NAMES;
  return list[dayOfWeek] ?? '';
}

/** 9 → "₹9"; 9.5 → "₹9.50"; null → "—" */
export function formatFee(fee: number | null): string {
  if (fee === null || fee === undefined) return '—';
  const rounded = Math.round(fee * 100) / 100;
  return Number.isInteger(rounded) ? `₹${rounded}` : `₹${rounded.toFixed(2)}`;
}

/** 4.5 → "4.5"; 0 → "New" */
export function formatRating(avgRating: number): string {
  if (!avgRating || avgRating <= 0) return 'New';
  return String(Math.round(avgRating * 10) / 10);
}

/** '2026-08-30' → '30 Aug 2026' (string slicing only — no Date math). */
export function formatDateISO(dateISO: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [y, m, d] = dateISO.split('-');
  if (!y || !m || !d) return dateISO;
  return `${d} ${months[Number(m) - 1] ?? m} ${y}`;
}

/** '2026-08-30' → '30 Aug' (compact chip form for the date strip). */
export function formatDayMonth(dateISO: string): string {
  const full = formatDateISO(dateISO);
  const parts = full.split(' ');
  if (parts.length !== 3) return dateISO;
  return `${parts[0]} ${parts[1]}`;
}

/**
 * UTC ISO-8601 timestamp → '30 Aug 2026 · 14:35 IST'. Uses the IST calendar
 * date (never `ts.slice(0, 10)`, which is UTC and off-by-one after 18:30 IST).
 */
export function formatISTTimestamp(timestamp: string): string {
  const date = formatDateISO(istDateOfISO(timestamp));
  const time = istTimeOfISO(timestamp);
  return time ? `${date} · ${time} IST` : date;
}
