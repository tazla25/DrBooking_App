import { handle, ok, readJsonBody } from '@/lib/errors';
import { registerUser } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { clientIp } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register
 * Self-signup for PATIENT or DOCTOR. DOCTOR accounts start as PENDING and
 * must be verified by a SUPER_ADMIN before accessing doctor-scoped routes.
 * 409 when the phone number is already registered. Audits the registration.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const body = registerSchema.parse(await readJsonBody(request));
  const user = await registerUser(body, {
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  });
  return ok({ user }, 201);
});
