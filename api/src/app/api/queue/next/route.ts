import { handle, ok } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { istTodayISO } from '@/lib/time';
import { notifyUser } from '@/lib/push';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/queue/next  (#15) — DOCTOR/COMPOUNDER. ONE transaction:
 *  a) lowest-queueNumber CALLED appointment today → COMPLETED (may be none);
 *  b) lowest-queueNumber CONFIRMED appointment today → CALLED (may be none).
 * Strictly scoped by scope.doctorId; "today" always from istTodayISO().
 *
 * Push trigger (b) — AFTER the transaction commits, fire-and-forget: the
 * CONFIRMED patient now at position 3 of the remaining waiting line (the 3rd
 * lowest queueNumber among CONFIRMED appointments after the one just called)
 * gets "You're 3rd in queue" — a heads-up to start heading to the clinic.
 * Fewer than 3 remaining CONFIRMED patients → no notification. Walk-ins
 * without an account skip silently (notifyUser ignores a null patientId).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireVerifiedStaffScope(request);
  const today = istTodayISO();

  const result = await db.$transaction(async (tx) => {
    // (a) Complete the currently CALLED appointment, if any.
    const current = await tx.appointment.findFirst({
      where: { doctorId, date: today, status: 'CALLED' },
      orderBy: [{ queueNumber: 'asc' }, { createdAt: 'asc' }],
    });
    const completed = current
      ? await tx.appointment.update({
          where: { id: current.id },
          data: { status: 'COMPLETED' },
        })
      : null;

    // (b) Call the next CONFIRMED appointment, if any.
    const next = await tx.appointment.findFirst({
      where: { doctorId, date: today, status: 'CONFIRMED' },
      orderBy: [{ queueNumber: 'asc' }, { createdAt: 'asc' }],
    });
    const called = next
      ? await tx.appointment.update({
          where: { id: next.id },
          data: { status: 'CALLED' },
        })
      : null;

    return { completed, called, queueEmpty: called === null };
  });

  // Push trigger (b): the 3rd patient in the remaining waiting line (by
  // queueNumber). Purely read-after-commit; failures are swallowed inside
  // src/lib/push.ts and can never affect the queue advance.
  const waiting = await db.appointment.findMany({
    where: { doctorId, date: today, status: 'CONFIRMED' },
    orderBy: [{ queueNumber: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, patientId: true },
    take: 3,
  });
  const thirdInLine = waiting[2];
  if (thirdInLine) {
    notifyUser(thirdInLine.patientId, {
      title: 'Queue update',
      body: "You're 3rd in queue",
      data: {
        type: 'QUEUE_POSITION',
        position: '3',
        appointmentId: thirdInLine.id,
      },
    });
  }

  return ok(result);
});
