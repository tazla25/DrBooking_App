import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import type { User } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError, conflict } from '@/lib/errors';
import type { RegisterInput } from '@/lib/validation';

/**
 * Phone + password authentication with opaque bearer tokens.
 *
 * Security model (fixes the v1 bugs):
 *  - Passwords: bcryptjs, 10 rounds. No plaintext, no reversible storage.
 *  - Tokens: 32 bytes of crypto-random, returned ONCE at login. The DB only
 *    stores SHA-256(token) in Session.tokenHash; lookups are re-verified with
 *    a constant-time comparison.
 *  - Login lockout: 5 failures within 15 minutes (per phone) → 429.
 *  - Login failures never reveal WHICH field was wrong, and a dummy bcrypt
 *    comparison runs for unknown phones so response timing does not leak
 *    account existence.
 *  - No secrets are ever returned to the caller (no OTP, no hashes, no tokens
 *    other than the caller's own session token at login).
 */

const BCRYPT_ROUNDS = 10;
const SESSION_TTL_DAYS = 30;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

/** bcrypt compare against a throwaway hash, used to equalize timing. */
const DUMMY_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZUbE0f6bZ0mCjq0ROC8pXlXGiEli6y';

// -- Passwords ----------------------------------------------------------------

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

// -- Tokens -------------------------------------------------------------------

/** Generate a new opaque token (raw form — only ever shown once, at login). */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hex digest of a token — the only thing persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time equality of two hex digests. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

// -- Public user shape ----------------------------------------------------------

export type SafeUser = {
  id: string;
  phone: string;
  name: string;
  role: string;
  verificationStatus: string;
  mustChangePassword: boolean;
  isActive: boolean;
  delegatedDoctorId: string | null;
  createdAt: Date;
};

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    verificationStatus: user.verificationStatus,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    delegatedDoctorId: user.delegatedDoctorId,
    createdAt: user.createdAt,
  };
}

// -- Registration ----------------------------------------------------------------

export async function registerUser(
  input: RegisterInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<SafeUser> {
  const { name, phone, password, role } = input;

  const existing = await db.user.findUnique({ where: { phone }, select: { id: true } });
  if (existing) {
    throw conflict('PHONE_EXISTS', 'An account with this phone number already exists');
  }

  const passwordHash = await hashPassword(password);
  const verificationStatus = role === 'DOCTOR' ? 'PENDING' : 'VERIFIED';

  // Single transaction: user (+ doctor stub profile) + audit row. Never a
  // check-then-insert without a transaction (v1 bug).
  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { phone, passwordHash, name, role, verificationStatus },
    });

    if (role === 'DOCTOR') {
      // Stub profile; SUPER_ADMIN completes specialization/fee during verification.
      await tx.doctorProfile.create({ data: { userId: user.id, fullName: name } });
    }

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: 'AUTH_REGISTER',
        target: `user:${user.id}`,
        detail: JSON.stringify({ role, phone, ip: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null }),
      },
    });

    return user;
  });

  return toSafeUser(created);
}

// -- Login -----------------------------------------------------------------------

interface LoginMeta {
  ipAddress?: string | null;
}

export interface LoginResult {
  user: SafeUser;
  token: string;
  expiresAt: Date;
}

export async function login(phone: string, password: string, meta: LoginMeta = {}): Promise<LoginResult> {
  await assertNotLockedOut(phone);

  const user = await db.user.findUnique({ where: { phone } });

  if (!user) {
    // Equalize timing so "unknown phone" is indistinguishable from "wrong password".
    await compare(password, DUMMY_HASH);
    await recordFailedLogin(phone, meta.ipAddress);
    throw invalidCredentials();
  }

  if (!user.isActive) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact support.');
  }

  const passwordOk = await compare(password, user.passwordHash);
  if (!passwordOk) {
    await recordFailedLogin(phone, meta.ipAddress);
    throw invalidCredentials();
  }

  const session = await createSession(user.id);
  // Successful login resets the failure counter for this phone.
  await db.failedLogin.deleteMany({ where: { phone } });

  return { user: toSafeUser(user), token: session.token, expiresAt: session.expiresAt };
}

function invalidCredentials(): ApiError {
  // Deliberately generic — never reveal which field was wrong.
  return new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid phone or password');
}

async function assertNotLockedOut(phone: string): Promise<void> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000);
  const failures = await db.failedLogin.count({
    where: { phone, attemptedAt: { gte: since } },
  });
  if (failures >= LOCKOUT_THRESHOLD) {
    throw new ApiError(
      429,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Please try again in a few minutes.',
    );
  }
}

async function recordFailedLogin(phone: string, ipAddress?: string | null): Promise<void> {
  await db.failedLogin.create({ data: { phone, ipAddress: ipAddress ?? null } });
}

// -- Sessions ----------------------------------------------------------------------

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

/** Extract the bearer token from an Authorization header (or null). */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ', 2).map((part) => part.trim());
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

/**
 * Resolve the current user from the Authorization header.
 * Returns null when the token is missing, unknown, expired, or the account
 * is deactivated. Hash lookup is re-verified with a constant-time compare.
 */
export async function getCurrentUser(request: Request): Promise<User | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const computedHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash: computedHash },
    include: { user: true },
  });

  // Constant-time verification of the stored digest (defense in depth).
  if (!session || !tokenHashesMatch(session.tokenHash, computedHash)) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.user.isActive) return null;

  return session.user;
}

/** Delete the session backing the request's bearer token. */
export async function logout(request: Request): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// -- Password change -----------------------------------------------------------------

export async function changePassword(
  user: User,
  currentPassword: string,
  newPassword: string,
  currentToken?: string | null,
): Promise<SafeUser> {
  const okCurrent = await compare(currentPassword, user.passwordHash);
  if (!okCurrent) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  const same = await compare(newPassword, user.passwordHash);
  if (same) {
    throw new ApiError(422, 'SAME_PASSWORD', 'New password must be different from the current password');
  }

  const passwordHash = await hashPassword(newPassword);
  const currentHash = currentToken ? hashToken(currentToken) : null;

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    // Revoke every OTHER session; keep the caller's current session alive.
    if (currentHash) {
      await tx.session.deleteMany({
        where: { userId: user.id, tokenHash: { not: currentHash } },
      });
    } else {
      await tx.session.deleteMany({ where: { userId: user.id } });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: 'AUTH_PASSWORD_CHANGED',
        target: `user:${user.id}`,
        detail: JSON.stringify({ revokedOtherSessions: true }),
      },
    });
    return saved;
  });

  return toSafeUser(updated);
}
