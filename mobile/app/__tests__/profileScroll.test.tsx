import { render } from '@testing-library/react-native';
import { useAuthStore } from '@/store/auth';
import type { SafeUser } from '@/lib/types';
import StaffProfileScreen from '../(staff)/profile';
import PatientProfileScreen from '../(tabs)/profile';
import AdminProfileScreen from '../(admin)/profile';

/**
 * mobilefix1 FIX A (BUG-1): every profile screen renders its body inside a
 * bounded ScrollView (GlassScreen content is NOT scrollable by design — the
 * Phase 11 doctor edit card overflowed the fold and buried Sign Out on all
 * three role variants).
 *
 * Idiom follows app/__tests__/adminLayout.test.tsx: expo-router re-mocked at
 * file level (the global jest.setup.js mock's no-op useFocusEffect is fine
 * here — profile screens mount without focus), '@/lib/api' mocked so the
 * /api/auth/me hydration resolves instantly, and the session is seeded via
 * useAuthStore.setState. The scroll assertion uses the suite's established
 * UNSAFE_getByType(ScrollView) probe.
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
    useFocusEffect: (cb: () => (() => void) | void) => React.useEffect(() => cb(), [cb]),
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: 'Stack',
    Tabs: 'Tabs',
  };
});

jest.mock('@/lib/api', () => ({
  api: {
    // /api/auth/me hydration for the staff identity card (doctor profile
    // fields render from `me`); every other GET resolves empty.
    get: jest.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return {
          user: {
            id: 'u1',
            phone: '+919844000001',
            name: 'Dr Scroll Test',
            role: 'DOCTOR',
            verificationStatus: 'VERIFIED',
          },
          doctorProfile: null,
          compounderFor: null,
        };
      }
      return {};
    }),
  },
}));

// Minimal safe-area stand-in (the native module is absent in jest — the
// real SafeAreaProvider swallows children without it). Insets are zero.
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
    SafeAreaView: View, // zero insets — a plain View is the same thing
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaConsumer: Context.Consumer,
    initialWindowMetrics: { insets, frame },
  };
});

function userOf(role: SafeUser['role']): SafeUser {
  return {
    id: `user-${role.toLowerCase()}`,
    phone: '+919844000001',
    name: 'Scroll Test',
    role,
    verificationStatus: 'VERIFIED',
    mustChangePassword: false,
    isActive: true,
    delegatedDoctorId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function setSession(user: SafeUser) {
  useAuthStore.setState({ status: 'authenticated', token: 'tok', user });
}

type ScrollViewOf = {
  props: {
    showsVerticalScrollIndicator?: boolean;
    contentContainerStyle?: { paddingBottom?: number };
  };
};

/** (RNTL 14 removed UNSAFE_getByType — the toJSON walk below replaces it.) */
type RenderTree = Awaited<ReturnType<typeof render>>;

type JsonNode =
  | {
      type?: unknown;
      props?: Record<string, unknown>;
      children?: JsonNode[];
    }
  | string
  | null
  | undefined;

/** Walk the toJSON tree and collect every host ScrollView node (host name is
 * 'RCTScrollView' on this RN — both spellings matched; closed GlassModals
 * mount nothing, so the body ScrollView is the only one in a resting
 * profile screen). */
function findScrollViews(node: JsonNode): ScrollViewOf[] {
  if (!node || typeof node === 'string') return [];
  const isScrollView =
    node.type === 'ScrollView' ||
    node.type === 'RCTScrollView' ||
    node.type === 'RCTVirtualScrollView';
  const self = isScrollView ? [{ props: (node.props ?? {}) as ScrollViewOf['props'] }] : [];
  const kids = Array.isArray(node.children) ? node.children.flatMap(findScrollViews) : [];
  return [...self, ...kids];
}

/** Safe-area context is mocked (zero insets) — no provider needed; the
 * wrapper keeps the shape idiomatic for future providers. */
function withProviders(element: React.ReactElement): React.ReactElement {
  return element;
}

/** The screen's single body ScrollView — FAILS the test when absent. */
function scrollOf(tree: RenderTree): ScrollViewOf {
  const nodes = findScrollViews(tree.toJSON() as JsonNode);
  expect(nodes).toHaveLength(1); // the body ScrollView (modals closed)
  return nodes[0];
}

describe('FIX A — profile screens scroll (Sign out reachable)', () => {
  test('(staff) doctor profile body renders inside a bounded ScrollView with the tab-bar runway', async () => {
    setSession(userOf('DOCTOR'));
    const tree = await render(withProviders(<StaffProfileScreen />));
    const scroll = scrollOf(tree);
    expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
    expect(scroll.props.contentContainerStyle?.paddingBottom).toBe(96);
    // The overflow culprit card and the buried action are both in the tree.
    expect(tree.getByText('Edit profile')).toBeTruthy();
    expect(tree.getByText('Sign out')).toBeTruthy();
  });

  test('(staff) compounder profile also scrolls (same defect class)', async () => {
    setSession(userOf('COMPOUNDER'));
    const tree = await render(withProviders(<StaffProfileScreen />));
    expect(scrollOf(tree)).toBeTruthy();
    expect(tree.getByText('Sign out')).toBeTruthy();
  });

  test('(tabs) patient profile body renders inside a bounded ScrollView with the tab-bar runway', async () => {
    setSession(userOf('PATIENT'));
    const tree = await render(withProviders(<PatientProfileScreen />));
    const scroll = scrollOf(tree);
    expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
    expect(scroll.props.contentContainerStyle?.paddingBottom).toBe(96);
    expect(tree.getByText('Sign out')).toBeTruthy();
  });

  test('(admin) admin profile body renders inside a bounded ScrollView with the tab-bar runway', async () => {
    setSession(userOf('SUPER_ADMIN'));
    const tree = await render(withProviders(<AdminProfileScreen />));
    const scroll = scrollOf(tree);
    expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
    expect(scroll.props.contentContainerStyle?.paddingBottom).toBe(96);
    expect(tree.getByText('Sign out')).toBeTruthy();
  });
});
