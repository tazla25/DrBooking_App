import { db } from '@/lib/db';
import { handle, ok } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { toSafeUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Current authenticated user (safe fields), plus the linked doctor profile
 * when the account has one (DOCTOR), and the delegated doctor for COMPOUNDER.
 *
 * Phase 11 (A3, additive): doctorProfile now carries the profile-edit fields
 * (fee, yearsExperience, bio, registrationNumber, avatarUrl) so the mobile
 * edit form hydrates from ONE call — the same values publicDoctorView
 * exposes, nothing secret. Compounders see the same shape for their
 * delegated doctor (read-only for them — PATCH /api/doctors/me is 403).
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request);

  let doctorProfile: {
    id: string;
    fullName: string;
    specialization: string | null;
    fee: number | null;
    yearsExperience: number | null;
    bio: string | null;
    registrationNumber: string | null;
    avatarUrl: string | null;
  } | null = null;
  if (user.role === 'DOCTOR') {
    const profile = await db.doctorProfile.findUnique({ where: { userId: user.id } });
    if (profile) {
      doctorProfile = {
        id: profile.id,
        fullName: profile.fullName,
        specialization: profile.specialization,
        fee: profile.fee,
        yearsExperience: profile.yearsExperience,
        bio: profile.bio,
        registrationNumber: profile.registrationNumber,
        avatarUrl: profile.avatarUrl,
      };
    }
  } else if (user.role === 'COMPOUNDER' && user.delegatedDoctorId) {
    const delegated = await db.doctorProfile.findUnique({ where: { id: user.delegatedDoctorId } });
    if (delegated) {
      doctorProfile = {
        id: delegated.id,
        fullName: delegated.fullName,
        specialization: delegated.specialization,
        fee: delegated.fee,
        yearsExperience: delegated.yearsExperience,
        bio: delegated.bio,
        registrationNumber: delegated.registrationNumber,
        avatarUrl: delegated.avatarUrl,
      };
    }
  }

  return ok({ user: toSafeUser(user), doctorProfile });
});
