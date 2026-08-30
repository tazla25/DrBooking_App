import { router } from 'expo-router';
import { ApiError } from './errors';
import { clearSession, getToken } from './session';

/**
 * THE api client — every network call in the app goes through this module.
 *  - Base URL from EXPO_PUBLIC_API_URL (see .env.example).
 *  - Attaches the bearer token from expo-secure-store.
 *  - Parses the response envelope: success { ok:true, data } | error
 *    { ok:false, error:{ code, message } }.
 *  - Throws typed ApiError { code, message, status } — screens render
 *    friendlyMessage(err) for the user.
 *  - On 401 for an AUTHENTICATED call: clears the session and routes to
 *    /login (never fires for login/register themselves — auth:false there).
 */

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

if (__DEV__ && !process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    '[api] EXPO_PUBLIC_API_URL is not set — defaulting to http://localhost:3000. ' +
      'Copy mobile/.env.example to mobile/.env.local for a different target.',
  );
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON body (serialized automatically). */
  body?: unknown;
  /** Query params — undefined/null/'' values are skipped. */
  query?: Record<string, string | number | undefined | null>;
  /** Attach token + handle 401 (default true). Pass false for login/register. */
  auth?: boolean;
}

interface EnvelopeError {
  ok: false;
  error: { code: string; message: string };
}

const REQUEST_TIMEOUT_MS = 15000;

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = opts;

  const token = auth ? await getToken() : null;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }

  // A 401 on a call WE authenticated means the session died (logout elsewhere,
  // password change revoked it, expiry). Clear and route — exactly once.
  if (response.status === 401 && auth && token) {
    await clearSession().catch(() => undefined);
    try {
      router.replace('/login');
    } catch {
      // Router not ready (only possible during boot) — the splash gate will
      // land on /login anyway because the session was just cleared.
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // Every JSON endpoint uses the envelope; non-JSON (e.g. future CSV export)
    // is returned raw to the caller.
    if (!response.ok) {
      throw new ApiError(
        response.status,
        'UNEXPECTED_RESPONSE',
        `Request failed (HTTP ${response.status})`,
      );
    }
    return (await response.text()) as unknown as T;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Malformed server response');
  }

  const envelope = parsed as { ok?: boolean; data?: unknown } | EnvelopeError;
  if (parsed !== null && typeof parsed === 'object' && 'ok' in parsed) {
    if (envelope.ok === true) {
      return envelope.data as T;
    }
    if (envelope.ok === false) {
      const e = (parsed as EnvelopeError).error ?? {
        code: 'UNEXPECTED_RESPONSE',
        message: 'Request failed',
      };
      const retryAfterRaw = response.headers.get('retry-after');
      const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : null;
      throw new ApiError(response.status, e.code, e.message, {
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
      });
    }
  }

  throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'Malformed server response');
}

/** Convenience wrappers (all still funnel through apiRequest). */
export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};

export { BASE_URL };
