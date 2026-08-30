import { handle, ok } from '@/lib/errors';
import { doctorsQuerySchema } from '@/lib/validation';
import { publicDoctorView } from '@/lib/public';
import { db } from '@/lib/db';
import type { DoctorProfile } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/doctors  (#6, PUBLIC — no auth) — browse VERIFIED doctors only.
 *
 *  - A doctor is publicly listable iff the backing user account is active AND
 *    verificationStatus = VERIFIED. PENDING/REJECTED doctors are invisible
 *    (they simply do not exist publicly).
 *  - ?q=        contains, case-insensitive, on fullName or specialization.
 *  - ?pinCode=  exact match on any ACTIVE schedule's pinCode.
 *  - ?sort=     rating (default) | fee_asc | fee_desc — null fees sort last.
 *  - ?page & ?pageSize (max 50).
 *
 * Determinism across SQLite AND Postgres: no `mode: 'insensitive'`
 * (Postgres-only). The q-filter, sorting and pagination run in JS over the
 * VERIFIED set — same approach as the Phase 2 patients route.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const query = doctorsQuerySchema.parse(Object.fromEntries(url.searchParams));

  let doctors = await db.doctorProfile.findMany({
    where: {
      user: { isActive: true, verificationStatus: 'VERIFIED' },
      ...(query.pinCode
        ? { schedules: { some: { isActive: true, pinCode: query.pinCode } } }
        : {}),
    },
    orderBy: { id: 'asc' }, // stable base order; final ordering happens below
  });

  if (query.q) {
    const needle = query.q.toLowerCase();
    doctors = doctors.filter(
      (d) =>
        d.fullName.toLowerCase().includes(needle) ||
        (d.specialization ?? '').toLowerCase().includes(needle),
    );
  }

  // Deterministic tiebreakers: fullName asc (codepoint order), then id asc.
  const byNameThenId = (a: DoctorProfile, b: DoctorProfile): number => {
    if (a.fullName !== b.fullName) return a.fullName < b.fullName ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };
  // Null/unknown fees always sort LAST regardless of direction; returns 0 when
  // both are comparable (or both null) so the directional term can decide.
  const nullsLast = (a: number | null, b: number | null): number => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return 0;
  };

  switch (query.sort) {
    case 'fee_asc':
      doctors.sort(
        (a, b) => nullsLast(a.fee, b.fee) || (a.fee ?? 0) - (b.fee ?? 0) || byNameThenId(a, b),
      );
      break;
    case 'fee_desc':
      doctors.sort(
        (a, b) => nullsLast(a.fee, b.fee) || (b.fee ?? 0) - (a.fee ?? 0) || byNameThenId(a, b),
      );
      break;
    case 'rating':
    default:
      doctors.sort((a, b) => b.avgRating - a.avgRating || byNameThenId(a, b));
      break;
  }

  const total = doctors.length;
  const start = (query.page - 1) * query.pageSize;
  const pageItems = doctors.slice(start, start + query.pageSize).map(publicDoctorView);

  return ok({ total, page: query.page, pageSize: query.pageSize, doctors: pageItems });
});
