import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/store/auth';
import type { SafeUser } from '@/lib/types';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { formatDateISO } from '@/lib/format';
import { UPCOMING_SCAN_DAYS } from '@/hooks/useTodayQueue';
import { fetchTodayQueue, confirmAppointment, type TodayQueueResponse } from '@/lib/staff';
import StaffTodayScreen from '../(staff)/index';

/**
 * mobilefix2 FIX-C — the Today console's UNIFIED patient list:
 *   - pending patients (selected date), upcoming pending patients (future
 *     dates) and the confirmed queue render in ONE FlatList, each under its
 *     own section header (no floating cards above the list);
 *   - pending rows are COMPACT — tapping the row reveals its Confirm/Reject
 *     actions in place (one row expanded at a time, collapse on settle);
 *   - upcoming rows keep their "For <date>" date line (mobilefix1 FIX B,
 *     ported to the new anatomy);
 *   - an entirely empty list keeps the EmptyState behavior.
 *
 * Ports the mobilefix1 upcoming-card coverage to the new list anatomy (no
 * coverage deleted — same scan/confirm/refresh assertions, new structure).
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

/** The selected (today) queue — one PENDING row for the pending section and
 * one CONFIRMED row for the queue section (the unified-list fixture). */
const TODAY_QUEUE = (): TodayQueueResponse => ({
  date: today(),
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 1, confirmed: 1, called: 0, completed: 0, cancelled: 0, noShow: 0 },
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
    {
      id: 'aptQ',
      queueNumber: 6,
      status: 'CONFIRMED',
      source: 'ONLINE',
      patientName: 'Queue Patient',
      patientPhone: '+919812345602',
      patientId: 'u3',
      notes: null,
      fee: 300,
      estWaitMin: 25,
      createdAt: '2026-08-30T04:00:00.000Z',
    },
  ],
});

/** The selected-date queue AFTER 'aptSel' is confirmed (server truth: the
 * row moves to the queue section, the pending section drains). */
