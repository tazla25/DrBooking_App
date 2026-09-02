import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchTodayQueue, confirmAppointment, rejectAppointment } from '@/lib/staff';
import { ApiError } from '@/lib/errors';
import { useTodayQueue, TODAY_QUEUE_POLL_INTERVAL_MS } from '../useTodayQueue';

/**
 * Today-queue polling law (same architecture as the patient live queue):
 * fetch on focus, refetch when the DATE param changes, tick every 15s, stop
 * on unfocus AND unmount, never overlap in-flight requests, keep last-good
 * data on poll errors, recover on the next tick.
 *
 * Phase 11 B3: the PENDING section — derived pending rows, single-tap
 * confirm with OPTIMISTIC flip + full ROLLBACK on failure, and the
 * non-optimistic reject (CANCELLED via the status route + patient note).
 */

jest.mock('@/lib/staff', () => ({
  fetchTodayQueue: jest.fn(),
  confirmAppointment: jest.fn(),
  rejectAppointment: jest.fn(),
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  mockedConfirm.mockReset();
  mockedReject.mockReset();
  mockedFetch.mockResolvedValue(QUEUE('2026-08-30'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTodayQueue — 15s cadence', () => {
  test('fetches immediately, then once per 15s tick', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useTodayQueue('2026-08-30', true));

    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.current.data?.doctor.fullName).toBe('Ananya Rao');
    expect(result.current.loading).toBe(false);

    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  test('changing the date refetches for the new date', async () => {
    useScopedFakeTimers();
    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useTodayQueue(date, true),
      { initialProps: { date: '2026-08-30' } },
    );

    await act(async () => {});
    expect(mockedFetch).toHaveBeenNthCalledWith(1, '2026-08-30');
    expect(result.current.data?.date).toBe('2026-08-30');

    mockedFetch.mockResolvedValue(QUEUE('2026-09-06'));
    await rerender({ date: '2026-09-06' });
    await act(async () => {});

    expect(mockedFetch).toHaveBeenNthCalledWith(2, '2026-09-06');
    expect(result.current.data?.date).toBe('2026-09-06');
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await rerender({ active: false });
    await act(async () => {
      jest.advanceTimersByTime(5 * TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('interval cleared on unmount', async () => {
    useScopedFakeTimers();
    const { unmount } = await renderHook(() => useTodayQueue('2026-08-30', true));

    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(10 * TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Tick fires while the first request is unresolved → skipped.
    await act(async () => {
      jest.advanceTimersByTime(TODAY_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // First request resolves; the NEXT tick fetches again.
    await act(async () => {
      resolveFirst(QUEUE('2026-08-30'));
    });
    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);

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
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
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
    expect(mockedFetch).toHaveBeenCalledTimes(1); // no refresh on failure
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // e.g. after POST /api/queue/next the screen calls refresh()
    mockedFetch.mockResolvedValue(QUEUE('2026-08-30'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
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
    mockedFetch.mockImplementation(
      (date: string) =>
        new Promise((resolve) => {
          if (date === '2026-08-30') resolve(QUEUE('2026-08-30'));
          else blockResolve = resolve; // the 2026-09-06 fetch hangs
        }),
    );

    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useTodayQueue(date, true),
      { initialProps: { date: '2026-08-30' } },
    );
    await act(async () => {});
    expect(result.current.data?.date).toBe('2026-08-30');

    await rerender({ date: '2026-09-06' });
    // New date fetch is in flight — old-date rows must NOT leak through.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      (blockResolve as (value: unknown) => void)?.(QUEUE('2026-09-06'));
    });
    await waitFor(() => expect(result.current.data?.date).toBe('2026-09-06'));
  });
});
