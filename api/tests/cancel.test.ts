import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { POST as bookAppointment } from '@/app/api/appointments/route';
import { db } from '@/lib/db';
import { istTodayISO } from '@/lib/time';
import {
  postRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
  routeContext,
} from './helpers';

describe('POST /api/appointments/:id/cancel (#10)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let otherPatient: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9822000001', name: 'Dr Canceller', fee: 300 });
    patient = await createPatientFixture({ phone: '9822000010', name: 'Cancel Patient' });
    otherPatient = await createPatientFixture({ phone: '9822000011', name: 'Other Patient' });
    schedule = await createScheduleFixture(doctor.doctorId, { avgMinutesPerPatient: 10 });
  });

  function cancel(id: string, token = patient.token) {
    return cancelAppointment(
      postRequest(`${API}/api/appointments/${id}/cancel`, {}, token),
      routeContext({ id }),
    );
  }

  it('happy path: CONFIRMED → CANCELLED with an audit row', async () => {
    const appt = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'CONFIRMED',
      patientId: patient.userId,
      patientName: 'Cancel Patient',
      patientPhone: '+919822000010',
    });

    const body = await readResponse(await cancel(appt.id));
    expect(body.status).toBe(200);
    expect((body.data as { appointment: { status: string } }).appointment.status).toBe('CANCELLED');

    const audit = await db.auditLog.findFirst({
      where: { action: 'APPOINTMENT_CANCELLED', target: `appointment:${appt.id}` },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(patient.userId);
    expect(JSON.parse(audit!.detail!)).toEqual({
      previousStatus: 'CONFIRMED',
      newStatus: 'CANCELLED',
      by: 'PATIENT',
    });
  });

  it("someone else's appointment → 404 (never 403 — no existence leak)", async () => {
    const foreign = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 2,
      status: 'CONFIRMED',
      patientId: otherPatient.userId,
      patientName: 'Other Patient',
      patientPhone: '+919822000011',
    });

    const body = await readResponse(await cancel(foreign.id));
    expect(body.status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');

    const stillThere = await db.appointment.findUnique({ where: { id: foreign.id } });
    expect(stillThere?.status).toBe('CONFIRMED'); // untouched
  });

  it('a CALLED appointment → 409 INVALID_TRANSITION (staff already called them in)', async () => {
    const called = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 3,
      status: 'CALLED',
      patientId: patient.userId,
    });

    const body = await readResponse(await cancel(called.id));
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('INVALID_TRANSITION');
    expect(body.error?.message).toContain('CALLED');
  });

  it('terminal statuses are never resurrected: COMPLETED/CANCELLED → 409', async () => {
    const completed = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 4,
      status: 'COMPLETED',
      patientId: patient.userId,
    });
    expect((await readResponse(await cancel(completed.id))).status).toBe(409);

    const alreadyCancelled = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 5,
      status: 'CANCELLED',
      patientId: patient.userId,
    });
    expect((await readResponse(await cancel(alreadyCancelled.id))).status).toBe(409);
  });

  it('cancel → re-book flow: cancelled booking stops blocking a fresh one', async () => {
    // Isolated patient + schedule so earlier CALLED fixtures cannot trip the
    // duplicate-active guard.
    const soloPatient = await createPatientFixture({ phone: '9822000020', name: 'Solo Patient' });
    const soloSchedule = await createScheduleFixture(doctor.doctorId, {
      clinicName: 'Solo Clinic',
      avgMinutesPerPatient: 10,
    });

    // Book via the real route so the duplicate guard is exercised end-to-end.
    const booked = await readResponse(
      await bookAppointment(
        postRequest(
          `${API}/api/appointments`,
          { scheduleId: soloSchedule.id, date: today },
          soloPatient.token,
        ),
      ),
    );
    expect(booked.status).toBe(201);
    const apptId = (booked.data as { appointment: { id: string } }).appointment.id;
    const apptQueue = (booked.data as { appointment: { queueNumber: number } }).appointment.queueNumber;

    // Active duplicate → blocked.
    const dup = await readResponse(
      await bookAppointment(
        postRequest(
          `${API}/api/appointments`,
          { scheduleId: soloSchedule.id, date: today },
          soloPatient.token,
        ),
      ),
    );
    expect(dup.status).toBe(409);
    expect(dup.error?.code).toBe('ALREADY_BOOKED');

    // Cancel, then re-book the same schedule+date → allowed.
    expect((await readResponse(await cancel(apptId, soloPatient.token))).status).toBe(200);
    const rebook = await readResponse(
      await bookAppointment(
        postRequest(
          `${API}/api/appointments`,
          { scheduleId: soloSchedule.id, date: today },
          soloPatient.token,
        ),
      ),
    );
    expect(rebook.status).toBe(201);
    const rebooked = (rebook.data as { appointment: { id: string; queueNumber: number } }).appointment;
    expect(rebooked.id).not.toBe(apptId); // a NEW row, not a resurrection
    expect(rebooked.queueNumber).toBe(apptQueue + 1); // cancelled number not reused
  });

  it('anonymous → 401; staff → 403; unknown id → 404', async () => {
    const anonymous = await readResponse(
      await cancelAppointment(
        postRequest(`${API}/api/appointments/whatever/cancel`, {}),
        routeContext({ id: 'whatever' }),
      ),
    );
    expect(anonymous.status).toBe(401);

    const doctorToken = await createDoctorFixture({ phone: '9822000002' });
    const asDoctor = await readResponse(await cancel('whatever', doctorToken.token));
    expect(asDoctor.status).toBe(403);

    const unknown = await readResponse(await cancel('no-such-appointment'));
    expect(unknown.status).toBe(404);
  });
});
