/**
 * SUPER_ADMIN console wrappers + payload types — mirror the frozen api/
 * contracts EXACTLY (Phase 4 routes, re-verified against api/src on main):
 *
 *  - GET  /api/admin/pending-doctors?page=&limit=      (SUPER_ADMIN only)
 *  - POST /api/admin/verify-doctor  { userId, decision, note? }
 *  - GET  /api/admin/audit-log?page=&limit=&action=&userId=
 *  - GET  /api/analytics/summary?doctorId=             (doctorId REQUIRED)
 *  - GET  /api/analytics/revenue?doctorId=&days=
 *  - GET  /api/doctors                                  (PUBLIC, verified only)
 *  - GET  /api/export/appointments?doctorId=&from=&to=  (STREAMED text/csv)
 *
 * SCOPING LAW: unlike DOCTOR/COMPOUNDER routes, the analytics/export routes
 * REQUIRE ?doctorId=<DoctorProfile.id> from SUPER_ADMIN (missing/unknown →
 * 422 VALIDATION_ERROR). The wrappers below take a REQUIRED doctorId and
 * ALWAYS send it — the UI's doctor picker supplies it.
 *
 * The CSV export is a streamed text/csv attachment — NOT the JSON envelope —
 * so it must bypass apiRequest and use raw fetch + content-type branching.
 * Errors before the first byte still arrive as envelope JSON.
 */

import { File, Paths } from 'expo-file-system';
import { apiRequest, BASE_URL } from './api';
import { ApiError } from './errors';
import { getToken } from './session';
import type { DoctorSummary, DoctorsListResponse, SafeUser } from './types';

// ---------------------------------------------------------------------------
// A1 — Pending doctors (verification queue)
// ---------------------------------------------------------------------------

/** DoctorProfile fields embedded in a pending-doctor row (can be null —
 * a doctor account without a profile yet). */
export interface PendingDoctorProfile {
  id: string;
  fullName: string;
  specialization: string | null;
  fee: number | null;
  yearsExperience: number | null;
  bio: string | null;
  isAvailableNow: boolean;
  createdAt: string;
}

/** One row of GET /api/admin/pending-doctors. `id` is the USER id — exactly
 * what POST /api/admin/verify-doctor's { userId } needs. */
export interface PendingDoctor {
  id: string;
  phone: string;
  name: string;
  verificationStatus: string;
  createdAt: string;
  doctorProfile: PendingDoctorProfile | null;
}

export interface PendingDoctorsResponse {
  items: PendingDoctor[];
  total: number;
  page: number;
  limit: number;
}

/** Oldest-first FIFO verification queue (SUPER_ADMIN only). */
export function fetchPendingDoctors(page = 1, limit = 20): Promise<PendingDoctorsResponse> {
  return apiRequest<PendingDoctorsResponse>('/api/admin/pending-doctors', {
    query: { page, limit },
  });
}

// ---------------------------------------------------------------------------
// A1 — Verify / reject
// ---------------------------------------------------------------------------

export type VerifyDecision = 'VERIFIED' | 'REJECTED';

export interface VerifyDoctorResult {
  user: SafeUser;
  previousStatus: string;
  doctorProfile: { id: string; fullName: string } | null;
}

/**
 * POST /api/admin/verify-doctor. The optional note (rejections) is trimmed
 * here and OMITTED entirely when blank — mirroring the api's zod rule
 * (`note` must be 1..500 chars when present; empty-string is not sent).
 * 409 INVALID_TRANSITION surfaces when another admin verified first.
 */
export async function verifyDoctor(input: {
  userId: string;
  decision: VerifyDecision;
  note?: string;
}): Promise<VerifyDoctorResult> {
  const trimmed = input.note?.trim();
  const body: { userId: string; decision: VerifyDecision; note?: string } = {
    userId: input.userId,
    decision: input.decision,
  };
  if (trimmed) body.note = trimmed;
  return apiRequest<VerifyDoctorResult>('/api/admin/verify-doctor', {
    method: 'POST',
    body,
  });
}

// ---------------------------------------------------------------------------
// A3 — Audit log
// ---------------------------------------------------------------------------

export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

/** One row of GET /api/admin/audit-log (newest first). `actor` is null when
 * the user was deleted; `detail` is the RAW JSON-encoded string as stored. */
export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actor: AuditActor | null;
  action: string;
  target: string;
  detail: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

