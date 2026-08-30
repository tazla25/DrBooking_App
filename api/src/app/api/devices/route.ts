import { handle, ok, readJsonBody } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { deviceTokenSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/devices  (#33, ANY authenticated role) — register a push device.
 *
 * Upsert keyed on the token's unique constraint: if the token already exists
 * it is MOVED to the caller (userId + platform updated — a device handed
 * over to a new account stops receiving the previous user's notifications);
 * otherwise a new DeviceToken row is created. Returns { id }.
 */
export const POST = handle(async (request: Request): Promise<Response> => {
  const user = await requireAuth(request); // any role
  const body = deviceTokenSchema.parse(await readJsonBody(request));

  const device = await db.deviceToken.upsert({
    where: { token: body.token },
    update: { userId: user.id, platform: body.platform },
    create: { token: body.token, userId: user.id, platform: body.platform },
    select: { id: true },
  });

  return ok({ id: device.id });
});
