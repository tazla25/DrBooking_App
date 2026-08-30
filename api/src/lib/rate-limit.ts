import { ApiError } from '@/lib/errors';

/**
 * In-memory per-key sliding-window rate limiter (Phase 4, fixes old-repo bug #8).
 *
 * HONEST LIMITATION (documented in README): the counters live in the Node
 * process memory (a plain Map). This protects a single API instance. Behind a
 * load balancer with multiple instances, EACH instance counts separately, so
 * the effective limit is `limit × instance-count`. A global limiter would need
 * a shared store (Redis) or a DB model — both are deliberately OUT of stack
 * here (SCHEMA LAW: schema.prisma must stay 0-lines-diff in this phase).
 *
 * Bypassed entirely when RATE_LIMIT_DISABLED=1 or NODE_ENV=test so the jest
 * suites (142+ tests firing hundreds of requests from one IP) stay green.
 *
 * Env-overridable defaults (read at CHECK time so tests/ops can change them
 * without a restart):
 *   login    : RATE_LIMIT_LOGIN_MAX=10    / RATE_LIMIT_LOGIN_WINDOW_MS=60_000    (per IP)
 *   register : RATE_LIMIT_REGISTER_MAX=5  / RATE_LIMIT_REGISTER_WINDOW_MS=900_000 (per IP)
 *   booking  : RATE_LIMIT_BOOKING_MAX=20  / RATE_LIMIT_BOOKING_WINDOW_MS=60_000  (per USER id)
 */

interface Rule {
  /** Map key prefix, e.g. 'login'. */
  name: string;
  /** Bucket key: `prefix:key` (IP for login/register, user id for booking). */
  prefix: string;
  max: (env: NodeJS.ProcessEnv) => number;
  windowMs: (env: NodeJS.ProcessEnv) => number;
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * MINUTE_MS;

/** One Map per rule: key -> timestamps (ms) of allowed hits inside the window. */
const buckets = new Map<string, Map<string, number[]>>();
let checksSinceSweep = 0;
const SWEEP_EVERY_CHECKS = 1_000;

export function rateLimitingDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === '1' || process.env.NODE_ENV === 'test';
}

/**
 * Record a hit for `key` against the rule and decide whether it is allowed.
 * Pure sliding window: prune timestamps older than windowMs; if the remaining
 * count already reached `max`, REJECT (and do not record); else record `now`.
 *
 * Returns 0 when allowed, or the suggested Retry-After seconds when rejected.
 */
function hit(rule: Rule, key: string): number {
  const env = process.env;
  const max = rule.max(env);
  const windowMs = rule.windowMs(env);

  let ruleBuckets = buckets.get(rule.prefix);
  if (!ruleBuckets) {
    ruleBuckets = new Map();
    buckets.set(rule.prefix, ruleBuckets);
  }

  const now = Date.now();
  const recent = (ruleBuckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    // Rejected — keep the pruned window so repeated attempts do not extend it.
    ruleBuckets.set(key, recent);
    const retryAfterMs = recent[0] + windowMs - now;
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
  }

  recent.push(now);
  ruleBuckets.set(key, recent);

  checksSinceSweep += 1;
  if (checksSinceSweep >= SWEEP_EVERY_CHECKS) {
    checksSinceSweep = 0;
    sweep(now);
  }
  return 0;
}

/** Drop keys whose every hit is older than the longest window (memory bound). */
function sweep(now: number): void {
  const longestWindow = FIFTEEN_MINUTES_MS;
  for (const ruleBuckets of buckets.values()) {
    for (const [key, hits] of ruleBuckets) {
      if (hits.every((t) => now - t >= longestWindow)) ruleBuckets.delete(key);
    }
  }
}

function reject(ruleName: string, retryAfterSec: number): ApiError {
  return new ApiError(
    429,
    'RATE_LIMITED',
    `Too many ${ruleName} requests. Please wait ${retryAfterSec}s and try again.`,
    { 'retry-after': String(retryAfterSec) },
  );
}

// -- Public check helpers -------------------------------------------------------

/** POST /api/auth/login — 10/min/IP (env: RATE_LIMIT_LOGIN_*). */
export function checkLoginRateLimit(ip: string): void {
  const rule: Rule = {
    name: 'login',
    prefix: 'login',
    max: (env) => envInt(env, 'RATE_LIMIT_LOGIN_MAX', 10),
    windowMs: (env) => envInt(env, 'RATE_LIMIT_LOGIN_WINDOW_MS', MINUTE_MS),
  };
  if (rateLimitingDisabled()) return;
  const retryAfter = hit(rule, ip);
  if (retryAfter > 0) throw reject('login', retryAfter);
}

/** POST /api/auth/register — 5 per 15 min/IP (env: RATE_LIMIT_REGISTER_*). */
export function checkRegisterRateLimit(ip: string): void {
  const rule: Rule = {
    name: 'register',
    prefix: 'register',
    max: (env) => envInt(env, 'RATE_LIMIT_REGISTER_MAX', 5),
    windowMs: (env) => envInt(env, 'RATE_LIMIT_REGISTER_WINDOW_MS', FIFTEEN_MINUTES_MS),
  };
  if (rateLimitingDisabled()) return;
  const retryAfter = hit(rule, ip);
  if (retryAfter > 0) throw reject('register', retryAfter);
}

/** POST /api/appointments — 20/min/user (env: RATE_LIMIT_BOOKING_*). */
export function checkBookingRateLimit(userId: string): void {
  const rule: Rule = {
    name: 'booking',
    prefix: 'booking',
    max: (env) => envInt(env, 'RATE_LIMIT_BOOKING_MAX', 20),
    windowMs: (env) => envInt(env, 'RATE_LIMIT_BOOKING_WINDOW_MS', MINUTE_MS),
  };
  if (rateLimitingDisabled()) return;
  const retryAfter = hit(rule, userId);
  if (retryAfter > 0) throw reject('booking', retryAfter);
}

/** Test-only: forget every recorded hit (jest suites must not share state). */
export function resetRateLimiterForTests(): void {
  buckets.clear();
  checksSinceSweep = 0;
}
