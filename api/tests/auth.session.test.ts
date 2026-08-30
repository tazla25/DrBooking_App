import { GET as meRoute } from '@/app/api/auth/me/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { POST as changePasswordRoute } from '@/app/api/auth/change-password/route';
import { db } from '@/lib/db';
import {
  getRequest,
  postRequest,
  readResponse,
  resetDb,
  API,
  TEST_PASSWORD,
  TEST_PASSWORD_2,
} from './helpers';

const PHONE = '9812345677';

async function login(phone = PHONE, password = TEST_PASSWORD): Promise<string> {
  const res = await loginRoute(postRequest(`${API}/api/auth/login`, { phone, password }));
  const body = await readResponse(res);
  expect(body.status).toBe(200);
  return (body.data as { token: string }).token;
}

describe('GET /api/auth/me', () => {
  let token: string;

  beforeAll(async () => {
    await resetDb();
    await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Session Tester',
        phone: PHONE,
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    token = await login();
  });

  it('returns 401 without a token', async () => {
    const body = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`)));
    expect(body.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a garbage token', async () => {
    const body = await readResponse(
      await meRoute(getRequest(`${API}/api/auth/me`, 'deadbeef'.repeat(8))),
    );
    expect(body.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns the authenticated user for a valid token', async () => {
    const body = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, token)));
    expect(body.status).toBe(200);
    expect(body.ok).toBe(true);
    const data = body.data as { user: Record<string, unknown>; doctorProfile: unknown };
    expect(data.user.phone).toBe('+919812345677');
    expect(data.user.name).toBe('Session Tester');
    expect(data.user.passwordHash).toBeUndefined();
    expect(data.doctorProfile).toBeNull();
  });
});

describe('POST /api/auth/change-password', () => {
  let token: string;

  beforeAll(async () => {
    await resetDb();
    await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Change Pass Tester',
        phone: PHONE,
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    token = await login();
  });

  it('requires authentication (401 without token)', async () => {
    const body = await readResponse(
      await changePasswordRoute(
        postRequest(`${API}/api/auth/change-password`, {
          currentPassword: TEST_PASSWORD,
          newPassword: TEST_PASSWORD_2,
        }),
      ),
    );
    expect(body.status).toBe(401);
  });

  it('rejects a wrong current password (401)', async () => {
    const body = await readResponse(
      await changePasswordRoute(
        postRequest(
          `${API}/api/auth/change-password`,
          { currentPassword: 'Nope@1234', newPassword: TEST_PASSWORD_2 },
          token,
        ),
      ),
    );
    expect(body.status).toBe(401);
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a weak new password (422)', async () => {
    const body = await readResponse(
      await changePasswordRoute(
        postRequest(
          `${API}/api/auth/change-password`,
          { currentPassword: TEST_PASSWORD, newPassword: 'weak' },
          token,
        ),
      ),
    );
    expect(body.status).toBe(422);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('changes the password: old one stops working, new one works, mustChangePassword cleared', async () => {
    const body = await readResponse(
      await changePasswordRoute(
        postRequest(
          `${API}/api/auth/change-password`,
          { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD_2 },
          token,
        ),
      ),
    );
    expect(body.status).toBe(200);
    expect(body.ok).toBe(true);
    const user = (body.data as { user: Record<string, unknown> }).user;
    expect(user.mustChangePassword).toBe(false);

    // New password logs in; old one is rejected.
    const reloginOld = await readResponse(
      await loginRoute(postRequest(`${API}/api/auth/login`, { phone: PHONE, password: TEST_PASSWORD })),
    );
    expect(reloginOld.status).toBe(401);
    const reloginNew = await readResponse(
      await loginRoute(postRequest(`${API}/api/auth/login`, { phone: PHONE, password: TEST_PASSWORD_2 })),
    );
    expect(reloginNew.status).toBe(200);

    // Current session survived; the newer session (from re-login above) also valid.
    const me = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, token)));
    expect(me.status).toBe(200);
  });

  it('revokes OTHER sessions but keeps the caller session', async () => {
    // Two concurrent sessions (password was changed to TEST_PASSWORD_2 above).
    const tokenA = await login(PHONE, TEST_PASSWORD_2); // caller (will change password)
    const tokenB = await login(PHONE, TEST_PASSWORD_2); // other device

    const body = await readResponse(
      await changePasswordRoute(
        postRequest(
          `${API}/api/auth/change-password`,
          { currentPassword: TEST_PASSWORD_2, newPassword: 'Third@12345' },
          tokenA,
        ),
      ),
    );
    expect(body.status).toBe(200);

    const meA = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, tokenA)));
    expect(meA.status).toBe(200); // caller session kept

    const meB = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, tokenB)));
    expect(meB.status).toBe(401); // other session revoked
  });

  it('clears mustChangePassword (compounder onboarding flow)', async () => {
    // Simulate a compounder provisioned with a temp password.
    await db.user.create({
      data: {
        phone: '+919812345688',
        passwordHash: await import('bcryptjs').then((m) => m.hash(TEST_PASSWORD, 10)),
        name: 'Temp Compounder',
        role: 'COMPOUNDER',
        verificationStatus: 'VERIFIED',
        mustChangePassword: true,
      },
    });
    const token = await login('9812345688', TEST_PASSWORD);
    const me = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, token)));
    expect((me.data as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);

    const changed = await readResponse(
      await changePasswordRoute(
        postRequest(
          `${API}/api/auth/change-password`,
          { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD_2 },
          token,
        ),
      ),
    );
    expect(changed.status).toBe(200);
    const row = await db.user.findUnique({ where: { phone: '+919812345688' } });
    expect(row!.mustChangePassword).toBe(false);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the current session', async () => {
    await resetDb();
    await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Logout Tester',
        phone: PHONE,
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    const token = await login();

    const out = await readResponse(
      await logoutRoute(postRequest(`${API}/api/auth/logout`, {}, token)),
    );
    expect(out.status).toBe(200);
    expect(out.ok).toBe(true);

    const me = await readResponse(await meRoute(getRequest(`${API}/api/auth/me`, token)));
    expect(me.status).toBe(401); // token no longer valid
  });
});
