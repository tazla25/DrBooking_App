import { handle, ok } from '@/lib/errors';
import { requireDoctorOrAdminTarget } from '@/lib/rbac';
import { revenueQuerySchema } from '@/lib/validation';
import { revenueSeries } from '@/lib/analytics';
import { istTodayISO } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics/revenue?days=30  (#30) — DOCTOR (own scope) or
 * SUPER_ADMIN (?doctorId=<DoctorProfile.id> required, else 422).
 * COMPOUNDER/PATIENT → 403 per contract.
 *
 * Daily series [{ date, count, revenue }] of COMPLETED appointments over the
 * last `days` IST days (1..365, default 30), zero-filled, ascending.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireDoctorOrAdminTarget(request);
  const url = new URL(request.url);
  const query = revenueQuerySchema.parse(Object.fromEntries(url.searchParams));

  const series = await revenueSeries(doctorId, query.days);

  return ok({
    doctorId,
    days: query.days,
    today: istTodayISO(),
    series,
  });
});
