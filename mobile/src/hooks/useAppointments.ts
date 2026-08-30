import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMyAppointments, type AppointmentRange, type MyAppointment } from '@/lib/appointments';
import { toFriendlyMessage } from '@/lib/errors';

export const APPOINTMENTS_PAGE_SIZE = 10;

interface ListState {
  phase: 'loading' | 'ready' | 'error';
  items: MyAppointment[];
  total: number;
  page: number;
  loadedRange: AppointmentRange | null;
  message: string | null;
}

/**
 * The patient's own appointments (GET /api/appointments/mine), segmented by
 * `range`. Owns: initial load (effect), load-more (onEndReached), pull-to-
 * refresh and retry — the screen stays declarative.
 *
 * Rule-safe updates: no synchronous setState inside effect bodies; a range
 * switch keeps the old rows while `stale` (derived) flips the screen to its
 * loading state until the new page lands.
 */
export function useAppointments(range: AppointmentRange) {
  const [state, setState] = useState<ListState>({
    phase: 'loading',
    items: [],
    total: 0,
    page: 1,
    loadedRange: null,
    message: null,
  });

  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchMyAppointments(range, 1, APPOINTMENTS_PAGE_SIZE)
      .then((data) => {
        if (id !== seq.current) return;
        setState({
          phase: 'ready',
          items: data.appointments,
          total: data.total,
          page: 1,
          loadedRange: range,
          message: null,
        });
      })
      .catch((err) => {
        if (id !== seq.current) return;
        setState((s) => ({
          ...s,
          phase: 'error',
          message: toFriendlyMessage(err),
        }));
      });
  }, [range]);

  const loadMore = useCallback(async () => {
    const { phase, items, total, page } = state;
    if (loadingMore || phase !== 'ready' || items.length >= total) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchMyAppointments(range, next, APPOINTMENTS_PAGE_SIZE);
      setState((s) => {
        const seen = new Set(s.items.map((a) => a.id));
        const merged = [...s.items, ...data.appointments.filter((a) => !seen.has(a.id))];
        return {
          ...s,
          items: merged,
          total: data.total,
          page: next,
          loadedRange: range,
        };
      });
    } catch {
      // Silent: pull-to-refresh retries; keep the current page.
    } finally {
      setLoadingMore(false);
    }
  }, [range, state, loadingMore]);

  /** Pull-to-refresh + error retry — event handler, may set state freely. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchMyAppointments(range, 1, APPOINTMENTS_PAGE_SIZE);
      setState({
        phase: 'ready',
        items: data.appointments,
        total: data.total,
        page: 1,
        loadedRange: range,
        message: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
    } finally {
      setRefreshing(false);
    }
  }, [range]);

  const stale = state.loadedRange !== null && state.loadedRange !== range;

  return {
    items: stale ? [] : state.items,
    total: state.total,
    loading: state.phase === 'loading' || stale,
    error: state.phase === 'error' ? state.message : null,
    loadingMore,
    refreshing,
    /** True when every row is on screen (drives the footer hint). */
    complete: state.phase === 'ready' && !stale && state.items.length >= state.total,
    loadMore,
    refresh,
    /** Patch the list after a local mutation (e.g. cancel). */
    updateItems: useCallback((updater: (items: MyAppointment[]) => MyAppointment[]) => {
      setState((s) => ({ ...s, items: updater(s.items) }));
    }, []),
  };
}
