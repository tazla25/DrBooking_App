import * as SecureStore from 'expo-secure-store';
import {
  AUDIT_ACTIONS,
  REVENUE_DAY_OPTIONS,
  downloadAppointmentsCsv,
  fetchAnalyticsSummary,
  fetchAuditLog,
  fetchPendingDoctors,
  fetchRevenueSeries,
  fetchVerifiedDoctors,
  parseAuditDetail,
  verifyDoctor,
} from '../admin';
import { ApiError } from '../errors';

/**
 * SUPER_ADMIN console wrapper tests — every JSON call goes through the ONE
 * api client, so fetch is mocked at the envelope boundary (the staff.test.ts
 * pattern). The CSV export bypasses apiRequest BY DESIGN: its tests assert
 * the raw-fetch contract (bearer header + content-type branching).
 */

type MockResponseInit = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  text?: string;
};

function mockFetchOnce({ status, body, headers = {}, text }: MockResponseInit): jest.Mock {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' && !('content-type' in headers)
          ? 'application/json'
          : (headers[name.toLowerCase()] ?? null),
    },
    json: async () => body,
    text: async () => text ?? JSON.stringify(body ?? {}),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function envelope(data: unknown) {
  return { status: 200, body: { ok: true, data } };
}

function envelopeError(status: number, code: string, message: string) {
  return { status, body: { ok: false, error: { code, message } } };
}

/** Parse the Nth fetch call (url + init) the way the staff tests do. */
function calledRequest(
  fetchMock: jest.Mock,
  index = 0,
): { url: URL; init: { method?: string; headers?: Record<string, string>; body?: unknown } } {
  const [rawUrl, init] = fetchMock.mock.calls[index] as [string, Record<string, unknown>];
  return {
    url: new URL(String(rawUrl)),
    init: (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: unknown },
  };
}

/** The api client serializes bodies — parse the JSON back for assertions. */
function bodyJson(init: { body?: unknown }): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as unknown as { __keychain: Map<string, string> }).__keychain.clear();
});

// ---------------------------------------------------------------------------
// A1 — GET /api/admin/pending-doctors
// ---------------------------------------------------------------------------

const PENDING_ROW = {
  id: 'user-pending-1', // USER id — what verify-doctor needs
  phone: '+919876543299',
  name: 'Dr. Meera Patel',
  verificationStatus: 'PENDING',
  createdAt: '2026-08-28T19:45:00.000Z',
  doctorProfile: {
    id: 'profile-1',
    fullName: 'Dr. Meera Patel',
    specialization: 'Dermatology',
    fee: 400,
    yearsExperience: 9,
    bio: 'Skin and hair specialist.',
    isAvailableNow: false,
    createdAt: '2026-08-28T19:46:00.000Z',
  },
};

