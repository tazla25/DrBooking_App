import { act, renderHook } from '@testing-library/react-native';
import { fetchStaffSchedules } from '@/lib/staff';
import { useSchedules } from '../useSchedules';

/**
 * Schedules hook law: initial load of the staff list (inactive schedules
 * included), refresh() serves pull-to-refresh AND refetch-after-mutation,
 * errors surface with retry, and a mutation-failure never blanks the list.
 */

jest.mock('@/lib/staff', () => ({
  fetchStaffSchedules: jest.fn(),
}));

const mockedFetch = fetchStaffSchedules as jest.Mock;

const SCHEDULES = {
  today: '2026-08-30',
  schedules: [
    {
      id: 'sch1',
      doctorId: 'doc1',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '13:00',
      clinicName: 'Sunrise Clinic',
      clinicAddress: 'MG Road',
      pinCode: '560001',
      landmark: null,
      mapLink: null,
      avgMinutesPerPatient: 10,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      doctor: { id: 'doc1', fullName: 'Ananya Rao' },
      todayOverride: null,
      todayQueueCount: 2,
    },
    {
      id: 'sch2',
      doctorId: 'doc1',
      dayOfWeek: 3,
      startTime: '16:00',
      endTime: '19:00',
      clinicName: 'Evening Clinic',
      clinicAddress: 'Park Street',
      pinCode: null,
      landmark: null,
      mapLink: null,
      avgMinutesPerPatient: 15,
      isActive: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      doctor: { id: 'doc1', fullName: 'Ananya Rao' },
      todayOverride: null,
      todayQueueCount: 0,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(SCHEDULES);
});

describe('useSchedules', () => {
  test('loads the staff list including inactive schedules', async () => {
    const { result } = await renderHook(() => useSchedules());
    await act(async () => {});

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.today).toBe('2026-08-30');
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[1].isActive).toBe(false); // inactive ones included
  });

  test('refresh() refetches — pull-to-refresh AND after mutations', async () => {
    const { result } = await renderHook(() => useSchedules());
    await act(async () => {});
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // e.g. after PUT /api/schedules/:id the screen calls refresh()
    const updated = {
      ...SCHEDULES,
      schedules: [SCHEDULES.schedules[0], { ...SCHEDULES.schedules[1], isActive: false }],
    };
    mockedFetch.mockResolvedValueOnce(updated);
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.items).toHaveLength(2);
  });

  test('initial load errors surface with retry', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    const { result } = await renderHook(() => useSchedules());
    await act(async () => {});

    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.items).toHaveLength(0);

    await act(async () => {
      await result.current.refresh(); // retry
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(2);
  });

  test('a failed refresh keeps the already-loaded list', async () => {
    const { result } = await renderHook(() => useSchedules());
    await act(async () => {});
    expect(result.current.items).toHaveLength(2);

    mockedFetch.mockRejectedValueOnce(new Error('blip'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(result.current.items).toHaveLength(2); // kept
    expect(result.current.refreshing).toBe(false);
  });
});
