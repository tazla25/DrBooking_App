import { POST as bookAppointment } from '@/app/api/appointments/route';
import { db } from '@/lib/db';
import { dayOfWeekIST, istTodayISO, addDaysISO } from '@/lib/time';
import {
  postRequest,
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

interface BookedAppointment {
  id: string;
  scheduleId: string;
  doctorId: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string;
  date: string;
  queueNumber: number;
  status: string;
  source: string;
  fee: number | null;
}

/** Next date (≥ today) whose weekday differs from `date`'s. */
function nextDateWithDifferentWeekday(date: string): string {
  let d = addDaysISO(date, 1);
  while (dayOfWeekIST(d) === dayOfWeekIST(date)) d = addDaysISO(d, 1);
  return d;
}

describe('POST /api/appointments (patient booking, #8)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9820000001', name: 'Dr Booker', fee: 400 });
    patient = await createPatientFixture({ phone: '9820000010', name: 'Session Patient' });
    schedule = await createScheduleFixture(doctor.doctorId, { avgMinutesPerPatient: 15 });
  });

  function book(body: Record<string, unknown>, token?: string) {
    return bookAppointment(postRequest(`${API}/api/appointments`, body, token));
  }

  it('books for the patient: 201, identity from session, fee from doctor, ONLINE → PENDING (Phase 11 B1)', async () => {
    // A walk-in is already in the queue ahead (queue number 1).
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      queueNumber: 1,
      patientName: 'Ahead Person',
      patientPhone: '+919820000099',
    });

    const body = await readResponse(
      await book({ scheduleId: schedule.id, date: today }, patient.token),
    );
    expect(body.status).toBe(201);
    expect(body.ok).toBe(true);

    const data = body.data as { appointment: BookedAppointment; position: number; estWaitMin: number };
    expect(data.appointment.patientId).toBe(patient.userId); // session identity
    expect(data.appointment.patientName).toBe('Session Patient');
    expect(data.appointment.patientPhone).toBe('+919820000010');
    expect(data.appointment.source).toBe('ONLINE');
    // Phase 11 B1: ONLINE bookings land PENDING — staff confirm manually;
    // the serial is still allocated here (queueNumber 2) and never changes.
    expect(data.appointment.status).toBe('PENDING');
    expect(data.appointment.fee).toBe(400); // doctor's fee at booking time
    expect(data.appointment.queueNumber).toBe(2);
    expect(data.position).toBe(2);
    expect(data.estWaitMin).toBe(15); // one active appointment ahead × 15 min

    const audit = await db.auditLog.findFirst({ where: { action: 'APPOINTMENT_BOOKED' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(patient.userId);

    // DoctorProfile.appointmentCount incremented in the same transaction.
    const profile = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(profile?.appointmentCount).toBe(1);
  });

  it('IGNORES a body-supplied patientName/patientPhone (v1 IDOR fix)', async () => {
    const impostor = await createPatientFixture({ phone: '9820000011', name: 'Real Name' });
    const body = await readResponse(
      await book(
        {
          scheduleId: schedule.id,
          date: today,
          patientName: 'Impostor Name',
          patientPhone: '9999999999',
          patientId: 'not-a-real-id',
        },
        impostor.token,
      ),
    );
    expect(body.status).toBe(201);
    const appt = (body.data as { appointment: BookedAppointment }).appointment;
    expect(appt.patientName).toBe('Real Name'); // account name, never the body
    expect(appt.patientPhone).toBe('+919820000011');
    expect(appt.patientId).toBe(impostor.userId);
  });

  it('role guard: DOCTOR / COMPOUNDER / SUPER_ADMIN → 403, anonymous → 401', async () => {
    const otherDoctor = await createDoctorFixture({ phone: '9820000002' });
    const compounder = await createCompounderFixture({ phone: '9820000003', doctorId: doctor.doctorId });
    const admin = await createAdminFixture({ phone: '9820000004' });

    const asDoctor = await readResponse(await book({ scheduleId: schedule.id, date: today }, otherDoctor.token));
    expect(asDoctor.status).toBe(403);

    const asCompounder = await readResponse(await book({ scheduleId: schedule.id, date: today }, compounder.token));
    expect(asCompounder.status).toBe(403);

    const asAdmin = await readResponse(await book({ scheduleId: schedule.id, date: today }, admin.token));
    expect(asAdmin.status).toBe(403);

    const anonymous = await readResponse(await book({ scheduleId: schedule.id, date: today }));
    expect(anonymous.status).toBe(401);
  });

  it('rejects a duplicate ACTIVE booking with 409 ALREADY_BOOKED — a PENDING booking blocks too (Phase 11 B2)', async () => {
    // patient (9820000010) already has a PENDING booking on this schedule+date
    // (created by the test above) — PENDING is in the duplicate-active guard.
    const body = await readResponse(await book({ scheduleId: schedule.id, date: today }, patient.token));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('ALREADY_BOOKED');
  });

  it('after cancel, re-booking the same slot succeeds with a fresh queue number', async () => {
    const mine = await db.appointment.findFirst({
      where: { patientId: patient.userId, scheduleId: schedule.id, status: 'PENDING' },
    });
    expect(mine).not.toBeNull();
    await db.appointment.update({ where: { id: mine!.id }, data: { status: 'CANCELLED' } });

    const body = await readResponse(await book({ scheduleId: schedule.id, date: today }, patient.token));
    expect(body.status).toBe(201);
    const appt = (body.data as { appointment: BookedAppointment }).appointment;
    expect(appt.queueNumber).toBeGreaterThan(mine!.queueNumber); // cancelled number not reused
    expect(appt.status).toBe('PENDING'); // re-booked ONLINE → PENDING again
  });

  it('409 CAPACITY_FULL when the effective window is exhausted', async () => {
    const tiny = await createScheduleFixture(doctor.doctorId, {
      startTime: '09:00',
      endTime: '09:20', // 20 minutes…
      avgMinutesPerPatient: 10, // …/10 → capacity 2
    });
    const p1 = await createPatientFixture({ phone: '9820000021' });
    const p2 = await createPatientFixture({ phone: '9820000022' });
    const p3 = await createPatientFixture({ phone: '9820000023' });

    expect((await readResponse(await book({ scheduleId: tiny.id, date: today }, p1.token))).status).toBe(201);
    expect((await readResponse(await book({ scheduleId: tiny.id, date: today }, p2.token))).status).toBe(201);
    const third = await readResponse(await book({ scheduleId: tiny.id, date: today }, p3.token));
    expect(third.status).toBe(409);
    expect(third.error?.code).toBe('CAPACITY_FULL');
  });

  it('409 SCHEDULE_CLOSED on a CLOSED override; 422 past date / weekday mismatch; 404 unknown or unverified', async () => {
    const closedDate = addDaysISO(today, 7); // same weekday next week
    await db.scheduleOverride.create({
      data: { scheduleId: schedule.id, date: closedDate, type: 'CLOSED', reason: 'Festival' },
    });
    const closed = await readResponse(
      await book({ scheduleId: schedule.id, date: closedDate }, patient.token),
    );
    expect(closed.status).toBe(409);
    expect(closed.error?.code).toBe('SCHEDULE_CLOSED');

    const past = await readResponse(
      await book({ scheduleId: schedule.id, date: addDaysISO(today, -1) }, patient.token),
    );
    expect(past.status).toBe(422);

    const wrongDay = await readResponse(
      await book({ scheduleId: schedule.id, date: nextDateWithDifferentWeekday(today) }, patient.token),
    );
    expect(wrongDay.status).toBe(422);
    expect(wrongDay.error?.code).toBe('VALIDATION_ERROR');

    const unknown = await readResponse(
      await book({ scheduleId: 'does-not-exist', date: today }, patient.token),
    );
    expect(unknown.status).toBe(404);

    // PENDING doctor's schedule → same 404, never revealing the doctor.
    const pending = await createDoctorFixture({ phone: '9820000005', verificationStatus: 'PENDING' });
    const pendingSchedule = await createScheduleFixture(pending.doctorId);
    const unverified = await readResponse(
      await book({ scheduleId: pendingSchedule.id, date: today }, patient.token),
    );
    expect(unverified.status).toBe(404);
    expect(unverified.error?.code).toBe('NOT_FOUND');
  });

  it(
    '10 PARALLEL bookings (different patients, same schedule+date) → 10 distinct sequential queue numbers, all 201',
    async () => {
    const parallel = await createScheduleFixture(doctor.doctorId, {
      clinicName: 'Parallel Clinic',
      startTime: '08:00',
      endTime: '20:00', // 12h × 6/h = capacity 72 — plenty for 10
      avgMinutesPerPatient: 10,
    });

    const patients = [];
    for (let i = 0; i < 10; i += 1) {
      patients.push(await createPatientFixture({ phone: `98200001${String(30 + i).padStart(2, '0')}` }));
    }

    const responses = await Promise.all(
      patients.map((p) => book({ scheduleId: parallel.id, date: today }, p.token)),
    );
    const bodies = await Promise.all(responses.map(readResponse));

    const queueNumbers = bodies.map(
      (b) => (b.data as { appointment: BookedAppointment }).appointment.queueNumber,
    );
    expect(bodies.every((b) => b.status === 201)).toBe(true);
    expect(new Set(queueNumbers).size).toBe(10); // all distinct
    expect([...queueNumbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const stored = await db.appointment.findMany({
      where: { scheduleId: parallel.id, date: today },
    });
    expect(stored.length).toBe(10);

    const profile = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(profile?.appointmentCount).toBeGreaterThan(10); // earlier bookings + 10
    },
    30_000,
  );
});
