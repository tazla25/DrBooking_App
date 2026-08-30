import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStaffSchedules, type StaffSchedule } from '@/lib/staff';
import { toFriendlyMessage } from '@/lib/errors';

interface ListState {
  phase: 'loading' | 'ready' | 'error';
  today: string | null;
  items: StaffSchedule[];
  message: string | null;
}

/**
 * The caller's schedules INCLUDING inactive ones (GET /api/schedules).
 * Mutations (create / PUT / deactivate / overrides) live in src/lib/staff.ts —
 * the screen calls `refresh()` after every SUCCESSFUL mutation so the list
 * always mirrors the server (refetch-after-success law).
 */
export function useSchedules() {
  const [state, setState] = useState<ListState>({
    phase: 'loading',
    today: null,
    items: [],
    message: null,
  });

  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchStaffSchedules()
      .then((data) => {
        if (id !== seq.current) return;
        setState({ phase: 'ready', today: data.today, items: data.schedules, message: null });
      })
      .catch((err) => {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
      });
  }, []);

  /** Pull-to-refresh, error retry AND refetch-after-mutation. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchStaffSchedules();
      setState({ phase: 'ready', today: data.today, items: data.schedules, message: null });
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return {
    items: state.items,
    today: state.today,
    loading: state.phase === 'loading',
    error: state.phase === 'error' ? state.message : null,
    refreshing,
    refresh,
  };
}