const TODAY_QUEUE_AFTER_CONFIRM = (): TodayQueueResponse => ({
  date: today(),
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 0, confirmed: 2, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [
    {
      id: 'aptQ',
      queueNumber: 6,
      status: 'CONFIRMED',
      source: 'ONLINE',
      patientName: 'Queue Patient',
      patientPhone: '+919812345602',
      patientId: 'u3',
      notes: null,
      fee: 300,
      estWaitMin: 25,
      createdAt: '2026-08-30T04:00:00.000Z',
    },
    {
      id: 'aptSel',
      queueNumber: 3,
      status: 'CONFIRMED',
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

/** toJSON walk (RNTL 14): collect text-node strings in document order — the
 * order assertion below compares positions in this list (exact match, no
 * JSON.stringify — props in the toJSON tree can hold circular fibers). */
type JsonNode =
  | { type?: unknown; props?: Record<string, unknown>; children?: JsonNode[] }
  | string
  | null
  | undefined;

function collectTexts(node: JsonNode, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (node.children) for (const child of node.children) collectTexts(child, out);
}

function textOrder(node: JsonNode): string[] {
  const out: string[] = [];
  collectTexts(node, out);
  return out;
}

describe('Today console — unified patient list (mobilefix2 FIX-C)', () => {
  test('renders pending, upcoming and queue sections IN ORDER with headers; rows show their dates', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    // All three sections render with their headers (counts derive from the
    // rendered arrays — same sources the rows use).
    expect(tree.getByText('Upcoming — awaiting confirmation (1)')).toBeTruthy();
    expect(tree.getByText('Queue · Today')).toBeTruthy();
    // The patients themselves live in the list.
    expect(tree.getByText('Same Day Patient')).toBeTruthy();
    expect(tree.getByText('Future Patient')).toBeTruthy();
    expect(tree.getByText('Queue Patient')).toBeTruthy();
    // The upcoming row keeps its FUTURE date; the selected-date row omits it.
    expect(tree.getByText(`For ${formatDateISO(d2)}`)).toBeTruthy();
    expect(tree.queryByText(`For ${formatDateISO(today())}`)).toBeNull();

    // Document order: pending header → its rows → upcoming header → its rows
    // → queue header → queue rows (verified on the toJSON text walk).
    const texts = textOrder(tree.toJSON());
    const at = (s: string) => texts.findIndex((t) => t === s);
    expect(at('Awaiting confirmation (1)')).toBeGreaterThanOrEqual(0);
    expect(at('Same Day Patient')).toBeGreaterThan(at('Awaiting confirmation (1)'));
    expect(at('Upcoming — awaiting confirmation (1)')).toBeGreaterThan(at('Same Day Patient'));
    expect(at('Future Patient')).toBeGreaterThan(at('Upcoming — awaiting confirmation (1)'));
    expect(at('Queue · Today')).toBeGreaterThan(at('Future Patient'));
    expect(at('Queue Patient')).toBeGreaterThan(at('Queue · Today'));
  });

  test('tap-to-reveal: compact rows hide the actions; tapping reveals Confirm/Reject (a11y state flips)', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    // COMPACT: no revealed actions anywhere; the quiet affordance is present.
    expect(tree.queryByText('Confirm')).toBeNull();
    expect(tree.queryByText('Reject')).toBeNull();
    expect(tree.getAllByText('Tap to confirm')).toHaveLength(2);

    // The whole row is the toggle — press it via its accessible label.
    // (fireEvent.press is async in RNTL 14: awaiting it lets the act flush
    // land the re-render before the assertions.)
    const row = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    expect(row.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(row);

    // Revealed in place: Confirm + Reject appear, the a11y state flips.
    expect(tree.getAllByText('Confirm')).toHaveLength(1);
    expect(tree.getAllByText('Reject')).toHaveLength(1);
    expect(
      tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation').props
        .accessibilityState,
    ).toEqual({ expanded: true });

    // Tapping the expanded row again collapses it.
    await fireEvent.press(tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation'));
    expect(tree.queryByText('Confirm')).toBeNull();
    expect(tree.queryByText('Reject')).toBeNull();
  });

  test('ONE row expanded at a time — tapping another row collapses the previous', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Future Patient')).toBeTruthy());

    // Expand the first row.
    await fireEvent.press(tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation'));
    expect(tree.getAllByText('Confirm')).toHaveLength(1);

    // Expanding the second row collapses the first — still ONE set of actions.
    await fireEvent.press(tree.getByLabelText('Future Patient, token 5, awaiting confirmation'));
    expect(tree.getAllByText('Confirm')).toHaveLength(1);
    expect(
      tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation').props
        .accessibilityState,
    ).toEqual({ expanded: false });
    expect(
      tree.getByLabelText('Future Patient, token 5, awaiting confirmation').props
        .accessibilityState,
    ).toEqual({ expanded: true });

    // Tapping the expanded row collapses it (back to zero revealed actions).
    await fireEvent.press(tree.getByLabelText('Future Patient, token 5, awaiting confirmation'));
    expect(tree.queryByText('Confirm')).toBeNull();
  });

  test('pressing Confirm on the revealed UPCOMING row goes through the SAME confirm handler; collapse on settle', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() =>
      expect(tree.getByText('Upcoming — awaiting confirmation (1)')).toBeTruthy(),
    );

    // The server confirms; the settle re-scan finds the row gone.
    mockedConfirm.mockResolvedValue({ appointment: { id: 'aptUp', status: 'CONFIRMED' } });
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    // Expand the upcoming row, then press its revealed Confirm.
    await fireEvent.press(tree.getByLabelText('Future Patient, token 5, awaiting confirmation'));
    expect(tree.getAllByText('Confirm')).toHaveLength(1);
    await fireEvent.press(tree.getByText('Confirm'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptUp'));
    // Same toast copy as the selected-date confirm flow.
    await waitFor(() =>
      expect(tree.getByText('Serial #5 confirmed — patient notified')).toBeTruthy(),
    );
    // Collapse on settle + normal data re-derivation: the row leaves the list
    // (the upcoming section header drains away with it).
    await waitFor(() => expect(tree.queryByText('Future Patient')).toBeNull());
    expect(tree.queryByText('Upcoming — awaiting confirmation (1)')).toBeNull();
    expect(tree.queryByText('Confirm')).toBeNull();
  });

  test('confirming the SELECTED-date pending row moves it into the queue section (pending header drains)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    mockedConfirm.mockResolvedValue({ appointment: { id: 'aptSel', status: 'CONFIRMED' } });
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE_AFTER_CONFIRM());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    await fireEvent.press(tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation'));
    await fireEvent.press(tree.getByText('Confirm'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptSel'));
    await waitFor(() =>
      expect(tree.getByText('Serial #3 confirmed — patient notified')).toBeTruthy(),
    );
    // The pending section is GONE (zero pending rows); the patient now sits in
    // the queue section (single row — no duplicate).
    await waitFor(() => expect(tree.queryByText('Awaiting confirmation (1)')).toBeNull());
    await waitFor(() => expect(tree.queryByText('Confirm')).toBeNull());
    expect(tree.getAllByText('Same Day Patient')).toHaveLength(1);
    expect(tree.getByText('Queue · Today')).toBeTruthy();
  });

  test('Reject on a revealed row opens the SAME reject modal (notes flow untouched)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    await fireEvent.press(tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation'));
    await fireEvent.press(tree.getByText('Reject'));

    await waitFor(() => expect(tree.getByText('Reject this booking?')).toBeTruthy());
    expect(tree.getByText('Keep it pending')).toBeTruthy();
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
    expect(tree.queryByText(/Upcoming — awaiting confirmation/)).toBeNull();
    // The selected-date pending rows NEVER depend on the horizon scan.
    expect(tree.getByText('Same Day Patient')).toBeTruthy();
  });

  test('entirely empty list → EmptyState (no section headers)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve(EMPTY_QUEUE(date ?? today() ?? d1)),
    );

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('No appointments today')).toBeTruthy());
    expect(tree.queryByText('Awaiting confirmation (')).toBeNull();
    expect(tree.queryByText('Upcoming — awaiting confirmation')).toBeNull();
    expect(tree.queryByText('Queue · Today')).toBeNull();
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
      expect(tree.getByText('Upcoming — awaiting confirmation (1)')).toBeTruthy(),
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
