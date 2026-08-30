import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { __resetPushConfiguredForTests, configurePush, registerPushToken } from '../push';

/**
 * Push registration + configurePush (Phase 8, B1/B2):
 *  - registration is best-effort — non-devices, denied permissions and
 *    non-Expo tokens never reach the POST;
 *  - a real token POSTs { token, platform } to /api/devices;
 *  - configurePush installs the foreground handler ONCE (idempotent) and the
 *    Android 'default' HIGH-importance channel on Android only.
 */

jest.mock('expo-device', () => ({
  __esModule: true,
  isDevice: true,
}));

jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-1]' })),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { HIGH: 5 },
  setNotificationChannelAsync: jest.fn(async () => ({ id: 'default' })),
}));

const mockedDevice = Device as unknown as { isDevice: boolean };
const mockedNotifications = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
  setNotificationHandler: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
};

function mockFetchOnce(status = 200): jest.Mock {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => ({ ok: true, data: { id: 'device-1' } }),
    text: async () => '{}',
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedDevice.isDevice = true;
  mockedNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
  mockedNotifications.requestPermissionsAsync.mockResolvedValue({
    granted: true,
    status: 'granted',
  });
  mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({
    data: 'ExponentPushToken[test-token-1]',
  });
  __resetPushConfiguredForTests();
});

describe('registerPushToken', () => {
  test('happy path: POSTs { token, platform } to /api/devices', async () => {
    const fetchMock = mockFetchOnce();

    await registerPushToken();

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(String(rawUrl)).toContain('/api/devices');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { token: string; platform: string };
    expect(body.token).toBe('ExponentPushToken[test-token-1]');
    expect(['ios', 'android']).toContain(body.platform);
  });

  test('non-device (simulator/emulator) skips — no permission call, no POST', async () => {
    mockedDevice.isDevice = false;
    const fetchMock = mockFetchOnce();

    await registerPushToken();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  test('permission denied → skips before any token call or POST', async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    mockedNotifications.requestPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    });
    const fetchMock = mockFetchOnce();

    await registerPushToken();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  test('token prefix guard: a non-Expo token never POSTs', async () => {
    mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'fcm-plain-token' });
    const fetchMock = mockFetchOnce();

    await registerPushToken();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('empty token never POSTs', async () => {
    mockedNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: '' });
    const fetchMock = mockFetchOnce();

    await registerPushToken();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a thrown getExpoPushTokenAsync (Expo Go without EAS projectId) is swallowed — never rejects', async () => {
    mockedNotifications.getExpoPushTokenAsync.mockRejectedValue(new Error('No projectId found'));

    await expect(registerPushToken()).resolves.toBeUndefined();
  });

  test('a failing POST is swallowed too — registration must never throw', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      text: async () => '{}',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(registerPushToken()).resolves.toBeUndefined();
  });
});

describe('configurePush (B1)', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    __resetPushConfiguredForTests();
  });

  test('installs the foreground handler exactly once (idempotent)', () => {
    configurePush();
    configurePush();
    configurePush();

    expect(mockedNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mockedNotifications.setNotificationHandler.mock.calls[0][0] as {
      handleNotification: () => Promise<{
        shouldShowAlert: boolean;
        shouldPlaySound: boolean;
        shouldSetBadge: boolean;
      }>;
    };
    expect(handler.handleNotification).toBeInstanceOf(Function);
  });

  test('handler behavior: alert + sound, NO badge', async () => {
    configurePush();
    const handler = mockedNotifications.setNotificationHandler.mock.calls[0][0] as {
      handleNotification: () => Promise<{
        shouldShowAlert: boolean;
        shouldPlaySound: boolean;
        shouldSetBadge: boolean;
      }>;
    };
    await expect(handler.handleNotification()).resolves.toMatchObject({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  test('Android: creates the General HIGH-importance channel once', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    configurePush();
    configurePush();

    expect(mockedNotifications.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
    const [channelId, options] = mockedNotifications.setNotificationChannelAsync.mock.calls[0] as [
      string,
      { name: string; importance: number; sound: string },
    ];
    expect(channelId).toBe('default');
    expect(options).toMatchObject({ name: 'General', importance: 5, sound: 'default' });
  });

  test('iOS: no channel is created', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    configurePush();

    expect(mockedNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
