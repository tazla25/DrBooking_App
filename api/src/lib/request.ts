/**
 * Request helpers shared by route handlers.
 */

/** Best-effort client IP (gateway/proxy aware). Never trusted for security decisions. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}
