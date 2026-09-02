/**
 * API payload types — mirror the frozen api/ contracts exactly (Phase 1–4).
 * api/ is FROZEN for mobile phases: if a screen seems to need a shape change,
 * stop and raise it as an "API GAP" in the PR instead of editing api/.
 */

export type Role = 'PATIENT' | 'DOCTOR' | 'COMPOUNDER' | 'SUPER_ADMIN';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** SafeUser — exactly what the API returns for `user` everywhere. */
export interface SafeUser {
  id: string;
  phone: string;
  name: string;
  role: Role;
  verificationStatus: VerificationStatus;
  mustChangePassword: boolean;
  isActive: boolean;
  delegatedDoctorId: string | null;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: SafeUser;
}

export interface RegisterResponse {
  user: SafeUser;
  /** The current API returns NO token on register — handled defensively. */
  token?: string;
}

export interface MeResponse {
  user: SafeUser;
  /**
   * Phase 11 (A3, additive): the profile-edit fields hydrate the doctor's
   * edit form from ONE call. Same values publicDoctorView exposes — nothing
   * secret. Null for patients / staff without a linked doctor.
   */
  doctorProfile: {
    id: string;
    fullName: string;
    specialization: string | null;
    fee: number | null;
    yearsExperience: number | null;
    bio: string | null;
    registrationNumber: string | null;
    avatarUrl: string | null;
  } | null;
}

/** Public doctor card (GET /api/doctors → data.doctors[]).
 * Phase 11 (A3, additive): registrationNumber + avatarUrl (null when unset). */
export interface DoctorSummary {
  id: string;
  fullName: string;
  specialization: string | null;
  registrationNumber: string | null;
  avatarUrl: string | null;
  fee: number | null;
  yearsExperience: number | null;
  bio?: string;
  avgRating: number;
  reviewCount: number;
  isAvailableNow: boolean;
}

export interface DoctorsListResponse {
  total: number;
  page: number;
  pageSize: number;
  doctors: DoctorSummary[];
}

export type DoctorSort = 'rating' | 'fee_asc' | 'fee_desc';

export interface ScheduleView {
  id: string;
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday (matches api/src/lib/time.ts)
  startTime: string; // 'HH:mm' IST — pass through, never timezone-convert
  endTime: string;
  clinicName: string;
  clinicAddress: string;
  pinCode: string | null;
  landmark: string | null;
  mapLink: string | null;
  avgMinutesPerPatient: number;
}

export type OverrideType = 'CLOSED' | 'MODIFIED_HOURS' | 'SPECIAL';

export interface OverrideView {
  id: string;
  scheduleId: string;
  date: string; // 'YYYY-MM-DD' IST
  type: OverrideType;
  newStartTime: string | null;
  newEndTime: string | null;
  reason: string | null;
}

export type DoctorDetail = DoctorSummary & {
  schedules: ScheduleView[];
  overrides: OverrideView[];
};
