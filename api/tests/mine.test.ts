import { GET as getMine } from '@/app/api/appointments/mine/route';
import { istTodayISO, addDaysISO, dayOfWeekIST } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

interface MineItem {
  id: string;
  date: string;
  queueNumber: number;
  status: string;
  source: string;
  fee: number | null;
  estWaitMin?: number;
  doctor: { id: string; fullName: string; specialization: string | null };
  schedule: { clinicName: string; clinicAddress: string; startTime: string; endTime: string };
}

/** The next date (≥ today) that matches `dayOfWeek` (today itself if it does). */
function nextDateWithWeekday(dayOfWeek: number): string {
  let d = istTodayISO();
  while (dayOfWeekIST(d) !== dayOfWeek) d = addDaysISO(d, 1);
  return d;
}

describe('GET /api/appointments/mine (#9)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let otherPatient: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();
  const yesterday = addDaysISO(today, -1);

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({
      phone: '9821000001',
      name: 'Dr Mine',
      fee: 350,
    });
    patient = await createPatientFixture({ phone: '9821000010', name: 'Mine Patient' });
    otherPatient = await createPatientFixture({ phone: '9821000011', name: 'Other Patient' });
    schedule = await createScheduleFixture(doctor.doctorId, { avgMinutesPerPatient: 15 });
    const otherSchedule = await createScheduleFixture(doctor.doctorId, {
      clinicName: 'Other Clinic',
      dayOfWeek: (dayOfWeekIST(today) + 1) % 7,
    });

    // -- upcoming bucket: CONFIRMED / CALLED with date >= today
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'CONFIRMED',
      patientId: otherPatient.userId, // someone else's — must NOT appear
      patientName: 'Other Person',
      patientPhone: '+919821000011',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 2,
      status: 'CONFIRMED',
      patientId: patient.userId,
      patientName: 'Mine Patient',
      patientPhone: '+919821000010',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 3,
      status: 'CALLED',
      patientId: patient.userId,
      patientName: 'Mine Patient',
      patientPhone: '+919821000010',
    });

    // -- past bucket: terminal statuses, or any status on a past date
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 4,
      status: 'COMPLETED',
      patientId: patient.userId,
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 5,
      status: 'CANCELLED',
      patientId: patient.userId,
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 6,
      status: 'NO_SHOW',
      patientId: patient.userId,
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: yesterday,
      queueNumber: 7,
      status: 'CONFIRMED', // stale future-never-visited → past by date
      patientId: patient.userId,
    });
    await createAppointmentFixture(otherSchedule.id, doctor.doctorId, {
      date: nextDateWithWeekday(otherSchedule.dayOfWeek),
      queueNumber: 1,
      status: 'CONFIRMED',
      patientId: patient.userId,
      patientName: 'Mine Patient',
      patientPhone: '+919821000010',
    });
  });

  function mine(query = '', token = patient.token) {
    return getMine(getRequest(`${API}/api/appointments/mine${query}`, token));
  }

  it('upcoming (default): only CONFIRMED/CALLED from today onward, queue order, estWaitMin', async () => {
    const body = await readResponse(await mine());
    expect(body.status).toBe(200);

    const data = body.data as { total: number; appointments: MineItem[] };
    expect(data.total).toBe(3); // queue 2, queue 3 today + future other-schedule booking
    expect(data.appointments.every((a) => a.estWaitMin !== undefined)).toBe(true);

    // Same-date items ordered by queueNumber asc.
    const todayItems = data.appointments.filter((a) => a.date === today);
    expect(todayItems.map((a) => a.queueNumber)).toEqual([2, 3]);

    // estWaitMin per the formula: active appointments with a lower queue number.
    const q2 = todayItems.find((a) => a.queueNumber === 2)!;
    const q3 = todayItems.find((a) => a.queueNumber === 3)!;
    expect(q2.estWaitMin).toBe(15); // queue 1 active ahead
    expect(q3.estWaitMin).toBe(30); // queues 1 and 2 active ahead

    expect(q2.doctor.fullName).toBe('Dr Mine');
    expect(q2.schedule.clinicName).toBe('City Clinic');
    expect(q2.fee).toBe(null);
  });

  it('past: terminal statuses OR past dates, newest first, no estWaitMin', async () => {
    const body = await readResponse(await mine('?range=past'));
    expect(body.status).toBe(200);

    const data = body.data as { total: number; appointments: MineItem[] };
    expect(data.total).toBe(4); // COMPLETED, CANCELLED, NO_SHOW + yesterday CONFIRMED
    expect(data.appointments.every((a) => a.estWaitMin === undefined)).toBe(true);

    const dates = data.appointments.map((a) => a.date);
    expect(dates[0]).toBe(today); // date desc → yesterday last
    expect(dates[dates.length - 1]).toBe(yesterday);

    const statuses = new Set(data.appointments.filter((a) => a.date === today).map((a) => a.status));
    expect(statuses).toEqual(new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW']));
  });

  it("shows only the caller's appointments (no cross-patient leakage)", async () => {
    const body = await readResponse(await mine('', otherPatient.token));
    const data = body.data as { total: number; appointments: MineItem[] };
    expect(data.total).toBe(1); // only their queue-1 booking
    expect(data.appointments[0].queueNumber).toBe(1);
  });

  it('paginates and validates the query', async () => {
    const page = await readResponse(await mine('?page=1&pageSize=2'));
    const pageData = page.data as { total: number; page: number; pageSize: number; appointments: MineItem[] };
    expect(pageData.appointments.length).toBe(2);
    expect(pageData.total).toBe(3);

    const badRange = await readResponse(await mine('?range=someday'));
    expect(badRange.status).toBe(422);

    const anonymous = await readResponse(await getMine(getRequest(`${API}/api/appointments/mine`)));
    expect(anonymous.status).toBe(401);

    // Staff tokens are rejected: mine is a PATIENT route.
    const doctorToken = await createDoctorFixture({ phone: '9821000002' });
    const asDoctor = await readResponse(await mine('', doctorToken.token));
    expect(asDoctor.status).toBe(403);
  });
});
