import { GET as schedulesListRoute, POST as schedulesCreateRoute } from '@/app/api/schedules/route';
import { PUT as scheduleUpdateRoute, DELETE as scheduleDeleteRoute } from '@/app/api/schedules/[id]/route';
import {
  GET as overridesListRoute,
  POST as overrideCreateRoute,
} from '@/app/api/schedules/[id]/overrides/route';
import { DELETE as overrideDeleteRoute } from '@/app/api/schedules/[id]/overrides/[date]/route';
import { db } from '@/lib/db';
import { istTodayISO, addDaysISO } from '@/lib/time';
import {
  postRequest,
  getRequest,
  putRequest,
  deleteRequest,
  readResponse,
  resetDb,
  API,
  routeContext,
  createDoctorFixture,
  createCompounderFixture,
  createAdminFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

const today = istTodayISO();

interface ScheduleRow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  clinicName: string;
  clinicAddress: string;
  avgMinutesPerPatient: number;
  isActive: boolean;
  doctor: { id: string; fullName: string };
  todayOverride: { type: string } | null;
  todayQueueCount: number;
}

const VALID_SCHEDULE = {
  dayOfWeek: 1,
  startTime: '10:00',
  endTime: '14:00',
  clinicName: 'Sunrise Clinic',
  clinicAddress: '45 Lake View Road',
  avgMinutesPerPatient: 15,
};

