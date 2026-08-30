import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/**
 * Standard API error type + response envelope.
 *
 * Every endpoint responds with either:
 *   { ok: true,  data: ... }
 *   { ok: false, error: { code, message } }
 * with a proper HTTP status (401 / 403 / 404 / 409 / 422 / 429 / 500).
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Optional extra response headers (e.g. Retry-After on 429). */
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, message: string, headers?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }

  toResponse(): Response {
    return jsonResponse(this.status, { ok: false, error: { code: this.code, message: this.message } }, this.headers);
  }
}

// -- Convenience factories ---------------------------------------------------

export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to do this') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export const validationError = (message: string) =>
  new ApiError(422, 'VALIDATION_ERROR', message);

// -- Response helpers ---------------------------------------------------------

/** Success envelope: { ok: true, data } */
export function ok<T>(data: T, status = 200): Response {
  return jsonResponse(status, { ok: true, data });
}

function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/**
 * Wrap a route handler so every thrown error becomes the standard envelope.
 * Zod errors → 422 VALIDATION_ERROR; Prisma unique violations → 409;
 * anything else → 500 INTERNAL_ERROR (logged, message never leaked).
 *
 * The returned handler forwards the second (context) argument so dynamic
 * routes can `await context.params` — Next.js 15+/16 passes route params as
 * a Promise. Static routes simply ignore it.
 */
export function handle<C = unknown>(
  route: (request: Request, context: C) => Promise<Response>,
): (request: Request, context?: C) => Promise<Response> {
  return async (request: Request, context?: C): Promise<Response> => {
    try {
      return await route(request, context as C);
    } catch (err) {
      if (err instanceof ApiError) return err.toResponse();
      if (err instanceof ZodError) return zodErrorResponse(err);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Unique-constraint violation (e.g. concurrent register with same phone).
        return jsonResponse(409, {
          ok: false,
          error: { code: 'ALREADY_EXISTS', message: 'A record with these details already exists' },
        });
      }
      console.error('[api] Unhandled error:', err);
      return jsonResponse(500, {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      });
    }
  };
}

/** Parse a JSON request body; malformed JSON → 422 (not a 500). */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw validationError('Request body must be valid JSON');
  }
}

function zodErrorResponse(err: ZodError): Response {
  const issue = err.issues[0];
  const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  const message = issue ? `${path}${issue.message}` : 'Invalid request payload';
  return jsonResponse(422, {
    ok: false,
    error: { code: 'VALIDATION_ERROR', message },
  });
}
