import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAnalyticsSummary,
  fetchRevenueSeries,
  type AnalyticsSummaryResponse,
  type RevenueDayPoint,
} from '@/lib/admin';
import { toFriendlyMessage } from '@/lib/errors';

/**
 * Analytics tab data (Phase 8, A2). The scoping law makes doctorId REQUIRED
 * for SUPER_ADMIN callers, so both hooks take a NON-NULL id only — the screen
 * gates them on the doctor picker.
 *
 * Staleness follows the patients-list pattern: the loaded key is kept in
 * state, and a key change hides the old rows until the new page lands (no
 * synchronous setState inside effect bodies — house lint rule).
 */

interface SummaryState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  data: AnalyticsSummaryResponse | null;
  loadedDoctorId: string | null;
  message: string | null;
}

export function useAnalyticsSummary(doctorId: string | null) {
  const [state, setState] = useState<SummaryState>({
    phase: 'idle',
    data: null,
    loadedDoctorId: null,
    message: null,
  });
  const seq = useRef(0);

  const load = useCallback((id: string | null) => {
    if (!id) return;
    const ticket = ++seq.current;
    fetchAnalyticsSummary(id)
      .then((data) => {
        if (ticket !== seq.current) return;
        setState({ phase: 'ready', data, loadedDoctorId: id, message: null });
      })
      .catch((err) => {
        if (ticket !== seq.current) return;
        setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
      });
  }, []);

  useEffect(() => {
    load(doctorId);
  }, [doctorId, load]);

  const stale = state.loadedDoctorId !== null && state.loadedDoctorId !== doctorId;

  return {
    data: stale ? null : state.data,
    loading: doctorId !== null && (stale || state.phase === 'idle' || state.phase === 'loading'),
    error: state.phase === 'error' && !stale ? state.message : null,
    retry: () => load(doctorId),
  };
}

interface SeriesState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  series: RevenueDayPoint[] | null;
  today: string | null;
  loadedKey: string | null; // `${doctorId}:${days}`
  message: string | null;
}

export function useRevenueSeries(doctorId: string | null, days: number) {
  const [state, setState] = useState<SeriesState>({
    phase: 'idle',
    series: null,
    today: null,
    loadedKey: null,
    message: null,
  });
  const seq = useRef(0);

  const load = useCallback((id: string | null, windowDays: number) => {
    if (!id) return;
    const ticket = ++seq.current;
    fetchRevenueSeries(id, windowDays)
      .then((data) => {
        if (ticket !== seq.current) return;
        setState({
          phase: 'ready',
          series: data.series,
          today: data.today,
          loadedKey: `${id}:${windowDays}`,
          message: null,
        });
      })
      .catch((err) => {
        if (ticket !== seq.current) return;
        setState((s) => ({ ...s, phase: 'error', message: toFriendlyMessage(err) }));
      });
  }, []);

  useEffect(() => {
    load(doctorId, days);
  }, [doctorId, days, load]);

  const key = doctorId !== null ? `${doctorId}:${days}` : null;
  const stale = state.loadedKey !== null && state.loadedKey !== key;

  return {
    series: stale ? null : state.series,
    loading: doctorId !== null && (stale || state.phase === 'idle' || state.phase === 'loading'),
    error: state.phase === 'error' && !stale ? state.message : null,
    retry: () => load(doctorId, days),
  };
}
