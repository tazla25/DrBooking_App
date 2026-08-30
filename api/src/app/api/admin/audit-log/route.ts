import { handle, ok } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { auditLogQuerySchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-log  (#28, SUPER_ADMIN only).
 *
 * Append-only audit trail, newest first. Filters: ?userId= (actorId exact),
 * ?action= (exact, e.g. DOCTOR_VERIFIED). Paginated ?page=&limit= →
 * { items, total, page, limit }.
 *
 * `detail` stays the raw JSON-encoded string as stored (the admin UI parses
 * it); `actor` is embedded for readability. Deleted/unknown actors surface as
 * null (AuditLog.actorId is SetNull on user delete).
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  await requireAuth(request, ['SUPER_ADMIN']);
  const url = new URL(request.url);
  const query = auditLogQuerySchema.parse(Object.fromEntries(url.searchParams));

  const where = {
    ...(query.userId ? { actorId: query.userId } : {}),
    ...(query.action ? { action: query.action } : {}),
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actor: row.actor ? { id: row.actor.id, name: row.actor.name, role: row.actor.role } : null,
    action: row.action,
    target: row.target,
    detail: row.detail,
    createdAt: row.createdAt,
  }));

  return ok({ items, total, page: query.page, limit: query.limit });
});
