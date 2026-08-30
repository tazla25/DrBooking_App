import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from '@/lib/security-headers';

/**
 * Security headers on every response (Phase 4 hardening):
 *   X-Content-Type-Options: nosniff
 *   X-Frame-Options: DENY
 *   Referrer-Policy: strict-origin-when-cross-origin
 *   Strict-Transport-Security (production only)
 *
 * NOTE on the file name: the spec called for `middleware.ts`; Next.js 16
 * deprecated the `middleware` convention in favor of `proxy` (it logs a
 * deprecation warning and will remove the old name in a future major).
 * src/proxy.ts IS the middleware — same signature, same matcher, applied to
 * every request before the route handler runs.
 */
export function proxy(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders(process.env.NODE_ENV === 'production'))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Every path (this app serves only /api routes + the / status route).
  matcher: '/:path*',
};
