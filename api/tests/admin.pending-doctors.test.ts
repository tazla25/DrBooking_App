import { GET as listPendingDoctors } from '@/app/api/admin/pending-doctors/route';
import { db } from '@/lib/db';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createAdminFixture,
  createDoctorFixture,
  createPatientFixture,
} from './helpers';

describe('GET /api/admin/pending-doctors (#26)', () => {
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let pendingA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let pendingB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let verified: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;

  beforeAll(async () => {
    await resetDb();
    admin = await createAdminFixture({ phone: '9830000001', name: 'Admin One' });
    pendingA = await createDoctorFixture({
      phone: '9830000010',
      name: 'Dr Pending A',
      verificationStatus: 'PENDING',
      fee: 400,
    });
    pendingB = await createDoctorFixture({
      phone: '9830000011',
      name: 'Dr Pending B',
      verificationStatus: 'PENDING',
    });
    verified = await createDoctorFixture({ phone: '9830000012', verificationStatus: 'VERIFIED' });
    patient = await createPatientFixture({ phone: '9830000013' });
  });

  function list(token: string, qs = '') {
    return listPendingDoctors(getRequest(`${API}/api/admin/pending-doctors${qs}`, token));
  }

  it('401 without a token, 403 for non-admin roles', async () => {
    expect((await readResponse(await listPendingDoctors(getRequest(`${API}/api/admin/pending-doctors`)))).status).toBe(401);
    expect((await readResponse(await list(patient.token))).status).toBe(403);
    expect((await readResponse(await list(verified.token))).status).toBe(403);
  });

  it('lists ONLY PENDING doctors with their DoctorProfile fields', async () => {
    const body = await readResponse(await list(admin.token));
    expect(body.status).toBe(200);

    const data = body.data as {
      items: Array<{
        id: string;
        phone: string;
        verificationStatus: string;
        doctorProfile: { fullName: string; fee: number | null } | null;
      }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(data.total).toBe(2);
    expect(data.items.map((i) => i.id).sort()).toEqual([pendingA.userId, pendingB.userId].sort());
    expect(data.items.every((i) => i.verificationStatus === 'PENDING')).toBe(true);

    const itemA = data.items.find((i) => i.id === pendingA.userId)!;
    expect(itemA.phone).toBe(pendingA.phone);
    expect(itemA.doctorProfile).not.toBeNull();
    expect(itemA.doctorProfile!.fullName).toBe('Dr Pending A');
    expect(itemA.doctorProfile!.fee).toBe(400);
  });

  it('paginates with ?page=&limit= (FIFO by createdAt)', async () => {
    const page1 = await readResponse(await list(admin.token, '?page=1&limit=1'));
    expect(page1.status).toBe(200);
    const d1 = page1.data as { items: Array<{ id: string }>; total: number; page: number; limit: number };
    expect(d1.total).toBe(2);
    expect(d1.page).toBe(1);
    expect(d1.limit).toBe(1);
    expect(d1.items).toHaveLength(1);
    expect(d1.items[0].id).toBe(pendingA.userId); // oldest pending first

    const page2 = await readResponse(await list(admin.token, '?page=2&limit=1'));
    const d2 = page2.data as { items: Array<{ id: string }> };
    expect(d2.items[0].id).toBe(pendingB.userId);

    const pastEnd = await readResponse(await list(admin.token, '?page=5&limit=1'));
    expect((pastEnd.data as { items: unknown[] }).items).toHaveLength(0);
  });

  it('rejects invalid pagination with 422', async () => {
    const bad = await readResponse(await list(admin.token, '?limit=abc'));
    expect(bad.status).toBe(422);
    expect(bad.error?.code).toBe('VALIDATION_ERROR');

    const tooBig = await readResponse(await list(admin.token, '?limit=500'));
    expect(tooBig.status).toBe(422);
  });

  it('a REJECTED doctor is not listed as pending', async () => {
    const rejected = await createDoctorFixture({ phone: '9830000014', verificationStatus: 'REJECTED' });
    const body = await readResponse(await list(admin.token));
    const data = body.data as { items: Array<{ id: string }>; total: number };
    expect(data.items.some((i) => i.id === rejected.userId)).toBe(false);
    expect(data.total).toBe(2);
    await db.user.delete({ where: { id: rejected.userId } });
  });
});
