import { GET as patientsRoute } from '@/app/api/patients/route';
import { istTodayISO, addDaysISO } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createCompounderFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

interface PatientRow {
  name: string;
  phone: string;
  lastVisit: string;
  totalVisits: number;
  lastStatus: string;
}

describe('GET /api/patients (#21)', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let doctorB: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000061', name: 'Dr Patients' });
    doctorB = await createDoctorFixture({ phone: '9810000062' });
    compounderA = await createCompounderFixture({ phone: '9810000063', doctorId: doctorA.doctorId });
    const scheduleA = await createScheduleFixture(doctorA.doctorId);
    const scheduleB = await createScheduleFixture(doctorB.doctorId);

    // P1 — three visits, one cancelled (totalVisits should be 2).
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      date: addDaysISO(today, -14),
      queueNumber: 1,
      patientName: 'Asha Rani',
      patientPhone: '9815550001',
      status: 'COMPLETED',
    });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      date: addDaysISO(today, -7),
      queueNumber: 2,
      patientName: 'Asha Rani',
      patientPhone: '9815550001',
      status: 'CANCELLED',
    });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      date: today,
      queueNumber: 3,
      patientName: 'Asha Rani',
      patientPhone: '9815550001',
      status: 'CONFIRMED',
    });

    // P2 — two visits, latest one carries a NEW name; latest status COMPLETED.
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      date: addDaysISO(today, -3),
      queueNumber: 4,
      patientName: 'Bimal Old Name',
      patientPhone: '9815550002',
      status: 'COMPLETED',
    });
    await createAppointmentFixture(scheduleA.id, doctorA.doctorId, {
      date: today,
      queueNumber: 5,
      patientName: 'Bimal New Name',
      patientPhone: '9815550002',
      status: 'COMPLETED',
    });

    // P3 — doctor B's patient: must never appear for doctor A.
    await createAppointmentFixture(scheduleB.id, doctorB.doctorId, {
      date: today,
      queueNumber: 1,
      patientName: 'Chandra Foreign',
      patientPhone: '9815550003',
      status: 'CONFIRMED',
    });
  });

  it('returns DISTINCT patients of the scoped doctor with correct aggregates', async () => {
    const body = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients`, doctorA.token)),
    );
    expect(body.status).toBe(200);

    const data = body.data as { total: number; page: number; pageSize: number; patients: PatientRow[] };
    expect(data.total).toBe(2); // P1 + P2, NOT P3
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.patients).toHaveLength(2);

    const p1 = data.patients.find((p) => p.phone === '+919815550001')!;
    expect(p1.name).toBe('Asha Rani');
    expect(p1.totalVisits).toBe(2); // cancelled visit excluded
    expect(p1.lastVisit).toBe(today);
    expect(p1.lastStatus).toBe('CONFIRMED');

    const p2 = data.patients.find((p) => p.phone === '+919815550002')!;
    expect(p2.name).toBe('Bimal New Name'); // latest name kept
    expect(p2.totalVisits).toBe(2);
    expect(p2.lastStatus).toBe('COMPLETED');
  });

  it('the compounder of doctor A sees exactly the same scoped patient list', async () => {
    const body = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients`, compounderA.token)),
    );
    const data = body.data as { total: number; patients: PatientRow[] };
    expect(data.total).toBe(2);
  });

  it('doctor B sees only their own patients', async () => {
    const body = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients`, doctorB.token)),
    );
    const data = body.data as { total: number; patients: PatientRow[] };
    expect(data.total).toBe(1);
    expect(data.patients[0].phone).toBe('+919815550003');
  });

  it('?q= searches name and phone (contains, case-insensitive)', async () => {
    const byName = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?q=ASHA`, doctorA.token)),
    );
    const nameData = byName.data as { total: number; patients: PatientRow[] };
    expect(nameData.total).toBe(1);
    expect(nameData.patients[0].phone).toBe('+919815550001');

    const byPhone = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?q=5550002`, doctorA.token)),
    );
    expect((byPhone.data as { total: number }).total).toBe(1);

    const none = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?q=zzz-no-match`, doctorA.token)),
    );
    expect((none.data as { total: number }).total).toBe(0);
    expect((none.data as { patients: unknown[] }).patients).toHaveLength(0);
  });

  it('paginates for real: total + page slicing (v1 pagination was broken)', async () => {
    const page1 = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?page=1&pageSize=1`, doctorA.token)),
    );
    const d1 = page1.data as { total: number; page: number; pageSize: number; patients: PatientRow[] };
    expect(d1.total).toBe(2);
    expect(d1.page).toBe(1);
    expect(d1.patients).toHaveLength(1);

    const page2 = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?page=2&pageSize=1`, doctorA.token)),
    );
    const d2 = page2.data as { total: number; page: number; patients: PatientRow[] };
    expect(d2.page).toBe(2);
    expect(d2.patients).toHaveLength(1);
    expect(d1.patients[0].phone).not.toBe(d2.patients[0].phone); // disjoint pages

    const beyond = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients?page=3&pageSize=1`, doctorA.token)),
    );
    expect((beyond.data as { patients: unknown[] }).patients).toHaveLength(0);
    expect((beyond.data as { total: number }).total).toBe(2); // total still accurate
  });

  it('validates query params (422): page=0, pageSize=101, non-numeric', async () => {
    for (const qs of ['page=0', 'pageSize=101', 'page=abc']) {
      const body = await readResponse(
        await patientsRoute(getRequest(`${API}/api/patients?${qs}`, doctorA.token)),
      );
      expect(body.status).toBe(422);
    }
  });

  it('sorts by most recent visit first', async () => {
    const body = await readResponse(
      await patientsRoute(getRequest(`${API}/api/patients`, doctorA.token)),
    );
    const patients = (body.data as { patients: PatientRow[] }).patients;
    expect(patients[0].lastVisit).toBe(today);
  });
});
