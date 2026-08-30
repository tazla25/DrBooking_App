import { handle, ok } from '@/lib/errors';
import { requireAuth } from '@/lib/rbac';
import { pageLimitQuerySchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/pending-doctors  (#26, SUPER_ADMIN only — any other role 403).
 *
 * Users with role=DOCTOR AND verificationStatus=PENDING, each with their
 * DoctorProfile fields. Oldest first (FIFO verification queue).
 * Paginated: ?page=&limit= → { items, total, page, limit }.
 * SUPER_ADMIN has NO doctorId scope — this route never accepts one.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  await requireAuth(request, ['SUPER_ADMIN']);
  const url = new URL(request.url);
  const query = pageLimitQuerySchema.parse(Object.fromEntries(url.searchParams));

  const where = { role: 'DOCTOR', verificationStatus: 'PENDING' };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        doctorProfile: {
          select: {
            id: true,
            fullName: true,
            specialization: true,
            fee: true,
            yearsExperience: true,
            bio: true,
            isAvailableNow: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const items = users.map((user) => ({
    id: user.id,
    phone: user.phone, // SUPER_ADMIN verification workflow needs the contact number
    name: user.name,
    verificationStatus: user.verificationStatus,
    createdAt: user.createdAt,
    doctorProfile: user.doctorProfile
      ? {
          id: user.doctorProfile.id,
          fullName: user.doctorProfile.fullName,
          specialization: user.doctorProfile.specialization,
          fee: user.doctorProfile.fee,
          yearsExperience: user.doctorProfile.yearsExperience,
          bio: user.doctorProfile.bio,
          isAvailableNow: user.doctorProfile.isAvailableNow,
          createdAt: user.doctorProfile.createdAt,
        }
      : null,
  }));

  return ok({ items, total, page: query.page, limit: query.limit });
});
