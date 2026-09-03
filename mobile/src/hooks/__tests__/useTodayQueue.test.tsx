import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { fetchTodayQueue, confirmAppointment, rejectAppointment } from '@/lib/staff';
import { ApiError } from '@/lib/errors';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { useTodayQueue, TODAY_QUEUE_POLL_INTERVAL_MS, UPCOMING_SCAN_DAYS } from '../useTodayQueue';

/**
 * Today-queue polling law (same architecture as the patient live queue):
 * fetch on focus, refetch when the DATE param changes, tick every 15s, stop
 * on unfocus AND unmount, never overlap in-flight requests, keep last-good
 * data on poll errors, recover on the next tick.
 *
 * Phase 11 B3: the PENDING section — derived pending rows, single-tap
 * confirm with OPTIMISTIC flip + full ROLLBACK on failure, and the
 * non-optimistic reject (CANCELLED via the status route + patient note).
 *
 * mobilefix1 FIX B: the upcoming-pending scan — future-date PENDING rows
 * (today+1…today+7) EXCLUDING the selected date, deduped by id, failed dates
 * keep last-good rows, rescan on mutation settle + date change, NEVER on the
 * 15s poll tick.
 *
 * The scan dates derive from the REAL istTodayISO() at run time — the tests
 * compute the same window, so both sides agree without freezing the clock.
 */

jest.mock('@/lib/staff', () => ({
  fetchTodayQueue: jest.fn(),
  confirmAppointment: jest.fn(),
  rejectAppointment: jest.fn(),
}));

// mobilefix2 P2: the @react-native/jest-preset already swaps AppState for a
// mock (addEventListener = tracked jest.fn); its `currentState` is a bare
// jest.fn though — the hook expects a status string, so each test seeds
// 'active' (the app's foreground assumption at mount). The listener is
// invoked manually for background/active transitions.
beforeEach(() => {
  (AppState as { currentState: unknown }).currentState = 'active';
});

const mockedFetch = fetchTodayQueue as jest.Mock;
const mockedConfirm = confirmAppointment as jest.Mock;
const mockedReject = rejectAppointment as jest.Mock;

const QUEUE = (date: string) => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 1, confirmed: 2, called: 1, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [
    {
      id: 'apt1',
      queueNumber: 3,
      status: 'CALLED',
      source: 'ONLINE',
      patientName: 'Priya Nair',
      patientPhone: '+919812345601',
      patientId: 'u1',
      notes: null,
      fee: 300,
      estWaitMin: 20,
      createdAt: '2026-08-30T03:00:00.000Z',
    },
    {
      id: 'apt2',
      queueNumber: 4,
      status: 'PENDING',
      source: 'ONLINE',
      patientName: 'Pending Patient',
      patientPhone: '+919812345678',
      patientId: 'u2',
      notes: null,
      fee: 300,
      estWaitMin: 30,
      createdAt: '2026-08-30T05:30:00.000Z',
    },
  ],
});

/** The FIX-B scan window: today + 1 … today + 7 (mirrors the hook). */
const scanDates = (): string[] =>
  Array.from({ length: UPCOMING_SCAN_DAYS }, (_, i) => addDaysISO(istTodayISO(), i + 1));

/** A queue with NO pending rows (the default for scanned future dates). */
const EMPTY_QUEUE = (date: string) => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 0, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [],
});

/** A queue whose ONLY row is PENDING (an upcoming booking). */
const PENDING_QUEUE = (date: string, id: string, name = 'Future Patient') => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 1, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [
    {
      id,
      queueNumber: 7,
      status: 'PENDING',
      source: 'ONLINE',
      patientName: name,
      patientPhone: '+919812345999',
      patientId: 'u9',
      notes: null,
      fee: 300,
      estWaitMin: 30,
      createdAt: '2026-08-30T06:00:00.000Z',
    },
  ],
});

/** Fetch calls made for a given date (the scan fires for OTHER dates —
 * counting per date keeps the polling assertions scan-aware). */
function callsFor(date: string): number {
  return mockedFetch.mock.calls.filter((c) => c[0] === date).length;
}

function useScopedFakeTimers() {
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });
}

/** Advance exactly one poll interval and let the fetch settle. */
async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(TODAY_QUEUE_POLL_INTERVAL_MS);
  });
}

