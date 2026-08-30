import type { Appointment, Schedule } from '@prisma/client';

/**
 * Queue view helpers for the doctor/compounder panel (Phase 2, #14–15).
 *
 * estWaitMin (fixes the v1 miscount — implement EXACTLY this):
 *   (number of appointments with the SAME scheduleId+date whose status is
 *    CONFIRMED or CALLED and whose queueNumber is LOWER than this one's)
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
  // Per (scheduleId) prefix count of CONFIRMED|CALLED — appointments passed in
  // are all for the same date, so scheduleId alone identifies the group.
  const seenAhead = new Map<string, number>();

  return appointments.map((appt) => {
    const ahead = seenAhead.get(appt.scheduleId) ?? 0;
    const estWaitMin = ahead * appt.schedule.avgMinutesPerPatient;

    if (appt.status === 'CONFIRMED' || appt.status === 'CALLED') {
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

/** Status tally for the queue header — { confirmed, called, completed, cancelled, noShow }. */
export function countStatuses(appointments: Appointment[]): {
  confirmed: number;
  called: number;
  completed: number;
  cancelled: number;
  noShow: number;
} {
  const counts = { confirmed: 0, called: 0, completed: 0, cancelled: 0, noShow: 0 };
  for (const appt of appointments) {
    switch (appt.status) {
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
