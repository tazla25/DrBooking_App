import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { POST as bookingRoute } from '@/app/api/appointments/route';
import {
  resetRateLimiterForTests,
  rateLimitingDisabled,
} from '@/lib/rate-limit';
import {
  readResponse,
  resetDb,
  API,
  createPatientFixture,
} from './helpers';

/** POST with a custom x-forwarded-for (limiter key). */
function postFromIp(url: string, body: unknown, ip: string, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** NODE_ENV is readonly in @types/node — mutate through a widened view. */
function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

describe('Rate limiting (sliding window, per IP / per user)', () => {
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let patientB: Awaited<ReturnType<typeof createPatientFixture>>;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await resetDb();
    patient = await createPatientFixture({ phone: '9835000010' });
    patientB = await createPatientFixture({ phone: '9835000011' });
  });

  beforeEach(() => {
    resetRateLimiterForTests();
  });

  afterEach(() => {
    // Restore the jest environment after every active-limiter test.
    setNodeEnv(originalEnv.NODE_ENV ?? 'test');
    delete process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_LOGIN_MAX;
    delete process.env.RATE_LIMIT_REGISTER_MAX;
    delete process.env.RATE_LIMIT_BOOKING_MAX;
    resetRateLimiterForTests();
  });

  it('bypass flag: NODE_ENV=test disables the limiter entirely', async () => {
    expect(rateLimitingDisabled()).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      const res = await readResponse(
        await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '198.51.100.1')),
      );
      expect(res.status).toBe(422); // invalid body, but NEVER 429
    }
  });

  it('bypass flag: RATE_LIMIT_DISABLED=1 disables it even outside test env', async () => {
    setNodeEnv('development');
    process.env.RATE_LIMIT_DISABLED = '1';
    expect(rateLimitingDisabled()).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      const res = await readResponse(
        await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '198.51.100.2')),
      );
      expect(res.status).toBe(422);
    }
  });

  it('login: 429 RATE_LIMITED with Retry-After after the limit, per IP', async () => {
    setNodeEnv('development');
    process.env.RATE_LIMIT_LOGIN_MAX = '2';

    // Requests carry an invalid body: the limiter runs BEFORE zod, so these
    // still consume the budget (first two → 422 VALIDATION_ERROR).
    const first = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.10')));
    const second = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.10')));
    expect(first.status).toBe(422);
    expect(second.status).toBe(422);

    const third = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.10')));
    expect(third.status).toBe(429);
    expect(third.error?.code).toBe('RATE_LIMITED');
    // The 429 carries the standard envelope + a Retry-After hint.
    const raw = await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.10'));
    expect(raw.headers.get('retry-after')).toMatch(/^\d+$/);

    // A different IP is NOT affected (per-IP buckets).
    const other = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.11')));
    expect(other.status).toBe(422);
  });

  it('register: separate rule from login (5 per 15 min default), own 429', async () => {
    setNodeEnv('development');
    process.env.RATE_LIMIT_REGISTER_MAX = '1';

    const first = await readResponse(await registerRoute(postFromIp(`${API}/api/auth/register`, {}, '203.0.113.20')));
    expect(first.status).toBe(422);
    const second = await readResponse(await registerRoute(postFromIp(`${API}/api/auth/register`, {}, '203.0.113.20')));
    expect(second.status).toBe(429);
    expect(second.error?.code).toBe('RATE_LIMITED');

    // Login rule untouched for the same IP.
    const loginRes = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.20')));
    expect(loginRes.status).toBe(422);
  });

  it('booking: per-USER bucket (20/min default) — user A limited, user B fine', async () => {
    setNodeEnv('development');
    process.env.RATE_LIMIT_BOOKING_MAX = '2';

    // Same IP for both users — proves the key is the USER id, not the IP.
    const ip = '203.0.113.30';
    const a1 = await readResponse(await bookingRoute(postFromIp(`${API}/api/appointments`, {}, ip, patient.token)));
    const a2 = await readResponse(await bookingRoute(postFromIp(`${API}/api/appointments`, {}, ip, patient.token)));
    expect(a1.status).toBe(422); // invalid body — limiter ran first
    expect(a2.status).toBe(422);

    const a3 = await readResponse(await bookingRoute(postFromIp(`${API}/api/appointments`, {}, ip, patient.token)));
    expect(a3.status).toBe(429);
    expect(a3.error?.code).toBe('RATE_LIMITED');

    const b1 = await readResponse(await bookingRoute(postFromIp(`${API}/api/appointments`, {}, ip, patientB.token)));
    expect(b1.status).toBe(422); // different user — unaffected
  });

  it('env override changes the effective limit', async () => {
    setNodeEnv('development');
    process.env.RATE_LIMIT_LOGIN_MAX = '3';
    for (let i = 0; i < 3; i += 1) {
      const res = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.40')));
      expect(res.status).toBe(422);
    }
    const blocked = await readResponse(await loginRoute(postFromIp(`${API}/api/auth/login`, {}, '203.0.113.40')));
    expect(blocked.status).toBe(429);
  });
});
