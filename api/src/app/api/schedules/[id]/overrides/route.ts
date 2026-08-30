import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { handle, ok, readJsonBody, conflict, notFound, validationError } from '@/lib/errors';
import { requireVerifiedStaffScope, requireStaffOrAdmin, getDoctorScope } from '@/lib/rbac';
import { overrideCreateSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Load a schedule readable by the caller: staff must own it (404 otherwise);
 * SUPER_ADMIN (read-only) may read any existing schedule.
 */
async function readableSchedule(id: string, user: User) {
  const schedule = await db.schedule.findUnique({ where: { id } });
  if (!schedule) throw notFound('Schedule not found');
  if (user.role !== 'SUPER_ADMIN') {
    const scope = await getDoctorScope(user);
    if (schedule.doctorId !== scope!.doctorId) throw notFound('Schedule not found');
  }
  return schedule;
}

/**
 * GET /api/schedules/:id/overrides  (#20) — list a schedule's overrides
 * (calendar order). DOCTOR/COMPOUNDER scoped; SUPER_ADMIN read-only.
 */
export const GET = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const user = await requireStaffOrAdmin(request);
  const { id } = await context.params;
  await readableSchedule(id, user);

  const overrides = await db.scheduleOverride.findMany({
    where: { scheduleId: id },
    orderBy: { date: 'asc' },
  });

  return ok({ overrides });
});

/**
 * POST /api/schedules/:id/overrides  (#20) — DOCTOR/COMPOUNDER.
 *  - CLOSED must not carry times;
 *  - MODIFIED_HOURS / SPECIAL REQUIRE newStartTime < newEndTime;
 *  - one override per (scheduleId, date) → 409 OVERRIDE_EXISTS.
 */
export const POST = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user, doctorId } = await requireVerifiedStaffScope(request);
  const { id } = await context.params;
  const body = overrideCreateSchema.parse(await readJsonBody(request));

  const schedule = await db.schedule.findUnique({ where: { id } });
  if (!schedule || schedule.doctorId !== doctorId) {
    throw notFound('Schedule not found');
  }

  if (body.type === 'CLOSED' && (body.newStartTime !== undefined || body.newEndTime !== undefined)) {
    throw validationError('A CLOSED override cannot carry newStartTime/newEndTime');
  }
  if (body.type !== 'CLOSED') {
    if (!body.newStartTime || !body.newEndTime) {
      throw validationError(`${body.type} requires newStartTime and newEndTime`);
    }
    if (body.newStartTime >= body.newEndTime) {
      throw validationError('newStartTime must be before newEndTime');
    }
  }

  const existing = await db.scheduleOverride.findUnique({
    where: { scheduleId_date: { scheduleId: id, date: body.date } },
    select: { id: true },
  });
  if (existing) {
    throw conflict('OVERRIDE_EXISTS', 'An override already exists for this date — delete it first');
  }

  let override;
  try {
    override = await db.scheduleOverride.create({
      data: {
        scheduleId: id,
        date: body.date,
        type: body.type,
        newStartTime: body.newStartTime ?? null,
        newEndTime: body.newEndTime ?? null,
        reason: body.reason ?? null,
        createdById: user.id,
      },
    });
  } catch (err) {
    // Concurrent create on the same (scheduleId, date) → same 409 code.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('OVERRIDE_EXISTS', 'An override already exists for this date — delete it first');
    }
    throw err;
  }

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'OVERRIDE_CHANGED',
      target: `schedule:${id}`,
      detail: JSON.stringify({ op: 'create', date: body.date, type: body.type }),
    },
  });

  return ok({ override }, 201);
});
