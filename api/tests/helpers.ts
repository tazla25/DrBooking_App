import { db } from '@/lib/db';
import { hash } from 'bcryptjs';
import { createSession } from '@/lib/auth';
import { dayOfWeekIST, istTodayISO } from '@/lib/time';
import { normalizePhone } from '@/lib/validation';

/**
 * Shared helpers for route-handler tests. Route handlers are plain functions
 * taking a `Request`, so tests call them directly — no HTTP server needed.
 * Dynamic routes receive `{ params: Promise.resolve({...}) }` as context
 * (Next.js 15+/16 passes route params as a Promise).
 */

/** Fixtures store phones in the same NORMALIZED form production writes use. */
function mustPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (!normalized) throw new Error(`Invalid fixture phone: ${raw}`);
  return normalized;
}

export function postRequest(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': '203.0.113.7',
      'user-agent': 'jest-test-suite',
    },
    body: JSON.stringify(body),
  });
}

export function getRequest(url: string, token?: string): Request {
  return new Request(url, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

export function putRequest(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function patchRequest(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function deleteRequest(url: string, token?: string): Request {
  return new Request(url, {
    method: 'DELETE',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

export async function readResponse(res: Response): Promise<{
  status: number;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}> {
  const body = (await res.json()) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  };
  return { status: res.status, ok: body.ok, data: body.data, error: body.error };
}

/** Wipe all rows (children first). Keeps schema; used for test isolation. */
export async function resetDb(): Promise<void> {
  await db.failedLogin.deleteMany();
  await db.auditLog.deleteMany();
  await db.deviceToken.deleteMany();
  await db.session.deleteMany();
  await db.feedback.deleteMany();
  await db.patientNote.deleteMany();
  await db.appointment.deleteMany();
  await db.scheduleOverride.deleteMany();
  await db.schedule.deleteMany();
  await db.doctorProfile.deleteMany();
  await db.user.deleteMany();
}

export const API = 'http://localhost:3000';
export const TEST_PASSWORD = 'Test@1234';
export const TEST_PASSWORD_2 = 'NewPass@123';

// -- Phase 2 fixtures: doctors, compounders, admin, schedules, appointments ---

export interface StaffFixture {
  userId: string;
  doctorId: string; // DoctorProfile.id
  token: string;
  phone: string;
}

/** Create a doctor (user + profile + session token) directly in the DB. */
export async function createDoctorFixture(opts: {
  phone: string;
  name?: string;
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  fee?: number | null;
  isAvailableNow?: boolean;
}): Promise<StaffFixture> {
  const phone = mustPhone(opts.phone);
  const passwordHash = await hash(TEST_PASSWORD, 10);
  const user = await db.user.create({
    data: {
      phone,
      passwordHash,
      name: opts.name ?? `Dr ${phone.slice(-4)}`,
      role: 'DOCTOR',
      verificationStatus: opts.verificationStatus ?? 'VERIFIED',
    },
  });
  const profile = await db.doctorProfile.create({
    data: {
      userId: user.id,
      fullName: opts.name ?? `Dr ${phone.slice(-4)}`,
      fee: opts.fee ?? null,
      isAvailableNow: opts.isAvailableNow ?? false,
    },
  });
  const { token } = await createSession(user.id);
  return { userId: user.id, doctorId: profile.id, token, phone };
}

/** Create a COMPOUNDER delegated to a doctor, with a session token. */
export async function createCompounderFixture(opts: {
  phone: string;
  name?: string;
  doctorId: string; // DoctorProfile.id to delegate to
}): Promise<{ userId: string; token: string; phone: string }> {
  const phone = mustPhone(opts.phone);
  const passwordHash = await hash(TEST_PASSWORD, 10);
  const user = await db.user.create({
    data: {
      phone,
      passwordHash,
      name: opts.name ?? `Compounder ${phone.slice(-4)}`,
      role: 'COMPOUNDER',
      verificationStatus: 'VERIFIED',
      delegatedDoctorId: opts.doctorId,
    },
  });
  const { token } = await createSession(user.id);
  return { userId: user.id, token, phone };
}

/** Create a SUPER_ADMIN with a session token. */
export async function createAdminFixture(opts: {
  phone: string;
  name?: string;
}): Promise<{ userId: string; token: string }> {
  const passwordHash = await hash(TEST_PASSWORD, 10);
  const user = await db.user.create({
    data: {
      phone: mustPhone(opts.phone),
      passwordHash,
      name: opts.name ?? 'Admin',
      role: 'SUPER_ADMIN',
      verificationStatus: 'VERIFIED',
    },
  });
  const { token } = await createSession(user.id);
  return { userId: user.id, token };
}

/** Create a PATIENT with a session token. */
export async function createPatientFixture(opts: {
  phone: string;
  name?: string;
}): Promise<{ userId: string; token: string }> {
  const passwordHash = await hash(TEST_PASSWORD, 10);
  const user = await db.user.create({
    data: {
      phone: mustPhone(opts.phone),
      passwordHash,
      name: opts.name ?? 'Patient',
      role: 'PATIENT',
      verificationStatus: 'VERIFIED',
    },
  });
  const { token } = await createSession(user.id);
  return { userId: user.id, token };
}

/** Create a schedule — defaults to operating TODAY with 10-minute slots. */
export async function createScheduleFixture(
  doctorId: string,
  overrides: Partial<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    clinicName: string;
    clinicAddress: string;
    pinCode: string;
    landmark: string;
    mapLink: string;
    avgMinutesPerPatient: number;
    isActive: boolean;
  }> = {},
) {
  return db.schedule.create({
    data: {
      doctorId,
      dayOfWeek: overrides.dayOfWeek ?? dayOfWeekIST(istTodayISO()),
      startTime: overrides.startTime ?? '09:00',
      endTime: overrides.endTime ?? '13:00',
      clinicName: overrides.clinicName ?? 'City Clinic',
      clinicAddress: overrides.clinicAddress ?? '12 MG Road',
      pinCode: overrides.pinCode ?? null,
      landmark: overrides.landmark ?? null,
      mapLink: overrides.mapLink ?? null,
      avgMinutesPerPatient: overrides.avgMinutesPerPatient ?? 10,
      isActive: overrides.isActive ?? true,
    },
  });
}

/** Create an appointment directly (queueNumber is the caller's choice). */
export async function createAppointmentFixture(
  scheduleId: string,
  doctorId: string,
  overrides: Partial<{
    date: string;
    queueNumber: number;
    status: string;
    source: string;
    patientName: string;
    patientPhone: string;
    patientId: string | null;
    fee: number | null;
    notes: string | null;
  }> = {},
) {
  return db.appointment.create({
    data: {
      scheduleId,
      doctorId,
      date: overrides.date ?? istTodayISO(),
      queueNumber: overrides.queueNumber ?? 1,
      status: overrides.status ?? 'CONFIRMED',
      source: overrides.source ?? 'ONLINE',
      patientName: overrides.patientName ?? 'Walk Patient',
      patientPhone: mustPhone(overrides.patientPhone ?? '+919811110000'),
      patientId: overrides.patientId ?? null,
      fee: overrides.fee ?? null,
      notes: overrides.notes ?? null,
    },
  });
}

/** Build a dynamic-route context whose params resolve to the given values. */
export function routeContext<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