/** Emit an AppState transition to the hook's CURRENT subscription (P2). */
async function emitAppState(state: string) {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const listener = calls[calls.length - 1]?.[1] as ((s: string) => void) | undefined;
  await act(async () => {
    listener?.(state);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  mockedConfirm.mockReset();
  mockedReject.mockReset();
  // Default transport: the selected date has the classic 2-row queue; every
  // OTHER date (the FIX-B scan window) is empty — individual tests override.
  mockedFetch.mockImplementation((date?: string) =>
    Promise.resolve(
      date === '2026-08-30' ? QUEUE('2026-08-30') : EMPTY_QUEUE(date ?? '2026-08-30'),
    ),
  );
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTodayQueue — 15s cadence', () => {
  test('fetches immediately, then once per 15s tick', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));

    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1); // primary queue (scan hits other dates)
    expect(result.current.data?.doctor.fullName).toBe('Ananya Rao');
    expect(result.current.loading).toBe(false);

    await tick();
    expect(callsFor('2026-08-30')).toBe(2);

    await tick();
    expect(callsFor('2026-08-30')).toBe(3);
  });

  test('changing the date refetches for the new date', async () => {
    useScopedFakeTimers();
    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useTodayQueue(date, true),
      { initialProps: { date: '2026-08-30' } },
    );

    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1); // the primary fetch for the initial date
    expect(result.current.data?.date).toBe('2026-08-30');

    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve(
        date === '2026-09-15' ? QUEUE('2026-09-15') : EMPTY_QUEUE(date ?? '2026-09-15'),
      ),
    );
    await rerender({ date: '2026-09-15' });
    await act(async () => {});

    expect(callsFor('2026-09-15')).toBe(1);
    expect(result.current.data?.date).toBe('2026-09-15');
  });
});

