import { sendToUser, notifyUser, routeToken, pushDisabled } from '@/lib/push';
import { db } from '@/lib/db';
import { resetDb, createPatientFixture } from './helpers';

/**
 * Push service unit tests (#push): no-op when unconfigured, token-type
 * routing with a mocked global.fetch, failures swallowed.
 *
 * sendToUser reads PUSH_DISABLED/NODE_ENV at CALL time, so tests flip
 * process.env.NODE_ENV to 'development' and restore it afterwards.
 */

/** NODE_ENV is readonly in @types/node — mutate through a widened view. */
function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

describe('src/lib/push.ts', () => {
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  const originalEnv = { ...process.env };
  const fetchMock = jest.fn();

  beforeAll(async () => {
    await resetDb();
    patient = await createPatientFixture({ phone: '9836000010' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    setNodeEnv(originalEnv.NODE_ENV ?? 'test');
    delete process.env.FIREBASE_SERVER_KEY;
    delete process.env.EXPO_ACCESS_TOKEN;
    delete process.env.PUSH_DISABLED;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    setNodeEnv(originalEnv.NODE_ENV ?? 'test');
    delete process.env.FIREBASE_SERVER_KEY;
    delete process.env.EXPO_ACCESS_TOKEN;
    delete process.env.PUSH_DISABLED;
  });

  afterEach(() => {
    setNodeEnv(originalEnv.NODE_ENV ?? 'test');
  });

  const okResponse = () => new Response('{}', { status: 200 });

  it('routeToken classifies token shapes', () => {
    expect(routeToken('ExponentPushToken[abc123]')).toBe('expo');
    expect(routeToken('ExponentPushToken['.padEnd(140, 'x'))).toBe('unknown'); // no closing ]
    expect(routeToken('a'.repeat(152))).toBe('fcm'); // long alphanumeric → FCM shape
    expect(routeToken('a-b_C123'.padEnd(140, 'x'))).toBe('fcm');
    expect(routeToken('short')).toBe('unknown');
    expect(routeToken('has spaces '.padEnd(140, 'x'))).toBe('unknown');
    expect(routeToken('')).toBe('unknown');
  });

  it('no-op when disabled: NODE_ENV=test never touches fetch', async () => {
    await db.deviceToken.create({
      data: { userId: patient.userId, token: 'ExponentPushToken[test-expo-1]', platform: 'ios' },
    });
    const result = await sendToUser(patient.userId, { title: 'T', body: 'B' });
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('no-op when PUSH_DISABLED=1 (outside test env)', async () => {
    setNodeEnv('development');
    process.env.PUSH_DISABLED = '1';
    expect(pushDisabled()).toBe(true);
    await db.deviceToken.create({
      data: { userId: patient.userId, token: 'ExponentPushToken[test-expo-2]', platform: 'android' },
    });
    const result = await sendToUser(patient.userId, { title: 'T', body: 'B' });
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('quiet no-op when the user has NO device tokens', async () => {
    setNodeEnv('development');
    const result = await sendToUser('no-such-user-id', { title: 'T', body: 'B' });
    expect(result).toEqual({ userId: 'no-such-user-id', sent: 0, failed: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Expo routing: posts to exp.host (no credentials required)', async () => {
    setNodeEnv('development');
    await db.deviceToken.create({
      data: { userId: patient.userId, token: 'ExponentPushToken[expo-abc-123]', platform: 'ios' },
    });
    fetchMock.mockResolvedValueOnce(okResponse());

    const result = await sendToUser(patient.userId, { title: 'Booking confirmed', body: 'token #4', data: { type: 'BOOKING_CONFIRMED' } });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('authorization'); // EXPO_ACCESS_TOKEN optional
    const payload = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0].to).toBe('ExponentPushToken[expo-abc-123]');
    expect(payload[0].title).toBe('Booking confirmed');
    expect(payload[0].body).toBe('token #4');
    expect(payload[0].data).toEqual({ type: 'BOOKING_CONFIRMED' });

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('Expo routing: sends EXPO_ACCESS_TOKEN as Bearer when configured', async () => {
    setNodeEnv('development');
    process.env.EXPO_ACCESS_TOKEN = 'secret-expo-token';
    await db.deviceToken.create({
      data: { userId: patient.userId, token: 'ExponentPushToken[expo-bearer]', platform: 'ios' },
    });
    fetchMock.mockResolvedValueOnce(okResponse());

    await sendToUser(patient.userId, { title: 'T', body: 'B' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-expo-token');

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  it('FCM routing: skipped with a log when FIREBASE_SERVER_KEY is unconfigured', async () => {
    setNodeEnv('development');
    const fcmToken = 'f'.repeat(152);
    await db.deviceToken.create({ data: { userId: patient.userId, token: fcmToken, platform: 'android' } });

    const result = await sendToUser(patient.userId, { title: 'T', body: 'B' });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('FCM routing: posts to the FCM endpoint with the server key', async () => {
    setNodeEnv('development');
    process.env.FIREBASE_SERVER_KEY = 'firebase-server-key-1';
    const fcmToken = 'g'.repeat(160);
    await db.deviceToken.create({ data: { userId: patient.userId, token: fcmToken, platform: 'android' } });
    fetchMock.mockResolvedValueOnce(okResponse());

    const result = await sendToUser(patient.userId, { title: 'Queue update', body: "You're 3rd in queue" });
    expect(result.sent).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send');
    expect((init.headers as Record<string, string>).authorization).toBe('key=firebase-server-key-1');
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.to).toBe(fcmToken);
    expect(payload.notification).toEqual({ title: 'Queue update', body: "You're 3rd in queue" });

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
    delete process.env.FIREBASE_SERVER_KEY;
  });

  it('fan-out over MULTIPLE devices; unknown token types skipped', async () => {
    setNodeEnv('development');
    await db.deviceToken.createMany({
      data: [
        { userId: patient.userId, token: 'ExponentPushToken[expo-multi-1]', platform: 'ios' },
        { userId: patient.userId, token: 'ExponentPushToken[expo-multi-2]', platform: 'android' },
        { userId: patient.userId, token: 'not a valid token!!', platform: 'ios' },
      ],
    });
    fetchMock.mockResolvedValue(okResponse());

    const result = await sendToUser(patient.userId, { title: 'T', body: 'B' });
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('a failing push is swallowed — never throws, flow continues', async () => {
    setNodeEnv('development');
    await db.deviceToken.create({
      data: { userId: patient.userId, token: 'ExponentPushToken[expo-fail]', platform: 'ios' },
    });
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await sendToUser(patient.userId, { title: 'T', body: 'B' });
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);

    // Even a DB error inside sendToUser resolves (belt and braces).
    fetchMock.mockReset();
    const broken = await sendToUser(patient.userId, { title: 'T', body: 'B' }).catch(() => 'THREW');
    expect(broken).not.toBe('THREW');

    await db.deviceToken.deleteMany({ where: { userId: patient.userId } });
  });

  it('notifyUser: null patientId (walk-in) skips silently', () => {
    expect(() => notifyUser(null, { title: 'T', body: 'B' })).not.toThrow();
    expect(() => notifyUser(undefined, { title: 'T', body: 'B' })).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
