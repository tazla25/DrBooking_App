import { GET as exportRoute } from '@/app/api/export/appointments/route';
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

/** Read a CSV response: { status, headers, text, lines } (BOM stripped). */
async function readCsv(res: Response): Promise<{
  status: number;
  headers: Record<string, string>;
  lines: string[];
  text: string;
}> {
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    status: res.status,
    headers,
    text,
    lines: text.replace(/^\uFEFF/, '').split('\n').filter((l) => l.length > 0),
  };
}

describe('GET /api/export/appointments (#31)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let otherDoctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounder: Awaited<ReturnType<typeof createCompounderFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let admin: Awaited<ReturnType<typeof createAdminFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9834000010', name: 'Dr Export', fee: 500 });
    otherDoctor = await createDoctorFixture({ phone: '9834000011', name: 'Dr Other', fee: 700 });
    compounder = await createCompounderFixture({ phone: '9834000012', doctorId: doctor.doctorId });
    patient = await createPatientFixture({ phone: '9834000013' });
    admin = await createAdminFixture({ phone: '9834000001' });
    schedule = await createScheduleFixture(doctor.doctorId, { clinicName: 'Export Clinic' });

    const yesterday = addDaysISO(today, -1);

    // Formula-injection attempts (old-repo bug #9) in patientName.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 500,
      patientName: '=SUM(A1:A2)',
      patientPhone: '+919834000101',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 2,
      status: 'CANCELLED',
      source: 'WALK_IN',
      fee: 300,
      patientName: '+cmd| /C calc',
      patientPhone: '+919834000102',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 3,
      status: 'CONFIRMED',
      source: 'ONLINE',
      fee: 500,
      patientName: '-2+3',
      patientPhone: '+919834000103',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 4,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 500,
      patientName: '@import url(evil)',
      patientPhone: '+919834000104',
    });
    // CR/LF smuggling attempt → stripped inside the cell.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 5,
      status: 'CONFIRMED',
      source: 'WALK_IN',
      fee: null,
      patientName: 'Ravi\nKumar',
      patientPhone: '+919834000105',
    });
    // CSV quoting cases: comma and double quotes.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: yesterday,
      queueNumber: 1,
      status: 'NO_SHOW',
      source: 'ONLINE',
      fee: 500,
      patientName: 'Doe, Jane',
      patientPhone: '+919834000106',
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: yesterday,
      queueNumber: 2,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 500,
      patientName: 'He said "hi"',
      patientPhone: '+919834000107',
    });
    // Outside the default 30-day window (today-31): must NOT be exported.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: addDaysISO(today, -31),
      queueNumber: 1,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 999,
    });
    // Another doctor's appointment: scope isolation.
    const otherSchedule = await createScheduleFixture(otherDoctor.doctorId);
    await createAppointmentFixture(otherSchedule.id, otherDoctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'COMPLETED',
      source: 'ONLINE',
      fee: 700,
    });
  });

  function exportCsv(token: string, qs = '') {
    return exportRoute(getRequest(`${API}/api/export/appointments${qs}`, token));
  }

  it('access control: 401 unauthenticated, 403 PATIENT and COMPOUNDER', async () => {
    expect((await exportRoute(getRequest(`${API}/api/export/appointments`))).status).toBe(401);
    expect((await exportCsv(patient.token)).status).toBe(403);
    expect((await exportCsv(compounder.token)).status).toBe(403);
  });

  it('streams a CSV attachment with the exact header row', async () => {
    const res = await readCsv(await exportCsv(doctor.token, `?from=${today}&to=${today}`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(`appointments_${today}_${today}.csv`);
    expect(res.lines[0]).toBe('date,queueNumber,patientName,phone,doctorName,clinicName,status,source,fee');
    expect(res.lines).toHaveLength(6); // header + 5 rows (other doctor + old rows excluded)
  });

  it('rows ordered by date asc then queueNumber asc; today phone cells formula-escaped', async () => {
    const res = await readCsv(await exportCsv(doctor.token, `?from=${addDaysISO(today, -1)}&to=${today}`));
    const yesterday = addDaysISO(today, -1);
    const rows = res.lines.slice(1).map((line) => line.split(','));
    expect(rows).toHaveLength(7); // 2 yesterday + 5 today
    // date asc: yesterday first, then today; queueNumber asc within a date.
    expect(rows[0][0]).toBe(yesterday);
    expect(Number(rows[0][1])).toBe(1);
    expect(rows[1][0]).toBe(yesterday);
    expect(Number(rows[1][1])).toBe(2);
    expect(rows[2][0]).toBe(today);
    expect(Number(rows[2][1])).toBe(1);
    expect(rows[6][0]).toBe(today);
    expect(Number(rows[6][1])).toBe(5);
    // Today's rows are unquoted; the phone cell (index 3) starts with the escape
    // quote (phones are stored with a leading '+').
    for (const row of rows.slice(2)) {
      expect(row[3].startsWith("'+91")).toBe(true);
    }
  });

  it('FORMULA INJECTION: = + - @ prefixed with quote, CR/LF stripped (bug #9)', async () => {
    const res = await readCsv(await exportCsv(doctor.token, `?from=${today}&to=${today}`));
    const lines = res.lines;

    // '=SUM(A1:A2)' has no comma/quote → bare escaped cell.
    expect(lines[1]).toContain(`'=SUM(A1:A2)`);
    // '+cmd…' (no comma/quote) → bare escaped cell.
    expect(lines[2]).toContain("'+cmd| /C calc");
    expect(lines[2].includes(',,')).toBe(false);
    // '-2+3' → '-2+3'.
    expect(lines[3]).toContain("'-2+3");
    // '@import url(evil)' → '@import url(evil)'.
    expect(lines[4]).toContain("'@import url(evil)");
    // 'Ravi\nKumar' → newline stripped into a single cell (no extra CSV row).
    expect(lines[5]).toContain('Ravi Kumar');
    expect(lines).toHaveLength(6); // the \n inside the name must NOT create a 7th line
    // fee null exports as an empty last cell.
    expect(lines[5].endsWith(',')).toBe(true);

    // No un-escaped formula cell anywhere in the file.
    for (const line of lines.slice(1)) {
      // strip quoted CSV cells, then ensure no cell starts with a formula char
      const cells = line.match(/("([^"]|"")*"|[^,]*)/g) ?? [];
      for (const cell of cells) {
        if (!cell) continue;
        expect(/^[=+\-@]/.test(cell)).toBe(false);
      }
    }
  });

  it('CSV quoting: commas wrapped, inner quotes doubled', async () => {
    const res = await readCsv(await exportCsv(doctor.token, `?from=${addDaysISO(today, -1)}&to=${addDaysISO(today, -1)}`));
    const lines = res.lines;
    expect(lines[1]).toContain('"Doe, Jane"');
    expect(lines[2]).toContain('"He said ""hi"""');
  });

  it('default range is today-30..today IST (today-31 excluded, no query needed)', async () => {
    const res = await readCsv(await exportCsv(doctor.token));
    expect(res.lines).toHaveLength(8); // header + 7 rows (the today-31 row is out)
    const dates = res.lines.slice(1).map((line) => line.split(',')[0]);
    expect(dates).not.toContain(addDaysISO(today, -31));
    expect(dates).toContain(addDaysISO(today, -1));
    expect(dates).toContain(today);
  });

  it('strictly scoped to the doctor (other doctor rows never exported)', async () => {
    const res = await readCsv(await exportCsv(doctor.token, `?from=${today}&to=${today}`));
    expect(res.text).not.toContain('Dr Other');
    expect(res.text).not.toContain(',700,');
  });

  it('SUPER_ADMIN: 422 without ?doctorId, 200 with it', async () => {
    const noTarget = await readResponse(await exportCsv(admin.token));
    expect(noTarget.status).toBe(422);
    expect(noTarget.error?.code).toBe('VALIDATION_ERROR');

    const targeted = await readCsv(await exportCsv(admin.token, `?doctorId=${doctor.doctorId}&from=${today}&to=${today}`));
    expect(targeted.status).toBe(200);
    expect(targeted.lines).toHaveLength(6);

    const badTarget = await readResponse(await exportCsv(admin.token, '?doctorId=unknown'));
    expect(badTarget.status).toBe(422);
  });

  it('validation: from > to → 422 (envelope), malformed dates → 422', async () => {
    const inverted = await readResponse(await exportCsv(doctor.token, `?from=${today}&to=${addDaysISO(today, -1)}`));
    expect(inverted.status).toBe(422);
    expect(inverted.error?.code).toBe('VALIDATION_ERROR');

    const malformed = await readResponse(await exportCsv(doctor.token, '?from=2026-13-40'));
    expect(malformed.status).toBe(422);
  });

  it('PENDING rows export with status PENDING in the status column (Phase 11 B2)', async () => {
    // Runs LAST so the earlier row-count assertions are untouched.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 6,
      status: 'PENDING',
      source: 'ONLINE',
      fee: 500,
      patientName: 'Pending Export',
      patientPhone: '+919834000109',
    });

    const res = await readCsv(await exportCsv(doctor.token, `?from=${today}&to=${today}`));
    expect(res.status).toBe(200);
    // queueNumber 6 sorts last among today's rows — its status cell is PENDING.
    const rows = res.lines.slice(1).map((line) => line.split(','));
    const pendingRow = rows.find((r) => Number(r[1]) === 6);
    expect(pendingRow).toBeDefined();
    expect(pendingRow![6]).toBe('PENDING'); // status column renders the raw value

    // Cleanup (keeps the file's fixtures honest if it ever grows).
    await db.appointment.deleteMany({
      where: { scheduleId: schedule.id, date: today, queueNumber: 6 },
    });
  });
});
