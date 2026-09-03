import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { fetchLiveQueue } from '@/lib/appointments';
import { useLiveQueue, LIVE_QUEUE_POLL_INTERVAL_MS } from '../useLiveQueue';

/**
 * Live-queue polling law: fetch on focus, tick every 15s, stop on unfocus
 * AND on unmount, never overlap in-flight requests, keep last-good data on
 * errors, and recover on the next tick.
 *
 * RTL v14 notes: renderHook/rerender/unmount are ALL async (each awaits its
 * own act) — awaiting them in sequence avoids overlapping-act errors. Fake
 * timers fake ONLY the macro timers so React and the mocks can still flush
 * microtasks.
 */

jest.mock('@/lib/appointments', () => ({
  fetchLiveQueue: jest.fn(),
}));

// mobilefix2 P2: the @react-native/jest-preset already swaps AppState for a
// mock (addEventListener = tracked jest.fn); its `currentState` is a bare
// jest.fn though — the hook expects a status string, so each test seeds
// 'active' (the app's foreground assumption at mount). The listener is
// invoked manually for background/active transitions.
beforeEach(() => {
  (AppState as { currentState: unknown }).currentState = 'active';
});

const mockedFetch = fetchLiveQueue as jest.Mock;

const QUEUE = (my: unknown = null) => ({
  date: '2026-08-31',
  schedule: {
    clinicName: 'Sunrise Clinic',
    clinicAddress: 'MG Road',
    startTime: '09:00',
    endTime: '13:00',
    avgMinutesPerPatient: 10,
  },
  doctor: { fullName: 'Ananya Rao', specialization: 'Cardiologist' },
  current: { queueNumber: 3, patientName: 'P***r' },
  upNext: [{ queueNumber: 4, patientName: 'R***i', estWaitMin: 10 }],
  counts: { completed: 2, called: 1, waiting: 1 },
  my,
});

function useScopedFakeTimers() {
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });
}

/** Advance exactly one poll interval and let the fetch settle. */
async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(LIVE_QUEUE_POLL_INTERVAL_MS);
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
  mockedFetch.mockResolvedValue(QUEUE());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useLiveQueue — 15s cadence', () => {
  test('fetches immediately, then once per 15s tick', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));

    // Initial fetch on focus.
    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.current.data?.schedule.clinicName).toBe('Sunrise Clinic');
    expect(result.current.loading).toBe(false);

    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(3);

    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  test('polls the CURRENT (scheduleId, date) on every tick', async () => {
    useScopedFakeTimers();
    await renderHook(() => useLiveQueue('sch9', '2026-09-07', true));
    await act(async () => {});
    await tick();

    expect(mockedFetch).toHaveBeenNthCalledWith(1, 'sch9', '2026-09-07');
    expect(mockedFetch).toHaveBeenNthCalledWith(2, 'sch9', '2026-09-07');
  });
});

describe('useLiveQueue — stops', () => {
  test('no polling while unfocused (active: false)', async () => {
    useScopedFakeTimers();
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useLiveQueue('sch1', '2026-08-31', active),
      { initialProps: { active: false } },
    );

    await act(async () => {
      jest.advanceTimersByTime(3 * LIVE_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).not.toHaveBeenCalled();

    // Focusing starts it; unfocusing stops it again.
    await rerender({ active: true });
    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await rerender({ active: false });
    await act(async () => {
      jest.advanceTimersByTime(5 * LIVE_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('interval cleared on unmount', async () => {
    useScopedFakeTimers();
    const { unmount } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));

    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(10 * LIVE_QUEUE_POLL_INTERVAL_MS);
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

    await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));
    // The initial request is now hanging.
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Tick fires while the first request is unresolved → skipped.
    await act(async () => {
      jest.advanceTimersByTime(LIVE_QUEUE_POLL_INTERVAL_MS);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // First request resolves; the NEXT tick fetches again.
    await act(async () => {
      resolveFirst(QUEUE());
    });
    await tick();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe('useLiveQueue — resilience', () => {
  test('a failed poll keeps the last good data and surfaces the error', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));
    await act(async () => {});
    expect(result.current.data).not.toBeNull();
    expect(result.current.error).toBeNull();

    mockedFetch.mockRejectedValueOnce(new Error('network blip'));
    await tick();

    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.data?.schedule.clinicName).toBe('Sunrise Clinic'); // kept

    // Next successful tick clears the error and refreshes data.
    await tick();
    expect(result.current.error).toBeNull();
  });

  test('manual refresh() fetches immediately and toggles refreshing', async () => {
    useScopedFakeTimers();
    const { result } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));
    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.data?.counts.waiting).toBe(1);
  });

  test('my:null (anonymous caller) renders the same data without a You row', async () => {
    useScopedFakeTimers();
    mockedFetch.mockResolvedValue(QUEUE(null));
    const { result } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));

    await act(async () => {});

    expect(result.current.data?.my).toBeNull();
    expect(result.current.error).toBeNull(); // anonymous NEVER errors
  });
});

describe('useLiveQueue — foreground re-sync (mobilefix2 P2)', () => {
  test('returning to active after background fires ONE silent refetch', async () => {
    const { result } = await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));
    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1); // initial focus fetch

    await emitAppState('background');
    await emitAppState('active');
    await act(async () => {});

    expect(mockedFetch).toHaveBeenCalledTimes(2); // exactly one silent refetch
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test('NO refetch when a fetch is already in flight (guard absorbs the trigger)', async () => {
    mockedFetch.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    await renderHook(() => useLiveQueue('sch1', '2026-08-31', true));
    await act(async () => {}); // the initial fetch hangs — in flight
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await emitAppState('background');
    await emitAppState('active');
    await act(async () => {});

    expect(mockedFetch).toHaveBeenCalledTimes(1); // nothing stacked
  });

  test('unfocused hook ignores the foreground transition', async () => {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useLiveQueue('sch1', '2026-08-31', active),
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
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
