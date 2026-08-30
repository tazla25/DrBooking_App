import { createHash } from 'node:crypto';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { db } from '@/lib/db';
import { postRequest, readResponse, resetDb, API, TEST_PASSWORD } from './helpers';

const PHONE = '9812345699'; // 10-digit; normalized to +919812345699

async function loginAttempt(phone: string, password: string) {
  const res = await loginRoute(
    postRequest(`${API}/api/auth/login`, { phone, password }),
  );
  return readResponse(res);
}

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await resetDb();
    const res = await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Lockout Tester',
        phone: PHONE,
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('rejects a wrong password with generic INVALID_CREDENTIALS', async () => {
    const body = await loginAttempt(PHONE, 'Wrong@1234');
    expect(body.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('is indistinguishable for an unknown phone (never reveals which field was wrong)', async () => {
    const unknown = await loginAttempt('9899988877', 'Wrong@1234');
    const wrongPass = await loginAttempt(PHONE, 'Wrong@1234');
    expect(unknown.status).toBe(wrongPass.status);
    expect(unknown.error?.code).toBe(wrongPass.error?.code);
    expect(unknown.error?.message).toBe(wrongPass.error?.message);
  });

  it('logs in successfully and returns an opaque token + safe user', async () => {
    const body = await loginAttempt(PHONE, TEST_PASSWORD);
    expect(body.status).toBe(200);
    expect(body.ok).toBe(true);

    const data = body.data as {
      token: string;
      expiresAt: string;
      user: Record<string, unknown>;
    };
    // 32-byte crypto-random token, hex-encoded → 64 chars
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    // 30-day expiry (allow rounding slack)
    const ttlDays = (new Date(data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(29.9);
    expect(ttlDays).toBeLessThanOrEqual(30.01);
    expect(data.user.phone).toBe('+919812345699');
    expect(data.user.passwordHash).toBeUndefined();

    // DB stores SHA-256(token), never the raw token
    const session = await db.session.findFirst({ where: { user: { phone: '+919812345699' } } });
    expect(session).not.toBeNull();
    expect(session!.tokenHash).not.toBe(data.token);
    expect(session!.tokenHash).toBe(createHash('sha256').update(data.token).digest('hex'));
  });

  it('clears the failure counter after a successful login', async () => {
    await loginAttempt(PHONE, 'Wrong@1234');
    await loginAttempt(PHONE, TEST_PASSWORD);
    const failures = await db.failedLogin.count({ where: { phone: '+919812345699' } });
    expect(failures).toBe(0);
  });

  it('locks the account after 5 failures within 15 minutes (even with the correct password)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const body = await loginAttempt(PHONE, 'Wrong@1234');
      expect(body.status).toBe(401);
    }
    const locked = await loginAttempt(PHONE, TEST_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.error?.code).toBe('ACCOUNT_LOCKED');
  });

  it('unlocks after the 15-minute window passes', async () => {
    // Simulate window expiry by back-dating the recorded failures.
    const windowAgo = new Date(Date.now() - 16 * 60_000);
    await db.failedLogin.updateMany({
      where: { phone: '+919812345699' },
      data: { attemptedAt: windowAgo },
    });
    const body = await loginAttempt(PHONE, TEST_PASSWORD);
    expect(body.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 422 for a malformed payload', async () => {
    const body = await loginAttempt('not-a-phone', '');
    expect(body.status).toBe(422);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });
});
