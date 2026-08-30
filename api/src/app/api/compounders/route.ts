import { randomInt } from 'node:crypto';
import { handle, ok, readJsonBody, conflict } from '@/lib/errors';
import { requireVerifiedDoctorScope } from '@/lib/rbac';
import { hashPassword, toSafeUser } from '@/lib/auth';
import { compounderCreateSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TEMP_PASSWORD_LENGTH = 12;
// Unambiguous alphabet (no 0/O, 1/l/I) — still guarantees letters AND digits.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Crypto-random temp password: 12 chars, at least one letter and one number.
 * Shown ONCE in the create response; only the bcrypt hash is stored.
 */
function generateTempPassword(): string {
  for (;;) {
    let pw = '';
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
      pw += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
    }
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

/**
 * Compounder management (#23) — DOCTOR-only (compounders cannot manage
 * compounders).
 */

/** GET /api/compounders — my delegated compounders (active and deactivated). */
export const GET = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireVerifiedDoctorScope(request);

  const compounders = await db.user.findMany({
    where: { role: 'COMPOUNDER', delegatedDoctorId: doctorId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      phone: true,
      isActive: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  return ok({ compounders });
});

/**
 * POST /api/compounders — provision a compounder for MY practice.
 * 409 PHONE_EXISTS when the phone is already registered. The generated temp
 * password (12 chars, crypto-random, letters+digits) is returned ONCE here;
 * the DB stores only its bcrypt hash. Audits COMPOUNDER_CREATED.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const { user: doctor, doctorId } = await requireVerifiedDoctorScope(request);
  const body = compounderCreateSchema.parse(await readJsonBody(request));

  const existing = await db.user.findUnique({
    where: { phone: body.phone },
    select: { id: true },
  });
  if (existing) {
    throw conflict('PHONE_EXISTS', 'An account with this phone number already exists');
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phone: body.phone,
        passwordHash,
        name: body.name,
        role: 'COMPOUNDER',
        verificationStatus: 'VERIFIED',
        mustChangePassword: true, // forced password change at first login
        delegatedDoctorId: doctorId, // inherits MY scope
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: doctor.id,
        action: 'COMPOUNDER_CREATED',
        target: `user:${created.id}`,
        detail: JSON.stringify({ phone: created.phone, delegatedDoctorId: doctorId }),
      },
    });
    return created;
  });

  // tempPassword is NEVER persisted in plaintext, never logged, shown once.
  return ok({ user: toSafeUser(user), tempPassword }, 201);
});
