import { handle, ok } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/queue/next  (#15) — DOCTOR/COMPOUNDER. ONE transaction:
 *  a) lowest-queueNumber CALLED appointment today → COMPLETED (may be none);
 *  b) lowest-queueNumber CONFIRMED appointment today → CALLED (may be none).
 * Strictly scoped by scope.doctorId; "today" always from istTodayISO().
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

  return ok(result);
});
