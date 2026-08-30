import type { User } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError, forbidden, unauthorized } from '@/lib/errors';
import { getCurrentUser } from '@/lib/auth';
import type { Role } from '@/lib/validation';

/**
 * Server-side role-based access control.
 *
 * RULES (fixes the v1 bugs):
 *  - EVERY non-public route calls requireAuth([roles]) server-side.
 *  - DOCTOR and COMPOUNDER data access is scoped by their doctorId via
 *    getDoctorScope(); a client-sent doctorId can never override the
 *    server-side scope — routes must ignore/validate any client doctorId.
 *  - COMPOUNDER inherits the delegated doctor's scope (User.delegatedDoctorId).
 *  - SUPER_ADMIN has no scope (null) = unrestricted.
 */

export interface DoctorScope {
  doctorId: string; // DoctorProfile.id — the ONLY trusted value
}

/**
 * Authenticate the request and (optionally) enforce roles.
 * Throws 401 (no/invalid token) or 403 (role not allowed, inactive handled
 * by getCurrentUser returning null).
 */
export async function requireAuth(request: Request, roles?: readonly Role[]): Promise<User> {
  const user = await getCurrentUser(request);
  if (!user) throw unauthorized();
  if (roles && roles.length > 0 && !roles.includes(user.role as Role)) {
    throw forbidden();
  }
  return user;
}

/** requireAuth for DOCTOR + VERIFIED — blocks PENDING/REJECTED doctors. */
export async function requireVerifiedDoctor(request: Request): Promise<User> {
  const user = await requireAuth(request, ['DOCTOR']);
  if (user.verificationStatus !== 'VERIFIED') {
    throw new ApiError(403, 'DOCTOR_NOT_VERIFIED', 'Your doctor account has not been verified yet');
  }
  return user;
}

/**
 * Phase 2 staff gate: DOCTOR or COMPOUNDER, caller must be VERIFIED.
 * PENDING/REJECTED doctors get 403 DOCTOR_NOT_VERIFIED on every doctor-panel
 * route (contracts #13–25). Compounders are provisioned VERIFIED at creation,
 * so this check only ever trips for doctors.
 */
export async function requireVerifiedStaff(request: Request): Promise<User> {
  const user = await requireAuth(request, ['DOCTOR', 'COMPOUNDER']);
  if (user.verificationStatus !== 'VERIFIED') {
    throw new ApiError(403, 'DOCTOR_NOT_VERIFIED', 'Your doctor account has not been verified yet');
  }
  return user;
}

/**
 * Phase 2 staff-or-admin gate: verified DOCTOR/COMPOUNDER, or SUPER_ADMIN
 * (null scope — the caller must handle admin targeting via ?doctorId=).
 * Used by the read routes where SUPER_ADMIN has read-only access.
 */
export async function requireStaffOrAdmin(request: Request): Promise<User> {
  const user = await requireAuth(request, ['DOCTOR', 'COMPOUNDER', 'SUPER_ADMIN']);
  if (user.role !== 'SUPER_ADMIN' && user.verificationStatus !== 'VERIFIED') {
    throw new ApiError(403, 'DOCTOR_NOT_VERIFIED', 'Your doctor account has not been verified yet');
  }
  return user;
}

/**
 * Verified staff (DOCTOR/COMPOUNDER) + their NON-NULL doctor scope in one
 * call. The single entry point for every staff-write route (#13–25):
 * the returned doctorId is the ONLY trusted filter for data access.
 */
export async function requireVerifiedStaffScope(
  request: Request,
): Promise<{ user: User; doctorId: string }> {
  const user = await requireVerifiedStaff(request);
  const scope = await getDoctorScope(user);
  if (!scope) {
    // Unreachable: requireVerifiedStaff rejects SUPER_ADMIN (the only null scope).
    throw forbidden();
  }
  return { user, doctorId: scope.doctorId };
}

/**
 * Verified DOCTOR + their NON-NULL scope — for doctor-ONLY management routes
 * (compounder provisioning, #23–24: compounders must not manage compounders).
 */
export async function requireVerifiedDoctorScope(
  request: Request,
): Promise<{ user: User; doctorId: string }> {
  const user = await requireVerifiedDoctor(request);
  const scope = await getDoctorScope(user);
  if (!scope) {
    // Unreachable: requireVerifiedDoctor rejects SUPER_ADMIN (the only null scope).
    throw forbidden();
  }
  return { user, doctorId: scope.doctorId };
}

/**
 * Resolve the doctor scope for clinical data access.
 *
 *  - DOCTOR      → their own DoctorProfile.id
 *  - COMPOUNDER  → the delegated doctor's DoctorProfile.id (inherited scope)
 *  - SUPER_ADMIN → null (unrestricted — caller must handle null explicitly)
 *  - PATIENT     → 403 (patients never get a doctor scope)
 *
 * NOTE: This is the ONLY place scope is derived, always server-side, always
 * from the authenticated user — never from request parameters.
 */
export async function getDoctorScope(user: User): Promise<DoctorScope | null> {
  switch (user.role) {
    case 'SUPER_ADMIN':
      return null;

    case 'DOCTOR': {
      const profile = await db.doctorProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        throw new ApiError(403, 'NO_DOCTOR_PROFILE', 'No doctor profile is linked to this account');
      }
      return { doctorId: profile.id };
    }

    case 'COMPOUNDER': {
      if (!user.delegatedDoctorId) {
        throw new ApiError(403, 'NO_DELEGATED_DOCTOR', 'This compounder is not delegated to any doctor');
      }
      // Inherit the delegated doctor's scope.
      return { doctorId: user.delegatedDoctorId };
    }

    default:
      throw forbidden('Patients cannot access doctor-scoped resources');
  }
}

/**
 * Phase 4 gate for analytics (#29–30) and CSV export (#31):
 *  - DOCTOR       → own doctorId scope (compounders have none of these
 *                   contracts → plain 403 from requireAuth).
 *  - SUPER_ADMIN  → MUST target a doctor via ?doctorId= (a DoctorProfile.id);
 *                   missing or unknown → 422 (the admin has no doctorId scope
 *                   of their own and these routes never guess one).
 * A client-sent doctorId is IGNORED for DOCTOR callers (scope law).
 */
export async function requireDoctorOrAdminTarget(
  request: Request,
): Promise<{ user: User; doctorId: string }> {
  const user = await requireAuth(request, ['DOCTOR', 'SUPER_ADMIN']);

  if (user.role === 'DOCTOR') {
    const scope = await getDoctorScope(user);
    // Unreachable in practice: DOCTOR always has a profile or getDoctorScope throws.
    if (!scope) throw forbidden();
    return { user, doctorId: scope.doctorId };
  }

  // SUPER_ADMIN — the target must come from the query string.
  const url = new URL(request.url);
  const target = url.searchParams.get('doctorId')?.trim() ?? '';
  if (!target) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'doctorId query parameter is required for SUPER_ADMIN');
  }
  const profile = await db.doctorProfile.findUnique({ where: { id: target }, select: { id: true } });
  if (!profile) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'doctorId must be a valid DoctorProfile id');
  }
  return { user, doctorId: profile.id };
}
