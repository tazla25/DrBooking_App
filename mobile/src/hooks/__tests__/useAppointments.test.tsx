import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchMyAppointments } from '@/lib/appointments';
import { useAppointments } from '../useAppointments';

/**
 * The My Appointments list hook: initial load per range, load-more pagination
 * with dedupe, pull-to-refresh, error + retry, and in-place list patching
 * after a local mutation (cancel).
 */

jest.mock('@/lib/appointments', () => ({
  fetchMyAppointments: jest.fn(),
}));

const mockedFetch = fetchMyAppointments as jest.Mock;

function page(items: Record<string, unknown>[], total: number, page: number) {
  return { total, page, pageSize: 10, appointments: items };
}

function appt(id: string, queueNumber: number, status = 'CONFIRMED') {
  return {
    id,
    date: '2026-08-31',
    queueNumber,
    status,
    source: 'ONLINE',
    fee: 300,
    doctor: { id: 'doc1', fullName: 'Ananya Rao', specialization: 'Cardiologist' },
    schedule: {
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'MG Road',
      startTime: '09:00',
      endTime: '13:00',
    },
    estWaitMin: 20,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
});

describe('useAppointments — initial load', () => {
  test('fetches page 1 for the range and exposes items + total', async () => {
    mockedFetch.mockResolvedValue(page([appt('a1', 5), appt('a2', 6)], 2, 1));

    const { result } = await renderHook(() => useAppointments('upcoming'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedFetch).toHaveBeenCalledWith('upcoming', 1, 10);
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.complete).toBe(true);
  });

  test('range switch refetches with the new range', async () => {
    mockedFetch.mockResolvedValue(page([appt('p1', 3, 'COMPLETED')], 1, 1));

    const { result, rerender } = await renderHook(
      ({ range }: { range: 'upcoming' | 'past' }) => useAppointments(range),
      { initialProps: { range: 'upcoming' as const } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await rerender({ range: 'past' });
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith('past', 1, 10));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('COMPLETED'));
  });

  test('network failure surfaces a friendly error (with retry available)', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'));

    const { result } = await renderHook(() => useAppointments('upcoming'));

    await waitFor(() =>
      expect(result.current.error).toBe(
        'Cannot reach the server. Check your connection and try again.',
      ),
    );
    expect(result.current.items).toEqual([]);
  });
});

describe('useAppointments — pagination', () => {
  test('loadMore appends the next page and dedupes by id', async () => {
    mockedFetch.mockResolvedValueOnce(page([appt('a1', 5)], 12, 1));

    const { result } = await renderHook(() => useAppointments('upcoming'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Page 2 contains a1 again (server overlap) plus fresh rows.
    mockedFetch.mockResolvedValueOnce(page([appt('a1', 5), appt('a2', 6), appt('a3', 7)], 12, 2));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockedFetch).toHaveBeenLastCalledWith('upcoming', 2, 10);
    const ids = result.current.items.map((a) => a.id);
    expect(ids).toEqual(['a1', 'a2', 'a3']); // deduped
    expect(result.current.complete).toBe(false);
  });

  test('loadMore is a no-op at the end of the list', async () => {
    mockedFetch.mockResolvedValue(page([appt('a1', 5)], 1, 1));

    const { result } = await renderHook(() => useAppointments('upcoming'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1); // no page 2 requested
    expect(result.current.complete).toBe(true);
  });
});

describe('useAppointments — refresh + mutations', () => {
  test('pull-to-refresh reloads page 1', async () => {
    mockedFetch.mockResolvedValueOnce(page([appt('a1', 5)], 5, 1));

    const { result } = await renderHook(() => useAppointments('upcoming'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Something changed server-side: a1 got cancelled, a4 appeared.
    mockedFetch.mockResolvedValueOnce(page([appt('a4', 9)], 4, 1));
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockedFetch).toHaveBeenLastCalledWith('upcoming', 1, 10);
    expect(result.current.items.map((a) => a.id)).toEqual(['a4']);
    expect(result.current.refreshing).toBe(false);
  });

  test('updateItems patches the list in place (cancel removes the row)', async () => {
    mockedFetch.mockResolvedValue(page([appt('a1', 5), appt('a2', 6)], 2, 1));

    const { result } = await renderHook(() => useAppointments('upcoming'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.updateItems((items) => items.filter((a) => a.id !== 'a1'));
    });

    expect(result.current.items.map((a) => a.id)).toEqual(['a2']);
  });

  test('retry after an error recovers the list', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'));

    const { result } = await renderHook(() => useAppointments('upcoming'));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    mockedFetch.mockResolvedValue(page([appt('a1', 5)], 1, 1));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });
});