describe('Schedules CRUD (#19)', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000041', name: 'Dr Sched' });
    doctorB = await createDoctorFixture({ phone: '9810000042' });
    compounderA = await createCompounderFixture({ phone: '9810000043', doctorId: doctorA.doctorId });
    admin = await createAdminFixture({ phone: '9810000044' });
  });

  it('POST creates a schedule (201) and audits SCHEDULE_CHANGED', async () => {
    const body = await readResponse(
      await schedulesCreateRoute(
        postRequest(`${API}/api/schedules`, VALID_SCHEDULE, doctorA.token),
      ),
    );
    expect(body.status).toBe(201);
    const schedule = (body.data as { schedule: { id: string; clinicName: string; dayOfWeek: number; avgMinutesPerPatient: number } }).schedule;
    expect(schedule.clinicName).toBe('Sunrise Clinic');
    expect(schedule.dayOfWeek).toBe(1);
    expect(schedule.avgMinutesPerPatient).toBe(15);

    const audit = await db.auditLog.findFirst({
      where: { action: 'SCHEDULE_CHANGED', target: `schedule:${schedule.id}` },
    });
    expect(audit).not.toBeNull();
  });

  it('POST validates everything (422): dayOfWeek, times, ordering, minutes, clinic fields', async () => {
    const cases: Array<Record<string, unknown>> = [
      { ...VALID_SCHEDULE, dayOfWeek: 7 },
      { ...VALID_SCHEDULE, dayOfWeek: -1 },
      { ...VALID_SCHEDULE, startTime: '25:00' },
      { ...VALID_SCHEDULE, endTime: '9:00' },
      { ...VALID_SCHEDULE, startTime: '14:00', endTime: '10:00' }, // start >= end
      { ...VALID_SCHEDULE, startTime: '12:00', endTime: '12:00' }, // equal
      { ...VALID_SCHEDULE, avgMinutesPerPatient: 0 },
      { ...VALID_SCHEDULE, avgMinutesPerPatient: 121 },
      { ...VALID_SCHEDULE, avgMinutesPerPatient: 10.5 },
      { ...VALID_SCHEDULE, clinicName: '  ' },
      { ...VALID_SCHEDULE, clinicAddress: '' },
      { startTime: '10:00', endTime: '12:00', clinicName: 'X', clinicAddress: 'Y' }, // no dayOfWeek
    ];
    for (const payload of cases) {
      const body = await readResponse(
        await schedulesCreateRoute(postRequest(`${API}/api/schedules`, payload, doctorA.token)),
      );
      expect(body.status).toBe(422);
    }
  });

  it('compounder of A can create schedules within the delegated scope', async () => {
    const body = await readResponse(
      await schedulesCreateRoute(
        postRequest(`${API}/api/schedules`, { ...VALID_SCHEDULE, dayOfWeek: 2 }, compounderA.token),
      ),
    );
    expect(body.status).toBe(201);
    expect((body.data as { schedule: { doctorId: string } }).schedule.doctorId).toBe(doctorA.doctorId);
  });

  it('GET lists schedules incl. inactive ones, with todayOverride and todayQueueCount', async () => {
    // today-schedule with 2 CONFIRMED + 1 COMPLETED + 1 CANCELLED appointments
    const activeToday = await createScheduleFixture(doctorA.doctorId, { clinicName: 'Today Clinic' });
    await createAppointmentFixture(activeToday.id, doctorA.doctorId, { queueNumber: 1, patientPhone: '9814440001' });
    await createAppointmentFixture(activeToday.id, doctorA.doctorId, { queueNumber: 2, patientPhone: '9814440002' });
    await createAppointmentFixture(activeToday.id, doctorA.doctorId, { queueNumber: 3, patientPhone: '9814440003', status: 'COMPLETED' });
    await createAppointmentFixture(activeToday.id, doctorA.doctorId, { queueNumber: 4, patientPhone: '9814440004', status: 'CANCELLED' });
    await db.scheduleOverride.create({
      data: { scheduleId: activeToday.id, date: today, type: 'MODIFIED_HOURS', newStartTime: '16:00', newEndTime: '19:00' },
    });
    // soft-deleted schedule must still appear
    const softDeleted = await createScheduleFixture(doctorA.doctorId, { clinicName: 'Old Clinic', isActive: false });
    // doctor B schedule must NOT appear
    await createScheduleFixture(doctorB.doctorId, { clinicName: 'B Clinic' });

    const body = await readResponse(
      await schedulesListRoute(getRequest(`${API}/api/schedules`, doctorA.token)),
    );
    expect(body.status).toBe(200);
    const schedules = (body.data as { today: string; schedules: ScheduleRow[] }).schedules;
    expect(schedules.length).toBeGreaterThanOrEqual(4); // created ones incl. soft-deleted
    expect(schedules.some((s) => s.clinicName === 'B Clinic')).toBe(false);

    const todayRow = schedules.find((s) => s.clinicName === 'Today Clinic')!;
    expect(todayRow.todayQueueCount).toBe(2); // CONFIRMED only
    expect(todayRow.todayOverride?.type).toBe('MODIFIED_HOURS');
    const deletedRow = schedules.find((s) => s.clinicName === 'Old Clinic')!;
    expect(deletedRow.isActive).toBe(false);
    expect(deletedRow.id).toBe(softDeleted.id);

    // compounder sees the same scoped list
    const asCompounder = await readResponse(
      await schedulesListRoute(getRequest(`${API}/api/schedules`, compounderA.token)),
    );
    expect((asCompounder.data as { schedules: ScheduleRow[] }).schedules.length).toBe(schedules.length);
  });

  it('SUPER_ADMIN reads schedules read-only: ?doctorId= targets, absent = all doctors; writes → 403', async () => {
    const targeted = await readResponse(
      await schedulesListRoute(getRequest(`${API}/api/schedules?doctorId=${doctorA.doctorId}`, admin.token)),
    );
    expect(targeted.status).toBe(200);
    const rows = (targeted.data as { schedules: ScheduleRow[] }).schedules;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((s) => s.doctor.id === doctorA.doctorId)).toBe(true);

    const all = await readResponse(
      await schedulesListRoute(getRequest(`${API}/api/schedules`, admin.token)),
    );
    const allRows = (all.data as { schedules: ScheduleRow[] }).schedules;
    expect(allRows.some((s) => s.doctor.id === doctorA.doctorId)).toBe(true);
    expect(allRows.some((s) => s.doctor.id === doctorB.doctorId)).toBe(true);

    const write = await readResponse(
      await schedulesCreateRoute(postRequest(`${API}/api/schedules`, VALID_SCHEDULE, admin.token)),
    );
    expect(write.status).toBe(403); // SUPER_ADMIN is read-only here
  });

  it('PUT updates a schedule (same validations) and 404s for other doctors', async () => {
    const created = await readResponse(
      await schedulesCreateRoute(postRequest(`${API}/api/schedules`, { ...VALID_SCHEDULE, dayOfWeek: 3 }, doctorA.token)),
    );
    const id = (created.data as { schedule: { id: string } }).schedule.id;

    const updated = await readResponse(
      await scheduleUpdateRoute(
        putRequest(`${API}/api/schedules/${id}`, { ...VALID_SCHEDULE, dayOfWeek: 3, startTime: '11:00', endTime: '15:30', clinicName: 'Renamed' }, doctorA.token),
        routeContext({ id }),
      ),
    );
    expect(updated.status).toBe(200);
    const schedule = (updated.data as { schedule: { startTime: string; endTime: string; clinicName: string } }).schedule;
    expect(schedule.startTime).toBe('11:00');
    expect(schedule.clinicName).toBe('Renamed');

    const badOrder = await readResponse(
      await scheduleUpdateRoute(
        putRequest(`${API}/api/schedules/${id}`, { ...VALID_SCHEDULE, startTime: '18:00', endTime: '09:00' }, doctorA.token),
        routeContext({ id }),
      ),
    );
    expect(badOrder.status).toBe(422);

    const bSchedule = await createScheduleFixture(doctorB.doctorId);
    const foreign = await readResponse(
      await scheduleUpdateRoute(
        putRequest(`${API}/api/schedules/${bSchedule.id}`, VALID_SCHEDULE, doctorA.token),
        routeContext({ id: bSchedule.id }),
      ),
    );
    expect(foreign.status).toBe(404);
  });

  it('DELETE soft-deletes only: isActive=false, appointment history survives', async () => {
    const schedule = await createScheduleFixture(doctorA.doctorId, { clinicName: 'Doomed Clinic' });
    const appt = await createAppointmentFixture(schedule.id, doctorA.doctorId, { patientPhone: '9814440099' });

    const body = await readResponse(
      await scheduleDeleteRoute(deleteRequest(`${API}/api/schedules/${schedule.id}`, doctorA.token), routeContext({ id: schedule.id })),
    );
    expect(body.status).toBe(200);
    expect((body.data as { schedule: { isActive: boolean } }).schedule.isActive).toBe(false);

    const stillThere = await db.appointment.findUnique({ where: { id: appt.id } });
    expect(stillThere).not.toBeNull(); // history preserved — NEVER hard-delete

    const audit = await db.auditLog.findFirst({
      where: { action: 'SCHEDULE_CHANGED', target: `schedule:${schedule.id}`, detail: { contains: 'soft_delete' } },
    });
    expect(audit).not.toBeNull();

    // other doctor's schedule is untouchable
    const bSchedule = await createScheduleFixture(doctorB.doctorId);
    const foreign = await readResponse(
      await scheduleDeleteRoute(deleteRequest(`${API}/api/schedules/${bSchedule.id}`, doctorA.token), routeContext({ id: bSchedule.id })),
    );
    expect(foreign.status).toBe(404);
  });
});

