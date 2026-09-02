import { POST as statusRoute } from '@/app/api/appointments/[id]/status/route';
import * as pushModule from '@/lib/push';
import { db } from '@/lib/db';
import {
  postRequest,
  readResponse,
  resetDb,
  API,
  routeContext,
  createDoctorFixture,
  createCompounderFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

function setStatus(id: string, status: string, token: string) {
  return statusRoute(
    postRequest(`${API}/api/appointments/${id}/status`, { status }, token),
    routeContext({ id }),
  );
}

describe('POST /api/appointments/:id/status', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  let scheduleA: { id: string };
  let appts: { id: string }[] = [];
  let foreignApptId: string;

  // Fresh CONFIRMED appointment helper (state machine tests consume them).
  // Phone tail is zero-padded so queue numbers > 9 still produce a valid
  // 10-digit fixture phone (n=1 → 9813330001, n=101 → 9813330101).
  async function freshAppointment(n: number, status = 'CONFIRMED') {
    return createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      queueNumber: n,
      patientPhone: `981333${String(n).padStart(4, '0')}`,
      patientName: `Status Patient ${n}`,
      status,
    });
  }

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000031' });
    doctorB = await createDoctorFixture({ phone: '9810000032' });
    compounderA = await createCompounderFixture({ phone: '9810000033', doctorId: doctorA.doctorId });
    scheduleA = await createScheduleFixture(doctorA.doctorId);
    const scheduleB = await createScheduleFixture(doctorB.doctorId);
    foreignApptId = (
      await createAppointmentFixture(scheduleB.id, doctorB.doctorId, { queueNumber: 1 })
    ).id;
  });

  beforeEach(async () => {
    // Give each test a pristine set of CONFIRMED appointments.
    await db.appointment.deleteMany({ where: { doctorId: doctorA.doctorId } });
    appts = [
      await freshAppointment(1),
      await freshAppointment(2),
      await freshAppointment(3),
      await freshAppointment(4),
      await freshAppointment(5),
      await freshAppointment(6),
    ];
  });

  it('PENDING → CONFIRMED is legal (the manual confirm action, Phase 11 B2) and audited + pushed', async () => {
    const pending = await freshAppointment(101, 'PENDING');
    const notifySpy = jest.spyOn(pushModule, 'notifyUser').mockImplementation(() => undefined);
    try {
      const body = await readResponse(await setStatus(pending.id, 'CONFIRMED', doctorA.token));
      expect(body.status).toBe(200);
      expect((body.data as { appointment: { status: string } }).appointment.status).toBe(
        'CONFIRMED',
      );

      // Audit: the manual confirmation is a staff decision (B2).
      const audit = await db.auditLog.findFirst({
        where: { action: 'APPOINTMENT_CONFIRMED', target: `appointment:${pending.id}` },
      });
      expect(audit).not.toBeNull();

      // Push: fire-and-forget to the patient (walk-ins pass patientId null —
      // notifyUser itself skips; the wiring is what is asserted).
      expect(notifySpy).toHaveBeenCalledTimes(1);
      const [pushUserId, message] = notifySpy.mock.calls[0] as [
        string | null,
        pushModule.PushMessage,
      ];
      expect(pushUserId).toBeNull(); // fixture default has no patient account
      expect(message.title).toBe('Appointment confirmed');
      expect(message.body).toContain(`Serial #${pending.queueNumber}`);
      expect(message.data?.type).toBe('APPOINTMENT_CONFIRMED');
      expect(message.data?.appointmentId).toBe(pending.id);
    } finally {
      notifySpy.mockRestore();
    }
  });

  it('PENDING → CANCELLED is legal (the staff reject action)', async () => {
    const pending = await freshAppointment(102, 'PENDING');
    const body = await readResponse(await setStatus(pending.id, 'CANCELLED', doctorA.token));
    expect(body.status).toBe(200);
    const audit = await db.auditLog.findFirst({
      where: { action: 'APPOINTMENT_CANCELLED', target: `appointment:${pending.id}` },
    });
    expect(audit).not.toBeNull();
  });

  it('PENDING → CALLED is illegal (confirm first) → 409', async () => {
    const pending = await freshAppointment(103, 'PENDING');
    const body = await readResponse(await setStatus(pending.id, 'CALLED', doctorA.token));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('INVALID_TRANSITION');
  });

  it('CONFIRMED → PENDING is illegal (one-way confirmation) → 409', async () => {
    const body = await readResponse(await setStatus(appts[0].id, 'PENDING', doctorA.token));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('INVALID_TRANSITION');
    expect(body.error?.message).toContain('PENDING');
  });

  it('CONFIRMED → CALLED is legal (and writes NO audit row)', async () => {
    const body = await readResponse(await setStatus(appts[0].id, 'CALLED', doctorA.token));
    expect(body.status).toBe(200);
    expect((body.data as { appointment: { status: string } }).appointment.status).toBe('CALLED');

    const audits = await db.auditLog.count({ where: { target: `appointment:${appts[0].id}` } });
    expect(audits).toBe(0); // audits exist only for CANCELLED / NO_SHOW
  });

  it('CALLED → COMPLETED is legal', async () => {
    await setStatus(appts[1].id, 'CALLED', doctorA.token);
    const body = await readResponse(await setStatus(appts[1].id, 'COMPLETED', doctorA.token));
    expect(body.status).toBe(200);
    expect((body.data as { appointment: { status: string } }).appointment.status).toBe('COMPLETED');
  });

  it('CONFIRMED → CANCELLED is legal and audited', async () => {
    const body = await readResponse(await setStatus(appts[2].id, 'CANCELLED', doctorA.token));
    expect(body.status).toBe(200);
    const audit = await db.auditLog.findFirst({
      where: { action: 'APPOINTMENT_CANCELLED', target: `appointment:${appts[2].id}` },
    });
    expect(audit).not.toBeNull();
  });

  it('CONFIRMED → NO_SHOW is legal and audited', async () => {
    const body = await readResponse(await setStatus(appts[3].id, 'NO_SHOW', doctorA.token));
    expect(body.status).toBe(200);
    const audit = await db.auditLog.findFirst({
      where: { action: 'APPOINTMENT_NO_SHOW', target: `appointment:${appts[3].id}` },
    });
    expect(audit).not.toBeNull();
  });

  it('COMPLETED is terminal: any transition → 409 INVALID_TRANSITION naming the current status', async () => {
    await setStatus(appts[4].id, 'CALLED', doctorA.token);
    await setStatus(appts[4].id, 'COMPLETED', doctorA.token);
    const body = await readResponse(await setStatus(appts[4].id, 'CALLED', doctorA.token));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('INVALID_TRANSITION');
    expect(body.error?.message).toContain('COMPLETED');
  });

  it('CALLED → CANCELLED is illegal (must complete or no-show first) → 409', async () => {
    await setStatus(appts[5].id, 'CALLED', doctorA.token);
    const body = await readResponse(await setStatus(appts[5].id, 'CANCELLED', doctorA.token));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('INVALID_TRANSITION');
  });

  it('CANCELLED is terminal — no resurrection (v1 bug #7)', async () => {
    await setStatus(appts[1].id, 'CANCELLED', doctorA.token);
    const body = await readResponse(await setStatus(appts[1].id, 'CALLED', doctorA.token));
    expect(body.status).toBe(409);
  });

  it('NO_SHOW is terminal', async () => {
    await setStatus(appts[2].id, 'NO_SHOW', doctorA.token);
    const body = await readResponse(await setStatus(appts[2].id, 'CANCELLED', doctorA.token));
    expect(body.status).toBe(409);
  });

  it('a compounder of doctor A can transition within A\'s scope', async () => {
    const body = await readResponse(await setStatus(appts[3].id, 'CALLED', compounderA.token));
    expect(body.status).toBe(200);
  });

  it("doctor A's staff cannot touch doctor B's appointment — 404 (existence never revealed)", async () => {
    const asDoctor = await readResponse(await setStatus(foreignApptId, 'CALLED', doctorA.token));
    expect(asDoctor.status).toBe(404);

    const asCompounder = await readResponse(await setStatus(foreignApptId, 'CALLED', compounderA.token));
    expect(asCompounder.status).toBe(404);
  });

  it('rejects an unknown appointment id (404) and invalid status values (422)', async () => {
    const missing = await readResponse(await setStatus('does-not-exist', 'CALLED', doctorA.token));
    expect(missing.status).toBe(404);

    // A truly unknown value → 422 at the schema gate. (PENDING and CONFIRMED
    // are both schema-accepted now — the ALLOWED_TRANSITIONS map is what
    // rejects CONFIRMED→PENDING with an explicit 409, see the test above.)
    const invalid = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${appts[0].id}/status`, { status: 'BOGUS' }, doctorA.token),
        routeContext({ id: appts[0].id }),
      ),
    );
    expect(invalid.status).toBe(422);
  });
});
