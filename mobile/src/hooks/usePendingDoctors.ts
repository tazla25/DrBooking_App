import { useCallback, useEffect, useRef, useState } from 'react';
import { toFriendlyMessage } from '@/lib/errors';
import { fetchPendingDoctors, type PendingDoctor } from '@/lib/admin';

export const PENDING_DOCTORS_PAGE_SIZE = 20;

interface ListState {
  phase: 'loading' | 'ready' | 'error';
  items: PendingDoctor[];
  total: number;
  page: number;
  message: string | null;
}

/**
 * The SUPER_ADMIN verification queue (GET /api/admin/pending-doctors) —
 * oldest-first FIFO with next-page-on-scroll:
 *  - page 1 loads on mount;
 *  - loadMore appends the next page, deduped by user id (another admin may
 *    have verified a row between pages — it simply disappears from the API);
 *  - refresh serves pull-to-refresh + post-mutation refetch (verify/reject
 *    drops the row server-side, so the list is re-read after every decision).
 */
export function usePendingDoctors() {
  const [state, setState] = useState<ListState>({
    phase: 'loading',
    items: [],
    total: 0,
    page: 1,
    message: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchPendingDoctors(1, PENDING_DOCTORS_PAGE_SIZE)
      .then((data) => {
        if (id !== seq.current) return;
        setState({
          phase: 'ready',
          items: data.items,
          total: data.total,
          page: 1,
          message: null,
        });
      })
      .catch((err) => {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
      });
  }, []);

  const loadMore = useCallback(async () => {
    const { phase, items, total, page } = state;
    if (loadingMore || phase !== 'ready' || items.length >= total) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPendingDoctors(next, PENDING_DOCTORS_PAGE_SIZE);
      setState((s) => {
        const seen = new Set(s.items.map((d) => d.id));
        const merged = [...s.items, ...data.items.filter((d) => !seen.has(d.id))];
        return { ...s, items: merged, total: data.total, page: next };
      });
    } catch {
      // Silent: pull-to-refresh retries; keep the current page.
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore]);

  /** Pull-to-refresh + error retry + post-verify/reject refetch. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchPendingDoctors(1, PENDING_DOCTORS_PAGE_SIZE);
      setState({
        phase: 'ready',
        items: data.items,
        total: data.total,
        page: 1,
        message: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return {
    items: state.items,
    total: state.total,
    loading: state.phase === 'loading',
    error: state.phase === 'error' ? state.message : null,
    loadingMore,
    refreshing,
    complete: state.phase === 'ready' && state.items.length >= state.total,
    loadMore,
    refresh,
  };
}