describe('Schedule overrides (#20)', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let scheduleA: { id: string };
  const futureDate = addDaysISO(today, 14);

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000051' });
    doctorB = await createDoctorFixture({ phone: '9810000052' });
    admin = await createAdminFixture({ phone: '9810000053' });
    scheduleA = await createScheduleFixture(doctorA.doctorId);
  });

  it('POST creates a CLOSED override (201) and audits OVERRIDE_CHANGED', async () => {
    const body = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: futureDate, type: 'CLOSED', reason: 'Conference' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(body.status).toBe(201);
    const audit = await db.auditLog.findFirst({
      where: { action: 'OVERRIDE_CHANGED', target: `schedule:${scheduleA.id}` },
    });
    expect(audit).not.toBeNull();
  });

  it('one override per (scheduleId, date) → 409 OVERRIDE_EXISTS (incl. concurrent P2002)', async () => {
    const body = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: futureDate, type: 'CLOSED' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('OVERRIDE_EXISTS');
  });

  it('CLOSED must not carry times; MODIFIED_HOURS/SPECIAL require start < end', async () => {
    const withTimes = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: addDaysISO(today, 21), type: 'CLOSED', newStartTime: '10:00', newEndTime: '12:00' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(withTimes.status).toBe(422);

    const noTimes = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: addDaysISO(today, 21), type: 'MODIFIED_HOURS' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(noTimes.status).toBe(422);

    const reversed = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: addDaysISO(today, 21), type: 'SPECIAL', newStartTime: '15:00', newEndTime: '10:00' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(reversed.status).toBe(422);

    const ok = await readResponse(
      await overrideCreateRoute(
        postRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, { date: addDaysISO(today, 21), type: 'SPECIAL', newStartTime: '10:00', newEndTime: '12:00' }, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(ok.status).toBe(201);
  });

  it('GET lists the schedule overrides (calendar order); SUPER_ADMIN can read; other doctors → 404', async () => {
    const body = await readResponse(
      await overridesListRoute(
        getRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, doctorA.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(body.status).toBe(200);
    const overrides = (body.data as { overrides: { date: string; type: string }[] }).overrides;
    expect(overrides.length).toBe(2);
    expect(overrides[0].date <= overrides[1].date).toBe(true);

    const asAdmin = await readResponse(
      await overridesListRoute(
        getRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, admin.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(asAdmin.status).toBe(200);

    const foreign = await readResponse(
      await overridesListRoute(
        getRequest(`${API}/api/schedules/${scheduleA.id}/overrides`, doctorB.token),
        routeContext({ id: scheduleA.id }),
      ),
    );
    expect(foreign.status).toBe(404);
  });

  it('DELETE removes the override for a date; unknown dates → 404', async () => {
    const body = await readResponse(
      await overrideDeleteRoute(
        deleteRequest(`${API}/api/schedules/${scheduleA.id}/overrides/${futureDate}`, doctorA.token),
        routeContext({ id: scheduleA.id, date: futureDate }),
      ),
    );
    expect(body.status).toBe(200);
    expect((body.data as { deleted: boolean }).deleted).toBe(true);

    const remaining = await db.scheduleOverride.count({ where: { scheduleId: scheduleA.id } });
    expect(remaining).toBe(1);

    const again = await readResponse(
      await overrideDeleteRoute(
        deleteRequest(`${API}/api/schedules/${scheduleA.id}/overrides/${futureDate}`, doctorA.token),
        routeContext({ id: scheduleA.id, date: futureDate }),
      ),
    );
    expect(again.status).toBe(404);

    // doctor B cannot delete doctor A's override
    const other = await db.scheduleOverride.findFirst({ where: { scheduleId: scheduleA.id } });
    const foreign = await readResponse(
      await overrideDeleteRoute(
        deleteRequest(`${API}/api/schedules/${scheduleA.id}/overrides/${other!.date}`, doctorB.token),
        routeContext({ id: scheduleA.id, date: other!.date }),
      ),
    );
    expect(foreign.status).toBe(404);
  });
});
