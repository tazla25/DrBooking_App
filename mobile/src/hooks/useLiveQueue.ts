import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchLiveQueue, type LiveQueueResponse } from '@/lib/appointments';
import { toFriendlyMessage } from '@/lib/errors';

/** The live-queue auto-refresh cadence (spec: 15 seconds). */
export const LIVE_QUEUE_POLL_INTERVAL_MS = 15_000;

interface QueueState {
  data: LiveQueueResponse | null;
  loadedFor: { scheduleId: string; date: string } | null;
  message: string | null;
  refreshing: boolean;
}

/**
 * Live queue with 15s auto-polling — the screen passes `active` (true while
 * the screen is focused, from useFocusEffect). The hook:
 *
 *  - fetches immediately when (re)activated or when scheduleId/date change;
 *  - polls every LIVE_QUEUE_POLL_INTERVAL_MS while active (skips a tick when
 *    the previous request is still in flight);
 *  - clears the interval on unfocus/unmount (effect cleanup);
 *  - keeps the LAST GOOD data on a failed poll and surfaces `error` — the
 *    next successful poll clears it (transient network blips never blank the
 *    screen);
 *  - never throws for `my: null` — an anonymous caller simply gets no You row.
 *
 * Rule-safe updates: no synchronous setState inside effect bodies — phase
 * transitions happen in promise callbacks; "stale" is derived via loadedFor.
 *
 * mobilefix2 P2 — foreground re-sync: returning to `active` after a
 * background stint fires ONE silent refetch, skipped while a fetch is
 * already in flight (never stacks calls). The 15s cadence is untouched.
 */
export function useLiveQueue(scheduleId: string, date: string, active: boolean) {
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
        const data = await fetchLiveQueue(scheduleId, date);
        if (!alive) return;
        setState((s) => ({
          ...s,
          data,
          loadedFor: { scheduleId, date },
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

    void load(); // immediate fetch on (re)focus / selection change
    const interval = setInterval(() => void load(), LIVE_QUEUE_POLL_INTERVAL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [scheduleId, date, active]);

  /** Pull-to-refresh — event handler, may set state freely. */
  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const data = await fetchLiveQueue(scheduleId, date);
      setState((s) => ({
        ...s,
        data,
        loadedFor: { scheduleId, date },
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
  }, [scheduleId, date]);

  // mobilefix2 P2 — foreground re-sync: active-after-background fires ONE
  // silent refetch (the existing refresh path), skipped while a fetch is
  // already in flight (the in-flight sentinel absorbs the trigger).
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active' && active && !inFlight.current) {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [active, refresh]);

  const stale =
    state.data !== null &&
    (!state.loadedFor ||
      state.loadedFor.scheduleId !== scheduleId ||
      state.loadedFor.date !== date);

  return {
    data: stale ? null : state.data,
    /** First fetch for the current selection (big spinner). */
    loading: active && (state.data === null || stale) && state.message === null,
    error: state.message,
    refreshing: state.refreshing,
    refresh,
  };
}
