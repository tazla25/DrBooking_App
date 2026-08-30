import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAvailability, type AvailabilityResponse } from '@/lib/appointments';
import { toFriendlyMessage } from '@/lib/errors';

/**
 * Availability for one (schedule, date) — auto-refetches when either changes.
 *
 * Rule-safe state updates: NOTHING is set synchronously inside the effect —
 * the effect only starts the fetch; phase transitions happen in the promise
 * callbacks. "Stale" (selection changed, new fetch in flight) is DERIVED via
 * loadedFor so the UI can show a spinner without touching state.
 */
export function useAvailability(scheduleId: string | null, date: string | null) {
  const [state, setState] = useState<{
    phase: 'idle' | 'ready' | 'error';
    data: AvailabilityResponse | null;
    loadedFor: { scheduleId: string; date: string } | null;
    message: string | null;
  }>({ phase: 'idle', data: null, loadedFor: null, message: null });

  const [refreshKey, setRefreshKey] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!scheduleId || !date) return; // idle — nothing selected yet

    fetchAvailability(scheduleId, date)
      .then((data) => {
        if (!aliveRef.current) return;
        setState({
          phase: 'ready',
          data,
          loadedFor: { scheduleId, date },
          message: null,
        });
      })
      .catch((err) => {
        if (!aliveRef.current) return;
        setState({
          phase: 'error',
          data: null,
          loadedFor: null,
          message: toFriendlyMessage(err),
        });
      });

    return () => {
      aliveRef.current = false;
    };
  }, [scheduleId, date, refreshKey]);

  /** Retry button — event handler, so it may set state freely. */
  const refetch = useCallback(() => {
    setState((s) => ({ ...s, phase: 'idle' }));
    setRefreshKey((k) => k + 1);
  }, []);

  const enabled = Boolean(scheduleId && date);
  const stale =
    state.phase === 'ready' &&
    (!state.loadedFor ||
      state.loadedFor.scheduleId !== scheduleId ||
      state.loadedFor.date !== date);

  return {
    data: stale ? null : state.data,
    /** True while the initial fetch (or a selection change fetch) is in flight. */
    loading: enabled && (state.phase === 'idle' || stale),
    error: state.phase === 'error' ? state.message : null,
    refetch,
  };
}
