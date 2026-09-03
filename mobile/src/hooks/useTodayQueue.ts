import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  fetchTodayQueue,
  confirmAppointment,
  rejectAppointment,
  type StaffQueueAppointment,
  type TodayQueueResponse,
} from '@/lib/staff';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { toFriendlyMessage } from '@/lib/errors';

/**
 * The Today tab auto-refresh cadence (same 15s as the patient live queue).
 */
export const TODAY_QUEUE_POLL_INTERVAL_MS = 15_000;

/**
 * mobilefix1 FIX B — upcoming-pending scan window: the 7 IST days AFTER today
 * (mirrors the patient book screen's DATE_STRIP_DAYS = 7 horizon, so a
 * future-dated booking is always within the scan range).
 */
export const UPCOMING_SCAN_DAYS = 7;

/** One upcoming-pending row: the appointment + the IST date it belongs to. */
export interface UpcomingPendingRow {
  appointment: StaffQueueAppointment;
  /** 'YYYY-MM-DD' IST — the booking's date (verbatim, never converted). */
  date: string;
}

/** The scan dates: today + 1 … today + UPCOMING_SCAN_DAYS (IST strings). */
function upcomingScanDates(): string[] {
  const today = istTodayISO();
  return Array.from({ length: UPCOMING_SCAN_DAYS }, (_, i) => addDaysISO(today, i + 1));
}

interface QueueState {
  data: TodayQueueResponse | null;
  loadedFor: string | null; // the date the current data belongs to
  message: string | null;
  refreshing: boolean;
}

/** Symmetric count adjust: -1 when `status` is left, +1 when it is entered. */
function adjustCount(count: number, from: string, to: string, status: string): number {
  return Math.max(0, count + (to === status ? 1 : 0) - (from === status ? 1 : 0));
}

/** Status flip helpers for the optimistic confirm (and its rollback). */
function withAppointmentStatus(
  data: TodayQueueResponse,
  id: string,
  from: string,
  to: string,
): TodayQueueResponse {
  const matches = (a: StaffQueueAppointment) => a.id === id && a.status === from;
  const changed = data.appointments.some(matches);
  if (!changed) return data; // stale/foreign row — leave untouched
  return {
    ...data,
    appointments: data.appointments.map((a) => (matches(a) ? { ...a, status: to } : a)),
    counts: {
      ...data.counts,
      pending: adjustCount(data.counts.pending, from, to, 'PENDING'),
      confirmed: adjustCount(data.counts.confirmed, from, to, 'CONFIRMED'),
    },
  };
}

/**
 * The staff "Today" queue with 15s focus-polling — same architecture as the
 * patient useLiveQueue hook (Phase 6), parameterized by business DATE:
 *
 *  - fetches immediately when (re)activated or when the date changes;
 *  - polls every TODAY_QUEUE_POLL_INTERVAL_MS while active (skips a tick when
 *    the previous request is still in flight);
 *  - clears the interval on unfocus/unmount (effect cleanup);
 *  - keeps the LAST GOOD data on a failed poll and surfaces `error` — the
 *    next successful poll clears it;
 *  - `refresh()` serves pull-to-refresh AND refetch-after-mutation (every
 *    queue mutation on the Today tab calls it).
 *
 * Phase 11 B3 — manual confirmation actions on the PENDING section:
 *  - `confirmPending(id)`: single-tap CONFIRM with an OPTIMISTIC status flip
 *    (row moves out of the pending section instantly) and a full ROLLBACK on
 *    failure; a background refresh re-syncs counts/estWait after success.
 *  - `rejectPending(id, note?)`: destructive — never optimistic; CANCELLED
 *    via the existing status route, the optional note persisted as a patient
 *    note (best-effort, never rolls the rejection back).
 *  - `pending`: the derived PENDING rows (top section of the console).
 *  Both return a friendly error message (null on success) for the toast.
 *
 * mobilefix1 FIX B — `upcomingPending`: PENDING bookings for FUTURE dates
 * (today + 1 … + 7, the book-screen horizon) EXCLUDING the selected date
 * (those already render in the pending card). The scan reuses the EXISTING
 * `fetchTodayQueue(date)` (L2 — no new endpoints), bounded parallel (7
 * requests), dedupes by appointment id, runs on focus / date change /
 * pull-to-refresh / after every confirm/reject settles — and NEVER on the
 * 15s poll tick (bounded cost). A date whose fetch fails is simply absent
 * (its last-good rows are kept — no error banner; the selected-date queue
 * owns error UX). Nothing here blocks the console's first render.
 *
 * TIME LAW: `date` is a verbatim 'YYYY-MM-DD' IST string — never converted.
 * Rule-safe updates: no synchronous setState inside effect bodies.
 *
 * mobilefix2 P2 — foreground re-sync: returning to `active` after a
 * background stint fires the SILENT refresh path (refresh + rescan) once per
 * transition, guarded by the existing in-flight sentinels (a fetch already
 * in flight absorbs the trigger). The 15s poll cadence is untouched.
 */
