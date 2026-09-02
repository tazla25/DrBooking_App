import { GET as summaryRoute } from '@/app/api/analytics/summary/route';
import { GET as revenueRoute } from '@/app/api/analytics/revenue/route';
import { db } from '@/lib/db';
import { addDaysISO, istTodayISO } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
  createAdminFixture,
} from './helpers';

describe('Analytics (#29 summary, #30 revenue)', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounder: Awaited<ReturnType<typeof createCompounderFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let scheduleA: { id: string; doctorId: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9833000010', name: 'Dr Analytics A', fee: 500 });
    doctorB = await createDoctorFixture({ phone: '9833000011', name: 'Dr Analytics B', fee: 700 });
    compounder = await createCompounderFixture({ phone: '9833000012', doctorId: doctorA.doctorId });
    patient = await createPatientFixture({ phone: '9833000013' });
    admin = await createAdminFixture({ phone: '9833000001' });
    scheduleA = await createScheduleFixture(doctorA.doctorId);

    const yesterday = addDaysISO(today, -1);
    const in7 = addDaysISO(today, -6); // last7d boundary (inclusive)
    const out7 = addDaysISO(today, -7); // outside last7d, inside last30d
    const in30 = addDaysISO(today, -29); // last30d boundary (inclusive)
    const out30 = addDaysISO(today, -30); // outside last30d
    const future = addDaysISO(today, 1);

    // TODAY — mixed statuses and sources.
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 2, status: 'COMPLETED', source: 'WALK_IN', fee: 300 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 3, status: 'CANCELLED', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 4, status: 'NO_SHOW', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 5, status: 'CONFIRMED', source: 'WALK_IN', fee: 300 });

    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: yesterday, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: in7, queueNumber: 1, status: 'COMPLETED', source: 'WALK_IN', fee: 300 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: out7, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: in30, queueNumber: 1, status: 'CANCELLED', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: out30, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 999 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: future, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 999 });

    // Another doctor's data — must never leak into doctor A's analytics.
    const scheduleB = await createScheduleFixture(doctorB.doctorId);
    await createAppointmentFixture(scheduleB.id, doctorB.doctorId, { date: today, queueNumber: 1, status: 'COMPLETED', source: 'ONLINE', fee: 700 });
  });

  function summary(token: string, qs = '') {
    return summaryRoute(getRequest(`${API}/api/analytics/summary${qs}`, token));
  }
  function revenue(token: string, qs = '') {
    return revenueRoute(getRequest(`${API}/api/analytics/revenue${qs}`, token));
  }

  it('access control: PATIENT and COMPOUNDER 403, unauthenticated 401', async () => {
    expect((await readResponse(await summaryRoute(getRequest(`${API}/api/analytics/summary`)))).status).toBe(401);
    expect((await readResponse(await summary(patient.token))).status).toBe(403);
    expect((await readResponse(await summary(compounder.token))).status).toBe(403);
    expect((await readResponse(await revenue(patient.token))).status).toBe(403);
    expect((await readResponse(await revenue(compounder.token))).status).toBe(403);
  });

  it('summary: TODAY counts (booked/pending/completed/cancelled/noShow/walkIns/revenue)', async () => {
    const body = await readResponse(await summary(doctorA.token));
    expect(body.status).toBe(200);
    const data = body.data as {
      doctorId: string;
      today: { booked: number; pending: number; completed: number; cancelled: number; noShow: number; walkIns: number; revenue: number };
    };
    expect(data.doctorId).toBe(doctorA.doctorId);
    expect(data.today).toEqual({ booked: 5, pending: 0, completed: 2, cancelled: 1, noShow: 1, walkIns: 2, revenue: 800 });
  });

  it('summary: last7d and last30d totals with exact IST day boundaries', async () => {
    const body = await readResponse(await summary(doctorA.token));
    const data = body.data as {
      last7d: { booked: number; pending: number; completed: number; cancelled: number; noShow: number; walkIns: number; revenue: number };
      last30d: { booked: number; pending: number; completed: number; cancelled: number; noShow: number; walkIns: number; revenue: number };
    };
    // today(5) + yesterday(1) + today-6(1): boundary day today-6 IS in, today-7 is OUT.
    expect(data.last7d).toEqual({ booked: 7, pending: 0, completed: 4, cancelled: 1, noShow: 1, walkIns: 3, revenue: 1600 });
    // adds today-7 (completed 500) and today-29 (cancelled): today-30 and future are OUT.
    expect(data.last30d).toEqual({ booked: 9, pending: 0, completed: 5, cancelled: 2, noShow: 1, walkIns: 3, revenue: 2100 });
  });

  it('summary: PENDING counts as pending only — never completed, never revenue (Phase 11 B2)', async () => {
    // Two pending bookings TODAY for doctor A.
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 6, status: 'PENDING', source: 'ONLINE', fee: 500 });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, { date: today, queueNumber: 7, status: 'PENDING', source: 'ONLINE', fee: 500 });

    const body = await readResponse(await summary(doctorA.token));
    expect(body.status).toBe(200);
    const data = body.data as {
      today: { booked: number; pending: number; completed: number; cancelled: number; noShow: number; walkIns: number; revenue: number };
      last7d: { booked: number; pending: number; revenue: number };
    };
    // booked grew by 2 (rows exist), pending = 2, completed/revenue UNCHANGED.
    expect(data.today).toEqual({ booked: 7, pending: 2, completed: 2, cancelled: 1, noShow: 1, walkIns: 2, revenue: 800 });
    expect(data.last7d.pending).toBe(2);
    expect(data.last7d.revenue).toBe(1600); // untouched by PENDING rows

    // Cleanup so later revenue-series fixtures stay honest.
    await db.appointment.deleteMany({ where: { scheduleId: scheduleA.id, date: today, queueNumber: { in: [6, 7] } } });
  });

  it('summary: strictly scoped to the doctor (other doctor invisible)', async () => {
    const body = await readResponse(await summary(doctorB.token));
    const data = body.data as { today: { booked: number; revenue: number } };
    expect(data.today.booked).toBe(1);
    expect(data.today.revenue).toBe(700);
  });

  it('summary: SUPER_ADMIN must target ?doctorId= (422 without, 422 unknown, 200 valid)', async () => {
    const noTarget = await readResponse(await summary(admin.token));
    expect(noTarget.status).toBe(422);
    expect(noTarget.error?.code).toBe('VALIDATION_ERROR');

    const badTarget = await readResponse(await summary(admin.token, '?doctorId=not-a-profile-id'));
    expect(badTarget.status).toBe(422);

    const targeted = await readResponse(await summary(admin.token, `?doctorId=${doctorA.doctorId}`));
    expect(targeted.status).toBe(200);
    const data = targeted.data as { today: { booked: number } };
    expect(data.today.booked).toBe(5);
  });

  it('revenue series: ?days=7 → 7 zero-filled ascending IST days', async () => {
    const body = await readResponse(await revenue(doctorA.token, '?days=7'));
    expect(body.status).toBe(200);
    const data = body.data as {
      days: number;
      series: Array<{ date: string; count: number; revenue: number }>;
    };
    expect(data.series).toHaveLength(7);
    expect(data.series[0].date).toBe(addDaysISO(today, -6));
    expect(data.series[6].date).toBe(today);
    // Ascending.
    for (let i = 1; i < data.series.length; i += 1) {
      expect(data.series[i - 1].date < data.series[i].date).toBe(true);
    }
    expect(data.series[0]).toEqual({ date: addDaysISO(today, -6), count: 1, revenue: 300 });
    expect(data.series[5]).toEqual({ date: addDaysISO(today, -1), count: 1, revenue: 500 });
    expect(data.series[6]).toEqual({ date: today, count: 2, revenue: 800 });
    // Zero-filled middle days.
    for (const day of data.series.slice(1, 5)) {
      expect(day.count).toBe(0);
      expect(day.revenue).toBe(0);
    }
  });

  it('revenue series: default days=30 counts only COMPLETED inside the window', async () => {
    const body = await readResponse(await revenue(doctorA.token));
    const data = body.data as { days: number; series: Array<{ count: number; revenue: number }> };
    expect(data.days).toBe(30);
    expect(data.series).toHaveLength(30);
    const totals = data.series.reduce((acc, d) => ({ count: acc.count + d.count, revenue: acc.revenue + d.revenue }), { count: 0, revenue: 0 });
    // COMPLETED only: today 2, yesterday 1, today-6 1, today-7 1 (today-30 excluded).
    expect(totals).toEqual({ count: 5, revenue: 2100 });
  });

  it('revenue series: ?days=1 → only today', async () => {
    const body = await readResponse(await revenue(doctorA.token, '?days=1'));
    const data = body.data as { series: Array<{ date: string; count: number; revenue: number }> };
    expect(data.series).toEqual([{ date: today, count: 2, revenue: 800 }]);
  });

  it('revenue: SUPER_ADMIN targeting + validation of days', async () => {
    const noTarget = await readResponse(await revenue(admin.token));
    expect(noTarget.status).toBe(422);

    const targeted = await readResponse(await revenue(admin.token, `?doctorId=${doctorA.doctorId}&days=7`));
    expect(targeted.status).toBe(200);

    const badDays = await readResponse(await revenue(doctorA.token, '?days=0'));
    expect(badDays.status).toBe(422);
    const badDays2 = await readResponse(await revenue(doctorA.token, '?days=366'));
    expect(badDays2.status).toBe(422);
  });
});
