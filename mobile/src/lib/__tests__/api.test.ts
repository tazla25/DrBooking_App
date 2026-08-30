import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { apiRequest } from '../api';
import { ApiError } from '../errors';

/**
 * api client tests — envelope parsing, token attach, 401 session wipe,
 * error mapping. fetch is mocked per-test; expo-secure-store and expo-router
 * are mocked globally in jest.setup.js.
 */

type MockResponseInit = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

function mockFetchOnce({ status, body, headers = {} }: MockResponseInit): jest.Mock {
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
    text: async () => JSON.stringify(body),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const TEST_TOKEN = 'a'.repeat(64);
const TEST_USER = {
  id: 'u1',
  phone: '+919876543210',
  name: 'Test Patient',
  role: 'PATIENT',
  verificationStatus: 'VERIFIED',
  mustChangePassword: false,
  isActive: true,
  delegatedDoctorId: null,
  createdAt: '2026-08-30T10:00:00.000Z',
};

async function seedSession(): Promise<void> {
  await SecureStore.setItemAsync('auth.token', TEST_TOKEN);
  await SecureStore.setItemAsync('auth.user', JSON.stringify(TEST_USER));
}

describe('api client — envelope parsing', () => {
  test('success envelope returns data', async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true, data: { hello: 'world' } } });

    const data = await apiRequest<{ hello: string }>('/api/x');

    expect(data).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/x');
    expect(init.method).toBe('GET');
  });

  test('error envelope throws typed ApiError with code, message and status', async () => {
    mockFetchOnce({
      status: 409,
      body: { ok: false, error: { code: 'ALREADY_BOOKED', message: 'Duplicate booking' } },
    });

    await expect(apiRequest('/api/appointments')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'ALREADY_BOOKED',
      status: 409,
      message: 'Duplicate booking',
    });

    try {
      await apiRequest('/api/appointments');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });

  test('RATE_LIMITED carries retryAfter seconds from the Retry-After header', async () => {
    mockFetchOnce({
      status: 429,
      headers: { 'retry-after': '42' },
      body: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    });

    await expect(apiRequest('/api/auth/login', { auth: false })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      meta: { retryAfter: 42 },
    });
  });

  test('network failure maps to ApiError NETWORK_ERROR with status 0', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/doctors')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  test('malformed JSON response maps to UNEXPECTED_RESPONSE', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => {
        throw new Error('not json');
      },
      text: async () => '<html>oops</html>',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(apiRequest('/api/doctors')).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      status: 200,
    });
  });
});

describe('api client — token attach', () => {
  test('bearer token is attached for authenticated calls', async () => {
    await seedSession();
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true, data: null } });

    await apiRequest('/api/auth/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
  });

  test('no token attached when auth:false', async () => {
    await seedSession();
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true, data: null } });

    await apiRequest('/api/doctors', { auth: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  test('query params are serialized, blanks skipped', async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { ok: true, data: null } });

    await apiRequest('/api/doctors', {
      query: { q: 'cardio', page: 2, pageSize: 20, pinCode: undefined },
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/doctors?q=cardio&page=2&pageSize=20');
  });
});

describe('api client — 401 handling', () => {
  test('401 on an authenticated call clears the session and routes to /login', async () => {
    await seedSession();
    mockFetchOnce({
      status: 401,
      body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } },
    });

    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(await SecureStore.getItemAsync('auth.token')).toBeNull();
    expect(await SecureStore.getItemAsync('auth.user')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  test('401 with auth:false (login) does NOT clear the session or route', async () => {
    await seedSession();
    mockFetchOnce({
      status: 401,
      body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } },
    });

    await expect(
      apiRequest('/api/auth/login', { method: 'POST', body: {}, auth: false }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(await SecureStore.getItemAsync('auth.token')).toBe(TEST_TOKEN);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
