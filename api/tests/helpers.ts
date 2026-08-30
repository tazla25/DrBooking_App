import { db } from '@/lib/db';

/**
 * Shared helpers for route-handler tests. Route handlers are plain functions
 * taking a `Request`, so tests call them directly — no HTTP server needed.
 */

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
