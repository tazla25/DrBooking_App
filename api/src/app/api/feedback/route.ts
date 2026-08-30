import { Prisma } from '@prisma/client';
import { handle, ok, readJsonBody, conflict, notFound } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { feedbackSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Round to 2 decimals without floating-point drift (e.g. 4.5, 4.33). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * POST /api/feedback  (#11, PATIENT) — rate a COMPLETED visit.
 *
 *  - The appointment must be the caller's OWN (patientId === user.id, else
 *    404) and COMPLETED (else 409 NOT_COMPLETED).
 *  - One feedback per appointment: the DB unique constraint backs the guard;
 *    a second attempt → 409 ALREADY_REVIEWED.
 *  - ONE transaction: insert Feedback + RECOMPUTE the doctor's avgRating and
 *    reviewCount from ALL feedback across that doctor's appointments
 *    (aggregated from the DB — never blindly incremented).
 *  - Audit: FEEDBACK_SUBMITTED (actor = patient).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request, ['PATIENT']);
  const body = feedbackSchema.parse(await readJsonBody(request));

  const appointment = await db.appointment.findUnique({ where: { id: body.appointmentId } });
  if (!appointment || appointment.patientId !== user.id) {
    throw notFound('Appointment not found');
  }
  if (appointment.status !== 'COMPLETED') {
    throw conflict('NOT_COMPLETED', 'Feedback can only be submitted after the appointment is completed');
  }

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.feedback.findUnique({
      where: { appointmentId: appointment.id },
      select: { id: true },
    });
    if (existing) {
      throw conflict('ALREADY_REVIEWED', 'Feedback has already been submitted for this appointment');
    }

    let feedback;
    try {
      feedback = await tx.feedback.create({
        data: {
          appointmentId: appointment.id,
          rating: body.rating,
          comment: body.comment ?? null,
        },
      });
    } catch (err) {
      // Parallel double-submit hitting the unique constraint.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('ALREADY_REVIEWED', 'Feedback has already been submitted for this appointment');
      }
      throw err;
    }

    // Recompute the aggregate from ALL of this doctor's feedback — never a
    // blind increment (a deleted/cancelled review can never desync it).
    const agg = await tx.feedback.aggregate({
      where: { appointment: { doctorId: appointment.doctorId } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const avgRating = agg._avg.rating === null ? 0 : round2(agg._avg.rating);
    const reviewCount = agg._count._all;

    await tx.doctorProfile.update({
      where: { id: appointment.doctorId },
      data: { avgRating, reviewCount },
    });

    return { feedback, avgRating, reviewCount };
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'FEEDBACK_SUBMITTED',
      target: `appointment:${appointment.id}`,
      detail: JSON.stringify({
        rating: body.rating,
        doctorId: appointment.doctorId,
        avgRating: result.avgRating,
        reviewCount: result.reviewCount,
      }),
    },
  });

  return ok(
    {
      feedback: {
        id: result.feedback.id,
        appointmentId: result.feedback.appointmentId,
        rating: result.feedback.rating,
        comment: result.feedback.comment,
      },
      avgRating: result.avgRating,
      reviewCount: result.reviewCount,
    },
    201,
  );
});
