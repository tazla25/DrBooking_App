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
 * The wired push triggers (fire-and-forget AFTER commit):
 *   (a) patient booking      → "Booking received — token #N, awaiting clinic
 *                              confirmation" (Phase 11 B2: PENDING-aware copy;
 *                              data.type stays BOOKING_CONFIRMED — frozen)
 *   (b) POST /api/queue/next → the CONFIRMED patient now at position 3 of the
 *                              remaining waiting line → "You're 3rd in queue"
 *   (c) staff set CANCELLED  → patient notified
 *   (d) staff PENDING→CONFIRMED (Phase 11 B2) → "Appointment confirmed",
 *                              Serial #N + IST date, APPOINTMENT_CONFIRMED
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

  it('(a) booking received → patient gets "Booking received — token #N, awaiting clinic confirmation"', async () => {
    const res = await readResponse(
      await bookingRoute(
        postRequest(`${API}/api/appointments`, { scheduleId: schedule.id, date: today }, patient.token),
      ),
    );
    expect(res.status).toBe(201);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [userId, message] = notifySpy.mock.calls[0] as [string, pushModule.PushMessage];
    expect(userId).toBe(patient.userId);
    expect(message.title).toBe('Booking received');
    expect(message.body).toBe('Booking received — token #1, awaiting clinic confirmation');
    expect(message.data?.type).toBe('BOOKING_CONFIRMED');
    expect(message.data?.queueNumber).toBe('1');
  });

  it('(b) queue/next notifies the 3rd remaining CONFIRMED patient only', async () => {
    // Queue state: #1 PENDING (patient, from (a) — Phase 11: ONLINE books
    // PENDING and queue/next never auto-calls it) + walk-ins #2..#6 CONFIRMED
    // (no accounts).
    for (let qn = 2; qn <= 6; qn += 1) {
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

    // Call next: #2 → CALLED (PENDING #1 is skipped by design). Remaining
    // CONFIRMED: #3, #4, #5, #6. 3rd in line = #5 → exactly ONE notification
    // (a walk-in, so notifyUser receives null and would skip silently — the
    // wiring is what is asserted).
    const res = await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(res.status).toBe(200);

    const calls = notifySpy.mock.calls as Array<[string | null | undefined, pushModule.PushMessage]>;
    expect(calls).toHaveLength(1);
    const [userId, message] = calls[0];
    expect(userId).toBeNull(); // walk-in #5 — no patient account
    expect(message.body).toBe("You're 3rd in queue");
    expect(message.data?.position).toBe('3');

    // Call next again: #2 → COMPLETED, #3 → CALLED. Remaining CONFIRMED:
    // #4, #5, #6 → 3rd in line is now #6 → still exactly one notification.
    notifySpy.mockClear();
    await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect((notifySpy.mock.calls[0] as [string | null, pushModule.PushMessage])[1].body).toBe("You're 3rd in queue");
  });

  it('(b) fewer than 3 remaining CONFIRMED → no position-3 notification at all', async () => {
    await db.appointment.updateMany({
      where: { scheduleId: schedule.id, date: today, queueNumber: { in: [4, 5, 6] } },
      data: { status: 'CANCELLED' },
    });
    notifySpy.mockClear();

    const res = await readResponse(await queueNextRoute(postRequest(`${API}/api/queue/next`, {}, doctor.token)));
    expect(res.status).toBe(200);
    // Remaining CONFIRMED after this call: none → no 3rd-in-line push (the
    // PENDING #1 is not part of the waiting line either).
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

  it('(d) staff CONFIRM of a PENDING booking → "Appointment confirmed" with Serial + IST date', async () => {
    // The appointment created by (a) is still PENDING (Phase 11: ONLINE →
    // PENDING; (a) verified it booked). Confirm it as staff.
    const pending = await db.appointment.findFirstOrThrow({
      where: {
        scheduleId: schedule.id,
        date: today,
        patientId: patient.userId,
        status: 'PENDING',
      },
    });

    notifySpy.mockClear();
    const res = await readResponse(
      await statusRoute(
        postRequest(`${API}/api/appointments/${pending.id}/status`, { status: 'CONFIRMED' }, doctor.token),
        routeContext({ id: pending.id }),
      ),
    );
    expect(res.status).toBe(200);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [userId, message] = notifySpy.mock.calls[0] as [string, pushModule.PushMessage];
    expect(userId).toBe(patient.userId);
    expect(message.title).toBe('Appointment confirmed');
    // Body carries Serial #N AND the IST date (the route renders 'YYYY-MM-DD'
    // as 'D Mon YYYY' — mirror it here; TIME LAW: string slicing only).
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const [y, m, d] = today.split('-');
    const pretty = `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
    expect(message.body).toBe(`Serial #${pending.queueNumber} confirmed for ${pretty}`);
    expect(message.data?.type).toBe('APPOINTMENT_CONFIRMED');
    expect(message.data?.appointmentId).toBe(pending.id);
    expect(message.data?.queueNumber).toBe(String(pending.queueNumber));
  });
});
