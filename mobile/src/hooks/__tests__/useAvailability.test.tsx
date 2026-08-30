import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchAvailability } from '@/lib/appointments';
import { ApiError } from '@/lib/errors';
import { useAvailability } from '../useAvailability';

/**
 * Availability hook — the booking screen's live "can I book this slot?"
 * source: open/closed mapping, selection-change refetch, error + retry.
 */

jest.mock('@/lib/appointments', () => ({
  fetchAvailability: jest.fn(),
}));

const mockedFetch = fetchAvailability as jest.Mock;

const OPEN = {
  open: true,
  date: '2026-08-31',
  schedule: {
    id: 'sch1',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '13:00',
    clinicName: 'Sunrise Clinic',
    clinicAddress: 'MG Road',
    pinCode: null,
    landmark: null,
    mapLink: null,
    avgMinutesPerPatient: 10,
  },
  nextQueue: 6,
  estWaitMin: 40,
  capacityLeft: 8,
  avgMinutesPerPatient: 10,
};

const CLOSED = { open: false as const, reason: 'SCHEDULE_CLOSED' as const };

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
});

describe('useAvailability', () => {
  test('loads availability for the selected (schedule, date)', async () => {
    mockedFetch.mockResolvedValue(OPEN);

    const { result } = await renderHook(() => useAvailability('sch1', '2026-08-31'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedFetch).toHaveBeenCalledWith('sch1', '2026-08-31');
    expect(result.current.data?.open).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test('closed days arrive as open:false (banner, not error)', async () => {
    mockedFetch.mockResolvedValue(CLOSED);

    const { result } = await renderHook(() => useAvailability('sch1', '2026-09-07'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ open: false, reason: 'SCHEDULE_CLOSED' });
    expect(result.current.error).toBeNull();
  });

  test('changing the date refetches (stale data is hidden while loading)', async () => {
    mockedFetch.mockResolvedValue(OPEN);

    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useAvailability('sch1', date),
      { initialProps: { date: '2026-08-31' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The next fetch hangs until we resolve it — lets us observe the loading
    // window where the OLD date's metrics must not leak.
    let release: (value: typeof OPEN) => void = () => undefined;
    mockedFetch.mockImplementation(
      () =>
        new Promise<typeof OPEN>((resolve) => {
          release = resolve;
        }),
    );
    await rerender({ date: '2026-09-07' });

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBeNull();

    release({ ...OPEN, date: '2026-09-07', capacityLeft: 0 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedFetch).toHaveBeenLastCalledWith('sch1', '2026-09-07');
    expect(result.current.data?.open).toBe(true);
    if (result.current.data?.open) {
      expect(result.current.data.capacityLeft).toBe(0);
    }
  });

  test('idle while nothing is selected (no fetch, no spinner)', async () => {
    const { result } = await renderHook(() => useAvailability(null, null));

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  test('404 surfaces as a friendly error with a retry that recovers', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Schedule not found'));

    const { result } = await renderHook(() => useAvailability('gone', '2026-08-31'));

    await waitFor(() =>
      expect(result.current.error).toBe('We could not find what you were looking for.'),
    );

    mockedFetch.mockResolvedValue(OPEN);
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data?.open).toBe(true);
  });
});
