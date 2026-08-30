import { db } from '@/lib/db';
import { handle, ok } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { toSafeUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Current authenticated user (safe fields), plus the linked doctor profile
 * when the account has one (DOCTOR), and the delegated doctor for COMPOUNDER.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request);

  let doctorProfile: { id: string; fullName: string; specialization: string | null } | null = null;
  if (user.role === 'DOCTOR') {
    const profile = await db.doctorProfile.findUnique({ where: { userId: user.id } });
    if (profile) {
      doctorProfile = {
        id: profile.id,
        fullName: profile.fullName,
        specialization: profile.specialization,
      };
    }
  } else if (user.role === 'COMPOUNDER' && user.delegatedDoctorId) {
    const delegated = await db.doctorProfile.findUnique({ where: { id: user.delegatedDoctorId } });
    if (delegated) {
      doctorProfile = {
        id: delegated.id,
        fullName: delegated.fullName,
        specialization: delegated.specialization,
      };
    }
  }

  return ok({ user: toSafeUser(user), doctorProfile });
});
