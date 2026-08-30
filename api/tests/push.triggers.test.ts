import { POST as bookingRoute } from '@/app/api/appointments/route';
import { POST as queueNextRoute } from '@/app/api/queue/next/route';
import { POST as statusRoute } from '@/app/api/appointments/[id]/status/route';
import * as pushModule from '@/lib/push';
import { db } from '@/lib/db';
import { istTodayISO, dayOfWeekIST } from '@/lib/time';
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

/**
 * The three wired push triggers (fire-and-forget AFTER commit):
 *   (a) patient booking      → "Booking confirmed, token #N"
 *   (b) POST /api/queue/next → the CONFIRMED patient now at position 3 of the
 *                              remaining waiting line → "You're 3rd in queue"
 *   (c) staff set CANCELLED  → patient notified
 *
 * notifyUser is spied (and stubbed) at the module boundary — it is exactly
 * what the routes call — so no network ever happens.
 */
describe('Push triggers wiring', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();
  let notifySpy: jest.SpyInstance;

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9837000010', name: 'Dr Triggers', fee: 500 });
    patient = await createPatientFixture({ phone: '9837000020', name: 'Trigger Patient' });
    schedule = await createScheduleFixture(doctor.doctorId, {
      dayOfWeek: dayOfWeekIST(today),
      startTime: '08:00',
      endTime: '20:00',
      avgMinutesPerPatient: 10,
    });
  });

  beforeEach(() => {
    notifySpy = jest.spyOn(pushModule, 'notifyUser').mockImplementation(() => undefined);
  });

  afterEach(() => {
    notifySpy.mockRestore();
  });

  it('(a) booking confirmed → patient gets "Booking confirmed, token #N"', async () => {
    const res = await readResponse(
      await bookingRoute(
        postRequest(`${API}/api/appointments`, { scheduleId: schedule.id, date: today }, patient.token),
      ),
    );
    expect(res.status).toBe(201);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [userId, message] = notifySpy.mock.calls[0] as [string, pushModule.PushMessage];
    expect(userId).toBe(patient.userId);
    expect(message.title).toBe('Booking confirmed');
    expect(message.body).toBe('Booking confirmed, token #1');
    expect(message.data?.type).toBe('BOOKING_CONFIRMED');
    expect(message.data?.queueNumber).toBe('1');
  });

  it('(b) queue/next notifies the 3rd remaining CONFIRMED patient only', async () => {
    // Queue state: #1 CONFIRMED (patient, from (a)) + walk-ins #2..#5 (no accounts).
    for (let qn = 2; qn <= 5; qn += 1) {
      await createAppointmentFixture(schedule.id, doctor.doctorId, {
        date: today,
        queueNumber: qn,
        status: 'CONFIRMED',
        source: 'WALK_IN',
        patientId: null,
        patientPhone: `+9198370000${qn.toString().padStart(2, '0')}`,
      });
    }
    notifySpy.mockClear();

    // Call next: #1 → CALLED. Remaining CONFIRMED: #2, #3, #4, #5.
    // 3rd in line = #4 → exactly ONE notification (a walk-in, so notifyUser
    // receives null and would skip silently — the wiring is what is asserted).
    const res = await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(res.status).toBe(200);

    const calls = notifySpy.mock.calls as Array<[string | null | undefined, pushModule.PushMessage]>;
    expect(calls).toHaveLength(1);
    const [userId, message] = calls[0];
    expect(userId).toBeNull(); // walk-in #4 — no patient account
    expect(message.body).toBe("You're 3rd in queue");
    expect(message.data?.position).toBe('3');

    // Call next again: #1 → COMPLETED, #2 → CALLED. Remaining CONFIRMED: #3,#4,#5
    // → 3rd in line is now #5 → still exactly one notification.
    notifySpy.mockClear();
    await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect((notifySpy.mock.calls[0] as [string | null, pushModule.PushMessage])[1].body).toBe("You're 3rd in queue");
  });

  it('(b) fewer than 3 remaining CONFIRMED → no position-3 notification at all', async () => {
    await db.appointment.updateMany({
      where: { scheduleId: schedule.id, date: today, queueNumber: { in: [3, 4, 5] } },
      data: { status: 'CANCELLED' },
    });
    notifySpy.mockClear();

    const res = await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(res.status).toBe(200);
    // Remaining CONFIRMED after this call: none → no 3rd-in-line push.
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('(c) staff CANCELLED → patient notified; CALLED/COMPLETED → no push', async () => {
    const appt = await db.appointment.create({
      data: {
        scheduleId: schedule.id,
        doctorId: doctor.doctorId,
        patientId: patient.userId,
        patientName: 'Trigger Patient',
        patientPhone: '+919837000020',
        date: today,
        queueNumber: 10,
        status: 'CONFIRMED',
        source: 'ONLINE',
        fee: 500,
      },
    });

    notifySpy.mockClear();
    const called = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${appt.id}/status`, { status: 'CALLED' }, doctor.token),
        routeContext({ id: appt.id }),
      ),
    );
    expect(called.status).toBe(200);
    expect(notifySpy).not.toHaveBeenCalled(); // CALLED → no push

    const completed = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${appt.id}/status`, { status: 'COMPLETED' }, doctor.token),
        routeContext({ id: appt.id }),
      ),
    );
    expect(completed.status).toBe(200);
    expect(notifySpy).not.toHaveBeenCalled(); // COMPLETED → no push

    // CANCELLED on a fresh appointment → exactly one push to the patient.
    const appt2 = await db.appointment.create({
      data: {
        scheduleId: schedule.id,
        doctorId: doctor.doctorId,
        patientId: patient.userId,
        patientName: 'Trigger Patient',
        patientPhone: '+919837000020',
        date: today,
        queueNumber: 11,
        status: 'CONFIRMED',
        source: 'ONLINE',
        fee: 500,
      },
    });
    notifySpy.mockClear();
    const cancelled = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${appt2.id}/status`, { status: 'CANCELLED' }, doctor.token),
        routeContext({ id: appt2.id }),
      ),
    );
    expect(cancelled.status).toBe(200);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [userId, message] = notifySpy.mock.calls[0] as [string, pushModule.PushMessage];
    expect(userId).toBe(patient.userId);
    expect(message.title).toBe('Appointment cancelled');
    expect(message.data?.type).toBe('APPOINTMENT_CANCELLED');
  });
});