/** Known audit actions written by the frozen api/ (see api/src/lib/audit paths). */
export const AUDIT_ACTIONS = [
  'DOCTOR_VERIFIED',
  'DOCTOR_REJECTED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_NO_SHOW',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Append-only audit trail, newest first. `action`/`userId` are optional exact filters. */
export function fetchAuditLog(
  page = 1,
  limit = 20,
  filters: { action?: string; userId?: string } = {},
): Promise<AuditLogResponse> {
  return apiRequest<AuditLogResponse>('/api/admin/audit-log', {
    query: {
      page,
      limit,
      // apiRequest skips undefined/null/'' — blank filters are simply omitted.
      action: filters.action,
      userId: filters.userId,
    },
  });
}

/**
 * Parse an audit `detail` JSON string defensively. Returns the parsed object,
 * or the raw string when it is not JSON (corrupt/legacy rows never crash the
 * screen — the spec's try/catch rule).
 */
export function parseAuditDetail(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A2 — Analytics (doctorId is REQUIRED — scoping law)
// ---------------------------------------------------------------------------

export interface AnalyticsWindow {
  booked: number;
  completed: number;
  cancelled: number;
  noShow: number;
  walkIns: number;
  revenue: number;
}

export type AnalyticsWindowKey = 'today' | 'last7d' | 'last30d';

export interface AnalyticsSummaryResponse {
  doctorId: string;
  todayDate: string;
  last7dStart: string;
  last30dStart: string;
  today: AnalyticsWindow;
  last7d: AnalyticsWindow;
  last30d: AnalyticsWindow;
}

/** GET /api/analytics/summary — ALWAYS sends ?doctorId= (required param). */
export function fetchAnalyticsSummary(doctorId: string): Promise<AnalyticsSummaryResponse> {
  return apiRequest<AnalyticsSummaryResponse>('/api/analytics/summary', {
    query: { doctorId },
  });
}

export interface RevenueDayPoint {
  date: string; // YYYY-MM-DD IST — pass through, never convert
  count: number;
  revenue: number;
}

export interface RevenueResponse {
  doctorId: string;
  days: number;
  today: string;
  /** Zero-filled, ascending — exactly `days` points. */
  series: RevenueDayPoint[];
}

/** Day-window options the UI offers (the api accepts 1..365; these are ours). */
export const REVENUE_DAY_OPTIONS = [7, 30, 90] as const;

/** GET /api/analytics/revenue — ALWAYS sends ?doctorId= (required param). */
export function fetchRevenueSeries(doctorId: string, days = 30): Promise<RevenueResponse> {
  return apiRequest<RevenueResponse>('/api/analytics/revenue', {
    query: { doctorId, days },
  });
}

/** Verified doctors for the picker (PUBLIC route — VERIFIED only, so pending
 * doctors are invisible here by design; they have no analytics). */
export function fetchVerifiedDoctors(): Promise<DoctorsListResponse> {
  return apiRequest<DoctorsListResponse>('/api/doctors', {
    query: { pageSize: 50 },
    auth: false,
  });
}

export type { DoctorSummary };

// ---------------------------------------------------------------------------
// A4 — CSV export (STREAMED attachment — bypasses the JSON api client)
// ---------------------------------------------------------------------------

export interface CsvExportInput {
  /** DoctorProfile.id — required (scoping law). */
  doctorId: string;
  /** Inclusive IST 'YYYY-MM-DD' range; client validates from <= to. */
  from: string;
  to: string;
}

function buildExportUrl({ doctorId, from, to }: CsvExportInput, baseUrl: string): string {
  const url = new URL('/api/export/appointments', baseUrl);
  url.searchParams.set('doctorId', doctorId);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  return url.toString();
}

/** Mock seam for tests (the real writer uses the expo-file-system File API). */
export type CsvFileWriter = (filename: string, contents: string) => string;

const defaultWriteCsv: CsvFileWriter = (filename, contents) => {
  const file = new File(Paths.cache, filename);
  file.write(contents);
  return file.uri;
};

/**
 * GET /api/export/appointments — raw fetch with the bearer token (NOT
 * apiRequest: success is a streamed text/csv attachment, not the envelope).
 *
 * Content-type branching:
 *  - application/json  → an envelope error (thrown as ApiError with the
 *    server's code/message, e.g. 422 VALIDATION_ERROR or 403 FORBIDDEN);
 *  - text/csv          → the body is written to a cache file and its URI
 *    returned for the share sheet.
 *
 * The response starts with a UTF-8 BOM and formula-escapes phone cells —
 * both intentional server-side; do not "fix" either here.
 */
export async function downloadAppointmentsCsv(
  input: CsvExportInput,
  writeFile: CsvFileWriter = defaultWriteCsv,
): Promise<string> {
  const token = await getToken();
  let response: Response;
  try {
    response = await fetch(buildExportUrl(input, BASE_URL), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    // Error path: the envelope JSON (auth, scoping, validation failures).
    let code = 'UNEXPECTED_RESPONSE';
    let message = 'Export failed';
    try {
      const body = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // keep the defaults
    }
    throw new ApiError(response.status, code, message);
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      `Export failed (HTTP ${response.status})`,
    );
  }

  if (!contentType.includes('text/csv')) {
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Unexpected export response');
  }

  const csv = await response.text();
  const filename = `appointments-${input.doctorId}-${input.from}-to-${input.to}.csv`;
  try {
    return writeFile(filename, csv);
  } catch (err) {
    throw new ApiError(
      0,
      'EXPORT_WRITE_FAILED',
      err instanceof Error ? err.message : 'Could not save the export file',
    );
  }
}