describe('useTodayQueue — stops', () => {
  test('no polling while unfocused (active: false)', async () => {
    useScopedFakeTimers();
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useTodayQueue('2026-08-30', active),
      { initialProps: { active: false } },
    );

    await act(async () => {
      jest.advanceTimersByTime(3 * TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).not.toHaveBeenCalled();

    // Focusing starts it; unfocusing stops it again.
    await rerender({ active: true });
    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1);

    await rerender({ active: false });
    await act(async () => {
      jest.advanceTimersByTime(5 * TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(callsFor('2026-08-30')).toBe(1);
  });

  test('interval cleared on unmount', async () => {
    useScopedFakeTimers();
    const { unmount } = await renderHook(() => useTodayQueue('2026-08-30', true));

    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1);

    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(10 * TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(callsFor('2026-08-30')).toBe(1);
  });

  test('skips a tick while a previous request is still in flight', async () => {
    useScopedFakeTimers();
    let resolveFirst: (value: unknown) => void = () => undefined;
    mockedFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    await renderHook(() => useTodayQueue('2026-08-30', true));
    // The initial request is now hanging.
    expect(mockedFetch.mock.calls.filter((c) => c[0] === '2026-08-30')).toHaveLength(1);

    // Tick fires while the first request is unresolved → skipped.
    await act(async () => {
      jest.advanceTimersByTime(TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(callsFor('2026-08-30')).toBe(1);

    // First request resolves; the NEXT tick fetches again.
    await act(async () => {
      resolveFirst(QUEUE('2026-08-30'));
    });
    await tick();
    expect(callsFor('2026-08-30')).toBe(2);
  });
});

describe('useTodayQueue — PENDING section + confirm/reject (Phase 11 B3)', () => {
  test('pending rows are derived from the queue data (status PENDING only)', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].id).toBe('apt2');
    expect(result.current.pending[0].status).toBe('PENDING');
    // The confirmed queue (screen side) filters these out — the raw rows stay.
    expect(result.current.data?.appointments).toHaveLength(2);
  });

  test('confirmPending flips the row OPTIMISTICALLY, calls the API, refreshes on success', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1);

    // The post-confirm refresh HANGS until resolved, so the OPTIMISTIC state
    // is observable before the server truth lands (mockImplementationOnce is
    // queued AFTER the initial fetch has been consumed).
    let resolveRefresh: (value: unknown) => void = () => undefined;
    mockedFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    mockedConfirm.mockResolvedValueOnce({ appointment: { id: 'apt2', status: 'CONFIRMED' } });
    let error: string | null = 'unset';
    await act(async () => {
      error = await result.current.confirmPending('apt2');
    });

    expect(error).toBeNull();
    expect(mockedConfirm).toHaveBeenCalledWith('apt2');

    // The optimistic flip: pending drained, counts moved — immediately, BEFORE
    // the refresh resolves (it is still hanging).
    expect(result.current.pending).toHaveLength(0);
    expect(result.current.data?.counts.pending).toBe(0);
    expect(result.current.data?.counts.confirmed).toBe(3);
    const flipped = result.current.data?.appointments.find((a) => a.id === 'apt2');
    expect(flipped?.status).toBe('CONFIRMED');

    // Success triggered the background refresh — now land the server truth.
    await waitFor(() => expect(callsFor('2026-08-30')).toBe(2));
    const serverTruth = QUEUE('2026-08-30');
    serverTruth.appointments[1].status = 'CONFIRMED';
    serverTruth.counts = { ...serverTruth.counts, pending: 0, confirmed: 3 };
    await act(async () => {
      resolveRefresh(serverTruth);
    });
    expect(result.current.data?.counts.confirmed).toBe(3);
    expect(result.current.data?.appointments.find((a) => a.id === 'apt2')?.status).toBe(
      'CONFIRMED',
    );
  });

  test('confirmPending ROLLS BACK the optimistic flip on failure and returns the error', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    mockedConfirm.mockRejectedValueOnce(
      new ApiError(409, 'INVALID_TRANSITION', 'Stale list — refetching'),
    );
    let error: string | null = null;
    await act(async () => {
      error = await result.current.confirmPending('apt2');
    });

    expect(error).toBe('Stale list — refetching');
    // Rolled back exactly: the row is pending again, counts restored.
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.data?.counts.pending).toBe(1);
    expect(result.current.data?.counts.confirmed).toBe(2);
    expect(result.current.data?.appointments.find((a) => a.id === 'apt2')?.status).toBe('PENDING');
    // No refresh on failure (the rollback IS the state).
    expect(callsFor('2026-08-30')).toBe(1);
  });

  test('rejectPending cancels via the status route with the patient phone + note, then refreshes', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    mockedReject.mockResolvedValueOnce({ appointment: { id: 'apt2' }, noteWarning: null });
    let outcome!: { error: string | null; noteWarning: string | null };
    await act(async () => {
      outcome = await result.current.rejectPending('apt2', ' Double-booked slot ');
    });

    expect(outcome?.error).toBeNull();
    expect(outcome?.noteWarning).toBeNull();
    // Phone resolved from the row + the note trimmed (patient-note contract).
    expect(mockedReject).toHaveBeenCalledWith('apt2', '+919812345678', 'Double-booked slot');
    await waitFor(() => expect(callsFor('2026-08-30')).toBe(2));
  });

  test('rejectPending failure surfaces the error and NEVER mutates the rows (not optimistic)', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    mockedReject.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server'));
    let outcome!: { error: string | null; noteWarning: string | null };
    await act(async () => {
      outcome = await result.current.rejectPending('apt2');
    });

    expect(outcome?.error).toBe('Cannot reach the server. Check your connection and try again.');
    expect(result.current.pending).toHaveLength(1); // untouched
    expect(callsFor('2026-08-30')).toBe(1); // no refresh on failure
  });

  test('rejectPending surfaces the note warning without failing the rejection', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    mockedReject.mockResolvedValueOnce({
      appointment: { id: 'apt2' },
      noteWarning: 'Rejection saved, but the note could not be added to the patient record.',
    });
    let outcome!: { error: string | null; noteWarning: string | null };
    await act(async () => {
      outcome = await result.current.rejectPending('apt2', 'reason');
    });

    expect(outcome?.error).toBeNull();
    expect(outcome?.noteWarning).toBe(
      'Rejection saved, but the note could not be added to the patient record.',
    );
  });
});

