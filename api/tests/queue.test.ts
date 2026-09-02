import { GET as queueTodayRoute } from '@/app/api/queue/today/route';
import { POST as queueNextRoute } from '@/app/api/queue/next/route';
import { db } from '@/lib/db';
import {
  postRequest,
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createAdminFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

/**
 * Phase 2 queue endpoints (#14–15): scoping, estWaitMin, queue/next state
 * machine, SUPER_ADMIN targeting.
 */

interface QueueAppointment {
  id: string;
  queueNumber: number;
  status: string;
  source: string;
  patientName: string;
  patientPhone: string;
  patientId: string | null;
  notes: string | null;
  fee: number | null;
  estWaitMin: number;
  createdAt: string;
}

describe('GET /api/queue/today', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  let pendingDoctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  const apptIds: string[] = [];

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000001', name: 'Dr Alpha' });
    doctorB = await createDoctorFixture({ phone: '9810000002', name: 'Dr Beta' });
    compounderA = await createCompounderFixture({ phone: '9810000003', doctorId: doctorA.doctorId });
    pendingDoctor = await createDoctorFixture({ phone: '9810000004', verificationStatus: 'PENDING' });
    admin = await createAdminFixture({ phone: '9810000005' });

    const scheduleA = await createScheduleFixture(doctorA.doctorId, { avgMinutesPerPatient: 10 });
    for (let i = 1; i <= 3; i += 1) {
      const appt = await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
        queueNumber: i,
        patientName: `Patient ${i}`,
        patientPhone: `981111000${i}`,
      });
      apptIds.push(appt.id);
    }
    // Doctor B has her own queue today.
    const scheduleB = await createScheduleFixture(doctorB.doctorId);
    await createAppointmentFixture(scheduleB.id, doctorB.doctorId, {
      queueNumber: 1,
      patientName: 'Beta Patient',
      patientPhone: '9812220001',
    });
  });

  it('returns the scoped queue ordered by queueNumber with FULL patient contact (staff view)', async () => {
    const res = await queueTodayRoute(getRequest(`${API}/api/queue/today`, doctorA.token));
    const body = await readResponse(res);
    expect(body.status).toBe(200);

    const data = body.data as {
      date: string;
      doctor: { id: string; fullName: string };
      counts: Record<string, number>;
      appointments: QueueAppointment[];
    };
    expect(data.doctor.id).toBe(doctorA.doctorId);
    expect(data.doctor.fullName).toBe('Dr Alpha');
    expect(data.counts).toEqual({ pending: 0, confirmed: 3, called: 0, completed: 0, cancelled: 0, noShow: 0 });
    expect(data.appointments.map((a) => a.queueNumber)).toEqual([1, 2, 3]);
    expect(data.appointments[0].patientPhone).toBe('+919811110001'); // full, unmasked
    expect(data.appointments[0].patientName).toBe('Patient 1');
  });

  it('computes estWaitMin = (ahead-statuses in same schedule) × avgMinutesPerPatient — PENDING counts ahead (Phase 11 B2)', async () => {
    // q1, q2, q3 CONFIRMED → est 0, 10, 20 (avg = 10 min).
    const res = await queueTodayRoute(getRequest(`${API}/api/queue/today`, doctorA.token));
    const body = await readResponse(res);
    const { appointments } = body.data as { appointments: QueueAppointment[] };
    expect(appointments.map((a) => a.estWaitMin)).toEqual([0, 10, 20]);

    // COMPLETED / CANCELLED rows do NOT count ahead of later patients.
    await db.appointment.update({ where: { id: appointments[0].id }, data: { status: 'COMPLETED' } });
    await db.appointment.update({ where: { id: appointments[1].id }, data: { status: 'CANCELLED' } });
    const res2 = await queueTodayRoute(getRequest(`${API}/api/queue/today`, doctorA.token));
    const body2 = await readResponse(res2);
    const appts2 = (body2.data as { appointments: QueueAppointment[] }).appointments;
    expect(appts2.map((a) => a.estWaitMin)).toEqual([0, 0, 0]);
    // restore for later tests
    await db.appointment.update({ where: { id: appointments[0].id }, data: { status: 'CONFIRMED' } });
    await db.appointment.update({ where: { id: appointments[1].id }, data: { status: 'CONFIRMED' } });

    // Phase 11: a PENDING row is returned by /queue/today with status PENDING,
    // counts as ahead for later serials, and increments counts.pending.
    const scheduleA = await db.schedule.findFirst({ where: { doctorId: doctorA.doctorId } });
    await createAppointmentFixture(scheduleA!.id, doctorA.doctorId, {
      queueNumber: 4,
      status: 'PENDING',
      patientName: 'Pending Patient',
      patientPhone: '9811110004',
    });
    await createAppointmentFixture(scheduleA!.id, doctorA.doctorId, {
      queueNumber: 5,
      patientName: 'Later Patient',
      patientPhone: '9811110005',
    });
    const res3 = await queueTodayRoute(getRequest(`${API}/api/queue/today`, doctorA.token));
    const body3 = await readResponse(res3);
    const data3 = body3.data as { counts: Record<string, number>; appointments: QueueAppointment[] };
    expect(data3.counts).toEqual({ pending: 1, confirmed: 4, called: 0, completed: 0, cancelled: 0, noShow: 0 });
    // q4 PENDING: est = 3 CONFIRMED ahead (q1..q3) × 10 = 30.
    expect(data3.appointments.find((a) => a.queueNumber === 4)?.estWaitMin).toBe(30);
    // q5 CONFIRMED after the PENDING row: 4 ahead-statuses ahead × 10 = 40.
    expect(data3.appointments.find((a) => a.queueNumber === 5)?.estWaitMin).toBe(40);
    // The PENDING row itself carries status PENDING (client partitions).
    expect(data3.appointments.find((a) => a.queueNumber === 4)?.status).toBe('PENDING');
    // clean up the two extras so later length assertions stay honest
    await db.appointment.deleteMany({
      where: { scheduleId: scheduleA!.id, queueNumber: { in: [4, 5] } },
    });
  });

  it('scopes a COMPOUNDER to the delegated doctor and IGNORES client-sent ?doctorId=', async () => {
    const res = await queueTodayRoute(
      getRequest(`${API}/api/queue/today?doctorId=${doctorB.doctorId}`, compounderA.token),
    );
    const body = await readResponse(res);
    expect(body.status).toBe(200);
    const data = body.data as { doctor: { id: string }; appointments: QueueAppointment[] };
    expect(data.doctor.id).toBe(doctorA.doctorId); // never doctor B
    expect(data.appointments).toHaveLength(3);
  });

  it('blocks a PENDING doctor with 403 DOCTOR_NOT_VERIFIED', async () => {
    const res = await queueTodayRoute(getRequest(`${API}/api/queue/today`, pendingDoctor.token));
    const body = await readResponse(res);
    expect(body.status).toBe(403);
    expect(body.error?.code).toBe('DOCTOR_NOT_VERIFIED');
  });

  it('rejects patients (403) and anonymous callers (401)', async () => {
    const patient = await createPatientFixture({ phone: '9810000009' });
    const asPatient = await readResponse(
      await queueTodayRoute(getRequest(`${API}/api/queue/today`, patient.token)),
    );
    expect(asPatient.status).toBe(403);

    const anon = await readResponse(await queueTodayRoute(getRequest(`${API}/api/queue/today`)));
    expect(anon.status).toBe(401);
  });

  it('validates ?date (422 on malformed) and honors a valid one', async () => {
    const bad = await readResponse(
      await queueTodayRoute(getRequest(`${API}/api/queue/today?date=2026-02-30`, doctorA.token)),
    );
    expect(bad.status).toBe(422);

    const empty = await readResponse(
      await queueTodayRoute(getRequest(`${API}/api/queue/today?date=2020-01-01`, doctorA.token)),
    );
    expect(empty.status).toBe(200);
    expect((empty.data as { appointments: unknown[] }).appointments).toHaveLength(0);
  });

  it('lets SUPER_ADMIN read any doctor queue via ?doctorId= (and requires it)', async () => {
    const targeted = await readResponse(
      await queueTodayRoute(
        getRequest(`${API}/api/queue/today?doctorId=${doctorB.doctorId}`, admin.token),
      ),
    );
    expect(targeted.status).toBe(200);
    const data = targeted.data as { doctor: { id: string }; appointments: QueueAppointment[] };
    expect(data.doctor.id).toBe(doctorB.doctorId);
    expect(data.appointments).toHaveLength(1);

    const untargeted = await readResponse(
      await queueTodayRoute(getRequest(`${API}/api/queue/today`, admin.token)),
    );
    expect(untargeted.status).toBe(422);

    const bogus = await readResponse(
      await queueTodayRoute(getRequest(`${API}/api/queue/today?doctorId=nope`, admin.token)),
    );
    expect(bogus.status).toBe(404);
  });
});

