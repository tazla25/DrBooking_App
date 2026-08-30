import { POST as submitFeedback } from '@/app/api/feedback/route';
import { db } from '@/lib/db';
import { istTodayISO } from '@/lib/time';
import {
  postRequest,
  readResponse,
  resetDb,
  API,
  createDoctorFixture,
  createPatientFixture,
  createScheduleFixture,
  createAppointmentFixture,
} from './helpers';

describe('POST /api/feedback (#11)', () => {
  let doctor: Awaited<ReturnType<typeof createDoctorFixture>>;
  let patientA: Awaited<ReturnType<typeof createPatientFixture>>;
  let patientB: Awaited<ReturnType<typeof createPatientFixture>>;
  let schedule: { id: string; doctorId: string };
  let completedA: { id: string };
  let completedB: { id: string };
  const today = istTodayISO();

  beforeAll(async () => {
    await resetDb();
    doctor = await createDoctorFixture({ phone: '9826000001', name: 'Dr Feedback', fee: 200 });
    patientA = await createPatientFixture({ phone: '9826000010', name: 'Reviewer A' });
    patientB = await createPatientFixture({ phone: '9826000011', name: 'Reviewer B' });
    schedule = await createScheduleFixture(doctor.doctorId);

    completedA = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 1,
      status: 'COMPLETED',
      patientId: patientA.userId,
      patientName: 'Reviewer A',
      patientPhone: '+919826000010',
    });
    completedB = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 2,
      status: 'COMPLETED',
      patientId: patientB.userId,
      patientName: 'Reviewer B',
      patientPhone: '+919826000011',
    });
  });

  function feedback(body: Record<string, unknown>, token: string) {
    return submitFeedback(postRequest(`${API}/api/feedback`, body, token));
  }

  it('happy path: 201, feedback row created, doctor aggregate recomputed', async () => {
    const body = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 5, comment: 'Excellent doctor' }, patientA.token),
    );
    expect(body.status).toBe(201);

    const data = body.data as {
      feedback: { appointmentId: string; rating: number; comment: string | null };
      avgRating: number;
      reviewCount: number;
    };
    expect(data.feedback.rating).toBe(5);
    expect(data.feedback.comment).toBe('Excellent doctor');
    expect(data.avgRating).toBe(5);
    expect(data.reviewCount).toBe(1);

    const stored = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(stored?.avgRating).toBe(5);
    expect(stored?.reviewCount).toBe(1);

    const audit = await db.auditLog.findFirst({ where: { action: 'FEEDBACK_SUBMITTED' } });
    expect(audit?.actorId).toBe(patientA.userId);
  });

  it('aggregate recomputed from ALL feedback: 5 + 4 → avgRating 4.5, reviewCount 2', async () => {
    const body = await readResponse(
      await feedback({ appointmentId: completedB.id, rating: 4 }, patientB.token),
    );
    expect(body.status).toBe(201);

    const data = body.data as { avgRating: number; reviewCount: number };
    expect(data.avgRating).toBe(4.5);
    expect(data.reviewCount).toBe(2);

    const stored = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(stored?.avgRating).toBe(4.5);
    expect(stored?.reviewCount).toBe(2);
  });

  it('second review of the same appointment → 409 ALREADY_REVIEWED', async () => {
    const body = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 3 }, patientA.token),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('ALREADY_REVIEWED');

    // Aggregate unchanged.
    const stored = await db.doctorProfile.findUnique({ where: { id: doctor.doctorId } });
    expect(stored?.reviewCount).toBe(2);
  });

  it('non-COMPLETED appointment → 409 NOT_COMPLETED', async () => {
    const confirmed = await createAppointmentFixture(schedule.id, doctor.doctorId, {
      date: today,
      queueNumber: 3,
      status: 'CONFIRMED',
      patientId: patientA.userId,
    });

    const body = await readResponse(
      await feedback({ appointmentId: confirmed.id, rating: 5 }, patientA.token),
    );
    expect(body.status).toBe(409);
    expect(body.error?.code).toBe('NOT_COMPLETED');
  });

  it("someone else's appointment → 404; unknown appointment → 404", async () => {
    const foreign = await readResponse(
      await feedback({ appointmentId: completedB.id, rating: 1 }, patientA.token),
    );
    expect(foreign.status).toBe(404);
    expect(foreign.error?.code).toBe('NOT_FOUND');

    const unknown = await readResponse(
      await feedback({ appointmentId: 'no-such-appointment', rating: 5 }, patientA.token),
    );
    expect(unknown.status).toBe(404);
  });

  it('validates the body and the caller (422 / 401 / 403)', async () => {
    const rating0 = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 0 }, patientA.token),
    );
    expect(rating0.status).toBe(422);

    const rating6 = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 6 }, patientA.token),
    );
    expect(rating6.status).toBe(422);

    const longComment = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 5, comment: 'x'.repeat(1001) }, patientA.token),
    );
    expect(longComment.status).toBe(422);

    const anonymous = await readResponse(
      await submitFeedback(
        postRequest(`${API}/api/feedback`, { appointmentId: completedA.id, rating: 5 }),
      ),
    );
    expect(anonymous.status).toBe(401);

    // Staff cannot submit patient feedback.
    const doctorView = await createDoctorFixture({ phone: '9826000002' });
    const asDoctor = await readResponse(
      await feedback({ appointmentId: completedA.id, rating: 5 }, doctorView.token),
    );
    expect(asDoctor.status).toBe(403);
  });
});
