/**
 * Global jest setup.
 *  - expo-secure-store is mocked with an in-memory implementation (native
 *    module is unavailable in tests) — the same mock backs the session
 *    round-trip tests. Inspect via `(SecureStore as any).__keychain`.
 *  - expo-router's imperative router is mocked (used by the api client's
 *    401 handler). Calls are cleared automatically (clearMocks: true).
 *
 * NOTE: jest.mock factories must be self-contained (no out-of-scope vars),
 * so the in-memory keychain Map is created INSIDE the factory and exposed on
 * the mock object itself.
 */

jest.mock('expo-secure-store', () => {
  const keychain = new Map();
  return {
    __esModule: true,
    __keychain: keychain,
    setItemAsync: jest.fn(async (key, value) => {
      keychain.set(key, String(value));
    }),
    getItemAsync: jest.fn(async (key) => (keychain.has(key) ? keychain.get(key) : null)),
    deleteItemAsync: jest.fn(async (key) => {
      keychain.delete(key);
    }),
  };
});

jest.mock('expo-haptics', () => {
  return {
    __esModule: true,
    selectionAsync: jest.fn(async () => undefined),
    notificationAsync: jest.fn(async () => undefined),
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  };
});

jest.mock('expo-router', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    dismissAll: jest.fn(),
  };
  return {
    __esModule: true,
    __router: router,
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: jest.fn(),
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: 'Stack',
    Tabs: 'Tabs',
  };
});
