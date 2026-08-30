import { GET as auditLogList } from '@/app/api/admin/audit-log/route';
import { POST as verifyDoctor } from '@/app/api/admin/verify-doctor/route';
import { db } from '@/lib/db';
import {
  postRequest,
  getRequest,
  readResponse,
  resetDb,
  API,
  createAdminFixture,
  createDoctorFixture,
  createPatientFixture,
} from './helpers';

describe('GET /api/admin/audit-log (#28)', () => {
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let admin2: Awaited<ReturnType<typeof createAdminFixture>>;
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;

  beforeAll(async () => {
    await resetDb();
    admin = await createAdminFixture({ phone: '9832000001', name: 'Audit Admin' });
    admin2 = await createAdminFixture({ phone: '9832000002', name: 'Audit Admin Two' });
    patient = await createPatientFixture({ phone: '9832000003' });
    doctor = await createDoctorFixture({ phone: '9832000010', verificationStatus: 'PENDING' });

    // Deterministic audit rows: one by admin (verify), one by patient (register-style).
    await verifyDoctor(
      postRequest(`${API}/api/admin/verify-doctor`, { userId: doctor.userId, decision: 'VERIFIED' }, admin.token),
    );
    await db.auditLog.create({
      data: {
        actorId: patient.userId,
        action: 'AUTH_REGISTER',
        target: `user:${patient.userId}`,
        detail: JSON.stringify({ role: 'PATIENT' }),
      },
    });
    await db.auditLog.create({
      data: {
        actorId: admin2.userId,
        action: 'DOCTOR_VERIFIED',
        target: `user:${patient.userId}`,
        detail: JSON.stringify({ decision: 'VERIFIED' }),
      },
    });
  });

  function list(token: string, qs = '') {
    return auditLogList(getRequest(`${API}/api/admin/audit-log${qs}`, token));
  }

  it('401 without a token, 403 for non-admin roles', async () => {
    expect((await readResponse(await auditLogList(getRequest(`${API}/api/admin/audit-log`)))).status).toBe(401);
    expect((await readResponse(await list(patient.token))).status).toBe(403);
    expect((await readResponse(await list(doctor.token))).status).toBe(403);
  });

  it('newest first with actor info and pagination shape', async () => {
    const body = await readResponse(await list(admin.token));
    expect(body.status).toBe(200);
    const data = body.data as {
      items: Array<{ id: string; action: string; actorId: string | null; actor: { id: string; name: string; role: string } | null; target: string | null; detail: string | null; createdAt: string }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(data.total).toBe(3);
    expect(data.items).toHaveLength(3);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(20);
    // Strictly descending createdAt.
    for (let i = 1; i < data.items.length; i += 1) {
      expect(new Date(data.items[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(data.items[i].createdAt).getTime(),
      );
    }
    const withActor = data.items.find((i) => i.action === 'AUTH_REGISTER')!;
    expect(withActor.actor?.id).toBe(patient.userId);
    expect(withActor.actor?.role).toBe('PATIENT');
  });

  it('filters by ?action=', async () => {
    const body = await readResponse(await list(admin.token, '?action=DOCTOR_VERIFIED'));
    const data = body.data as { items: Array<{ action: string }>; total: number };
    expect(data.total).toBe(2);
    expect(data.items.every((i) => i.action === 'DOCTOR_VERIFIED')).toBe(true);
  });

  it('filters by ?userId= (actorId)', async () => {
    const body = await readResponse(await list(admin.token, `?userId=${admin2.userId}`));
    const data = body.data as { items: Array<{ actorId: string | null }>; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0].actorId).toBe(admin2.userId);
  });

  it('combines filters and paginates', async () => {
    const body = await readResponse(await list(admin.token, '?action=DOCTOR_VERIFIED&page=1&limit=1'));
    const data = body.data as { items: unknown[]; total: number; page: number; limit: number };
    expect(data.total).toBe(2);
    expect(data.items).toHaveLength(1);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(1);

    const page2 = await readResponse(await list(admin.token, '?action=DOCTOR_VERIFIED&page=2&limit=1'));
    expect((page2.data as { items: unknown[] }).items).toHaveLength(1);
  });

  it('empty result set for a filter that matches nothing', async () => {
    const body = await readResponse(await list(admin.token, '?action=NO_SUCH_ACTION'));
    expect(body.status).toBe(200);
    const data = body.data as { items: unknown[]; total: number };
    expect(data.total).toBe(0);
    expect(data.items).toHaveLength(0);
  });

  it('422 for invalid pagination', async () => {
    const body = await readResponse(await list(admin.token, '?page=0'));
    expect(body.status).toBe(422);
  });
});
