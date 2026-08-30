/**
 * Security response headers (Phase 4 hardening), applied by src/middleware.ts
 * to EVERY response. Kept as a pure function so it is unit-testable and can
 * be reused outside the middleware runtime.
 *
 * HSTS is only sent in production — over plain HTTP in dev it would be a no-op
 * at best and a warning in security scanners at worst.
 */
export function securityHeaders(isProduction: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  if (isProduction) {
    headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
  }
  return headers;
}
