import { db } from '@/lib/db';
import { addDaysISO, istTodayISO } from '@/lib/time';

/**
 * Analytics core (Phase 4, contracts #29–30).
 *
 * ALL day boundaries come from src/lib/time.ts (Asia/Kolkata) — never
 * toISOString(), which would shift the day for IST between 18:30–00:00 UTC.
 *
 * Windows (inclusive, IST business dates):
 *   today    = [today, today]
 *   last7d   = [today-6, today]
 *   last30d  = [today-29, today]
 * Future appointments (date > today) never count — the windows end at today.
 */

export interface DayMetrics {
  booked: number; // appointments created for the window (ONLINE + WALK_IN, any status)
  completed: number;
  cancelled: number;
  noShow: number;
  walkIns: number; // source = WALK_IN (any status)
  revenue: number; // sum of fee over COMPLETED appointments (both sources)
}

export function emptyMetrics(): DayMetrics {
  return { booked: 0, completed: 0, cancelled: 0, noShow: 0, walkIns: 0, revenue: 0 };
}

interface MetricRow {
  date: string;
  status: string;
  source: string;
  fee: number | null;
}

function accumulate(m: DayMetrics, row: MetricRow): void {
  m.booked += 1;
  if (row.status === 'COMPLETED') {
    m.completed += 1;
    m.revenue += row.fee ?? 0;
  } else if (row.status === 'CANCELLED') {
    m.cancelled += 1;
  } else if (row.status === 'NO_SHOW') {
    m.noShow += 1;
  }
  if (row.source === 'WALK_IN') m.walkIns += 1;
}

/** Fetch the 30-day slice once and reduce it into today / last7d / last30d. */
export async function summaryMetrics(doctorId: string): Promise<{
  todayDate: string;
  last7dStart: string;
  last30dStart: string;
  today: DayMetrics;
  last7d: DayMetrics;
  last30d: DayMetrics;
}> {
  const today = istTodayISO();
  const last7dStart = addDaysISO(today, -6);
  const last30dStart = addDaysISO(today, -29);

  // 'YYYY-MM-DD' compares lexicographically — safe for ISO business dates.
  const rows = await db.appointment.findMany({
    where: { doctorId, date: { gte: last30dStart, lte: today } },
    select: { date: true, status: true, source: true, fee: true },
  });

  const mToday = emptyMetrics();
  const m7 = emptyMetrics();
  const m30 = emptyMetrics();
  for (const row of rows) {
    accumulate(m30, row);
    if (row.date >= last7dStart) accumulate(m7, row);
    if (row.date === today) accumulate(mToday, row);
  }

  return {
    todayDate: today,
    last7dStart,
    last30dStart,
    today: mToday,
    last7d: m7,
    last30d: m30,
  };
}

export interface RevenueDayPoint {
  date: string;
  count: number; // COMPLETED appointments that day
  revenue: number; // sum of their fees
}

/**
 * Daily COMPLETED series over the last `days` IST days (inclusive of today),
 * zero-filled for days without completions, ascending by date.
 */
export async function revenueSeries(doctorId: string, days: number): Promise<RevenueDayPoint[]> {
  const today = istTodayISO();
  const start = addDaysISO(today, -(days - 1));

  const rows = await db.appointment.findMany({
    where: { doctorId, date: { gte: start, lte: today }, status: 'COMPLETED' },
    select: { date: true, fee: true },
  });

  const byDate = new Map<string, RevenueDayPoint>();
  for (let i = 0; i < days; i += 1) {
    const date = addDaysISO(start, i);
    byDate.set(date, { date, count: 0, revenue: 0 });
  }
  for (const row of rows) {
    const point = byDate.get(row.date);
    if (!point) continue; // outside the window — impossible given the where, kept for safety
    point.count += 1;
    point.revenue += row.fee ?? 0;
  }

  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}
