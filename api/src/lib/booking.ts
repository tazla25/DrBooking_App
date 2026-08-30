import { Prisma, type Appointment, type Schedule, type ScheduleOverride } from '@prisma/client';
import { db } from '@/lib/db';
import { conflict, notFound } from '@/lib/errors';

/**
 * Shared booking core (Phase 3, contracts #6–8) — the ONE place where a
 * queue-numbered appointment is inserted. Both entry points MUST use it:
 *  - staff walk-in   (Phase 2 #17, patientId = null, free-typed identity)
 *  - patient booking (Phase 3 #8,  identity strictly from the session)
 *
 * The transaction body performs, in order:
 *   1. CLOSED-override check for (scheduleId, date)      → 409 SCHEDULE_CLOSED
 *   2. duplicate-active guard (INSIDE the transaction — v1 bug #4)
 *      - patientId path  : same patientId + schedule + date, CONFIRMED|CALLED
 *      - walk-in path    : same phone   + schedule + date, CONFIRMED|CALLED
 *   3. queueNumber = max(scheduleId+date, ALL statuses) + 1  (numbers are
 *      never reused, even after cancellations)
 *   4. insert
 *
 * Retries on Prisma P2002 (queue-number unique race) / P2034 (write conflict)
 * live HERE — `runBookingTransaction` re-runs the whole body up to 3 attempts.
 */

export type BookingSource = 'ONLINE' | 'WALK_IN';

export interface BookInQueueInput {
  scheduleId: string;
  date: string; // 'YYYY-MM-DD' (IST)
  /** Session user id for patient bookings; null for walk-ins. */
  patientId: string | null;
  patientName: string;
  patientPhone: string;
  source: BookingSource;
  /** Fee at booking time; defaults to the doctor's current fee when omitted. */
  fee?: number | null;
  notes?: string | null;
  /** Error shape for the duplicate-active guard (defaults per path). */
  duplicate?: { code: string; message: string };
}

/**
 * Insert one appointment into a schedule's queue inside a transaction.
 * `tx` MUST be a Prisma transaction client so the guards and the insert are
 * atomic with the caller's surrounding checks (capacity, counters…).
 */
export async function bookInQueue(
  tx: Prisma.TransactionClient,
  input: BookInQueueInput,
): Promise<Appointment> {
  // 1. CLOSED override — the clinic does not operate at all on this date.
  const override = await tx.scheduleOverride.findUnique({
    where: { scheduleId_date: { scheduleId: input.scheduleId, date: input.date } },
    select: { type: true },
  });
  if (override?.type === 'CLOSED') {
    throw conflict('SCHEDULE_CLOSED', 'The clinic is closed on this date');
  }

  // 2. Duplicate-active guard INSIDE the transaction (v1 bug #4 fix).
  const duplicateWhere: Prisma.AppointmentWhereInput =
    input.patientId !== null
      ? {
          scheduleId: input.scheduleId,
          date: input.date,
          patientId: input.patientId,
          status: { in: ['CONFIRMED', 'CALLED'] },
        }
      : {
          scheduleId: input.scheduleId,
          date: input.date,
          patientPhone: input.patientPhone,
          status: { in: ['CONFIRMED', 'CALLED'] },
        };
  const duplicate = await tx.appointment.findFirst({
    where: duplicateWhere,
    select: { id: true },
  });
  if (duplicate) {
    const fallback =
      input.patientId !== null
        ? { code: 'ALREADY_BOOKED', message: 'You already have an active booking for this schedule' }
        : { code: 'ALREADY_IN_QUEUE', message: 'This patient is already in the queue for this schedule' };
    const dup = input.duplicate ?? fallback;
    throw conflict(dup.code, dup.message);
  }

  // doctorId is resolved server-side from the schedule — never from the body.
  const schedule = await tx.schedule.findUnique({
    where: { id: input.scheduleId },
    select: { doctorId: true, doctor: { select: { fee: true } } },
  });
  if (!schedule) {
    throw notFound('Schedule not found');
  }

  // 3. Next queue number (max over ALL statuses — cancelled numbers stay taken).
  const last = await tx.appointment.findFirst({
    where: { scheduleId: input.scheduleId, date: input.date },
    orderBy: { queueNumber: 'desc' },
    select: { queueNumber: true },
  });
  const queueNumber = (last?.queueNumber ?? 0) + 1;

  // 4. Insert.
  return tx.appointment.create({
    data: {
      scheduleId: input.scheduleId,
      doctorId: schedule.doctorId,
      patientId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      date: input.date,
      queueNumber,
      status: 'CONFIRMED',
      source: input.source,
      fee: input.fee !== undefined ? input.fee : schedule.doctor.fee,
      notes: input.notes ?? null,
    },
  });
}

// -- Transaction retry ---------------------------------------------------------

