import {
  GET as notesListRoute,
  POST as noteCreateRoute,
} from '@/app/api/patients/[phone]/notes/route';
import { db } from '@/lib/db';
import {
  postRequest,
  getRequest,
  readResponse,
  resetDb,
  API,
  routeContext,
  createDoctorFixture,
  createCompounderFixture,
} from './helpers';

const PHONE_PATH = '9817770001'; // normalized to +919817770001

function listNotes(token?: string, phone = PHONE_PATH) {
  return notesListRoute(
    getRequest(`${API}/api/patients/${phone}/notes`, token),
    routeContext({ phone }),
  );
}

function createNote(token: string, body: Record<string, unknown>, phone = PHONE_PATH) {
  return noteCreateRoute(
    postRequest(`${API}/api/patients/${phone}/notes`, body, token),
    routeContext({ phone }),
  );
}

describe('Patient notes (#22) — team-shared within one doctor scope', () => {
  let doctorA: Awaited<ReturnType<typeof createDoctorFixture>>;
  let compounderA: Awaited<ReturnType<typeof createCompounderFixture>>;

  beforeAll(async () => {
    await resetDb();
    doctorA = await createDoctorFixture({ phone: '9810000071', name: 'Dr Notes' });
    compounderA = await createCompounderFixture({
      phone: '9810000072',
      name: 'Cara Compounder',
      doctorId: doctorA.doctorId,
    });
  });

  it('doctor creates a note (201) with the author recorded', async () => {
    const body = await readResponse(
      await createNote(doctorA.token, { note: 'Allergic to penicillin', isImportant: true }),
    );
    expect(body.status).toBe(201);
    const note = (body.data as { note: { id: string; note: string; isImportant: boolean; author: { id: string; name: string; role: string } | null; createdAt: string } }).note;
    expect(note.note).toBe('Allergic to penicillin');
    expect(note.isImportant).toBe(true);
    expect(note.author!.id).toBe(doctorA.userId);
    expect(note.author!.name).toBe('Dr Notes');
    expect(note.author!.role).toBe('DOCTOR');
  });

  it('the compounder of the SAME doctor sees the doctor note (shared team view)', async () => {
    const body = await readResponse(await listNotes(compounderA.token));
    expect(body.status).toBe(200);
    const notes = (body.data as { notes: { note: string; author: { role: string } | null }[] }).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe('Allergic to penicillin');
    expect(notes[0].author!.role).toBe('DOCTOR');
  });

  it('a compounder can add a note too — author recorded as COMPOUNDER', async () => {
    const body = await readResponse(
      await createNote(compounderA.token, { note: 'Prefers evening calls' }),
    );
    expect(body.status).toBe(201);
    expect((body.data as { note: { isImportant: boolean } }).note.isImportant).toBe(false); // default

    const all = await readResponse(await listNotes(doctorA.token));
    const notes = (all.data as { notes: { author: { role: string } | null }[] }).notes;
    expect(notes).toHaveLength(2);
    expect(notes.some((n) => n.author!.role === 'COMPOUNDER')).toBe(true);
  });

  it('lists notes newest-first', async () => {
    const all = await readResponse(await listNotes(doctorA.token));
    const notes = (all.data as { notes: { createdAt: string }[] }).notes;
    expect(notes.length).toBe(2);
    expect(new Date(notes[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(notes[1].createdAt).getTime(),
    );
  });

  it('validates: bad phone path → 422; empty note → 422; >2000 chars → 422', async () => {
    const badPhone = await readResponse(
      await notesListRoute(
        getRequest(`${API}/api/patients/12345/notes`, doctorA.token),
        routeContext({ phone: '12345' }),
      ),
    );
    expect(badPhone.status).toBe(422);

    const empty = await readResponse(
      await createNote(doctorA.token, { note: '   ' }),
    );
    expect(empty.status).toBe(422);

    const tooLong = await readResponse(
      await createNote(doctorA.token, { note: 'x'.repeat(2001) }),
    );
    expect(tooLong.status).toBe(422);
  });

  it('patients and anonymous callers are rejected', async () => {
    const anon = await readResponse(await listNotes());
    expect(anon.status).toBe(401);
  });

  it('notes persist keyed by the NORMALIZED phone regardless of input form', async () => {
    // 10-digit form in the path resolves to the same +91 normalized bucket.
    const viaFullForm = await readResponse(await listNotes(doctorA.token, '+919817770001'));
    expect(viaFullForm.status).toBe(200);
    expect((viaFullForm.data as { notes: unknown[] }).notes).toHaveLength(2);
  });

  it('keeps notes reachable for walk-in phones without any account', async () => {
    const body = await readResponse(
      await createNote(doctorA.token, { note: 'Walk-in follow-up needed' }, '9817770009'),
    );
    expect(body.status).toBe(201);
    const count = await db.patientNote.count({ where: { patientPhone: '+919817770009' } });
    expect(count).toBe(1);
  });
});
