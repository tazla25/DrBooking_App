import { handle, ok } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { patientsQuerySchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PatientRow {
  name: string;
  phone: string;
  lastVisit: string;
  totalVisits: number;
  lastStatus: string;
}

/**
 * GET /api/patients  (#21) — distinct patients across the scoped doctor's
 * appointments (group by patientPhone, keep the latest patientName).
 *
 *  - lastVisit / lastStatus come from the patient's most recent appointment;
 *  - totalVisits counts non-cancelled appointments (fixes the broken v1
 *    pagination: real total + page/pageSize slicing over the grouped set).
 *  - ?q= matches name or phone (contains, case-insensitive).
 *
 * Grouping/search/pagination is done in JS over the scoped doctor's rows so
 * the behavior is identical on SQLite (dev) and Postgres/Supabase (prod) —
 * no `mode: 'insensitive'` (Postgres-only) anywhere.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireVerifiedStaffScope(request);
  const url = new URL(request.url);
  const query = patientsQuerySchema.parse(Object.fromEntries(url.searchParams));

  const appointments = await db.appointment.findMany({
    where: { doctorId },
    select: { patientName: true, patientPhone: true, date: true, status: true, createdAt: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  // Group by phone — appointments arrive newest-first, so the first row per
  // phone carries the latest name/date/status.
  const byPhone = new Map<string, PatientRow>();
  for (const appt of appointments) {
    const existing = byPhone.get(appt.patientPhone);
    if (!existing) {
      byPhone.set(appt.patientPhone, {
        name: appt.patientName,
        phone: appt.patientPhone,
        lastVisit: appt.date,
        lastStatus: appt.status,
        totalVisits: 0,
      });
    }
    if (appt.status !== 'CANCELLED') {
      byPhone.get(appt.patientPhone)!.totalVisits += 1;
    }
  }

  let patients = Array.from(byPhone.values());

  if (query.q) {
    const needle = query.q.toLowerCase();
    patients = patients.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.phone.includes(needle),
    );
  }

  // Most recently seen patients first (deterministic secondary sort by name).
  patients.sort((a, b) => (a.lastVisit !== b.lastVisit ? (a.lastVisit < b.lastVisit ? 1 : -1) : a.name.localeCompare(b.name)));

  const total = patients.length;
  const start = (query.page - 1) * query.pageSize;
  const pageItems = patients.slice(start, start + query.pageSize);

  return ok({ total, page: query.page, pageSize: query.pageSize, patients: pageItems });
});
