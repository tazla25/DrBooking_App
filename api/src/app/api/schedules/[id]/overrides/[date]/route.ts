import { handle, ok, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { dateSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; date: string }> };

/**
 * DELETE /api/schedules/:id/overrides/:date  (#20) — remove the override for
 * a specific date. Schedule must belong to the caller's scope (else 404).
 */
export const DELETE = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const { id, date: rawDate } = await context.params;
  const date = dateSchema.parse(rawDate); // malformed path date → 422

  const schedule = await db.schedule.findUnique({ where: { id } });
  if (!schedule || schedule.doctorId !== doctorId) {
    throw notFound('Schedule not found');
  }

  const override = await db.scheduleOverride.findUnique({
    where: { scheduleId_date: { scheduleId: id, date } },
  });
  if (!override) {
    throw notFound('Override not found');
  }

  await db.scheduleOverride.delete({ where: { id: override.id } });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'OVERRIDE_CHANGED',
      target: `schedule:${id}`,
      detail: JSON.stringify({ op: 'delete', date, type: override.type }),
    },
  });

  return ok({ deleted: true, date });
});
