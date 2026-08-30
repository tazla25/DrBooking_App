import { act, renderHook } from '@testing-library/react-native';
import { fetchPatients } from '@/lib/staff';
import { usePatients, PATIENTS_PAGE_SIZE } from '../usePatients';

/**
 * Patient book list law: the RAW search text is debounced inside the hook
 * (no fetch per keystroke), loadMore appends deduped pages, refresh resets
 * to page 1, and stale query results never leak between searches.
 */

jest.mock('@/lib/staff', () => ({
  fetchPatients: jest.fn(),
}));

const mockedFetch = fetchPatients as jest.Mock;

function page(patients: { name: string; phone: string }[], total: number) {
  return {
    total,
    page: 1,
    pageSize: PATIENTS_PAGE_SIZE,
    patients: patients.map((p, i) => ({
      ...p,
      lastVisit: '2026-08-30',
      lastStatus: 'COMPLETED',
      totalVisits: i + 1,
    })),
  };
}

const RAVI = { name: 'Ravi Kumar', phone: '+919812345601' };
const PRIYA = { name: 'Priya Nair', phone: '+919812345602' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(page([RAVI, PRIYA], 2));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('usePatients — debounced search', () => {
  test('does not fetch per keystroke — only after the debounce settles', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });

    const { result, rerender } = await renderHook(({ q }: { q: string }) => usePatients(q), {
      initialProps: { q: '' },
    });

    await act(async () => {}); // initial fetch for ''
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenNthCalledWith(1, '', 1, PATIENTS_PAGE_SIZE);

    // Typing "pri", "priya" — no fetch until typing pauses.
    await rerender({ q: 'pri' });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await rerender({ q: 'priya' });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(350); // debounce window passed
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch).toHaveBeenNthCalledWith(2, 'priya', 1, PATIENTS_PAGE_SIZE);
    expect(result.current.items).toHaveLength(2);
  });

  test('q is trimmed before it hits the API', async () => {
    const { rerender } = await renderHook(({ q }: { q: string }) => usePatients(q), {
      initialProps: { q: '' },
    });
    await act(async () => {});
    await rerender({ q: '  ravi  ' });
    // Fast-forward the debounce with real timers.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(mockedFetch).toHaveBeenLastCalledWith('ravi', 1, PATIENTS_PAGE_SIZE);
  });
});

describe('usePatients — pagination', () => {
  test('loadMore appends page 2 with dedupe by phone', async () => {
    mockedFetch.mockResolvedValueOnce(page([RAVI], 3));
    const { result } = await renderHook(() => usePatients(''));
    await act(async () => {});
    expect(result.current.items).toHaveLength(1);
    expect(result.current.complete).toBe(false);

    // Page 2 repeats Ravi's phone (server grouping glitch) + adds Priya.
    mockedFetch.mockResolvedValueOnce({
      total: 3,
      page: 2,
      pageSize: PATIENTS_PAGE_SIZE,
      patients: [
        { ...RAVI, lastVisit: '2026-08-29', lastStatus: 'CONFIRMED', totalVisits: 5 },
        { ...PRIYA, lastVisit: '2026-08-28', lastStatus: 'NO_SHOW', totalVisits: 1 },
      ],
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockedFetch).toHaveBeenLastCalledWith('', 2, PATIENTS_PAGE_SIZE);
    expect(result.current.items).toHaveLength(2); // Ravi NOT duplicated
    expect(result.current.complete).toBe(false);
  });

  test('complete is true once every row is loaded; loadMore then no-ops', async () => {
    mockedFetch.mockResolvedValueOnce(page([RAVI, PRIYA], 2));
    const { result } = await renderHook(() => usePatients(''));
    await act(async () => {});
    expect(result.current.complete).toBe(true);

    await act(async () => {
      await result.current.loadMore(); // items.length >= total → no fetch
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  test('refresh resets to page 1 (pull-to-refresh)', async () => {
    mockedFetch.mockResolvedValueOnce(page([RAVI], 2));
    const { result } = await renderHook(() => usePatients(''));
    await act(async () => {});

    mockedFetch.mockResolvedValueOnce(page([PRIYA], 1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedFetch).toHaveBeenLastCalledWith('', 1, PATIENTS_PAGE_SIZE);
    expect(result.current.items).toEqual([expect.objectContaining(PRIYA)]);
    expect(result.current.refreshing).toBe(false);
  });

  test('errors surface with retry available via refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => usePatients(''));
    await act(async () => {});

    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.items).toHaveLength(0);

    mockedFetch.mockResolvedValueOnce(page([RAVI], 1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });
});