const RETRYABLE_PRISMA_CODES = new Set(['P2002', 'P2034']);
const MAX_ATTEMPTS = 3;

/**
 * In-process serialization of booking transactions.
 *
 * SQLite (dev) allows exactly ONE writer at a time; parallel Prisma
 * interactive transactions contend for the connection and thrash locks until
 * the 5s interactive timeout fires mid-flight. Booking transactions are short
 * and infrequent, so serializing them in-process removes the contention
 * entirely while leaving semantics unchanged: the queue-number UNIQUE
 * constraint + the retry loop below still guard true cross-process races in
 * production (Postgres/Supabase, multiple app instances).
 */
let bookingChain: Promise<unknown> = Promise.resolve();

function withBookingLock<T>(run: () => Promise<T>): Promise<T> {
  // `run` ignores the previous outcome; the chain itself never rejects.
  const result = bookingChain.then(run, run);
  bookingChain = result.catch(() => undefined);
  return result;
}

/**
 * Run a booking transaction, retrying the WHOLE body on queue-number unique
 * races (P2002) / write conflicts (P2034) up to 3 attempts. Business errors
 * (ApiError: CAPACITY_FULL, ALREADY_BOOKED, SCHEDULE_CLOSED, …) are never
 * retried — they are deterministic and re-raised immediately.
 */
export async function runBookingTransaction<T>(
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withBookingLock(async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(body);
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          RETRYABLE_PRISMA_CODES.has(err.code) &&
          attempt < MAX_ATTEMPTS;
        if (!retryable) throw err;
      }
    }
    throw lastError ?? new Error('booking transaction failed');
  });
}

// -- Effective window & capacity ------------------------------------------------

/** 'HH:mm' → minutes since midnight ('09:30' → 570). Assumes a validated time. */
export function hmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export interface EffectiveWindow {
  startMin: number;
  endMin: number;
}

/**
 * The operating window for (schedule, date) in minutes since midnight.
 * A MODIFIED_HOURS/SPECIAL override replaces only the times it provides;
 * CLOSED is the caller's concern (checked before this runs).
 */
export function effectiveWindow(
  schedule: Pick<Schedule, 'startTime' | 'endTime'>,
  override: Pick<ScheduleOverride, 'type' | 'newStartTime' | 'newEndTime'> | null,
): EffectiveWindow {
  const usesOverride = override !== null && override.type !== 'CLOSED';
  const start = (usesOverride && override.newStartTime) || schedule.startTime;
  const end = (usesOverride && override.newEndTime) || schedule.endTime;
  return { startMin: hmToMinutes(start), endMin: hmToMinutes(end) };
}

/** Appointments that count toward capacity (everything except cancellations). */
export const CAPACITY_TAKEN_STATUSES = ['CONFIRMED', 'CALLED', 'COMPLETED', 'NO_SHOW'] as const;

/** Appointments that occupy the live queue ahead of a new booking. */
export const ACTIVE_STATUSES = ['CONFIRMED', 'CALLED'] as const;

export interface QueueCapacity {
  capacity: number;
  taken: number;
  capacityLeft: number;
  activeCount: number;
  nextQueueNumber: number;
}

/**
 * Capacity math for (schedule, date) — the single source shared by
 * GET /api/schedules/:id/availability (#7) and patient booking (#8).
 *
 *   capacity     = floor((endMin − startMin) / avgMinutesPerPatient)
 *   taken        = appointments with status ≠ CANCELLED
 *   capacityLeft = max(0, capacity − taken)
 *   nextQueueNumber = max(queueNumber over ALL appointments) + 1
 */
export async function getQueueCapacity(
  client: Pick<typeof db, 'appointment'>,
  schedule: Pick<Schedule, 'id' | 'startTime' | 'endTime' | 'avgMinutesPerPatient'>,
  date: string,
  override: Pick<ScheduleOverride, 'type' | 'newStartTime' | 'newEndTime'> | null,
): Promise<QueueCapacity> {
  const { startMin, endMin } = effectiveWindow(schedule, override);
  const avg = schedule.avgMinutesPerPatient;
  const capacity = Math.max(0, Math.floor((endMin - startMin) / avg));

  // Sequential awaits: this may run inside an interactive transaction.
  const taken = await client.appointment.count({
    where: { scheduleId: schedule.id, date, status: { not: 'CANCELLED' } },
  });
  const activeCount = await client.appointment.count({
    where: { scheduleId: schedule.id, date, status: { in: [...ACTIVE_STATUSES] } },
  });
  const last = await client.appointment.findFirst({
    where: { scheduleId: schedule.id, date },
    orderBy: { queueNumber: 'desc' },
    select: { queueNumber: true },
  });

  return {
    capacity,
    taken,
    capacityLeft: Math.max(0, capacity - taken),
    activeCount,
    nextQueueNumber: (last?.queueNumber ?? 0) + 1,
  };
}
