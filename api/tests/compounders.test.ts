import { GET as compoundersListRoute, POST as compounderCreateRoute } from '@/app/api/compounders/route';
import { DELETE as compounderDeleteRoute } from '@/app/api/compounders/[id]/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { db } from '@/lib/db';
import {
  postRequest,
  getRequest,
  deleteRequest,
  readResponse,
  resetDb,
  API,
  routeContext,
  createDoctorFixture,
  createCompounderFixture,
  createPatientFixture,
} from './helpers';

describe('Compounder management (#23–24) — DOCTOR-only', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;

  beforeEach(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000081', name: 'Dr Owner' });
    doctorB = await createDoctorFixture({ phone: '9810000082', name: 'Dr Other' });
  });

  it('creates a compounder with a one-time temp password (12 chars, letter+digit)', async () => {
    const body = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Nina Compounder', phone: '9818880001' }, doctorA.token),
      ),
    );
    expect(body.status).toBe(201);

    const data = body.data as {
      user: { id: string; phone: string; role: string; mustChangePassword: boolean; delegatedDoctorId: string | null; passwordHash?: unknown };
      tempPassword: string;
    };
    expect(data.user.role).toBe('COMPOUNDER');
    expect(data.user.mustChangePassword).toBe(true);
    expect(data.user.delegatedDoctorId).toBe(doctorA.doctorId);
    expect(data.user.passwordHash).toBeUndefined(); // never leak the hash
    expect(data.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(data.tempPassword).toMatch(/[A-Za-z]/);
    expect(data.tempPassword).toMatch(/\d/);

    // DB stores ONLY the bcrypt hash — never the plaintext.
    const row = await db.user.findUnique({ where: { phone: '+919818880001' } });
    expect(row!.passwordHash.startsWith('$2')).toBe(true);
    expect(row!.passwordHash).not.toContain(data.tempPassword);

    const audit = await db.auditLog.findFirst({ where: { action: 'COMPOUNDER_CREATED' } });
    expect(audit).not.toBeNull();
  });

  it('the temp password works at login (and forces a password change)', async () => {
    const created = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Login Test', phone: '9818880002' }, doctorA.token),
      ),
    );
    const tempPassword = (created.data as { tempPassword: string }).tempPassword;

    const login = await readResponse(
      await loginRoute(postRequest(`${API}/api/auth/login`, { phone: '9818880002', password: tempPassword })),
    );
    expect(login.status).toBe(200);
    expect((login.data as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);
  });

  it('409 PHONE_EXISTS on duplicate phone (against any account)', async () => {
    await createPatientFixture({ phone: '9818880003' });
    const body = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Dup Patient', phone: '9818880003' }, doctorA.token),
      ),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('PHONE_EXISTS');

    const created = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'First C', phone: '9818880004' }, doctorA.token),
      ),
    );
    expect(created.status).toBe(201);
    const dup = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Second C', phone: '9818880004' }, doctorA.token),
      ),
    );
    expect(dup.status).toBe(409);
  });

  it('GET lists my compounders (with mustChangePassword), NEVER temp passwords', async () => {
    await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Listed One', phone: '9818880005' }, doctorA.token),
      ),
    );
    // a compounder of doctor B must not appear
    await createCompounderFixture({ phone: '9818880006', doctorId: doctorB.doctorId });

    const body = await readResponse(
      await compoundersListRoute(getRequest(`${API}/api/compounders`, doctorA.token)),
    );
    expect(body.status).toBe(200);
    const compounders = (body.data as { compounders: { id: string; name: string; phone: string; isActive: boolean; mustChangePassword: boolean; createdAt: string }[] }).compounders;
    expect(compounders).toHaveLength(1);
    expect(compounders[0].name).toBe('Listed One');
    expect(compounders[0].mustChangePassword).toBe(true);
    expect(JSON.stringify(compounders)).not.toContain('tempPassword');
    expect(JSON.stringify(compounders)).not.toContain('passwordHash');
  });

  it('compounders cannot manage compounders (403) — doctor-only', async () => {
    const mine = await createCompounderFixture({ phone: '9818880007', doctorId: doctorA.doctorId });
    const list = await readResponse(
      await compoundersListRoute(getRequest(`${API}/api/compounders`, mine.token)),
    );
    expect(list.status).toBe(403);

    const create = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Nested', phone: '9818880008' }, mine.token),
      ),
    );
    expect(create.status).toBe(403);
  });

  it('DELETE deactivates my compounder, kills their sessions and blocks login', async () => {
    const created = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Doomed C', phone: '9818880009' }, doctorA.token),
      ),
    );
    const { user, tempPassword } = created.data as { user: { id: string }; tempPassword: string };

    // compounder logs in (creates a live session)
    const login = await readResponse(
      await loginRoute(postRequest(`${API}/api/auth/login`, { phone: '9818880009', password: tempPassword })),
    );
    expect(login.status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    const deleted = await readResponse(
      await compounderDeleteRoute(
        deleteRequest(`${API}/api/compounders/${user.id}`, doctorA.token),
        routeContext({ id: user.id }),
      ),
    );
    expect(deleted.status).toBe(200);
    expect((deleted.data as { user: { isActive: boolean } }).user.isActive).toBe(false);

    // sessions wiped immediately
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    // login now rejected (account disabled) — even with the right password
    const relogin = await readResponse(
      await loginRoute(postRequest(`${API}/api/auth/login`, { phone: '9818880009', password: tempPassword })),
    );
    expect(relogin.status).toBe(403);
    expect(relogin.error?.code).toBe('ACCOUNT_DISABLED');

    // soft delete: the user row and history survive
    const row = await db.user.findUnique({ where: { id: user.id } });
    expect(row).not.toBeNull();

    // deactivated compounder still listed (isActive=false) — keeps history
    const list = await readResponse(
      await compoundersListRoute(getRequest(`${API}/api/compounders`, doctorA.token)),
    );
    const listed = (list.data as { compounders: { id: string; isActive: boolean }[] }).compounders;
    expect(listed.find((c) => c.id === user.id)?.isActive).toBe(false);

    const audit = await db.auditLog.findFirst({ where: { action: 'COMPOUNDER_DEACTIVATED' } });
    expect(audit).not.toBeNull();
  });

  it("doctor A cannot delete doctor B's compounder — 404", async () => {
    const foreign = await createCompounderFixture({ phone: '9818880010', doctorId: doctorB.doctorId });
    const body = await readResponse(
      await compounderDeleteRoute(
        deleteRequest(`${API}/api/compounders/${foreign.userId}`, doctorA.token),
        routeContext({ id: foreign.userId }),
      ),
    );
    expect(body.status).toBe(404);
    const row = await db.user.findUnique({ where: { id: foreign.userId } });
    expect(row!.isActive).toBe(true); // untouched
  });

  it('validates the body (422) and rejects unknown/PENDING doctors', async () => {
    const badName = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'X', phone: '9818880011' }, doctorA.token),
      ),
    );
    expect(badName.status).toBe(422);

    const badPhone = await readResponse(
      await compounderCreateRoute(
        postRequest(`${API}/api/compounders`, { name: 'Good Name', phone: '12345' }, doctorA.token),
      ),
    );
    expect(badPhone.status).toBe(422);
  });
});
