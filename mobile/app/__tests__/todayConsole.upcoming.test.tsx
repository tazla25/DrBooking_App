import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/store/auth';
import type { SafeUser } from '@/lib/types';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { formatDateISO } from '@/lib/format';
import { UPCOMING_SCAN_DAYS } from '@/hooks/useTodayQueue';
import { fetchTodayQueue, confirmAppointment, type TodayQueueResponse } from '@/lib/staff';
import StaffTodayScreen from '../(staff)/index';

/**
 * mobilefix1 FIX B — the Today console's upcoming-pending card:
 *   - renders ONLY when future-date PENDING rows exist (zero rows = zero
 *     visual noise);
 *   - each row shows its date ("For <date>") and reuses the SAME PendingRow
 *     + confirm handler (a press goes through confirmPending → the transport
 *     confirmAppointment, any date);
 *   - pull-to-refresh triggers the horizon rescan alongside the queue refresh.
 *
 * Transport mocked exactly like the existing Today-console (hook) tests —
 * '@/lib/staff' fetch/confirm/reject overridden; everything else actual.
 * The REAL useTodayQueue runs behind the REAL screen, so the scan pipeline
 * is exercised end-to-end (mock network only). The focus effect is fired by
 * the file-level expo-router mock (adminLayout idiom).
 */

jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    dismissAll: jest.fn(),
  };
  return {
    __esModule: true,
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    // adminLayout-style: run the focus callback in an effect so the screen
    // mounts "focused" (its return value is the blur cleanup).
    useFocusEffect: (cb: () => (() => void) | void) => React.useEffect(() => cb(), [cb]),
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: 'Stack',
    Tabs: 'Tabs',
  };
});

// reanimated/worklets need native modules absent in jest — plain stand-ins
// for the motion primitives (pure presentation in this test).
jest.mock('@/components/motion', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    AnimatedEntrance: ({ children }: { children?: React.ReactNode }) => children ?? null,
    AnimatedChip: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityState,
      style,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean };
      style?: unknown;
    }) => (
      <Pressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        style={style as never}
      >
        {children}
      </Pressable>
    ),
    PulseView: () => null,
    useChangePulse: () => ({ value: 0 }),
  };
});

jest.mock('@/lib/staff', () => ({
  ...jest.requireActual('@/lib/staff'),
  fetchTodayQueue: jest.fn(),
  confirmAppointment: jest.fn(),
  rejectAppointment: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return {
          user: { id: 'u1', phone: '+919844000002', name: 'Dr Today', role: 'DOCTOR' },
          doctorProfile: {
            id: 'doc1',
            fullName: 'Ananya Rao',
            specialization: 'Cardiology',
            registrationNumber: null,
            avatarUrl: null,
          },
          compounderFor: null,
        };
      }
      if (url.startsWith('/api/doctors/')) return { isAvailableNow: true };
      return {};
    }),
  },
}));

// The native safe-area module is absent in jest — a plain View stand-in with
// zero insets keeps GlassScreen/GlassHeader renderable.
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  const Context = React.createContext({ insets, frame });
  return {
    __esModule: true,
    useSafeAreaInsets: () => React.useContext(Context).insets,
    useSafeAreaFrame: () => React.useContext(Context).frame,
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaConsumer: Context.Consumer,
    initialWindowMetrics: { insets, frame },
  };
});

const mockedFetch = fetchTodayQueue as jest.Mock;
const mockedConfirm = confirmAppointment as jest.Mock;

const today = () => istTodayISO();
const scanDates = (): string[] =>
  Array.from({ length: UPCOMING_SCAN_DAYS }, (_, i) => addDaysISO(today(), i + 1));

const EMPTY_QUEUE = (date: string): TodayQueueResponse => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 0, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [],
});

/** The selected (today) queue — one PENDING row for the classic card. */
const TODAY_QUEUE = (): TodayQueueResponse => ({
  date: today(),
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 1, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [
    {
      id: 'aptSel',
      queueNumber: 3,
      status: 'PENDING',
      source: 'ONLINE',
      patientName: 'Same Day Patient',
      patientPhone: '+919812345601',
      patientId: 'u1',
      notes: null,
      fee: 300,
      estWaitMin: 20,
      createdAt: '2026-08-30T03:00:00.000Z',
    },
  ],
});

/** One PENDING row on a future date (an upcoming booking). */
const UPCOMING_QUEUE = (date: string, id: string): TodayQueueResponse => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 1, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [
    {
      id,
      queueNumber: 5,
      status: 'PENDING',
      source: 'ONLINE',
      patientName: 'Future Patient',
      patientPhone: '+919812345678',
      patientId: 'u2',
      notes: null,
      fee: 300,
      estWaitMin: 30,
      createdAt: '2026-08-30T05:30:00.000Z',
    },
  ],
});

function setDoctorSession() {
  const user: SafeUser = {
    id: 'u1',
    phone: '+919844000002',
    name: 'Dr Today',
    role: 'DOCTOR',
    verificationStatus: 'VERIFIED',
    mustChangePassword: false,
    isActive: true,
    delegatedDoctorId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
  useAuthStore.setState({ status: 'authenticated', token: 'tok', user });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  mockedConfirm.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Today console — upcoming-pending card (mobilefix1 FIX B)', () => {
  test('renders BOTH cards when a future-date booking exists; row shows its date', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    // The upcoming card sits adjacent to the selected-date card, with count.
    expect(tree.getByText('Awaiting confirmation — upcoming (1)')).toBeTruthy();
    // The row reuses PendingRow — and shows its FUTURE date.
    expect(tree.getByText('Future Patient')).toBeTruthy();
    expect(tree.getByText(`For ${formatDateISO(d2)}`)).toBeTruthy();
    // No date line on the selected-date row (same-day card omits it).
    expect(tree.queryByText(`For ${formatDateISO(today())}`)).toBeNull();
  });

  test('renders NOTHING extra when the horizon has no pending rows', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());
    expect(tree.queryByText(/— upcoming/)).toBeNull();
  });

  test('pressing Confirm on the upcoming row goes through the SAME confirm handler', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });
    mockedConfirm.mockResolvedValue({ appointment: { id: 'aptUp', status: 'CONFIRMED' } });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() =>
      expect(tree.getByText('Awaiting confirmation — upcoming (1)')).toBeTruthy(),
    );

    // Two PendingRows render (selected-date first, upcoming second) — press
    // the UPCOMING row's Confirm (the second one in document order).
    const confirmButtons = tree.getAllByText('Confirm');
    expect(confirmButtons).toHaveLength(2);
    fireEvent.press(confirmButtons[1]);

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptUp'));
    // Same toast copy as the selected-date confirm flow.
    await waitFor(() =>
      expect(tree.getByText('Serial #5 confirmed — patient notified')).toBeTruthy(),
    );
  });

  test('pull-to-refresh rescans the horizon alongside the queue refresh', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() =>
      expect(tree.getByText('Awaiting confirmation — upcoming (1)')).toBeTruthy(),
    );
    const callsBefore = mockedFetch.mock.calls.filter((c: unknown[]) => c[0] === d2).length;
    expect(callsBefore).toBe(1); // the initial-focus scan

    // Pull-to-refresh: the FlatList's onRefresh (refresh + rescan).
    fireEvent(tree.getByTestId('today-queue-list'), 'refresh');
    await waitFor(() =>
      expect(
        mockedFetch.mock.calls.filter((c: unknown[]) => c[0] === d2).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });
});
