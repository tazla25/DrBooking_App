import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { deepLinkRouteFor, usePushDeepLinks } from '../usePushDeepLinks';
import { useAuthStore } from '@/store/auth';
import type { SafeUser } from '@/lib/types';

/**
 * Push deep-links (B3): the three frozen server payload types all route to
 * the patient appointments tab; unknown types, logged-out sessions and
 * staff/admin roles never navigate; double-fires dedupe; a cold-start tap
 * during session hydration is DEFERRED, not dropped.
 */

const mockResponseListeners: ((response: unknown) => void)[] = [];
let mockLastResponse: unknown = null;

jest.mock('expo-notifications', () => ({
  __esModule: true,
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => ({ id: 'default' })),
  addNotificationResponseReceivedListener: jest.fn((cb: (response: unknown) => void) => {
    mockResponseListeners.push(cb);
    return { remove: jest.fn() };
  }),
  useLastNotificationResponse: jest.fn(() => mockLastResponse),
}));

const PATIENT: SafeUser = {
  id: 'user-p1',
  phone: '+919812345601',
  name: 'Priya Nair',
  role: 'PATIENT',
  verificationStatus: 'VERIFIED',
  mustChangePassword: false,
  isActive: true,
  delegatedDoctorId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const DOCTOR: SafeUser = { ...PATIENT, id: 'user-d1', role: 'DOCTOR' };

/** Build a notification response the way expo-notifications delivers it. */
function responseOf(id: string, type?: string) {
  return {
    notification: {
      request: {
        identifier: id,
        content: { data: type ? { type, appointmentId: 'apt1' } : {} },
      },
    },
  };
}

function fireListener(response: unknown): void {
  const listeners = [...mockResponseListeners];
  for (const cb of listeners) cb(response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResponseListeners.length = 0;
  mockLastResponse = null;
  useAuthStore.setState({ status: 'authenticated', token: 'tok1', user: PATIENT });
});

// ---------------------------------------------------------------------------
// Pure mapper
// ---------------------------------------------------------------------------

describe('deepLinkRouteFor', () => {
  test('all frozen payload types route to the patient appointments tab', () => {
    expect(deepLinkRouteFor('BOOKING_CONFIRMED')).toBe('/(tabs)/appointments');
    expect(deepLinkRouteFor('QUEUE_POSITION')).toBe('/(tabs)/appointments');
    expect(deepLinkRouteFor('APPOINTMENT_CANCELLED')).toBe('/(tabs)/appointments');
    // Phase 11 B4: the manual-confirmation push routes the same way.
    expect(deepLinkRouteFor('APPOINTMENT_CONFIRMED')).toBe('/(tabs)/appointments');
  });

  test('unknown type is a no-op', () => {
    expect(deepLinkRouteFor('SOMETHING_NEW')).toBeNull();
  });

  test('missing/undefined/non-string type is a no-op', () => {
    expect(deepLinkRouteFor(undefined)).toBeNull();
    expect(deepLinkRouteFor(null)).toBeNull();
    expect(deepLinkRouteFor(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hook behavior
// ---------------------------------------------------------------------------

describe('usePushDeepLinks', () => {
  test('patient taps BOOKING_CONFIRMED → router.push("/(tabs)/appointments")', async () => {
    const router = useRouter() as unknown as { push: jest.Mock };
    await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(responseOf('n1', 'BOOKING_CONFIRMED'));
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/appointments');
  });

  test('patient taps APPOINTMENT_CONFIRMED (Phase 11 B4) → appointments tab (and CANCELLED still works)', async () => {
    const router = useRouter() as unknown as { push: jest.Mock };
    await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(responseOf('n-confirm', 'APPOINTMENT_CONFIRMED'));
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/appointments');

    // The existing CANCELLED link still routes after the Phase 11 change.
    await act(async () => {
      fireListener(responseOf('n-cancel', 'APPOINTMENT_CANCELLED'));
    });
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith('/(tabs)/appointments');
  });

  test('double-fire (listener + last-response, same id) navigates exactly once', async () => {
    const router = useRouter() as unknown as { push: jest.Mock };
    const response = responseOf('n2', 'QUEUE_POSITION');
    const { rerender } = await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(response);
    });
    expect(router.push).toHaveBeenCalledTimes(1);

    // The SAME tap also surfaces through useLastNotificationResponse.
    mockLastResponse = response;
    await act(async () => {
      rerender({});
    });
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  test('unknown payload type → no navigation', async () => {
    const router = useRouter() as unknown as { push: jest.Mock };
    await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(responseOf('n3', 'TOTALLY_NEW_TYPE'));
    });

    expect(router.push).not.toHaveBeenCalled();
  });

  test('logged-out tap → no navigation (and a later login never replays it)', async () => {
    useAuthStore.setState({ status: 'unauthenticated', token: null, user: null });
    const router = useRouter() as unknown as { push: jest.Mock };
    const { rerender } = await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(responseOf('n4', 'APPOINTMENT_CANCELLED'));
    });
    expect(router.push).not.toHaveBeenCalled();

    // The tap was consumed — logging in afterwards must not auto-navigate.
    useAuthStore.setState({ status: 'authenticated', token: 'tok1', user: PATIENT });
    await act(async () => {
      rerender({});
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  test('staff role (DOCTOR) tap → no navigation', async () => {
    useAuthStore.setState({ status: 'authenticated', token: 'tok1', user: DOCTOR });
    const router = useRouter() as unknown as { push: jest.Mock };
    await renderHook(() => usePushDeepLinks());

    await act(async () => {
      fireListener(responseOf('n5', 'BOOKING_CONFIRMED'));
    });

    expect(router.push).not.toHaveBeenCalled();
  });

  test('cold start during hydration: tap is DEFERRED, fires once the patient session lands', async () => {
    useAuthStore.setState({ status: 'hydrating', token: null, user: null });
    mockLastResponse = responseOf('n6', 'BOOKING_CONFIRMED');
    const router = useRouter() as unknown as { push: jest.Mock };

    const { rerender } = await renderHook(() => usePushDeepLinks());
    expect(router.push).not.toHaveBeenCalled(); // still hydrating — deferred

    useAuthStore.setState({ status: 'authenticated', token: 'tok1', user: PATIENT });
    await act(async () => {
      rerender({});
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/appointments');
  });

  test('listener subscription is removed on unmount', async () => {
    const { unmount } = await renderHook(() => usePushDeepLinks());
    const subscribe = (
      Notifications as unknown as {
        addNotificationResponseReceivedListener: jest.Mock;
      }
    ).addNotificationResponseReceivedListener;
    const registration = subscribe.mock.results[0]?.value as { remove: jest.Mock };

    await act(async () => {
      unmount();
    });

    expect(registration.remove).toHaveBeenCalled();
  });
});
