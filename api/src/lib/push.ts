import { db } from '@/lib/db';

/**
 * Push notification service (Phase 4) — env-guarded, NEVER blocks a flow.
 *
 * Guarantees (old-repo lesson: a push outage must not roll back a booking):
 *  - `sendToUser` NEVER throws. Unconfigured providers, network failures and
 *    unexpected errors are logged (console.warn) and swallowed.
 *  - Route call sites fire-and-forget AFTER their transaction commits via
 *    `notifyUser()` — a rejected promise can never roll anything back.
 *
 * Token routing by shape:
 *  - `ExponentPushToken[...]`      → Expo push API (no credentials required;
 *    EXPO_ACCESS_TOKEN optional, sent as Bearer when present).
 *  - Plain FCM registration token  → FCM legacy HTTP endpoint, requires
 *    FIREBASE_SERVER_KEY (skipped with a log when unconfigured).
 *  - Anything else / empty         → skipped with a log.
 *
 * Hard env guard: PUSH_DISABLED=1 or NODE_ENV=test skips ALL sends (keeps the
 * jest suites and local dev free of accidental network calls).
 */

export interface PushMessage {
  title: string;
  body: string;
  /** String-only payload map (FCM data messages only carry string values). */
  data?: Record<string, string>;
}

export interface PushResult {
  userId: string;
  sent: number;
  failed: number;
  skipped: number;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const FCM_SEND_URL = 'https://fcm.googleapis.com/fcm/send';

/** Minimum length we accept for a plain FCM registration token (real ones are ~140+). */
const FCM_TOKEN_MIN_LENGTH = 100;

export function pushDisabled(): boolean {
  return process.env.PUSH_DISABLED === '1' || process.env.NODE_ENV === 'test';
}

/** Classify a stored device token by its shape. */
export function routeToken(token: string): 'expo' | 'fcm' | 'unknown' {
  if (token.startsWith('ExponentPushToken[') && token.endsWith(']')) return 'expo';
  // FCM instance-id tokens: long runs of [A-Za-z0-9_-] with no other syntax.
  if (token.length >= FCM_TOKEN_MIN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token)) return 'fcm';
  return 'unknown';
}

export async function sendToUser(userId: string, message: PushMessage): Promise<PushResult> {
  const result: PushResult = { userId, sent: 0, failed: 0, skipped: 0 };
  try {
    if (pushDisabled()) {
      console.warn('[push] skipped (PUSH_DISABLED or test environment) for user %s', userId.slice(-6));
      return result;
    }

    const devices = await db.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (devices.length === 0) return result; // no devices registered — quiet no-op

    for (const { token } of devices) {
      const kind = routeToken(token);
      try {
        if (kind === 'expo') {
          await sendViaExpo(token, message);
          result.sent += 1;
        } else if (kind === 'fcm') {
          const serverKey = process.env.FIREBASE_SERVER_KEY;
          if (!serverKey) {
            result.skipped += 1;
            console.warn('[push] FCM token skipped — FIREBASE_SERVER_KEY is not configured');
            continue;
          }
          await sendViaFcm(token, message, serverKey);
          result.sent += 1;
        } else {
          result.skipped += 1;
          console.warn('[push] unknown token type skipped (length %d)', token.length);
        }
      } catch (err) {
        result.failed += 1;
        console.warn('[push] send failed for one device:', err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    // Belt and braces: nothing above may ever propagate to a route handler.
    console.warn('[push] sendToUser swallowed an error:', err instanceof Error ? err.message : String(err));
  }
  return result;
}

/**
 * Fire-and-forget wrapper for route call sites.
 * null/undefined patientId (walk-ins without an account) skip silently.
 * MUST be called only AFTER the business transaction has committed.
 */
export function notifyUser(userId: string | null | undefined, message: PushMessage): void {
  if (!userId) return; // walk-in without an account — skip silently
  void sendToUser(userId, message).catch(() => undefined);
}

async function sendViaExpo(token: string, message: PushMessage): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        to: token,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        priority: 'default',
        sound: 'default',
      },
    ]),
  });
  if (!res.ok) throw new Error(`Expo push API responded ${res.status}`);
}

async function sendViaFcm(token: string, message: PushMessage, serverKey: string): Promise<void> {
  const res = await fetch(FCM_SEND_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `key=${serverKey}`,
    },
    body: JSON.stringify({
      to: token,
      notification: { title: message.title, body: message.body },
      data: message.data ?? {},
    }),
  });
  if (!res.ok) throw new Error(`FCM responded ${res.status}`);
}
