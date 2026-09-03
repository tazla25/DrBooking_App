import { act, render, waitFor } from '@testing-library/react-native';
import { fetchMyAppointments, type MyAppointment } from '@/lib/appointments';
import MyAppointmentsScreen from '../(tabs)/appointments';

/**
 * mobilefix2 P3 — the patient appointments tab silently re-syncs when it
 * REGAINS focus with a settled list (before: mount + pull-to-refresh only).
 *
 * Idiom follows app/__tests__/todayConsole.upcoming.test.tsx: expo-router
 * re-mocked at file level with a CAPTURED focus callback (the 'mock' prefix
 * keeps the out-of-scope reference legal for jest.mock factories), transport
 * mocked, safe-area stand-in. The mount-time focus run is skipped by the
 * loading guard (it races the mount fetch); the captured callback stands in
 * for the tab REGAINING focus, exactly as expo-router would re-fire it.
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
    // capture the focus callback (mount still runs it once via the effect —
    // the loading guard absorbs that first run).
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

jest.mock('@/lib/appointments', () => ({
  fetchMyAppointments: jest.fn(),
  cancelAppointment: jest.fn(),
  resolveScheduleId: jest.fn(),
  submitFeedback: jest.fn(),
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

const mockedFetchMine = fetchMyAppointments as jest.Mock;

const MY_APPOINTMENT: MyAppointment = {
  id: 'apt1',
  date: '2026-09-04',
  queueNumber: 4,
  status: 'CONFIRMED',
  source: 'ONLINE',
  fee: 300,
  doctor: { id: 'doc1', fullName: 'Ananya Rao', specialization: 'Cardiology' },
  schedule: {
    clinicName: 'Sunrise Clinic',
    clinicAddress: 'MG Road',
    startTime: '09:00',
    endTime: '13:00',
  },
  estWaitMin: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetchMine.mockReset();
  mockedFetchMine.mockResolvedValue({
    total: 1,
    page: 1,
    pageSize: 10,
    appointments: [MY_APPOINTMENT],
  });
});

describe('My appointments tab — silent focus re-sync (mobilefix2 P3)', () => {
  test('mount fetches ONCE (the first focus is skipped — it races the load)', async () => {
    const tree = await render(<MyAppointmentsScreen />);
    await waitFor(() => expect(mockedFetchMine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tree.getByText(/Ananya Rao/)).toBeTruthy());
    // A beat passes; the settled list does NOT re-fetch on its own.
    await act(async () => {});
    expect(mockedFetchMine).toHaveBeenCalledTimes(1);
  });

  test('REGAINING focus fires exactly ONE silent extra fetch (no big spinner)', async () => {
    const tree = await render(<MyAppointmentsScreen />);
    await waitFor(() => expect(tree.getByText(/Ananya Rao/)).toBeTruthy());
    expect(mockedFetchMine).toHaveBeenCalledTimes(1); // mount only

    // The tab regains focus → the silent refresh path.
    await act(async () => {
      mockFocusCallback?.();
    });
    await waitFor(() => expect(mockedFetchMine).toHaveBeenCalledTimes(2));
    expect(mockedFetchMine).toHaveBeenLastCalledWith('upcoming', 1, 10);

    // Silent: the loading overlay never replaces the list (the appointment
    // card stays rendered throughout the refresh).
    expect(tree.getByText(/Ananya Rao/)).toBeTruthy();
    expect(tree.getByText('Sunrise Clinic')).toBeTruthy();
  });
});
