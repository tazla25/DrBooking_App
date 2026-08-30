import { POST as walkInRoute } from '@/app/api/appointments/walk-in/route';
import { db } from '@/lib/db';
import { dayOfWeekIST, istTodayISO, addDaysISO } from '@/lib/time';
import {
  postRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createScheduleFixture,
} from './helpers';

/** Next date (≥ today) whose weekday differs from `date`'s. */
function nextDateWithDifferentWeekday(date: string): string {
  let d = addDaysISO(date, 1);
  while (dayOfWeekIST(d) === dayOfWeekIST(date)) d = addDaysISO(d, 1);
  return d;
}

describe('POST /api/appointments/walk-in', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  let scheduleA: { id: string };
  let scheduleB: { id: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000021', name: 'Dr Walkin', fee: 500 });
    doctorB = await createDoctorFixture({ phone: '9810000022', fee: 700 });
    compounderA = await createCompounderFixture({ phone: '9810000023', doctorId: doctorA.doctorId });
    scheduleA = await createScheduleFixture(doctorA.doctorId, { avgMinutesPerPatient: 15 });
    scheduleB = await createScheduleFixture(doctorB.doctorId);
  });

  function walkIn(body: Record<string, unknown>, token: string) {
    return walkInRoute(postRequest(`${API}/api/appointments/walk-in`, body, token));
  }

  it('books a walk-in: 201, CONFIRMED, source WALK_IN, fee from doctor profile, normalized phone', async () => {
    const body = await readResponse(
      await walkIn(
        {
          scheduleId: scheduleA.id,
          date: today,
          patientName: 'Ravi Kumar',
          patientPhone: '9812345001',
          notes: 'Walk-in fever',
        },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(201);
    expect(body.ok).toBe(true);

    const appt = body.data as {
      appointment: {
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
        notes: string | null;
      };
    };

    expect(appt.appointment.queueNumber).toBe(1);
    expect(appt.appointment.status).toBe('CONFIRMED');
    expect(appt.appointment.source).toBe('WALK_IN');
    expect(appt.appointment.fee).toBe(500); // default from DoctorProfile
    expect(appt.appointment.patientPhone).toBe('+919812345001');
    expect(appt.appointment.doctorId).toBe(doctorA.doctorId); // trusted, from schedule
    expect(appt.appointment.notes).toBe('Walk-in fever');

    const audit = await db.auditLog.findFirst({ where: { action: 'WALK_IN_CREATED' } });
    expect(audit).not.toBeNull();
  });

  it('compounder can book on behalf of the delegated doctor; queueNumber increments', async () => {
    const body = await readResponse(
      await walkIn(
        {
          scheduleId: scheduleA.id,
          date: today,
          patientName: 'Second Person',
          patientPhone: '9812345002',
        },
        compounderA.token,
      ),
    );
    expect(body.status).toBe(201);
    expect((body.data as { appointment: { queueNumber: number } }).appointment.queueNumber).toBe(2);
  });

  it('honors an explicit fee override', async () => {
    const body = await readResponse(
      await walkIn(
        {
          scheduleId: scheduleA.id,
          date: today,
          patientName: 'Fee Override',
          patientPhone: '9812345003',
          fee: 250,
        },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(201);
    expect((body.data as { appointment: { fee: number } }).appointment.fee).toBe(250);
  });

  it('rejects a duplicate patient (same phone + schedule + date) with 409 ALREADY_IN_QUEUE', async () => {
    const body = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: today, patientName: 'Ravi Kumar', patientPhone: '9812345001' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('ALREADY_IN_QUEUE');
  });

  it('allows re-booking after the earlier visit was CANCELLED (guard matches reality)', async () => {
    const first = await db.appointment.findFirst({
      where: { patientPhone: '+919812345003' },
    });
    await db.appointment.update({ where: { id: first!.id }, data: { status: 'CANCELLED' } });

    const body = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: today, patientName: 'Fee Override', patientPhone: '9812345003' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(201);
  });

  it('rejects walk-ins on a CLOSED override date with 409 SCHEDULE_CLOSED', async () => {
    const futureDate = addDaysISO(today, 7); // same weekday next week
    await db.scheduleOverride.create({
      data: { scheduleId: scheduleA.id, date: futureDate, type: 'CLOSED', reason: 'Festival' },
    });
    const body = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: futureDate, patientName: 'Closed Day', patientPhone: '9812345004' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('SCHEDULE_CLOSED');
  });

  it('rejects a date whose weekday does not match the schedule (422)', async () => {
    const wrongDay = nextDateWithDifferentWeekday(today);
    const body = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: wrongDay, patientName: 'Wrong Day', patientPhone: '9812345005' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(422);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a past date (422) and a malformed date (422)', async () => {
    const past = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: addDaysISO(today, -1), patientName: 'Yesterday', patientPhone: '9812345006' },
        doctorA.token,
      ),
    );
    expect(past.status).toBe(422);

    const malformed = await readResponse(
      await walkIn(
        { scheduleId: scheduleA.id, date: '2026-13-40', patientName: 'Bad Date', patientPhone: '9812345007' },
        doctorA.token,
      ),
    );
    expect(malformed.status).toBe(422);
  });

  it('hides another doctor schedule behind 404 (scoping law: never 403)', async () => {
    const body = await readResponse(
      await walkIn(
        { scheduleId: scheduleB.id, date: today, patientName: 'Foreign Schedule', patientPhone: '9812345008' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('rejects an inactive (soft-deleted) schedule with 409', async () => {
    const inactive = await createScheduleFixture(doctorA.doctorId, { isActive: false });
    const body = await readResponse(
      await walkIn(
        { scheduleId: inactive.id, date: today, patientName: 'Inactive Schedule', patientPhone: '9812345009' },
        doctorA.token,
      ),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('SCHEDULE_INACTIVE');
  });

  it('two parallel walk-ins get distinct queue numbers and both succeed (P2002 retry)', async () => {
    const [res1, res2] = await Promise.all([
      walkIn({ scheduleId: scheduleA.id, date: today, patientName: 'Parallel One', patientPhone: '9812345011' }, doctorA.token),
      walkIn({ scheduleId: scheduleA.id, date: today, patientName: 'Parallel Two', patientPhone: '9812345012' }, doctorA.token),
    ]);
    const body1 = await readResponse(res1);
    const body2 = await readResponse(res2);
    expect(body1.status).toBe(201);
    expect(body2.status).toBe(201);
    const q1 = (body1.data as { appointment: { queueNumber: number } }).appointment.queueNumber;
    const q2 = (body2.data as { appointment: { queueNumber: number } }).appointment.queueNumber;
    expect(new Set([q1, q2]).size).toBe(2); // distinct queue numbers
  });

  it('validates the body (422): short name, bad phone, non-integer fee', async () => {
    const badName = await readResponse(
      await walkIn({ scheduleId: scheduleA.id, date: today, patientName: 'A', patientPhone: '9812345013' }, doctorA.token),
    );
    expect(badName.status).toBe(422);

    const badPhone = await readResponse(
      await walkIn({ scheduleId: scheduleA.id, date: today, patientName: 'Bad Phone', patientPhone: '12345' }, doctorA.token),
    );
    expect(badPhone.status).toBe(422);

    const badFee = await readResponse(
      await walkIn({ scheduleId: scheduleA.id, date: today, patientName: 'Bad Fee', patientPhone: '9812345014', fee: 12.5 }, doctorA.token),
    );
    expect(badFee.status).toBe(422);
  });
});
