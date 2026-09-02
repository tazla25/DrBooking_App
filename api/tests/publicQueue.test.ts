import { GET as getPublicQueue } from '@/app/api/queue/[scheduleId]/[date]/route';
import { db } from '@/lib/db';
import { istTodayISO, addDaysISO } from '@/lib/time';
import {
  getRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
  routeContext,
} from './helpers';

/** Visit every key/value pair of a parsed JSON structure. */
function deepVisit(node: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => deepVisit(child, visit));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      visit(key, value);
      deepVisit(value, visit);
    }
  }
}

interface QueueView {
  date: string;
  schedule: { clinicName: string; clinicAddress: string; startTime: string; endTime: string; avgMinutesPerPatient: number };
  doctor: { fullName: string; specialization: string | null };
  current: { queueNumber: number; patientName: string } | null;
  upNext: { queueNumber: number; patientName: string; estWaitMin: number }[];
  pending: { queueNumber: number; patientName: string }[];
  counts: { completed: number; called: number; waiting: number; pending: number };
  my: { id: string; queueNumber: number; status: string; estWaitMin: number } | null;
}

describe('GET /api/queue/:scheduleId/:date (public live queue, #12)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patient: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  const today = istTodayISO();
  const yesterday = addDaysISO(today, -1);
  const PII_PHONE = '+919823337777';

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({
      phone: '9823000001',
      name: 'Dr Queue',
      fee: 600,
    });
    patient = await createPatientFixture({ phone: '9823000010', name: 'Priya Nair' });
    schedule = await createScheduleFixture(doctor.doctorId, { avgMinutesPerPatient: 15 });

    // A queue for TODAY with every status represented.
    // 1: CALLED (current) — the PII canary: phone/notes/fee must never leak.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'CALLED',
      patientName: 'Priya Nair',
      patientPhone: PII_PHONE,
      patientId: patient.userId,
      fee: 600,
      notes: 'secret-notes-marker',
    });
    // 2: CONFIRMED — single-word name for the masking format.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 2,
      status: 'CONFIRMED',
      patientName: 'Ravi',
      patientPhone: '+919823000002',
      fee: 600,
    });
    // 3: CONFIRMED — masked to 'S***a'.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 3,
      status: 'CONFIRMED',
      patientName: 'Sunita Sharma',
      patientPhone: '+919823000003',
    });
    // 4: single-character name → 'X***'.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 4,
      status: 'CONFIRMED',
      patientName: 'X',
      patientPhone: '+919823000004',
    });
    // 5–7: terminal statuses for the counts.
    await createAppointmentFixture(schedule.id, doctor.doctorId, { date: today, queueNumber: 5, status: 'COMPLETED', patientName: 'Done Person', patientPhone: '+919823000005' });
    await createAppointmentFixture(schedule.id, doctor.doctorId, { date: today, queueNumber: 6, status: 'NO_SHOW', patientName: 'Missing Person', patientPhone: '+919823000006' });
    await createAppointmentFixture(schedule.id, doctor.doctorId, { date: today, queueNumber: 7, status: 'CANCELLED', patientName: 'Gone Person', patientPhone: '+919823000007' });

    // Yesterday's queue (history browsing is allowed).
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: yesterday,
      queueNumber: 1,
      status: 'COMPLETED',
      patientName: 'History Person',
      patientPhone: '+919823000008',
    });
  });

  function queue(scheduleId: string, date: string, token?: string) {
    return getPublicQueue(
      getRequest(`${API}/api/queue/${scheduleId}/${date}`, token),
      routeContext({ scheduleId, date }),
    );
  }

  it('anonymous: current + upNext + counts, correct masking, no PII anywhere', async () => {
    const body = await readResponse(await queue(schedule.id, today));
    expect(body.status).toBe(200);

    const data = body.data as QueueView;
    expect(data.date).toBe(today);
    expect(data.doctor.fullName).toBe('Dr Queue');
    expect(data.schedule.clinicName).toBe('City Clinic');
    expect(data.schedule.avgMinutesPerPatient).toBe(15);

    // current = the CALLED appointment, name masked.
    expect(data.current).toEqual({ queueNumber: 1, patientName: 'P***r' });

    // upNext = CONFIRMED in queue order with estWaitMin per the formula.
    expect(data.upNext.map((u) => [u.queueNumber, u.patientName])).toEqual([
      [2, 'R***i'],
      [3, 'S***a'],
      [4, 'X***'],
    ]);
    expect(data.upNext[0].estWaitMin).toBe(15); // CALLED queue 1 ahead
    expect(data.upNext[1].estWaitMin).toBe(30); // queue 1 + queue 2 ahead
    expect(data.upNext[2].estWaitMin).toBe(45);

    expect(data.counts).toEqual({ completed: 1, called: 1, waiting: 3, pending: 0 });
    expect(data.pending).toEqual([]);

    // Anonymous → my: null.
    expect(data.my).toBeNull();

    // MASKING LAW, deep-scan the whole structure: no phones, no patientIds,
    // no notes, no fees, and none of the seeded PII values.
    const serialized = JSON.stringify(data);
    const forbiddenKeys = new Set(['patientPhone', 'patientId', 'notes', 'fee', 'passwordHash', 'userId']);
    const forbiddenValues = [PII_PHONE, '9823000010', 'secret-notes-marker', patient.userId];
    deepVisit(data, (key) => {
      expect(forbiddenKeys.has(key)).toBe(false);
    });
    for (const value of forbiddenValues) {
      expect(serialized.includes(value)).toBe(false);
    }
  });

  it('patient Bearer token → my: { id, queueNumber, status, estWaitMin }', async () => {
    const body = await readResponse(await queue(schedule.id, today, patient.token));
    const data = body.data as QueueView;
    expect(data.my).not.toBeNull();
    expect(data.my!.queueNumber).toBe(1); // their CALLED appointment
    expect(data.my!.status).toBe('CALLED');
    expect(data.my!.estWaitMin).toBe(0); // nobody ahead of queue 1

    const stored = await db.appointment.findFirst({
      where: { scheduleId: schedule.id, date: today, queueNumber: 1 },
    });
    expect(data.my!.id).toBe(stored!.id);
  });

  it('staff tokens and unknown/invalid tokens → my: null (screen stays public)', async () => {
    const doctorView = await readResponse(await queue(schedule.id, today, doctor.token));
    expect((doctorView.data as QueueView).my).toBeNull();

    const invalidToken = await readResponse(await queue(schedule.id, today, 'not-a-valid-token'));
    expect(invalidToken.status).toBe(200);
    expect((invalidToken.data as QueueView).my).toBeNull();
  });

  it('a patient WITHOUT an appointment in this queue → my: null', async () => {
    const stranger = await createPatientFixture({ phone: '9823000020', name: 'Stranger' });
    const body = await readResponse(await queue(schedule.id, today, stranger.token));
    expect(body.status).toBe(200);
    expect((body.data as QueueView).my).toBeNull();
  });

  it('past dates are viewable (history) with the same shape', async () => {
    const body = await readResponse(await queue(schedule.id, yesterday));
    expect(body.status).toBe(200);
    const data = body.data as QueueView;
    expect(data.date).toBe(yesterday);
    expect(data.current).toBeNull(); // yesterday's only appointment is COMPLETED
    expect(data.upNext).toEqual([]);
    expect(data.counts).toEqual({ completed: 1, called: 0, waiting: 0, pending: 0 });
  });

  it('PENDING rows: masked, own list + count, NOT in upNext (Phase 11 B2)', async () => {
    // Two pending bookings for TOMORROW is wrong — the queue screen is
    // per-date; add PENDING rows to TODAY's queue.
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 8,
      status: 'PENDING',
      patientName: 'Waiting Person',
      patientPhone: '+919823000009',
      patientId: null,
    });
    await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 9,
      status: 'PENDING',
      patientName: 'X',
      patientPhone: '+919823000010',
      patientId: null,
    });

    const body = await readResponse(await queue(schedule.id, today));
    expect(body.status).toBe(200);
    const data = body.data as QueueView;

    // Pending list: masked names, queue order, serials visible.
    expect(data.pending).toEqual([
      { queueNumber: 8, patientName: 'W***n' },
      { queueNumber: 9, patientName: 'X***' },
    ]);
    expect(data.counts.pending).toBe(2);

    // NOT in upNext — only confirmed patients are up next.
    expect(data.upNext.map((u) => u.queueNumber)).toEqual([2, 3, 4]);

    // estWait for the confirmed #4 now includes the… no — the PENDING rows
    // are AFTER #4 in queue order, so the ahead-count is unchanged (the
    // ahead-set counts by queueNumber, pending rows sit at 8/9).
    expect(data.upNext[2].estWaitMin).toBe(45);

    // A PENDING booking of the CALLER takes priority in `my` (their live
    // booking) — verify with a fresh patient who owns queue 8.
    const pendingPatient = await createPatientFixture({ phone: '9823000030', name: 'Waiting Person' });
    const pendingRow = await db.appointment.findFirstOrThrow({
      where: { scheduleId: schedule.id, date: today, queueNumber: 8 },
    });
    await db.appointment.update({
      where: { id: pendingRow.id },
      data: { patientId: pendingPatient.userId },
    });
    const mine = await readResponse(await queue(schedule.id, today, pendingPatient.token));
    expect(mine.status).toBe(200);
    const myData = mine.data as QueueView;
    expect(myData.my).not.toBeNull();
    expect(myData.my!.queueNumber).toBe(8);
    expect(myData.my!.status).toBe('PENDING');

    // MASKING LAW: the pending list carries no phones/PII (deep-scan).
    const pendingJson = JSON.stringify(data.pending);
    expect(pendingJson).not.toContain('+919823000009');
    expect(pendingJson).not.toContain('9823000009');
  });

  it('invalid date → 422; unknown or inactive schedule → 404', async () => {
    const badDate = await readResponse(await queue(schedule.id, '2026-13-40'));
    expect(badDate.status).toBe(422);
    expect(badDate.error?.code).toBe('VALIDATION_ERROR');

    const unknown = await readResponse(await queue('no-such-schedule', today));
    expect(unknown.status).toBe(404);

    const inactive = await createScheduleFixture(doctor.doctorId, { isActive: false });
    const inactiveView = await readResponse(await queue(inactive.id, today));
    expect(inactiveView.status).toBe(404);
  });
});
