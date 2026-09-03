import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { useAuthStore } from '@/store/auth';
import type { SafeUser, MeResponse } from '@/lib/types';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { formatDateISO } from '@/lib/format';
import { UPCOMING_SCAN_DAYS } from '@/hooks/useTodayQueue';
import { auroraSpacing } from '@/theme';
import { api } from '@/lib/api';
import { fetchTodayQueue, confirmAppointment, type TodayQueueResponse } from '@/lib/staff';
import StaffTodayScreen from '../(staff)/index';

/**
 * mobilefix3 FIX-C — the Today console's pending CAROUSEL (supersedes the
 * mobilefix2 tap-to-reveal rows; owner's design decision after device use):
 *   - ONE horizontal snap carousel (selected-date cards first, then upcoming
 *     by date ascending) under a single "Awaiting confirmation (N)" header
 *     whose count comes from the SAME combined array the cards render;
 *   - Confirm/Reject are ALWAYS VISIBLE, side-by-side at every card's bottom
 *     (no tap-to-expand, no chevron, no "Tap to confirm" hint);
 *   - the busy double-tap guard disables BOTH buttons on the MUTATING card
 *     only (every other card stays enabled);
 *   - the queue (confirmed rows) stays vertical below the carousel.
 *
 * mobilefix3 FIX-B — the header avatar renders the doctor's photo
 * (doctorProfile.avatarUrl), and /api/auth/me is silently refetched on
 * REGAINED focus (the P3 pattern: mount once, regain-focus refetch).
 *
 * Ports ALL nine mobilefix2 todayConsole tests to the carousel anatomy (no
 * coverage deleted — same scan/confirm/refresh/reject assertions, new
 * structure) and adds the carousel-specific + focus-refetch coverage.
 * Transport mocked exactly like the existing Today-console (hook) tests —
 * '@/lib/staff' fetch/confirm/reject overridden; everything else actual.
 * The REAL useTodayQueue runs behind the REAL screen, so the scan pipeline
 * is exercised end-to-end (mock network only). The focus effect is fired by
 * the file-level expo-router mock (captured callback — the appointmentsFocus
 * idiom; the mount-time run is absorbed by the me loading-guard).
 */

let mockFocusCallback: (() => (() => void) | void) | null = null;

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
    // appointmentsFocus idiom: capture the focus callback (mount still runs
    // it once via the effect — the me loading-guard absorbs that first run;
    // the captured callback stands in for the screen REGAINING focus).
    useFocusEffect: (cb: () => (() => void) | void) => {
      mockFocusCallback = cb;
      return React.useEffect(() => cb(), [cb]);
    },
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

