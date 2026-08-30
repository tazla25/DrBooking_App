import { handle, validationError } from '@/lib/errors';
import { requireDoctorOrAdminTarget } from '@/lib/rbac';
import { exportQuerySchema } from '@/lib/validation';
import { toCsvRow } from '@/lib/csv';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CSV_HEADER = [
  'date',
  'queueNumber',
  'patientName',
  'phone',
  'doctorName',
  'clinicName',
  'status',
  'source',
  'fee',
] as const;

/** Stream rows in batches of this size (genuine incremental streaming). */
const BATCH_SIZE = 500;

/**
 * GET /api/export/appointments  (#31) — DOCTOR (own scope) or SUPER_ADMIN
 * (?doctorId=<DoctorProfile.id>, else 422). COMPOUNDER/PATIENT → 403.
 *
 * Query: ?from=&to= (IST 'YYYY-MM-DD', default today-30 .. today). Answer is
 * a STREAMED text/csv attachment (NOT the JSON envelope; errors still are).
 *
 * Every cell goes through escapeCsvCell (old-repo bug #9): cells starting
 * with = + - @ get a leading quote and CR/LF is stripped — note that phones
 * are stored with a leading '+' and are therefore intentionally escaped.
 */
export const GET = handle(async (request: Request): Promise<Response> => {
  const { doctorId } = await requireDoctorOrAdminTarget(request);

  const url = new URL(request.url);
  const query = exportQuerySchema.parse(Object.fromEntries(url.searchParams));
  const to = query.to ?? istTodayISO();
  const from = query.from ?? addDaysISO(to, -30);
  if (from > to) {
    throw validationError('from must be on or before to');
  }

  const where = { doctorId, date: { gte: from, lte: to } };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      try {
        // UTF-8 BOM so Excel renders Indian-language names correctly.
        controller.enqueue(encoder.encode('\uFEFF'));
        controller.enqueue(encoder.encode(`${toCsvRow(CSV_HEADER)}\n`));

        // Deterministic order for cursor pagination: (date, queueNumber) is
        // NOT unique across schedules on the same date, so id is the final
        // tiebreaker.
        let cursorId: string | undefined;
        for (;;) {
          const batch = await db.appointment.findMany({
            where,
            orderBy: [{ date: 'asc' }, { queueNumber: 'asc' }, { id: 'asc' }],
            take: BATCH_SIZE,
            ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
            include: {
              doctor: { select: { fullName: true } },
              schedule: { select: { clinicName: true } },
            },
          });
          if (batch.length === 0) break;

          for (const appt of batch) {
            const line = toCsvRow([
              appt.date,
              appt.queueNumber,
              appt.patientName,
              appt.patientPhone,
              appt.doctor.fullName,
              appt.schedule.clinicName,
              appt.status,
              appt.source,
              appt.fee,
            ]);
            controller.enqueue(encoder.encode(`${line}\n`));
          }

          if (batch.length < BATCH_SIZE) break;
          cursorId = batch[batch.length - 1].id;
        }
        controller.close();
      } catch (err) {
        // Client-visible errors are impossible past the first enqueue; just log.
        console.error('[export] csv stream failed:', err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="appointments_${from}_${to}.csv"`,
    },
  });
});
