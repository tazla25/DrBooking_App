import { handle, ok, readJsonBody, notFound, conflict } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import {
  doctorProfilePatchSchema,
  AVATAR_MAX_CHARS,
  AVATAR_DATA_URL_RE,
  REGISTRATION_NUMBER_RE,
  REGISTRATION_NUMBER_MIN,
  REGISTRATION_NUMBER_MAX,
} from '@/lib/validation';
import { publicDoctorView } from '@/lib/public';
import { db } from '@/lib/db';
import type { DoctorProfile } from '@prisma/client';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Phase 11 A2 — doctor self-service profile.
 *
 *  GET   /api/doctors/me   → the caller's OWN profile (publicDoctorView shape).
 *  PATCH /api/doctors/me   → partial update of the editable fields.
 *
 * Auth law (mirrors requireVerifiedDoctor without importing the compounder
 * path): bearer token, role MUST be DOCTOR (a COMPOUNDER gets 403), and the
 * account MUST be VERIFIED (PENDING/REJECTED doctors get 403
 * DOCTOR_NOT_VERIFIED — they are not publicly editable). The doctorId is
 * ALWAYS resolved server-side from the session (never from body/query) — a
 * doctor can only ever see/edit their own profile.
 *
 * fullName is NOT editable in this phase (A2 scope decision).
 *
 * PATCH semantics:
 *  - zod validates shapes (doctorProfilePatchSchema: every field optional,
 *    at least one required, unknown keys rejected via .strict());
 *  - avatarUrl value rules run HERE so they can carry their own codes:
 *    >300,000 chars → 400 AVATAR_TOO_LARGE; wrong data-URL form →
 *    400 AVATAR_INVALID. null clears (stores NULL).
 *  - the audit row (DOCTOR_PROFILE_UPDATED, target doctor:<id>) records the
 *    JSON list of CHANGED KEYS ONLY — never values, never the avatar itself.
 *  - response = the refreshed publicDoctorView (nothing secret involved).
 */

/** Fetch the session doctor's own profile row, or null when none is linked. */
async function findOwnProfile(userId: string): Promise<DoctorProfile | null> {
  return db.doctorProfile.findUnique({ where: { userId } });
}

export const GET = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request, ['DOCTOR']);
  if (user.verificationStatus !== 'VERIFIED') {
    throw new ApiError(403, 'DOCTOR_NOT_VERIFIED', 'Your doctor account has not been verified yet');
  }

  const profile = await findOwnProfile(user.id);
  if (!profile) {
    throw notFound('Doctor profile not found');
  }

  return ok(publicDoctorView(profile));
});

export const PATCH = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request, ['DOCTOR']);
  if (user.verificationStatus !== 'VERIFIED') {
    throw new ApiError(403, 'DOCTOR_NOT_VERIFIED', 'Your doctor account has not been verified yet');
  }

  const profile = await findOwnProfile(user.id);
  if (!profile) {
    throw notFound('Doctor profile not found');
  }

  const patch = doctorProfilePatchSchema.parse(await readJsonBody(request));

  // Avatar value rules (route-level so the codes are AVATAR_*), then the
  // registration-number rules (400 REGISTRATION_NUMBER_INVALID per the
  // Phase 11 spec — stricter than a generic zod 422). Every invalid value of
  // these two fields gets ONE consistent 400 code.
  if (patch.avatarUrl !== undefined && patch.avatarUrl !== null) {
    if (patch.avatarUrl.length > AVATAR_MAX_CHARS) {
      throw new ApiError(
        400,
        'AVATAR_TOO_LARGE',
        `Avatar must be at most ${AVATAR_MAX_CHARS} characters`,
      );
    }
    if (!AVATAR_DATA_URL_RE.test(patch.avatarUrl)) {
      throw new ApiError(
        400,
        'AVATAR_INVALID',
        'Avatar must be a data:image/jpeg;base64 or data:image/png;base64 URL',
      );
    }
  }
  if (patch.registrationNumber !== undefined && patch.registrationNumber !== null) {
    const reg = patch.registrationNumber; // already trimmed by zod
    if (
      reg.length < REGISTRATION_NUMBER_MIN ||
      reg.length > REGISTRATION_NUMBER_MAX ||
      !REGISTRATION_NUMBER_RE.test(reg)
    ) {
      throw new ApiError(
        400,
        'REGISTRATION_NUMBER_INVALID',
        'Registration number must be 3-40 characters (letters, digits, - . / and spaces)',
      );
    }
  }

  // Changed KEYS only (value comparison — sending an unchanged value is not a
  // change). bio keeps its only-when-present response convention but compares
  // with '' so an explicit empty string counts as clearing a stored bio.
  const changedKeys: string[] = [];
  if (patch.specialization !== undefined && patch.specialization !== profile.specialization) {
    changedKeys.push('specialization');
  }
  if (patch.fee !== undefined && patch.fee !== profile.fee) {
    changedKeys.push('fee');
  }
  if (patch.yearsExperience !== undefined && patch.yearsExperience !== profile.yearsExperience) {
    changedKeys.push('yearsExperience');
  }
  if (patch.bio !== undefined && patch.bio !== (profile.bio ?? '')) {
    changedKeys.push('bio');
  }
  if (
    patch.registrationNumber !== undefined &&
    patch.registrationNumber !== profile.registrationNumber
  ) {
    changedKeys.push('registrationNumber');
  }
  if (patch.avatarUrl !== undefined && patch.avatarUrl !== profile.avatarUrl) {
    changedKeys.push('avatarUrl');
  }

  // Empty-string bio clears the stored value (normalized to NULL on write);
  // empty-string registrationNumber is rejected by zod min(3) long before here.
  const data: Record<string, unknown> = {};
  if (patch.specialization !== undefined) {
    data.specialization = patch.specialization.trim() === '' ? null : patch.specialization;
  }
  if (patch.fee !== undefined) data.fee = patch.fee;
  if (patch.yearsExperience !== undefined) data.yearsExperience = patch.yearsExperience;
  if (patch.bio !== undefined) data.bio = patch.bio.trim() === '' ? null : patch.bio;
  if (patch.registrationNumber !== undefined) {
    data.registrationNumber =
      patch.registrationNumber === null || patch.registrationNumber === ''
        ? null
        : patch.registrationNumber;
  }
  if (patch.avatarUrl !== undefined) data.avatarUrl = patch.avatarUrl;

  const updated = await db.doctorProfile
    .update({ where: { id: profile.id }, data })
    .catch((err: unknown) => {
      // Paranoia: a rejected profile write must never 500 opaquely.
      if (err instanceof ApiError) throw err;
      throw conflict('PROFILE_UPDATE_FAILED', 'Could not update the profile');
    });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: 'DOCTOR_PROFILE_UPDATED',
      target: `doctor:${profile.id}`,
      detail: JSON.stringify({ changedKeys }),
    },
  });

  return ok(publicDoctorView(updated));
});
