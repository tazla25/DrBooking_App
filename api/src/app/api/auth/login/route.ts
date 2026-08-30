import { handle, ok, readJsonBody } from '@/lib/errors';
import { login } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { clientIp } from '@/lib/request';
import { checkLoginRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Phone + password → opaque bearer token (30-day session).
 * Failures are intentionally indistinguishable (never reveal which field was
 * wrong). Locked out after 5 failures within 15 minutes (429 ACCOUNT_LOCKED).
 * Rate limited per IP (10/min default) BEFORE any DB/bcrypt work — 429
 * RATE_LIMITED with Retry-After (bypassed in test env, see src/lib/rate-limit.ts).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  checkLoginRateLimit(clientIp(request));
  const body = loginSchema.parse(await readJsonBody(request));
  const result = await login(body.phone, body.password, { ipAddress: clientIp(request) });
  return ok({
    token: result.token,
    expiresAt: result.expiresAt,
    user: result.user,
  });
});