describe('fetchPendingDoctors', () => {
  test('passes the full shape through and sends page + limit (limit 20 default)', async () => {
    const fetchMock = mockFetchOnce(
      envelope({ items: [PENDING_ROW], total: 1, page: 1, limit: 20 }),
    );

    const data = await fetchPendingDoctors();

    const { url } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/admin/pending-doctors');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(data.items[0].id).toBe('user-pending-1');
    expect(data.items[0].doctorProfile?.fee).toBe(400);
    expect(data.total).toBe(1);
  });

  test('doctorProfile: null passes through untouched (no-profile rows are legal)', async () => {
    mockFetchOnce(
      envelope({ items: [{ ...PENDING_ROW, doctorProfile: null }], total: 1, page: 1, limit: 20 }),
    );
    const data = await fetchPendingDoctors(2, 20);
    expect(data.items[0].doctorProfile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A1 — POST /api/admin/verify-doctor
// ---------------------------------------------------------------------------

describe('verifyDoctor', () => {
  test('approve sends { userId, decision } with NO note key', async () => {
    const fetchMock = mockFetchOnce(
      envelope({
        user: { id: 'user-pending-1' },
        previousStatus: 'PENDING',
        doctorProfile: { id: 'profile-1', fullName: 'Dr. Meera Patel' },
      }),
    );

    await verifyDoctor({ userId: 'user-pending-1', decision: 'VERIFIED' });

    const { url, init } = calledRequest(fetchMock);
    const body = bodyJson(init);
    expect(url.pathname).toBe('/api/admin/verify-doctor');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ userId: 'user-pending-1', decision: 'VERIFIED' });
    expect('note' in body).toBe(false);
  });

  test('reject note is TRIMMED before send', async () => {
    const fetchMock = mockFetchOnce(
      envelope({
        user: { id: 'user-pending-1' },
        previousStatus: 'PENDING',
        doctorProfile: null,
      }),
    );

    await verifyDoctor({
      userId: 'user-pending-1',
      decision: 'REJECTED',
      note: '  certificate missing  ',
    });

    const { init } = calledRequest(fetchMock);
    expect(bodyJson(init)).toEqual({
      userId: 'user-pending-1',
      decision: 'REJECTED',
      note: 'certificate missing',
    });
  });

  test('blank note is OMITTED entirely (zod: note is 1..500 when present)', async () => {
    const fetchMock = mockFetchOnce(
      envelope({ user: { id: 'u' }, previousStatus: 'PENDING', doctorProfile: null }),
    );

    await verifyDoctor({ userId: 'u', decision: 'REJECTED', note: '   ' });

    const { init } = calledRequest(fetchMock);
    expect('note' in bodyJson(init)).toBe(false);
  });

  test('409 INVALID_TRANSITION (already verified by another admin) maps to ApiError', async () => {
    mockFetchOnce(
      envelopeError(
        409,
        'INVALID_TRANSITION',
        'Cannot transition doctor from VERIFIED to VERIFIED',
      ),
    );

    await expect(
      verifyDoctor({ userId: 'user-pending-1', decision: 'VERIFIED' }),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
  });
});

// ---------------------------------------------------------------------------
// A3 — GET /api/admin/audit-log
// ---------------------------------------------------------------------------

const AUDIT_ROW = {
  id: 'audit-1',
  actorId: 'user-admin-1',
  actor: { id: 'user-admin-1', name: 'Root Admin', role: 'SUPER_ADMIN' },
  action: 'DOCTOR_VERIFIED',
  target: 'user:user-pending-1',
  detail: '{"targetUserId":"user-pending-1","decision":"VERIFIED"}',
  createdAt: '2026-08-30T09:00:00.000Z',
};

describe('fetchAuditLog', () => {
  test('page-1 fetch sends NO action/userId when unfiltered', async () => {
    const fetchMock = mockFetchOnce(envelope({ items: [AUDIT_ROW], total: 1, page: 1, limit: 20 }));

    const data = await fetchAuditLog();

    const { url } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/admin/audit-log');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('action')).toBeNull();
    expect(url.searchParams.get('userId')).toBeNull();
    expect(data.items[0].actor?.role).toBe('SUPER_ADMIN');
  });

  test('action + userId filters are sent; blank strings are omitted (apiRequest law)', async () => {
    const fetchMock = mockFetchOnce(envelope({ items: [], total: 0, page: 1, limit: 20 }));

    await fetchAuditLog(3, 50, { action: 'DOCTOR_REJECTED', userId: 'user-admin-2' });
    await fetchAuditLog(1, 20, { action: '', userId: '' });

    const first = calledRequest(fetchMock, 0);
    expect(first.url.pathname).toBe('/api/admin/audit-log');
    expect(first.url.searchParams.get('page')).toBe('3');
    expect(first.url.searchParams.get('limit')).toBe('50');
    expect(first.url.searchParams.get('action')).toBe('DOCTOR_REJECTED');
    expect(first.url.searchParams.get('userId')).toBe('user-admin-2');

    const second = calledRequest(fetchMock, 1);
    expect(second.url.searchParams.get('action')).toBeNull();
    expect(second.url.searchParams.get('userId')).toBeNull();
  });

  test('null actor (deleted user) passes through as null', async () => {
    mockFetchOnce(
      envelope({
        items: [{ ...AUDIT_ROW, actorId: null, actor: null }],
        total: 1,
        page: 1,
        limit: 20,
      }),
    );
    const data = await fetchAuditLog();
    expect(data.items[0].actor).toBeNull();
  });
});

describe('parseAuditDetail', () => {
  test('parses a JSON object detail', () => {
    expect(parseAuditDetail('{"decision":"VERIFIED","note":null}')).toEqual({
      decision: 'VERIFIED',
      note: null,
    });
  });

  test('non-JSON raw string returns null (screen falls back to the raw text)', () => {
    expect(parseAuditDetail('not json at all')).toBeNull();
  });

  test('null/empty returns null', () => {
    expect(parseAuditDetail(null)).toBeNull();
    expect(parseAuditDetail('')).toBeNull();
  });

  test('JSON scalars/arrays are NOT objects → null (raw string display)', () => {
    expect(parseAuditDetail('42')).toBeNull();
    expect(parseAuditDetail('["a"]')).toBeNull();
  });

  test('the four known actions are exactly the frozen set', () => {
    expect([...AUDIT_ACTIONS]).toEqual([
      'DOCTOR_VERIFIED',
      'DOCTOR_REJECTED',
      'APPOINTMENT_CANCELLED',
      'APPOINTMENT_NO_SHOW',
    ]);
  });
});

// ---------------------------------------------------------------------------
// A2 — analytics (doctorId is REQUIRED — scoping law)
// ---------------------------------------------------------------------------

describe('analytics wrappers', () => {
  test('summary ALWAYS sends ?doctorId= (required param, not optional)', async () => {
    const fetchMock = mockFetchOnce(
      envelope({
        doctorId: 'profile-1',
        todayDate: '2026-08-30',
        last7dStart: '2026-08-24',
        last30dStart: '2026-08-01',
        today: { booked: 3, completed: 2, cancelled: 1, noShow: 0, walkIns: 1, revenue: 800 },
        last7d: { booked: 20, completed: 15, cancelled: 3, noShow: 2, walkIns: 6, revenue: 6000 },
        last30d: {
          booked: 80,
          completed: 60,
          cancelled: 12,
          noShow: 8,
          walkIns: 25,
          revenue: 24000,
        },
      }),
    );

    const data = await fetchAnalyticsSummary('profile-1');

    const { url } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/analytics/summary');
    expect(url.searchParams.get('doctorId')).toBe('profile-1');
    expect(data.last7d.revenue).toBe(6000);
    expect(data.today.walkIns).toBe(1);
  });

  test.each([7, 30, 90])('revenue sends days=%i alongside the required doctorId', async (days) => {
    const fetchMock = mockFetchOnce(
      envelope({
        doctorId: 'profile-1',
        days,
        today: '2026-08-30',
        series: Array.from({ length: days }, (_, i) => ({
          date: `2026-08-${String(i + 1).padStart(2, '0')}`,
          count: 0,
          revenue: 0,
        })),
      }),
    );

    const data = await fetchRevenueSeries('profile-1', days);

    const { url } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/analytics/revenue');
    expect(url.searchParams.get('doctorId')).toBe('profile-1');
    expect(url.searchParams.get('days')).toBe(String(days));
    expect(data.series).toHaveLength(days);
  });

  test('REVENUE_DAY_OPTIONS are exactly the UI chips 7/30/90', () => {
    expect([...REVENUE_DAY_OPTIONS]).toEqual([7, 30, 90]);
  });

  test('422 VALIDATION_ERROR (missing doctorId — impossible from the UI) still maps', async () => {
    mockFetchOnce(envelopeError(422, 'VALIDATION_ERROR', 'doctorId is required'));
    await expect(fetchAnalyticsSummary('')).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  test('verified-doctors picker call is PUBLIC (no bearer) with pageSize 50', async () => {
    const fetchMock = mockFetchOnce(
      envelope({
        total: 1,
        page: 1,
        pageSize: 50,
        doctors: [
          {
            id: 'profile-1',
            fullName: 'Dr. Ananya Rao',
            specialization: 'Cardiology',
            fee: 500,
            yearsExperience: 12,
            bio: '',
            avgRating: 4.8,
            reviewCount: 33,
            isAvailableNow: true,
          },
        ],
      }),
    );

    await fetchVerifiedDoctors();

    // auth:false is an apiRequest OPTION, not a fetch option — assert the
    // request went out with NO authorization header (public route).
    const { url, init } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/doctors');
    expect(url.searchParams.get('pageSize')).toBe('50');
    expect(init.headers?.authorization).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A4 — CSV export (raw fetch, content-type branching)
// ---------------------------------------------------------------------------

function csvResponse(body = '\uFEFFdate,queueNumber\n2026-08-30,1\n'): MockResponseInit {
  return { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' }, text: body };
}

describe('downloadAppointmentsCsv', () => {
  const INPUT = { doctorId: 'profile-1', from: '2026-08-01', to: '2026-08-30' };

  test('text/csv → raw fetch with bearer token, file written, uri returned', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok-export');
    const fetchMock = mockFetchOnce(csvResponse());
    const writeFile = jest.fn(() => 'file:///cache/appointments.csv');

    const uri = await downloadAppointmentsCsv(INPUT, writeFile);

    const { url, init } = calledRequest(fetchMock);
    expect(url.pathname).toBe('/api/export/appointments');
    expect(url.searchParams.get('doctorId')).toBe('profile-1');
    expect(url.searchParams.get('from')).toBe('2026-08-01');
    expect(url.searchParams.get('to')).toBe('2026-08-30');
    expect(init.headers?.authorization).toBe('Bearer tok-export');

    // The whole CSV body (BOM included — intentional, do not "fix") is written.
    expect(writeFile).toHaveBeenCalledWith(
      'appointments-profile-1-2026-08-01-to-2026-08-30.csv',
      '\uFEFFdate,queueNumber\n2026-08-30,1\n',
    );
    expect(uri).toBe('file:///cache/appointments.csv');
  });

  test('application/json error → envelope code/message surface as ApiError (422 VALIDATION_ERROR)', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok-export');
    mockFetchOnce(envelopeError(422, 'VALIDATION_ERROR', 'from must be on or before to'));

    await expect(downloadAppointmentsCsv(INPUT, jest.fn())).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'from must be on or before to',
    });
  });

  test('application/json 403 FORBIDDEN maps as ApiError (role lost mid-session)', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok-export');
    mockFetchOnce(envelopeError(403, 'FORBIDDEN', 'Insufficient role'));

    await expect(downloadAppointmentsCsv(INPUT, jest.fn())).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  test('non-JSON, non-CSV success response → UNEXPECTED_RESPONSE, nothing written', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok-export');
    mockFetchOnce({ status: 200, headers: { 'content-type': 'text/html' }, text: '<html>' });
    const writeFile = jest.fn();

    await expect(downloadAppointmentsCsv(INPUT, writeFile)).rejects.toBeInstanceOf(ApiError);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('fetch network failure → NETWORK_ERROR ApiError', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('failed to fetch');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(downloadAppointmentsCsv(INPUT, jest.fn())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  test('cache write failure → EXPORT_WRITE_FAILED, never crashes', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok-export');
    mockFetchOnce(csvResponse());
    const writeFile = jest.fn(() => {
      throw new Error('disk full');
    });

    await expect(downloadAppointmentsCsv(INPUT, writeFile)).rejects.toMatchObject({
      code: 'EXPORT_WRITE_FAILED',
    });
  });

  test('no token in store → request still sent, without an authorization header', async () => {
    const fetchMock = mockFetchOnce(csvResponse());

    await downloadAppointmentsCsv(
      INPUT,
      jest.fn(() => 'file:///x.csv'),
    );

    const { init } = calledRequest(fetchMock);
    expect(init.headers?.authorization).toBeUndefined();
  });
});
