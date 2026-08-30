import { POST as verifyDoctor } from '@/app/api/admin/verify-doctor/route';
import { GET as listPendingDoctors } from '@/app/api/admin/pending-doctors/route';
import { GET as queueToday } from '@/app/api/queue/today/route';
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
  createScheduleFixture,
} from './helpers';

describe('POST /api/admin/verify-doctor (#27)', () => {
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>; // starts PENDING
  let rejectedDoctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let verifiedDoctor: Awaited<ReturnType<typeof createDoctorFixture>>;

  beforeAll(async () => {
    await resetDb();
    admin = await createAdminFixture({ phone: '9831000001', name: 'Admin Verify' });
    patient = await createPatientFixture({ phone: '9831000002' });
    doctor = await createDoctorFixture({
      phone: '9831000010',
      name: 'Dr To Verify',
      verificationStatus: 'PENDING',
    });
    rejectedDoctor = await createDoctorFixture({ phone: '9831000011', verificationStatus: 'REJECTED' });
    verifiedDoctor = await createDoctorFixture({ phone: '9831000012', verificationStatus: 'VERIFIED' });
    await createScheduleFixture(doctor.doctorId); // schedule exists from the start
  });

  function verify(body: Record<string, unknown>, token: string) {
    return verifyDoctor(postRequest(`${API}/api/admin/verify-doctor`, body, token));
  }

  it('401 without a token, 403 for any non-SUPER_ADMIN role', async () => {
    const body = { userId: doctor.userId, decision: 'VERIFIED' };
    expect((await readResponse(await verifyDoctor(postRequest(`${API}/api/admin/verify-doctor`, body)))).status).toBe(401);
    expect((await readResponse(await verify(body, patient.token))).status).toBe(403);
    expect((await readResponse(await verify(body, doctor.token))).status).toBe(403);
  });

  it('happy path: PENDING → VERIFIED, status updated, audit row written', async () => {
    const body = await readResponse(
      await verify({ userId: doctor.userId, decision: 'VERIFIED', note: 'Checked MBBS degree' }, admin.token),
    );
    expect(body.status).toBe(200);
    const data = body.data as { user: { id: string; verificationStatus: string }; previousStatus: string };
    expect(data.user.id).toBe(doctor.userId);
    expect(data.user.verificationStatus).toBe('VERIFIED');
    expect(data.previousStatus).toBe('PENDING');

    const stored = await db.user.findUnique({ where: { id: doctor.userId } });
    expect(stored?.verificationStatus).toBe('VERIFIED');

    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_VERIFIED', actorId: admin.userId, target: `user:${doctor.userId}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const detail = JSON.parse(audit!.detail ?? '{}') as { targetUserId: string; decision: string; note: string | null };
    expect(detail.targetUserId).toBe(doctor.userId);
    expect(detail.decision).toBe('VERIFIED');
    expect(detail.note).toBe('Checked MBBS degree');
  });

  it('verified doctor now passes the EXISTING staff gate (no new code)', async () => {
    const res = await readResponse(await queueToday(getRequest(`${API}/api/queue/today`, doctor.token)));
    expect(res.status).toBe(200);
  });

  it('idempotent: VERIFIED → VERIFIED is 200 (not 409), still audited', async () => {
    const body = await readResponse(await verify({ userId: doctor.userId, decision: 'VERIFIED' }, admin.token));
    expect(body.status).toBe(200);
    const rows = await db.auditLog.count({ where: { action: 'DOCTOR_VERIFIED', target: `user:${doctor.userId}` } });
    expect(rows).toBe(2); // one per decision, append-only trail
  });

  it('REJECTED → VERIFIED is an allowed admin correction', async () => {
    const body = await readResponse(
      await verify({ userId: rejectedDoctor.userId, decision: 'VERIFIED', note: 'Correction' }, admin.token),
    );
    expect(body.status).toBe(200);
    expect((body.data as { previousStatus: string }).previousStatus).toBe('REJECTED');
    const stored = await db.user.findUnique({ where: { id: rejectedDoctor.userId } });
    expect(stored?.verificationStatus).toBe('VERIFIED');
  });

  it('VERIFIED → REJECTED acts as suspension and trips the existing 403 gate', async () => {
    const body = await readResponse(
      await verify({ userId: verifiedDoctor.userId, decision: 'REJECTED', note: 'Suspended pending review' }, admin.token),
    );
    expect(body.status).toBe(200);
    expect((body.data as { previousStatus: string }).previousStatus).toBe('VERIFIED');

    // The EXISTING requireVerifiedStaff gate rejects the now-unverified doctor.
    const res = await readResponse(await queueToday(getRequest(`${API}/api/queue/today`, verifiedDoctor.token)));
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('DOCTOR_NOT_VERIFIED');

    const audit = await db.auditLog.findFirst({
      where: { action: 'DOCTOR_REJECTED', target: `user:${verifiedDoctor.userId}` },
    });
    expect(audit).not.toBeNull();

    // And the doctor disappears from the pending list (still not PENDING).
    const pending = await readResponse(await listPendingDoctors(getRequest(`${API}/api/admin/pending-doctors`, admin.token)));
    const items = (pending.data as { items: Array<{ id: string }> }).items;
    expect(items.some((i) => i.id === verifiedDoctor.userId)).toBe(false);
  });

  it('REJECTED → REJECTED is NOT an allowed transition (409)', async () => {
    await verify({ userId: verifiedDoctor.userId, decision: 'VERIFIED', note: 're-verify first' }, admin.token);
    const body = await readResponse(await verify({ userId: verifiedDoctor.userId, decision: 'REJECTED' }, admin.token));
    expect(body.status).toBe(200); // VERIFIED → REJECTED ok
    const rejected = await readResponse(await verify({ userId: verifiedDoctor.userId, decision: 'REJECTED' }, admin.token));
    expect(rejected.status).toBe(409);
    expect(rejected.error?.code).toBe('INVALID_TRANSITION');
  });

  it('404 when the user is missing or not a DOCTOR', async () => {
    const missing = await readResponse(await verify({ userId: 'does-not-exist', decision: 'VERIFIED' }, admin.token));
    expect(missing.status).toBe(404);

    const notDoctor = await readResponse(await verify({ userId: patient.userId, decision: 'VERIFIED' }, admin.token));
    expect(notDoctor.status).toBe(404);
  });

  it('422 for an invalid decision / bad payload', async () => {
    const bad = await readResponse(
      await verify({ userId: doctor.userId, decision: 'PENDING' }, admin.token),
    );
    expect(bad.status).toBe(422);
    expect(bad.error?.code).toBe('VALIDATION_ERROR');

    const malformed = await readResponse(
      await verifyDoctor(postRequest(`${API}/api/admin/verify-doctor`, { decision: 'VERIFIED' }, admin.token)),
    );
    expect(malformed.status).toBe(422);
  });
});
