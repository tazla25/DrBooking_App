import { Prisma } from '@prisma/client';
import { handle, ok, readJsonBody, notFound } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { availabilitySchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/availability  (#25) — DOCTOR/COMPOUNDER.
 * The DOCTOR toggles their own profile; a COMPOUNDER toggles their delegated
 * doctor's profile — both resolve to the same scope.doctorId (the ONLY
 * trusted value; a client-sent doctorId is never consulted).
 */
export const PATCH = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireVerifiedStaffScope(request);
  const body = availabilitySchema.parse(await readJsonBody(request));

  let profile: { id: string; isAvailableNow: boolean } | null = null;
  try {
    profile = await db.doctorProfile.update({
      where: { id: doctorId },
      data: { isAvailableNow: body.isAvailableNow },
      select: { id: true, isAvailableNow: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw notFound('Doctor profile not found');
    }
    throw err;
  }

  return ok({ isAvailableNow: profile.isAvailableNow });
});
