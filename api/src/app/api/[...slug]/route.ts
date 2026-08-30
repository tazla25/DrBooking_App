import { handle, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Catch-all for every unmatched /api/* path (Phase 4 hardening) — always the
 * standard envelope, never Next.js' default HTML error page:
 *   { ok: false, error: { code: 'NOT_FOUND', message: '...' } }
 *
 * Next.js resolves concrete routes (e.g. /api/doctors, /api/appointments/mine)
 * before this catch-all, so existing endpoints are unaffected. Unmatched
 * sub-paths of existing resources (e.g. /api/appointments/<id> with no verb
 * route) land here.
 */

type RouteContext = { params: Promise<{ slug: string[] }> };

async function notFoundEnvelope(_request: Request, context: RouteContext): Promise<Response> {
  // Await params so malformed dynamic segments don't bypass the envelope.
  const { slug } = await context.params;
  const path = Array.isArray(slug) ? slug.join('/') : '';
  throw notFound(path ? `No API route matches /${path}` : 'No API route matches this path');
}

export const GET = handle(notFoundEnvelope);
export const POST = handle(notFoundEnvelope);
export const PUT = handle(notFoundEnvelope);
export const PATCH = handle(notFoundEnvelope);
export const DELETE = handle(notFoundEnvelope);
export const HEAD = handle(notFoundEnvelope);
export const OPTIONS = handle(notFoundEnvelope);
