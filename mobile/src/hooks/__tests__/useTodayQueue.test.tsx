import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchTodayQueue } from '@/lib/staff';
import { useTodayQueue, TODAY_QUEUE_POLL_INTERVAL_MS } from '../useTodayQueue';

/**
 * Today-queue polling law (same architecture as the patient live queue):
 * fetch on focus, refetch when the DATE param changes, tick every 15s, stop
 * on unfocus AND unmount, never overlap in-flight requests, keep last-good
 * data on poll errors, recover on the next tick.
 */

jest.mock('@/lib/staff', () => ({
  fetchTodayQueue: jest.fn(),
}));

const mockedFetch = fetchTodayQueue as jest.Mock;

const QUEUE = (date: string) => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { confirmed: 2, called: 1, completed: 0, cancelled: 0, noShow: 0 },
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