const ME_BASE: MeResponse = {
  user: {
    id: 'u1',
    phone: '+919844000002',
    name: 'Dr Today',
    role: 'DOCTOR',
    verificationStatus: 'VERIFIED',
    mustChangePassword: false,
    isActive: true,
    delegatedDoctorId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  doctorProfile: {
    id: 'doc1',
    fullName: 'Ananya Rao',
    specialization: 'Cardiology',
    fee: null,
    yearsExperience: null,
    bio: null,
    registrationNumber: null,
    avatarUrl: null,
  },
};
// mutable per test (the 'mock' prefix keeps the out-of-scope reference legal
// for jest.mock factories — FIX-B2 flips the avatar between fetches).
let mockMe: MeResponse = ME_BASE;

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(async (url: string) => {
      if (url === '/api/auth/me') return mockMe;
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
const mockedApiGet = api.get as jest.Mock;

const today = () => istTodayISO();
const scanDates = (): string[] =>
  Array.from({ length: UPCOMING_SCAN_DAYS }, (_, i) => addDaysISO(today(), i + 1));

const EMPTY_QUEUE = (date: string): TodayQueueResponse => ({
  date,
  doctor: { id: 'doc1', fullName: 'Ananya Rao' },
  counts: { pending: 0, confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 },
  appointments: [],
});

/** The selected (today) queue — one PENDING row for the carousel and one
 * CONFIRMED row for the queue section (the unified-list fixture). */
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
 * row moves to the queue section, the carousel drains). */
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
  mockMe = ME_BASE;
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

/** Climb from a button's label Text to its Pressable host — the nearest
 * ancestor carrying accessibilityState (the AuroraButton contract; the
 * button's computed accessible NAME also contains the leading icon glyph,
 * so a role+name query cannot match the label text alone). */
interface TreeLike {
  props?: Record<string, unknown>;
  parent?: unknown;
}
function buttonStateOf(labelText: TreeLike): { disabled?: boolean; busy?: boolean } {
  let node: unknown = labelText;
  while (node != null) {
    const props = (node as TreeLike).props;
    if (props?.accessibilityState !== undefined) {
      return props.accessibilityState as { disabled?: boolean; busy?: boolean };
    }
    node = (node as TreeLike).parent;
  }
  throw new Error('button host not found above the given label');
}

describe('Today console — pending carousel (mobilefix3 FIX-C)', () => {
  test('ONE carousel + queue section in order; combined header count; For-date on upcoming cards only', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    // ONE pending header with the COMBINED count (1 selected + 1 upcoming).
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // The queue section renders below the carousel (the queue stays vertical).
    expect(tree.getByText('Queue · Today')).toBeTruthy();
    // The patients themselves live on the cards / queue rows.
    expect(tree.getByText('Same Day Patient')).toBeTruthy();
    expect(tree.getByText('Future Patient')).toBeTruthy();
    expect(tree.getByText('Queue Patient')).toBeTruthy();
    // The upcoming card keeps its FUTURE date; the selected-date card omits it.
    expect(tree.getByText(`For ${formatDateISO(d2)}`)).toBeTruthy();
    expect(tree.queryByText(`For ${formatDateISO(today())}`)).toBeNull();

    // Document order: carousel header → both cards (selected first, then the
    // upcoming card) → queue header → queue row (toJSON text walk).
    const texts = textOrder(tree.toJSON());
    const at = (s: string) => texts.findIndex((t) => t === s);
    expect(at('Awaiting confirmation (2)')).toBeGreaterThanOrEqual(0);
    expect(at('Same Day Patient')).toBeGreaterThan(at('Awaiting confirmation (2)'));
    expect(at('Future Patient')).toBeGreaterThan(at('Same Day Patient'));
    expect(at('Queue · Today')).toBeGreaterThan(at('Future Patient'));
    expect(at('Queue Patient')).toBeGreaterThan(at('Queue · Today'));
  });

  test('Confirm/Reject are ALWAYS VISIBLE on every card — no tap-to-reveal, no hint strings', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // BOTH cards carry their actions with zero interaction — side-by-side at
    // the card bottom (the mobilefix2 tap-to-reveal UX is gone).
    expect(tree.getAllByText('Confirm')).toHaveLength(2);
    expect(tree.getAllByText('Reject')).toHaveLength(2);
    // The deleted affordances: no hint text, no expand chevrons anywhere.
    expect(tree.queryByText('Tap to confirm')).toBeNull();
    // The card is a labeled GROUP — no per-card expanded/pressed toggle state.
    const card = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    expect(card.props.accessibilityState).toBeUndefined();
    expect(card.props.onPress).toBeUndefined();
  });

  test('pressing Confirm on the UPCOMING card goes through the SAME confirm handler; card leaves on settle', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // The server confirms; the settle re-scan finds the row gone.
    mockedConfirm.mockResolvedValue({ appointment: { id: 'aptUp', status: 'CONFIRMED' } });
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    // Press the UPCOMING card's always-visible Confirm (selected-date card
    // is FIRST — target the upcoming card's own button).
    const upcoming = tree.getByLabelText(
      `Future Patient, token 5, awaiting confirmation for ${formatDateISO(d2)}`,
    );
    await fireEvent.press(within(upcoming).getByText('Confirm'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptUp'));
    // Same toast copy as the selected-date confirm flow.
    await waitFor(() =>
      expect(tree.getByText('Serial #5 confirmed — patient notified')).toBeTruthy(),
    );
    // Settle re-scan: the upcoming card leaves via data re-derivation; the
    // combined header recounts to 1 and the SELECTED card keeps its buttons.
    await waitFor(() => expect(tree.queryByText('Future Patient')).toBeNull());
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());
    expect(tree.getAllByText('Confirm')).toHaveLength(1);
    expect(tree.getAllByText('Reject')).toHaveLength(1);
  });

  test('confirming the SELECTED-date card moves it into the queue section (carousel drains)', async () => {
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

    const card = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    await fireEvent.press(within(card).getByText('Confirm'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptSel'));
    await waitFor(() =>
      expect(tree.getByText('Serial #3 confirmed — patient notified')).toBeTruthy(),
    );
    // The carousel is GONE (zero pending cards); the patient now sits in the
    // queue section (single row — no duplicate), no actions left rendered.
    await waitFor(() => expect(tree.queryByText('Awaiting confirmation (1)')).toBeNull());
    await waitFor(() => expect(tree.queryByText('Confirm')).toBeNull());
    expect(tree.queryByText('Reject')).toBeNull();
    expect(tree.getAllByText('Same Day Patient')).toHaveLength(1);
    expect(tree.getByText('Queue · Today')).toBeTruthy();
  });

  test('Reject on a card opens the SAME reject modal (notes flow untouched)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    const card = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    await fireEvent.press(within(card).getByText('Reject'));

    await waitFor(() => expect(tree.getByText('Reject this booking?')).toBeTruthy());
    expect(tree.getByText('Keep it pending')).toBeTruthy();
  });

  test('renders NOTHING extra when the horizon has no pending rows (combined count = selected only)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());
    // The selected-date pending cards NEVER depend on the horizon scan.
    expect(tree.getByText('Same Day Patient')).toBeTruthy();
    // One card, one set of actions — no upcoming card peeks in.
    expect(tree.getAllByText('Confirm')).toHaveLength(1);
  });

  test('entirely empty list → EmptyState (no carousel, no queue header)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) =>
      Promise.resolve(EMPTY_QUEUE(date ?? today() ?? d1)),
    );

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('No appointments today')).toBeTruthy());
    expect(tree.queryByText('Awaiting confirmation (')).toBeNull();
    expect(tree.queryByText('Queue · Today')).toBeNull();
    expect(tree.queryByTestId('today-pending-carousel')).toBeNull();
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
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());
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

  test('carousel snap props: snapToInterval (card + gap), fast deceleration, no scroll indicator', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    const carousel = tree.getByTestId('today-pending-carousel');
    // The snap interval is the card pitch: ~78% window width + spacing.sm.
    expect(carousel.props.horizontal).toBe(true);
    expect(carousel.props.decelerationRate).toBe('fast');
    expect(carousel.props.showsHorizontalScrollIndicator).toBe(false);
    expect(carousel.props.snapToInterval).toBe(
      Dimensions.get('window').width * 0.78 + auroraSpacing.sm,
    );
  });

  test('multi-card layout: both cards coexist in the track at ~78% window width each', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // Both cards render simultaneously in the carousel (multi-card layout).
    const cards = tree.getAllByTestId('today-pending-card');
    expect(cards).toHaveLength(2);
    const expected = Dimensions.get('window').width * 0.78;
    for (const card of cards) {
      const flat = StyleSheet.flatten(card.props.style);
      expect(flat.width).toBeCloseTo(expected, 6);
    }
    // The peek: card + gap is well under the window width — the next card
    // is always partially visible.
    expect(expected + auroraSpacing.sm).toBeLessThan(Dimensions.get('window').width);
  });

  test('busy guard: BOTH buttons disable on the MUTATING card only; double-tap cannot double-fire', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // A confirm that stays in flight (controlled promise).
    let settleConfirm!: (value: { appointment: { id: string; status: string } }) => void;
    mockedConfirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleConfirm = resolve;
        }),
    );

    const selected = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    const upcoming = tree.getByLabelText(
      `Future Patient, token 5, awaiting confirmation for ${formatDateISO(d2)}`,
    );

    // Confirm the UPCOMING card — it stays rendered during the flight (the
    // optimistic flip only applies to selected-date rows; the card leaves on
    // settle's re-scan), so its busy state is observable.
    await fireEvent.press(within(upcoming).getByText('Confirm'));
    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledTimes(1));

    // BOTH buttons on the mutating card disable…
    expect(buttonStateOf(within(upcoming).getByText('Confirm'))).toEqual({
      disabled: true,
      busy: false,
    });
    expect(buttonStateOf(within(upcoming).getByText('Reject'))).toEqual({
      disabled: true,
      busy: false,
    });
    // …while EVERY other card stays enabled.
    expect(buttonStateOf(within(selected).getByText('Confirm'))).toEqual({
      disabled: false,
      busy: false,
    });
    expect(buttonStateOf(within(selected).getByText('Reject'))).toEqual({
      disabled: false,
      busy: false,
    });

    // The synchronous ref guard: pressing the OTHER card's enabled Confirm
    // during the flight still cannot double-fire the mutation.
    await fireEvent.press(within(selected).getByText('Confirm'));
    expect(mockedConfirm).toHaveBeenCalledTimes(1);

    // Settle: the server commits — the upcoming card leaves, the selected
    // card's buttons re-enable (busy cleared).
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });
    await act(async () => {
      settleConfirm({ appointment: { id: 'aptUp', status: 'CONFIRMED' } });
    });
    await waitFor(() => expect(tree.queryByText('Future Patient')).toBeNull());
    await waitFor(() =>
      expect(buttonStateOf(within(selected).getByText('Confirm'))).toEqual({
        disabled: false,
        busy: false,
      }),
    );
  });

  test('header count = the COMBINED array length (drains 2 → 1 as a card leaves)', async () => {
    setDoctorSession();
    const [d1, d2] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (2)')).toBeTruthy());

    // Confirm the selected-date card; the upcoming card remains the sole
    // pending row — the header recounts from the same combined array.
    mockedConfirm.mockResolvedValue({ appointment: { id: 'aptSel', status: 'CONFIRMED' } });
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE_AFTER_CONFIRM());
      if (date === d2) return Promise.resolve(UPCOMING_QUEUE(d2, 'aptUp'));
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const selected = tree.getByLabelText('Same Day Patient, token 3, awaiting confirmation');
    await fireEvent.press(within(selected).getByText('Confirm'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith('aptSel'));
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());
    expect(tree.getByText('Future Patient')).toBeTruthy();
    // The confirmed patient joins the vertical queue below the carousel.
    await waitFor(() => expect(tree.getAllByText('Same Day Patient')).toHaveLength(1));
    expect(tree.getByText('Queue · Today')).toBeTruthy();
  });
});

