import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';

/**
 * Push deep-link taps (Phase 8, B3).
 *
 * The frozen server payloads (api/src/lib/push.ts) are string-only:
 *   BOOKING_CONFIRMED / APPOINTMENT_CANCELLED / QUEUE_POSITION /
 *   APPOINTMENT_CONFIRMED (Phase 11 B2 — the manual confirmation)
 * All of them target PATIENTS, so every one of them routes to the patient
 * appointments tab. The live-queue route needs scheduleId + date which the
 * payload does NOT carry — by design we do NOT guess those.
 */

/** The single deep-link destination for every known push type. */
export type PushDeepLinkRoute = '/(tabs)/appointments';

/**
 * Map a notification `data.type` to its route. Unknown/missing types are a
 * no-op (null) — future server payload types must never crash the app.
 */
export function deepLinkRouteFor(type: unknown): PushDeepLinkRoute | null {
  if (
    type === 'BOOKING_CONFIRMED' ||
    type === 'APPOINTMENT_CANCELLED' ||
    type === 'APPOINTMENT_CONFIRMED' ||
    type === 'QUEUE_POSITION'
  ) {
    return '/(tabs)/appointments';
  }
  return null;
}

type NotificationResponseLike = {
  notification: {
    request: {
      identifier: string;
      content: { data?: Record<string, unknown> | null };
    };
  };
};

/**
 * Mounted ONCE in the root layout. Covers:
 *  - live taps while the app is foregrounded/backgrounded
 *    (addNotificationResponseReceivedListener);
 *  - the cold-start tap (useLastNotificationResponse), including the case
 *    where the notification arrives while the session is still hydrating —
 *    the decision is DEFERRED until hydration finishes (never dropped);
 *  - double-fires (the listener and last-response can both deliver the same
 *    tap) deduped via a ref of handled notification identifiers.
 *
 * Guards: navigate only for a hydrated PATIENT session. Logged-out users and
 * staff/admin roles are a permanent no-op (the notification is marked handled
 * so a later login never auto-navigates from a stale tap).
 */
export function usePushDeepLinks(): void {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const handled = useRef<Set<string>>(new Set());

  const tryNavigate = useCallback(
    (response: NotificationResponseLike | null | undefined) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (!id || handled.current.has(id)) return;

      const data = response.notification.request.content.data ?? undefined;
      const route = deepLinkRouteFor(data?.type);
      if (!route) {
        // Unknown/missing type — permanently ignored.
        handled.current.add(id);
        return;
      }

      // Cold start can race hydration: defer (unhandled) until the session
      // resolves, then act on the final auth state exactly once.
      if (status === 'hydrating') return;

      if (status !== 'authenticated' || !user || user.role !== 'PATIENT') {
        // Logged out, or a staff/admin tap — permanent no-op.
        handled.current.add(id);
        return;
      }

      handled.current.add(id);
      router.push(route);
    },
    [router, status, user],
  );

  // Live taps while the app is running.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      tryNavigate(response as unknown as NotificationResponseLike);
    });
    return () => sub.remove();
  }, [tryNavigate]);

  // Cold start: the notification whose tap launched the app.
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    tryNavigate(last as unknown as NotificationResponseLike | null);
  }, [last, tryNavigate]);
}