describe('useTodayQueue — resilience', () => {
  test('a failed poll keeps the last good data and surfaces the error', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(result.current.data).not.toBeNull();
    expect(result.current.error).toBeNull();

    mockedFetch.mockRejectedValueOnce(new Error('network blip'));
    await tick();

    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.data?.doctor.fullName).toBe('Ananya Rao'); // kept

    // Next successful tick clears the error and refreshes data.
    await tick();
    expect(result.current.error).toBeNull();
  });

  test('manual refresh() serves pull-to-refresh AND refetch-after-mutation', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1);

    // e.g. after POST /api/queue/next the screen calls refresh()
    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve(
        date === '2026-08-30' ? QUEUE('2026-08-30') : EMPTY_QUEUE(date ?? '2026-08-30'),
      ),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(callsFor('2026-08-30')).toBe(2);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.data?.counts.called).toBe(1);
  });

  test('refresh error sets the banner without blanking the list', async () => {
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(result.current.data).not.toBeNull();

    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.data?.doctor.fullName).toBe('Ananya Rao'); // kept
    expect(result.current.refreshing).toBe(false);
  });

  test('stale data for an old date is hidden until the new date lands', async () => {
    let blockResolve: ((value: unknown) => void) | null = null;
    mockedFetch.mockImplementation((date: string) => {
      if (date === '2026-09-15') {
        return new Promise((resolve) => {
          blockResolve = resolve; // the 2026-09-06 fetch hangs
        });
      }
      return Promise.resolve(date === '2026-08-30' ? QUEUE('2026-08-30') : EMPTY_QUEUE(date));
    });

    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useTodayQueue(date, true),
      { initialProps: { date: '2026-08-30' } },
    );
    await act(async () => {});
    expect(result.current.data?.date).toBe('2026-08-30');

    await rerender({ date: '2026-09-15' });
    // New date fetch is in flight — old-date rows must NOT leak through.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      (blockResolve as (value: unknown) => void)?.(QUEUE('2026-09-15'));
    });
    await waitFor(() => expect(result.current.data?.date).toBe('2026-09-15'));
  });
});

