import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPatients, type PatientSummary } from '@/lib/staff';
import { toFriendlyMessage } from '@/lib/errors';
import { useDebouncedValue } from './useDebouncedValue';

export const PATIENTS_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

interface ListState {
  phase: 'loading' | 'ready' | 'error';
  items: PatientSummary[];
  total: number;
  page: number;
  loadedQuery: string | null;
  message: string | null;
}

/**
 * The doctor's patient book (GET /api/patients) with debounced search and
 * pagination:
 *
 *  - `query` is the RAW search-field text; the hook debounces it itself
 *    (SEARCH_DEBOUNCE_MS) so keystrokes do not hammer the API;
 *  - page-1 refetch whenever the DEBOUNCED query changes (stale rows are
 *    kept on screen until the new page lands — derived via loadedQuery);
 *  - loadMore appends the next page with dedupe by phone;
 *  - refresh serves pull-to-refresh + retry.
 *
 * Patients are distinct by phone server-side, so phone is the dedupe key.
 */
export function usePatients(query: string) {
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const [state, setState] = useState<ListState>({
    phase: 'loading',
    items: [],
    total: 0,
    page: 1,
    loadedQuery: null,
    message: null,
  });

  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchPatients(debouncedQuery, 1, PATIENTS_PAGE_SIZE)
      .then((data) => {
        if (id !== seq.current) return;
        setState({
          phase: 'ready',
          items: data.patients,
          total: data.total,
          page: 1,
          loadedQuery: debouncedQuery,
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
  }, [debouncedQuery]);

  const loadMore = useCallback(async () => {
    const { phase, items, total, page } = state;
    if (loadingMore || phase !== 'ready' || items.length >= total) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPatients(debouncedQuery, next, PATIENTS_PAGE_SIZE);
      setState((s) => {
        const seen = new Set(s.items.map((p) => p.phone));
        const merged = [...s.items, ...data.patients.filter((p) => !seen.has(p.phone))];
        return {
          ...s,
          items: merged,
          total: data.total,
          page: next,
          loadedQuery: debouncedQuery,
        };
      });
    } catch {
      // Silent: pull-to-refresh retries; keep the current page.
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, state, loadingMore]);

  /** Pull-to-refresh + error retry — event handler, may set state freely. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchPatients(debouncedQuery, 1, PATIENTS_PAGE_SIZE);
      setState({
        phase: 'ready',
        items: data.patients,
        total: data.total,
        page: 1,
        loadedQuery: debouncedQuery,
        message: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
    } finally {
      setRefreshing(false);
    }
  }, [debouncedQuery]);

  const stale = state.loadedQuery !== null && state.loadedQuery !== debouncedQuery;

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
  };
}
