import { handle, ok } from '@/lib/errors';
import { logout } from '@/lib/auth';
import { requireAuth } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 * Revokes the session backing the request's bearer token.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  await requireAuth(request);
  await logout(request);
  return ok({ success: true });
});
