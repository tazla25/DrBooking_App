import { handle, ok, readJsonBody } from '@/lib/errors';
import { requireVerifiedStaffScope } from '@/lib/rbac';
import { phoneSchema, noteCreateSchema } from '@/lib/validation';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ phone: string }> };

/**
 * Patient notes (shared within one doctor's team — fixes the v1 broken
 * sharing): keyed by patient phone (works for walk-ins without accounts),
 * visible to the scoped doctor AND all their compounders, author recorded.
 */

/** GET /api/patients/:phone/notes — newest first, with author identity. */
export const GET = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  await requireVerifiedStaffScope(request);
  const { phone: rawPhone } = await context.params;
  const phone = phoneSchema.parse(rawPhone); // normalize + validate the path param

  const notes = await db.patientNote.findMany({
    where: { patientPhone: phone },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  return ok({
    notes: notes.map((note) => ({
      id: note.id,
      note: note.note,
      isImportant: note.isImportant,
      author: note.author ? { id: note.author.id, name: note.author.name, role: note.author.role } : null,
      createdAt: note.createdAt,
    })),
  });
});

/** POST /api/patients/:phone/notes — authorId = the calling staff user. */
export const POST = handle(async (request: Request, context: RouteContext): Promise<Response> => {
  const { user } = await requireVerifiedStaffScope(request);
  const { phone: rawPhone } = await context.params;
  const phone = phoneSchema.parse(rawPhone);
  const body = noteCreateSchema.parse(await readJsonBody(request));

  const note = await db.patientNote.create({
    data: {
      patientPhone: phone,
      authorId: user.id,
      note: body.note,
      isImportant: body.isImportant ?? false,
    },
    include: { author: { select: { id: true, name: true, role: true } } },
  });

  return ok(
    {
      note: {
        id: note.id,
        note: note.note,
        isImportant: note.isImportant,
        author: note.author
          ? { id: note.author.id, name: note.author.name, role: note.author.role }
          : null,
        createdAt: note.createdAt,
      },
    },
    201,
  );
});
