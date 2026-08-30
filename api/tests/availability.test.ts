import { GET as getAvailability } from '@/app/api/schedules/[id]/availability/route';
import { db } from '@/lib/db';
import { istTodayISO, addDaysISO, dayOfWeekIST } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createScheduleFixture,
  createAppointmentFixture,
  routeContext,
} from './helpers';

/** The next date (>= today) whose weekday differs from today's. */
function nextDateWithDifferentWeekday(): string {
  let d = addDaysISO(istTodayISO(), 1);
  while (dayOfWeekIST(d) === dayOfWeekIST(istTodayISO())) d = addDaysISO(d, 1);
  return d;
}

interface AvailabilityView {
  open: boolean;
  reason?: string;
  date?: string;
  nextQueue?: number;
  estWaitMin?: number;
  capacityLeft?: number;
  avgMinutesPerPatient?: number;
  schedule?: { id: string; startTime: string; endTime: string };
}

describe('GET /api/schedules/:id/availability (public, #7)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9825000001', name: 'Dr Availability', fee: 250 });
  });

  function availability(scheduleId: string, query = '') {
    return getAvailability(
      getRequest(`${API}/api/schedules/${scheduleId}/availability${query}`),
      routeContext({ id: scheduleId }),
    );
  }

  it('open day: capacity math, nextQueue, estWaitMin, capacityLeft', async () => {
    // 09:00–13:00 (240 min) / 10 → capacity 24.
    const schedule = await createScheduleFixture(doctor.doctorId, { avgMinutesPerPatient: 10 });

    // queue 1 CONFIRMED, queue 2 CANCELLED (cancelled does NOT count as taken).
    await createAppointmentFixture(schedule.id, doctor.doctorId, { date: today, queueNumber: 1, status: 'CONFIRMED' });
    await createAppointmentFixture(schedule.id, doctor.doctorId, { date: today, queueNumber: 2, status: 'CANCELLED' });

    const body = await readResponse(await availability(schedule.id));
    expect(body.status).toBe(200);
    const data = body.data as AvailabilityView;

    expect(data.open).toBe(true);
    expect(data.date).toBe(today); // default date = IST today
    expect(data.capacityLeft).toBe(23); // 24 − 1 (cancelled excluded)
    expect(data.estWaitMin).toBe(10); // one active appointment × 10
    expect(data.nextQueue).toBe(3); // cancelled number 2 stays taken
    expect(data.avgMinutesPerPatient).toBe(10);
    expect(data.schedule?.startTime).toBe('09:00');
  });

  it('capacityLeft = 0 still returns open:true (booking would 409)', async () => {
    // 09:00–09:10 (10 min) / 10 → capacity 1.
    const tiny = await createScheduleFixture(doctor.doctorId, {
      startTime: '09:00',
      endTime: '09:10',
      avgMinutesPerPatient: 10,
      clinicName: 'Tiny Clinic',
    });
    await createAppointmentFixture(tiny.id, doctor.doctorId, { date: today, queueNumber: 1, status: 'CONFIRMED' });

    const body = await readResponse(await availability(tiny.id));
    const data = body.data as AvailabilityView;
    expect(data.open).toBe(true);
    expect(data.capacityLeft).toBe(0);
  });

  it('CLOSED override → { open: false, reason: SCHEDULE_CLOSED }', async () => {
    const schedule = await createScheduleFixture(doctor.doctorId, { clinicName: 'Closed Clinic' });
    const closedDate = addDaysISO(today, 7); // same weekday next week
    await db.scheduleOverride.create({
      data: { scheduleId: schedule.id, date: closedDate, type: 'CLOSED', reason: 'Festival' },
    });

    const body = await readResponse(await availability(schedule.id, `?date=${closedDate}`));
    expect(body.status).toBe(200);
    expect(body.data).toEqual({ open: false, reason: 'SCHEDULE_CLOSED' });
  });

  it('MODIFIED_HOURS override changes the capacity math', async () => {
    // Base 09:00–13:00 / 15 → 16 slots. Override 09:00–10:30 (90 min) → 6.
    const schedule = await createScheduleFixture(doctor.doctorId, {
      avgMinutesPerPatient: 15,
      clinicName: 'Modified Clinic',
    });
    await db.scheduleOverride.create({
      data: {
        scheduleId: schedule.id,
        date: today,
        type: 'MODIFIED_HOURS',
        newStartTime: '09:00',
        newEndTime: '10:30',
      },
    });

    const body = await readResponse(await availability(schedule.id, `?date=${today}`));
    const data = body.data as AvailabilityView;
    expect(data.open).toBe(true);
    expect(data.capacityLeft).toBe(6); // floor(90/15)
  });

  it('weekday mismatch → { open: false, reason: NOT_SCHEDULED_DAY }', async () => {
    const schedule = await createScheduleFixture(doctor.doctorId, { clinicName: 'Mismatch Clinic' });
    const wrongDay = nextDateWithDifferentWeekday();

    const body = await readResponse(await availability(schedule.id, `?date=${wrongDay}`));
    expect(body.status).toBe(200);
    expect(body.data).toEqual({ open: false, reason: 'NOT_SCHEDULED_DAY' });
  });

  it('past date → 422; malformed date → 422; bad query values → 422', async () => {
    const schedule = await createScheduleFixture(doctor.doctorId, { clinicName: 'Query Clinic' });

    const past = await readResponse(await availability(schedule.id, `?date=${addDaysISO(today, -1)}`));
    expect(past.status).toBe(422);
    expect(past.error?.code).toBe('VALIDATION_ERROR');

    const malformed = await readResponse(await availability(schedule.id, '?date=2026-13-40'));
    expect(malformed.status).toBe(422);
  });

  it('unknown / inactive / unverified-doctor schedules → 404', async () => {
    const unknown = await readResponse(await availability('no-such-schedule'));
    expect(unknown.status).toBe(404);

    const inactive = await createScheduleFixture(doctor.doctorId, { isActive: false, clinicName: 'Inactive Clinic' });
    expect((await readResponse(await availability(inactive.id))).status).toBe(404);

    const pending = await createDoctorFixture({ phone: '9825000091', verificationStatus: 'PENDING' });
    const pendingSchedule = await createScheduleFixture(pending.doctorId, { clinicName: 'Pending Clinic' });
    const pendingView = await readResponse(await availability(pendingSchedule.id));
    expect(pendingView.status).toBe(404);
    expect(pendingView.error?.code).toBe('NOT_FOUND'); // pending doctors stay invisible
  });
});
