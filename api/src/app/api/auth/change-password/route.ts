import { handle, ok, readJsonBody } from '@/lib/errors';
import { changePassword, extractBearerToken } from '@/lib/auth';
import { requireAuth } from '@/lib/rbac';
import { changePasswordSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/change-password
 * Authenticated password change. Clears mustChangePassword (completes the
 * compounder onboarding flow) and revokes all OTHER sessions — the caller's
 * current session stays valid.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request);
  const body = changePasswordSchema.parse(await readJsonBody(request));
  const updated = await changePassword(
    user,
    body.currentPassword,
    body.newPassword,
    extractBearerToken(request),
  );
  return ok({ user: updated });
});