describe('POST /api/queue/next', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  let doctorBApptId: string;
  const apptIds: string[] = [];

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000011' });
    doctorB = await createDoctorFixture({ phone: '9810000012' });
    compounderA = await createCompounderFixture({ phone: '9810000013', doctorId: doctorA.doctorId });

    const scheduleA = await createScheduleFixture(doctorA.doctorId);
    for (let i = 1; i <= 3; i += 1) {
      const appt = await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
        queueNumber: i,
        patientName: `Next Patient ${i}`,
        patientPhone: `981111100${i}`,
      });
      apptIds.push(appt.id);
    }
    const scheduleB = await createScheduleFixture(doctorB.doctorId);
    const apptB = await createAppointmentFixture(scheduleB.id, doctorB.doctorId, {
      queueNumber: 1,
      patientPhone: '9812222001',
    });
    doctorBApptId = apptB.id;
  });

  it('first call: calls #1, nothing completed yet', async () => {
    const res = await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctorA.token));
    const body = await readResponse(res);
    expect(body.status).toBe(200);
    const data = body.data as {
      completed: { id: string } | null;
      called: { id: string; queueNumber: number; status: string; patientName: string; patientPhone: string } | null;
      queueEmpty: boolean;
    };
    expect(data.completed).toBeNull();
    expect(data.queueEmpty).toBe(false);
    expect(data.called!.queueNumber).toBe(1);
    expect(data.called!.status).toBe('CALLED');
    expect(data.called!.patientName).toBe('Next Patient 1');
    expect(data.called!.patientPhone).toBe('+919811111001');
  });

  it('second call: completes #1 and calls #2', async () => {
    const body = await readResponse(
      await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctorA.token)),
    );
    expect(body.status).toBe(200);
    const data = body.data as {
      completed: { id: string; status: string } | null;
      called: { queueNumber: number } | null;
      queueEmpty: boolean;
    };
    expect(data.completed!.id).toBe(apptIds[0]);
    expect(data.completed!.status).toBe('COMPLETED');
    expect(data.called!.queueNumber).toBe(2);
  });

  it('drains the queue: eventually queueEmpty=true with called=null', async () => {
    await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctorA.token)));
    const final = await readResponse(
      await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctorA.token)),
    );
    expect(final.status).toBe(200);
    const data = final.data as { completed: { id: string } | null; called: null; queueEmpty: boolean };
    expect(data.completed!.id).toBe(apptIds[2]);
    expect(data.called).toBeNull();
    expect(data.queueEmpty).toBe(true);
  });

  it('a compounder advances only the DELEGATED doctor queue (doctor B untouched)', async () => {
    // Doctor A has one more CONFIRMED appointment? No — queue drained; add one.
    const scheduleA = await db.schedule.findFirst({ where: { doctorId: doctorA.doctorId } });
    const extra = await createAppointmentFixture(scheduleA!.id, doctorA.doctorId, {
      queueNumber: 4,
      patientPhone: '9811111004',
    });

    const body = await readResponse(
      await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, compounderA.token)),
    );
    expect(body.status).toBe(200);
    const data = body.data as { called: { id: string } | null };
    expect(data.called!.id).toBe(extra.id);

    const bStatus = await db.appointment.findUnique({ where: { id: doctorBApptId } });
    expect(bStatus!.status).toBe('CONFIRMED'); // B's queue untouched by A's staff
  });

  it('rejects patients (403) and requires auth (401)', async () => {
    const patient = await createPatientFixture({ phone: '9810000019' });
    const asPatient = await readResponse(
      await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, patient.token)),
    );
    expect(asPatient.status).toBe(403);

    const anon = await readResponse(
      await queueNextRoute(postRequest(`${API}/api/queue/next`, {})),
    );
    expect(anon.status).toBe(401);
  });
});
