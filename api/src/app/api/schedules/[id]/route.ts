import { handle, ok, readJsonBody, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { scheduleSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Load a schedule that must belong to the caller's scope — else 404. */
async function scopedSchedule(id: string, doctorId: string) {
  const schedule = await db.schedule.findUnique({ where: { id } });
  if (!schedule || schedule.doctorId !== doctorId) {
    throw notFound('Schedule not found');
  }
  return schedule;
}

/**
 * PUT /api/schedules/:id  (#19) — full field update (same validations as
 * POST). Schedule must belong to the caller's scope (else 404).
 */
export const PUT = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const { id } = await context.params;
  const body = scheduleSchema.parse(await readJsonBody(request));

  await scopedSchedule(id, doctorId);

  const schedule = await db.schedule.update({
    where: { id },
    data: {
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
      clinicName: body.clinicName,
      clinicAddress: body.clinicAddress,
      pinCode: body.pinCode ?? null,
      landmark: body.landmark ?? null,
      mapLink: body.mapLink ?? null,
      avgMinutesPerPatient: body.avgMinutesPerPatient,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'SCHEDULE_CHANGED',
      target: `schedule:${id}`,
      detail: JSON.stringify({ op: 'update', dayOfWeek: body.dayOfWeek, clinicName: body.clinicName }),
    },
  });

  return ok({ schedule });
});

/**
 * DELETE /api/schedules/:id  (#19) — SOFT delete only (isActive=false).
 * NEVER hard-delete: the FK cascade would erase patient appointment history.
 * Idempotent for already-inactive schedules of the caller's scope.
 */
export const DELETE = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const { id } = await context.params;

  await scopedSchedule(id, doctorId);

  const schedule = await db.schedule.update({
    where: { id },
    data: { isActive: false },
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'SCHEDULE_CHANGED',
      target: `schedule:${id}`,
      detail: JSON.stringify({ op: 'soft_delete', clinicName: schedule.clinicName }),
    },
  });

  return ok({ schedule });
});