export function useTodayQueue(date: string, active: boolean) {
  const [state, setState] = useState<QueueState>({
    data: null,
    loadedFor: null,
    message: null,
    refreshing: false,
  });

  const inFlight = useRef(false);

  // -- FIX B: the upcoming-pending scan state (last-good, all horizon dates;
  // the SELECTED date is excluded at derive time so switching dates
  // re-partitions the two cards instantly, without waiting for the network).
  const [upcomingScan, setUpcomingScan] = useState<UpcomingPendingRow[]>([]);
  const scanInFlight = useRef(false);

  /** Scan the next 7 IST days for PENDING rows (bounded parallel reusing
   * fetchTodayQueue). Failed dates keep their last-good rows; ids dedupe. */
  const scanUpcoming = useCallback(async (): Promise<void> => {
    if (scanInFlight.current) return; // bounded: never stack scans
    scanInFlight.current = true;
    try {
      const dates = upcomingScanDates();
      const results = await Promise.all(dates.map((d) => fetchTodayQueue(d).catch(() => null)));
      setUpcomingScan((prev) => {
        const prevByDate = new Map<string, UpcomingPendingRow[]>();
        for (const row of prev) {
          const list = prevByDate.get(row.date);
          if (list) list.push(row);
          else prevByDate.set(row.date, [row]);
        }
        const seen = new Set<string>();
        const merged: UpcomingPendingRow[] = [];
        results.forEach((data, i) => {
          const date = dates[i];
          if (data) {
            // Fresh rows for this date replace its last-good rows.
            for (const a of data.appointments) {
              if (a.status !== 'PENDING' || seen.has(a.id)) continue;
              seen.add(a.id);
              merged.push({ appointment: a, date });
            }
          } else {
            // Failed date — keep its last-good rows (deduped).
            for (const row of prevByDate.get(date) ?? []) {
              if (seen.has(row.appointment.id)) continue;
              seen.add(row.appointment.id);
              merged.push(row);
            }
          }
        });
        return merged;
      });
    } finally {
      scanInFlight.current = false;
    }
  }, []);

  // FIX B scan triggers: on (re)focus and when the selected date changes —
  // but NEVER on the 15s poll tick below (bounded cost).
  useEffect(() => {
    if (!active) return; // unfocused: no scan
    void scanUpcoming();
  }, [active, date, scanUpcoming]);

  useEffect(() => {
    if (!active) return; // unfocused: no timer, no fetches

    let alive = true;

    const load = async () => {
      if (inFlight.current) return; // skip overlapping ticks
      inFlight.current = true;
      try {
        const data = await fetchTodayQueue(date);
        if (!alive) return;
        setState((s) => ({
          ...s,
          data,
          loadedFor: date,
          message: null,
          refreshing: false,
        }));
      } catch (err) {
        if (!alive) return;
        // Keep last good data — only set the banner.
        setState((s) => ({ ...s, message: toFriendlyMessage(err), refreshing: false }));
      } finally {
        inFlight.current = false;
      }
    };

    void load(); // immediate fetch on (re)focus / date change
    const interval = setInterval(() => void load(), TODAY_QUEUE_POLL_INTERVAL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [date, active]);

  /** Pull-to-refresh + refetch-after-mutation — event handler, may set state. */
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const data = await fetchTodayQueue(date);
      setState((s) => ({
        ...s,
        data,
        loadedFor: date,
        message: null,
        refreshing: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        message: toFriendlyMessage(err),
        refreshing: false,
      }));
    }
  }, [date]);

  // mobilefix2 P2 — foreground re-sync: active-after-background fires ONE
  // silent refresh + rescan (the same path pull-to-refresh uses), skipped
  // while a fetch/scan is already in flight (never stacks calls).
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active' && active) {
        if (!inFlight.current) void refresh();
        if (!scanInFlight.current) void scanUpcoming();
      }
    });
    return () => sub.remove();
  }, [active, refresh, scanUpcoming]);

  /**
   * CONFIRM a PENDING booking (PENDING → CONFIRMED). Optimistic: the row
   * flips instantly and the counts move; on failure everything rolls back
   * exactly and the friendly error is returned for the toast. After success
   * a background refresh re-syncs server truth (estWait, ordering).
   */
  const confirmPending = useCallback(
    async (id: string): Promise<string | null> => {
      setState((s) =>
        s.data ? { ...s, data: withAppointmentStatus(s.data, id, 'PENDING', 'CONFIRMED') } : s,
      );
      try {
        await confirmAppointment(id);
        void refresh(); // re-sync counts + estWaitMin after the server commit
        void scanUpcoming(); // FIX B: the confirmed row leaves the upcoming card
        return null;
      } catch (err) {
        setState((s) =>
          s.data ? { ...s, data: withAppointmentStatus(s.data, id, 'CONFIRMED', 'PENDING') } : s,
        );
        void scanUpcoming(); // settle: re-validate after either outcome
        return toFriendlyMessage(err);
      }
    },
    [refresh, scanUpcoming],
  );

  /**
   * REJECT a PENDING booking (PENDING → CANCELLED) — destructive, so NOT
   * optimistic; the optional note is persisted as a patient note after the
   * cancellation commits (best-effort — a note failure surfaces as a warning
   * message but the rejection stands). The caller then refreshes via the
   * returned outcome (refresh runs here in both cases).
   */
  const rejectPending = useCallback(
    async (
      id: string,
      note?: string,
    ): Promise<{ error: string | null; noteWarning: string | null }> => {
      const phone = state.data?.appointments.find((a) => a.id === id)?.patientPhone ?? '';
      const trimmedNote = note?.trim(); // blank → omitted (never an empty note)
      try {
        const result = await rejectAppointment(id, phone, trimmedNote || undefined);
        await refresh();
        void scanUpcoming(); // FIX B: the rejected row leaves the upcoming card
        return { error: null, noteWarning: result.noteWarning };
      } catch (err) {
        void scanUpcoming(); // settle: re-validate after either outcome
        return { error: toFriendlyMessage(err), noteWarning: null };
      }
    },
    [refresh, scanUpcoming, state.data],
  );

  const stale = state.data !== null && state.loadedFor !== date;

  /** PENDING rows for the manual-confirmation section (top of the console). */
  const pending = useMemo(
    () =>
      stale || !state.data ? [] : state.data.appointments.filter((a) => a.status === 'PENDING'),
    [state.data, stale],
  );

  /** FIX B — PENDING rows on FUTURE dates (horizon minus the selected date). */
  const upcomingPending = useMemo(
    () => upcomingScan.filter((row) => row.date !== date),
    [upcomingScan, date],
  );

  return {
    data: stale ? null : state.data,
    /** First fetch for the current date (big spinner). */
    loading: active && (state.data === null || stale) && state.message === null,
    error: state.message,
    refreshing: state.refreshing,
    refresh,
    /** Phase 11 B3: the pending section + its actions. */
    pending,
    confirmPending,
    rejectPending,
    /** mobilefix1 FIX B: future-date pending rows (each with its IST date) +
     * a manual rescan (pull-to-refresh uses it alongside refresh()). */
    upcomingPending,
    rescan: scanUpcoming,
  };
}
