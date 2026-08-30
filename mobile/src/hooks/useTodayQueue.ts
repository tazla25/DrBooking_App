import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTodayQueue, type TodayQueueResponse } from '@/lib/staff';
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

  const stale = state.data !== null && state.loadedFor !== date;

  return {
    data: stale ? null : state.data,
    /** First fetch for the current date (big spinner). */
    loading: active && (state.data === null || stale) && state.message === null,
    error: state.message,
    refreshing: state.refreshing,
    refresh,
  };
}
