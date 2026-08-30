import { handle, ok } from '@/lib/errors';
import { requireDoctorOrAdminTarget } from '@/lib/rbac';
import { summaryMetrics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics/summary  (#29) — DOCTOR (own scope) or SUPER_ADMIN
 * (must target ?doctorId=<DoctorProfile.id>, else 422). COMPOUNDER/PATIENT
 * → 403 per contract. A client-sent doctorId is ignored for DOCTOR callers.
 *
 * IST day-window metrics: { today, last7d, last30d } ×
 * { booked, completed, cancelled, noShow, walkIns, revenue }.
 * revenue = sum of fee over COMPLETED appointments (both sources).
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireDoctorOrAdminTarget(request);
  const metrics = await summaryMetrics(doctorId);

  return ok({
    doctorId,
    todayDate: metrics.todayDate,
    last7dStart: metrics.last7dStart,
    last30dStart: metrics.last30dStart,
    today: metrics.today,
    last7d: metrics.last7d,
    last30d: metrics.last30d,
  });
});