describe('Today console — header avatar + silent focus refetch (mobilefix3 FIX-B/B2)', () => {
  test('header shows initials while avatarUrl is null; regained focus silently refetches /api/auth/me (mount 1, regain 2)', async () => {
    setDoctorSession();
    const [d1] = scanDates();
    mockedFetch.mockImplementation((date?: string) => {
      if (date === today()) return Promise.resolve(TODAY_QUEUE());
      return Promise.resolve(EMPTY_QUEUE(date ?? d1));
    });

    const tree = await render(<StaffTodayScreen />);
    await waitFor(() => expect(tree.getByText('Awaiting confirmation (1)')).toBeTruthy());

    // No photo yet — the initials fallback (the 'Y' the owner saw).
    expect(tree.getByText('DT')).toBeTruthy();
    expect(tree.queryByLabelText('Dr Today photo')).toBeNull();

    // Mount fetches /api/auth/me exactly ONCE (the mount-time focus run is
    // absorbed by the loading-guard; a beat passes with no extra fetch).
    const meCalls = () =>
      mockedApiGet.mock.calls.filter((c: unknown[]) => c[0] === '/api/auth/me').length;
    expect(meCalls()).toBe(1);
    await act(async () => {});
    expect(meCalls()).toBe(1);

    // The doctor sets a photo in Profile, returns → the screen REGAINS focus.
    mockMe = {
      ...ME_BASE,
      doctorProfile: { ...ME_BASE.doctorProfile!, avatarUrl: 'data:image/jpeg;base64,QUJD' },
    };
    await act(async () => {
      mockFocusCallback?.();
    });

    // Exactly ONE silent extra fetch; the header photo updates WITHOUT a
    // relaunch (no stale initials) and no big spinner replaces the list.
    await waitFor(() => expect(meCalls()).toBe(2));
    await waitFor(() => expect(tree.getByLabelText('Dr Today photo')).toBeTruthy());
    await waitFor(() => expect(tree.queryByText('DT')).toBeNull());
    expect(tree.getByText('Same Day Patient')).toBeTruthy();
  });
});
