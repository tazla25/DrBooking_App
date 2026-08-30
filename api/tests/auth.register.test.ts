import { POST as registerRoute } from '@/app/api/auth/register/route';
import { db } from '@/lib/db';
import { postRequest, readResponse, resetDb, API, TEST_PASSWORD } from './helpers';

describe('POST /api/auth/register', () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('registers a PATIENT (happy path) → 201, VERIFIED, audited', async () => {
    const res = await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Priya Test',
        phone: '9812345601', // 10-digit form
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    const body = await readResponse(res);

    expect(body.status).toBe(201);
    expect(body.ok).toBe(true);
    const user = (body.data as Record<string, unknown>).user as Record<string, unknown>;
    expect(user.phone).toBe('+919812345601'); // normalized
    expect(user.role).toBe('PATIENT');
    expect(user.verificationStatus).toBe('VERIFIED');
    expect(user.mustChangePassword).toBe(false);
    expect(user.passwordHash).toBeUndefined(); // never expose secrets

    const row = await db.user.findUnique({ where: { phone: '+919812345601' } });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).not.toBe(TEST_PASSWORD); // bcrypt-hashed
    expect(row!.passwordHash.startsWith('$2')).toBe(true);

    const audit = await db.auditLog.findFirst({
      where: { action: 'AUTH_REGISTER', actorId: row!.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.target).toBe(`user:${row!.id}`);
  });

  it('registers a DOCTOR → 201, starts PENDING with a stub profile', async () => {
    const res = await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Test Doctor',
        phone: '+919876543210', // full international form
        password: TEST_PASSWORD,
        role: 'DOCTOR',
      }),
    );
    const body = await readResponse(res);

    expect(body.status).toBe(201);
    const user = (body.data as Record<string, unknown>).user as Record<string, unknown>;
    expect(user.role).toBe('DOCTOR');
    expect(user.verificationStatus).toBe('PENDING');

    const profile = await db.doctorProfile.findFirst({
      where: { user: { phone: '+919876543210' } },
    });
    expect(profile).not.toBeNull();
    expect(profile!.fullName).toBe('Test Doctor');
    expect(profile!.isAvailableNow).toBe(false);
  });

  it('returns 409 PHONE_EXISTS for a duplicate phone', async () => {
    const res = await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'Someone Else',
        phone: '+919812345601',
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    const body = await readResponse(res);
    expect(body.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('PHONE_EXISTS');
  });

  it('normalizes alternate phone formats → same account (409, not a new user)', async () => {
    // "09812345601" (leading zero) and "919812345601" (with country code)
    // both normalize to +919812345601.
    for (const alt of ['09812345601', '919812345601']) {
      const res = await registerRoute(
        postRequest(`${API}/api/auth/register`, {
          name: 'Duplicate Check',
          phone: alt,
          password: TEST_PASSWORD,
          role: 'PATIENT',
        }),
      );
      const body = await readResponse(res);
      expect(body.status).toBe(409);
      expect(body.error?.code).toBe('PHONE_EXISTS');
    }
    expect(await db.user.count()).toBe(2); // patient + doctor only
  });

  it('returns 422 for invalid payloads', async () => {
    const cases: Array<Record<string, unknown>> = [
      { name: 'X', phone: '9812345602', password: TEST_PASSWORD, role: 'PATIENT' }, // name too short
      { name: 'Bad Phone', phone: '12345', password: TEST_PASSWORD, role: 'PATIENT' }, // invalid phone
      { name: 'Weak Pass', phone: '9812345602', password: 'short1', role: 'PATIENT' }, // < 8 chars
      { name: 'No Number', phone: '9812345602', password: 'onlyletters', role: 'PATIENT' }, // no digit
      { name: 'Bad Role', phone: '9812345602', password: TEST_PASSWORD, role: 'SUPER_ADMIN' }, // role not self-servable
      { name: 'Bad Country', phone: '+441234567890', password: TEST_PASSWORD, role: 'PATIENT' }, // unsupported country
    ];
    for (const payload of cases) {
      const res = await registerRoute(
        postRequest(`${API}/api/auth/register`, payload),
      );
      const body = await readResponse(res);
      expect(body.status).toBe(422);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('accepts +880 (Bangladesh) full-form numbers', async () => {
    const res = await registerRoute(
      postRequest(`${API}/api/auth/register`, {
        name: 'BD Patient',
        phone: '+8801712345678',
        password: TEST_PASSWORD,
        role: 'PATIENT',
      }),
    );
    const body = await readResponse(res);
    expect(body.status).toBe(201);
    const user = (body.data as Record<string, unknown>).user as Record<string, unknown>;
    expect(user.phone).toBe('+8801712345678');
  });
});
