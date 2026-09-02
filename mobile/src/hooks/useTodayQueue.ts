import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchTodayQueue,
  confirmAppointment,
  rejectAppointment,
  type StaffQueueAppointment,
  type TodayQueueResponse,
} from '@/lib/staff';
import { toFriendlyMessage } from '@/lib/errors';

/**
 * The Today tab auto-refresh cadence (same 15s as the patient live queue).
 */
export const TODAY_QUEUE_POLL_INTERVAL_MS = 15_000;

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
 * TIME LAW: `date` is a verbatim 'YYYY-MM-DD' IST string — never converted.
 * Rule-safe updates: no synchronous setState inside effect bodies.
 */
export function useTodayQueue(date: string, active: boolean) {
  const [state, setState] = useState<QueueState>({
    data: null,
    loadedFor: null,
    message: null,
    refreshing: false,
  });

  const inFlight = useRef(false);

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
        return null;
      } catch (err) {
        setState((s) =>
          s.data ? { ...s, data: withAppointmentStatus(s.data, id, 'CONFIRMED', 'PENDING') } : s,
        );
        return toFriendlyMessage(err);
      }
    },
    [refresh],
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
        return { error: null, noteWarning: result.noteWarning };
      } catch (err) {
        return { error: toFriendlyMessage(err), noteWarning: null };
      }
    },
    [refresh, state.data],
  );

  const stale = state.data !== null && state.loadedFor !== date;

  /** PENDING rows for the manual-confirmation section (top of the console). */
  const pending = useMemo(
    () =>
      stale || !state.data ? [] : state.data.appointments.filter((a) => a.status === 'PENDING'),
    [state.data, stale],
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
  };
}
