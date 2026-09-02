import type { Appointment, Schedule } from '@prisma/client';
import { ACTIVE_STATUSES } from '@/lib/booking';

/**
 * Queue view helpers for the doctor/compounder panel (Phase 2, #14–15).
 *
 * estWaitMin (fixes the v1 miscount — implement EXACTLY this):
 *   (number of appointments with the SAME scheduleId+date whose status is
 *    ahead-of-you (PENDING|CONFIRMED|CALLED — Phase 11 B2 sweep: consumers
 *    that counted CONFIRMED|CALLED now also count PENDING, matching
 *    ACTIVE_STATUSES) and whose queueNumber is LOWER than this one's)
 *   × schedule.avgMinutesPerPatient
 *
 * The input list MUST contain every appointment of each (scheduleId, date)
 * group the caller is viewing, so the per-group prefix count is complete.
 */

export type AppointmentWithSchedule = Appointment & {
  schedule: Pick<Schedule, 'id' | 'avgMinutesPerPatient'>;
};

export interface StaffAppointmentView {
  id: string;
  queueNumber: number;
  status: string;
  source: string;
  patientName: string;
  patientPhone: string;
  patientId: string | null;
  notes: string | null;
  fee: number | null;
  estWaitMin: number;
  createdAt: Date;
}

/** Map raw rows (ordered by queueNumber) to the staff queue view. */
export function toStaffQueueView(appointments: AppointmentWithSchedule[]): StaffAppointmentView[] {
  // Per (scheduleId) prefix count of ahead-statuses (PENDING|CONFIRMED|CALLED
  // via ACTIVE_STATUSES — Phase 11 B2). Appointments passed in are all for the
  // same date, so scheduleId alone identifies the group.
  const aheadSet: ReadonlySet<string> = new Set<string>(ACTIVE_STATUSES);
  const seenAhead = new Map<string, number>();

  return appointments.map((appt) => {
    const ahead = seenAhead.get(appt.scheduleId) ?? 0;
    const estWaitMin = ahead * appt.schedule.avgMinutesPerPatient;

    if (aheadSet.has(appt.status)) {
      seenAhead.set(appt.scheduleId, ahead + 1);
    }

    return {
      id: appt.id,
      queueNumber: appt.queueNumber,
      status: appt.status,
      source: appt.source,
      patientName: appt.patientName,
      patientPhone: appt.patientPhone,
      patientId: appt.patientId,
      notes: appt.notes,
      fee: appt.fee,
      estWaitMin,
      createdAt: appt.createdAt,
    };
  });
}

/**
 * Status tally for the queue header — { pending, confirmed, called,
 * completed, cancelled, noShow }. `pending` is the Phase 11 B2 manual-
 * confirmation inbox count (PENDING rows surface as their own section at the
 * top of the staff Today console).
 */
export function countStatuses(appointments: Appointment[]): {
  pending: number;
  confirmed: number;
  called: number;
  completed: number;
  cancelled: number;
  noShow: number;
} {
  const counts = {
    pending: 0,
    confirmed: 0,
    called: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
  };
  for (const appt of appointments) {
    switch (appt.status) {
      case 'PENDING':
        counts.pending += 1;
        break;
      case 'CONFIRMED':
        counts.confirmed += 1;
        break;
      case 'CALLED':
        counts.called += 1;
        break;
      case 'COMPLETED':
        counts.completed += 1;
        break;
      case 'CANCELLED':
        counts.cancelled += 1;
        break;
      case 'NO_SHOW':
        counts.noShow += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}
