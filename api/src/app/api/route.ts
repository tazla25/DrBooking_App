import { handle, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Bare /api (no path segments) — the [...slug] catch-all does not match it,
 * so it gets its own handler. Same 404 envelope for method consistency.
 * (The human-facing service status lives at GET / — src/app/route.ts.)
 */
async function apiNotFound(): Promise<Response> {
  throw notFound('No API route matches /api');
}

export const GET = handle(apiNotFound);
export const POST = handle(apiNotFound);
export const PUT = handle(apiNotFound);
export const PATCH = handle(apiNotFound);
export const DELETE = handle(apiNotFound);
export const HEAD = handle(apiNotFound);
export const OPTIONS = handle(apiNotFound);