describe('useTodayQueue — upcoming-pending scan (mobilefix1 FIX B)', () => {
  test('collects future-date PENDING rows and EXCLUDES the selected date', async () => {
    const dates = scanDates();
    const [, d2, , d4] = dates; // today+2 and today+4 carry upcoming bookings
    mockedFetch.mockImplementation((date?: string) => {
      if (date === '2026-08-30') return Promise.resolve(QUEUE('2026-08-30'));
      if (date === d2) return Promise.resolve(PENDING_QUEUE(d2, 'up1'));
      if (date === d4) return Promise.resolve(PENDING_QUEUE(d4, 'up2'));
      return Promise.resolve(EMPTY_QUEUE(date ?? dates[0]));
    });

    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    // The two future rows appear WITH their dates; the selected date's own
    // pending row (apt2) stays in the `pending` card instead.
    expect(result.current.upcomingPending.map((r) => [r.appointment.id, r.date])).toEqual([
      ['up1', d2],
      ['up2', d4],
    ]);
    expect(result.current.pending.map((r) => r.id)).toEqual(['apt2']);
    // Exactly ONE scan ran — every horizon date fetched exactly once.
    expect(dates.filter((d) => callsFor(d) === 1)).toHaveLength(UPCOMING_SCAN_DAYS);
    expect(result.current.error).toBeNull();
  });

  test('EXCLUDES the selected date itself when it lies inside the horizon', async () => {
    const dates = scanDates();
    const [d1, , d3] = dates;
    mockedFetch.mockImplementation((date?: string) => {
      if (date === d3) return Promise.resolve(PENDING_QUEUE(d3, 'sel1')); // the SELECTED date
      if (date === d1) return Promise.resolve(PENDING_QUEUE(d1, 'up3'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const { result } = await renderHook(() => useTodayQueue(d3, true));
    await act(async () => {});

    // d3's booking renders in the SELECTED-date pending card, not upcoming.
    expect(result.current.upcomingPending.map((r) => r.appointment.id)).toEqual(['up3']);
    expect(result.current.pending.map((r) => r.id)).toEqual(['sel1']);
  });

  test('dedupes by appointment id across dates', async () => {
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === d1 || date === d2) return Promise.resolve(PENDING_QUEUE(date as string, 'dup1'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});

    expect(result.current.upcomingPending).toHaveLength(1);
    expect(result.current.upcomingPending[0].appointment.id).toBe('dup1');
    expect(result.current.upcomingPending[0].date).toBe(d1); // first occurrence wins
  });

  test('a failed date keeps its last-good rows — silently, no error banner', async () => {
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === '2026-08-30') return Promise.resolve(QUEUE('2026-08-30'));
      if (date === d1) return Promise.resolve(PENDING_QUEUE(d1, 'a1'));
      if (date === d2) return Promise.resolve(PENDING_QUEUE(d2, 'b1'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(result.current.upcomingPending.map((r) => r.appointment.id)).toEqual(['a1', 'b1']);

    // Rescan: d1 now FAILS (its last-good row 'a1' survives), d2 returns 'b2'.
    mockedFetch.mockImplementation((date?: string) => {
      if (date === '2026-08-30') return Promise.resolve(QUEUE('2026-08-30'));
      if (date === d1) return Promise.reject(new Error('offline'));
      if (date === d2) return Promise.resolve(PENDING_QUEUE(d2, 'b2'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });
    await act(async () => {
      await result.current.rescan();
    });

    expect(result.current.upcomingPending.map((r) => r.appointment.id)).toEqual(['a1', 'b2']);
    expect(result.current.error).toBeNull(); // scan failures never surface here
  });

  test('confirmPending settle triggers a rescan — the confirmed row leaves the upcoming card', async () => {
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === '2026-08-30') return Promise.resolve(QUEUE('2026-08-30'));
      if (date === d1) return Promise.resolve(PENDING_QUEUE(d1, 'up9'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(result.current.upcomingPending.map((r) => r.appointment.id)).toEqual(['up9']);
    expect(callsFor(d1)).toBe(1);

    // The server confirms; the post-settle rescan finds the row gone.
    mockedConfirm.mockResolvedValueOnce({ appointment: { id: 'up9', status: 'CONFIRMED' } });
    mockedFetch.mockImplementation((date?: string) => {
      if (date === '2026-08-30') return Promise.resolve(QUEUE('2026-08-30'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });
    let error: string | null = 'unset';
    await act(async () => {
      error = await result.current.confirmPending('up9');
    });

    expect(error).toBeNull();
    expect(mockedConfirm).toHaveBeenCalledWith('up9');
    await waitFor(() => expect(result.current.upcomingPending).toHaveLength(0));
    expect(callsFor(d1)).toBe(2); // the horizon was re-scanned after the settle
  });

  test('date change rescans the horizon; the 15s poll tick does NOT', async () => {
    useScopedFakeTimers();
    const [d1] = scanDates();
    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useTodayQueue(date, true),
      { initialProps: { date: '2026-08-30' } },
    );
    await act(async () => {});
    expect(callsFor(d1)).toBe(1); // the initial-focus scan

    // A poll tick refreshes ONLY the selected date — zero scan calls.
    await tick();
    expect(callsFor('2026-08-30')).toBe(2);
    expect(callsFor(d1)).toBe(1);

    // Changing the selected date rescans the whole horizon.
    await rerender({ date: '2026-09-15' }); // outside the horizon
    await act(async () => {});
    expect(callsFor(d1)).toBe(2);
    expect(result.current.upcomingPending).toHaveLength(0); // empty horizon
  });
});

describe('useTodayQueue — foreground re-sync (mobilefix2 P2)', () => {
  test('returning to active after background fires ONE silent refresh + rescan', async () => {
    const [d1] = scanDates();
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1); // initial focus fetch
    expect(callsFor(d1)).toBe(1); // initial-focus scan

    await emitAppState('background');
    await emitAppState('active');
    await act(async () => {});

    // Exactly one silent refresh (selected date) + one rescan (horizon date).
    expect(callsFor('2026-08-30')).toBe(2);
    expect(callsFor(d1)).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test('NO refetch when a fetch is already in flight (guard absorbs the trigger)', async () => {
    // Every fetch hangs — the queue fetch AND the scan are in flight.
    mockedFetch.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    await renderHook(() => useTodayQueue('2026-08-30', true));
    await act(async () => {});
    const callsBefore = mockedFetch.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    await emitAppState('background');
    await emitAppState('active');
    await act(async () => {});

    expect(mockedFetch.mock.calls.length).toBe(callsBefore); // nothing stacked
  });

  test('unfocused hook ignores the foreground transition', async () => {
    const [d1] = scanDates();
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useTodayQueue('2026-08-30', active),
      { initialProps: { active: false } },
    );
    await act(async () => {});
    expect(mockedFetch).not.toHaveBeenCalled();

    await emitAppState('background');
    await emitAppState('active');
    await act(async () => {});
    expect(mockedFetch).not.toHaveBeenCalled(); // gated on focus

    await rerender({ active: true });
    await act(async () => {});
    expect(callsFor('2026-08-30')).toBe(1);
    expect(callsFor(d1)).toBe(1);
  });
});
