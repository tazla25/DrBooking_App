import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuditLog, type AuditLogEntry } from '@/lib/admin';
import { toFriendlyMessage } from '@/lib/errors';
import { useDebouncedValue } from './useDebouncedValue';

export const AUDIT_PAGE_SIZE = 20;
const USER_ID_DEBOUNCE_MS = 350;

interface ListState {
  phase: 'loading' | 'ready' | 'error';
  items: AuditLogEntry[];
  total: number;
  page: number;
  loadedAction: string | null;
  loadedUserId: string | null;
  message: string | null;
}

/**
 * The SUPER_ADMIN audit trail (GET /api/admin/audit-log) — newest first with:
 *  - an EXACT action filter (chips: All + the four known actions) and an
 *    optional exact actorId text filter (debounced here);
 *  - page-1 refetch whenever either filter changes (stale rows hidden via
 *    loadedAction/loadedUserId — the patients-list pattern);
 *  - loadMore appending the next page, deduped by id.
 */
export function useAuditLog(action: string | null, rawUserId: string) {
  const userId = useDebouncedValue(rawUserId.trim(), USER_ID_DEBOUNCE_MS);

  const [state, setState] = useState<ListState>({
    phase: 'loading',
    items: [],
    total: 0,
    page: 1,
    loadedAction: null,
    loadedUserId: null,
    message: null,
  });

  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchAuditLog(1, AUDIT_PAGE_SIZE, {
      action: action ?? undefined,
      userId: userId || undefined,
    })
      .then((data) => {
        if (id !== seq.current) return;
        setState({
          phase: 'ready',
          items: data.items,
          total: data.total,
          page: 1,
          loadedAction: action,
          loadedUserId: userId,
          message: null,
        });
      })
      .catch((err) => {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
      });
  }, [action, userId]);

  const loadMore = useCallback(async () => {
    const { phase, items, total, page } = state;
    if (loadingMore || phase !== 'ready' || items.length >= total) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchAuditLog(next, AUDIT_PAGE_SIZE, {
        action: action ?? undefined,
        userId: userId || undefined,
      });
      setState((s) => {
        const seen = new Set(s.items.map((e) => e.id));
        const merged = [...s.items, ...data.items.filter((e) => !seen.has(e.id))];
        return { ...s, items: merged, total: data.total, page: next };
      });
    } catch {
      // Silent: pull-to-refresh retries; keep the current page.
    } finally {
      setLoadingMore(false);
    }
  }, [action, userId, state, loadingMore]);

  /** Pull-to-refresh + error retry — event handler, may set state freely. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchAuditLog(1, AUDIT_PAGE_SIZE, {
        action: action ?? undefined,
        userId: userId || undefined,
      });
      setState({
        phase: 'ready',
        items: data.items,
        total: data.total,
        page: 1,
        loadedAction: action,
        loadedUserId: userId,
        message: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
    } finally {
      setRefreshing(false);
    }
  }, [action, userId]);

  const stale = (state.loadedAction !== null || action !== null) && state.loadedAction !== action;
  const staleUserId = state.loadedUserId !== null && state.loadedUserId !== userId;

  return {
    items: stale || staleUserId ? [] : state.items,
    total: state.total,
    loading: state.phase === 'loading' || stale || staleUserId,
    error: state.phase === 'error' ? state.message : null,
    loadingMore,
    refreshing,
    complete:
      state.phase === 'ready' && !stale && !staleUserId && state.items.length >= state.total,
    loadMore,
    refresh,
  };
}
