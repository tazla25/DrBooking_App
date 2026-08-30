import { handle, ok, readJsonBody } from '@/lib/errors';
import { registerUser } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { clientIp } from '@/lib/request';
import { checkRegisterRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register
 * Self-signup for PATIENT or DOCTOR. DOCTOR accounts start as PENDING and
 * must be verified by a SUPER_ADMIN before accessing doctor-scoped routes.
 * 409 when the phone number is already registered. Audits the registration.
 * Rate limited per IP (5 per 15 min default) — 429 RATE_LIMITED (bypassed
 * in test env, see src/lib/rate-limit.ts).
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  checkRegisterRateLimit(clientIp(request));
  const body = registerSchema.parse(await readJsonBody(request));
  const user = await registerUser(body, {
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  });
  return ok({ user }, 201);
});
