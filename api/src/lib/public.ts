import type { DoctorProfile, Schedule } from '@prisma/client';

/**
 * Public-view mappers (Phase 3, contracts #6–7, 32–33).
 *
 * MASKING LAW: public responses NEVER contain patient phones, patientIds,
 * notes, or fees. Patient names on the public queue screen are masked.
 * Doctor listings never expose userIds or account fields.
 */

/**
 * Mask a patient name for the public queue screen.
 *   'Priya Nair' → 'P***r'  (first char of the name + '***' + last char)
 *   'Ravi'       → 'R***i'
 *   'X'          → 'X***'   (single-char name: first char + '***' only)
 */
export function maskPatientName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '***';
  const first = trimmed[0];
  if (trimmed.length === 1) return `${first}***`;
  return `${first}***${trimmed[trimmed.length - 1]}`;
}

/**
 * Public doctor fields for listings and profiles (contract #6).
 * `id` is the DoctorProfile id — NEVER the backing User id.
 * `bio` is included only when present.
 * Phase 11 (A3): registrationNumber + avatarUrl are additive public fields
 * (both nullable — absent for doctors who never set them).
 */
export function publicDoctorView(
  doctor: Pick<
    DoctorProfile,
    | 'id'
    | 'fullName'
    | 'specialization'
    | 'fee'
    | 'yearsExperience'
    | 'bio'
    | 'registrationNumber'
    | 'avatarUrl'
    | 'avgRating'
    | 'reviewCount'
    | 'isAvailableNow'
  >,
): {
  id: string;
  fullName: string;
  specialization: string | null;
  fee: number | null;
  yearsExperience: number | null;
  bio?: string;
  registrationNumber: string | null;
  avatarUrl: string | null;
  avgRating: number;
  reviewCount: number;
  isAvailableNow: boolean;
} {
  const view: {
    id: string;
    fullName: string;
    specialization: string | null;
    fee: number | null;
    yearsExperience: number | null;
    bio?: string;
    registrationNumber: string | null;
    avatarUrl: string | null;
    avgRating: number;
    reviewCount: number;
    isAvailableNow: boolean;
  } = {
    id: doctor.id,
    fullName: doctor.fullName,
    specialization: doctor.specialization,
    fee: doctor.fee,
    yearsExperience: doctor.yearsExperience,
    registrationNumber: doctor.registrationNumber,
    avatarUrl: doctor.avatarUrl,
    avgRating: doctor.avgRating,
    reviewCount: doctor.reviewCount,
    isAvailableNow: doctor.isAvailableNow,
  };
  if (doctor.bio !== null && doctor.bio !== undefined) {
    view.bio = doctor.bio;
  }
  return view;
}

/**
 * Public schedule fields (no internal flags like isActive, no doctorId).
 * Used by the doctor profile (#6), availability (#7) and queue screens (#12).
 */
export function publicScheduleView(
  schedule: Pick<
    Schedule,
    | 'id'
    | 'dayOfWeek'
    | 'startTime'
    | 'endTime'
    | 'clinicName'
    | 'clinicAddress'
    | 'pinCode'
    | 'landmark'
    | 'mapLink'
    | 'avgMinutesPerPatient'
  >,
): {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  clinicName: string;
  clinicAddress: string;
  pinCode: string | null;
  landmark: string | null;
  mapLink: string | null;
  avgMinutesPerPatient: number;
} {
  return {
    id: schedule.id,
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    clinicName: schedule.clinicName,
    clinicAddress: schedule.clinicAddress,
    pinCode: schedule.pinCode,
    landmark: schedule.landmark,
    mapLink: schedule.mapLink,
    avgMinutesPerPatient: schedule.avgMinutesPerPatient,
  };
}
