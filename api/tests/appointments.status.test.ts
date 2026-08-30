import { POST as statusRoute } from '@/app/api/appointments/[id]/status/route';
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
  async function freshAppointment(n: number) {
    return createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      queueNumber: n,
      patientPhone: `981333000${n}`,
      patientName: `Status Patient ${n}`,
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

    const invalid = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${appts[0].id}/status`, { status: 'CONFIRMED' }, doctorA.token),
        routeContext({ id: appts[0].id }),
      ),
    );
    expect(invalid.status).toBe(422);
  });
});
