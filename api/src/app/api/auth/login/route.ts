import { handle, ok, readJsonBody } from '@/lib/errors';
import { login } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Phone + password → opaque bearer token (30-day session).
 * Failures are intentionally indistinguishable (never reveal which field was
 * wrong). Locked out after 5 failures within 15 minutes (429 ACCOUNT_LOCKED).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const body = loginSchema.parse(await readJsonBody(request));
  const result = await login(body.phone, body.password, { ipAddress: clientIp(request) });
  return ok({
    token: result.token,
    expiresAt: result.expiresAt,
    user: result.user,
  });
});
