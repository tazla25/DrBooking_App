import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiRequest } from './api';

/**
 * Best-effort Expo push-token registration — NEVER blocks or breaks a flow.
 *  - Simulators / non-devices: skipped.
 *  - Permission denied: skipped.
 *  - projectId missing (Expo Go without an EAS project) → getExpoPushTokenAsync
 *    throws → swallowed silently. Login must never fail because of push.
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted || settings.status === 'granted';
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req.status === 'granted';
    }
    if (!granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token || !token.startsWith('ExponentPushToken[')) return;

    await apiRequest('/api/devices', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
  } catch (err) {
    if (__DEV__) {
      console.warn('[push] registration skipped:', (err as Error)?.message ?? err);
    }
  }
}

// ---------------------------------------------------------------------------
// Foreground presentation + Android channel (Phase 8, B1)
// ---------------------------------------------------------------------------

/** Module flag — configurePush() is idempotent within one JS context. */
let pushConfigured = false;

/**
 * One-time push setup, called from the root layout on every app start:
 *  (a) the foreground notification handler — alerts + sound, no badge;
 *  (b) Android only: a HIGH-importance 'default' channel so heads-up
 *      notifications render on Android 8+.
 * Safe to call repeatedly (re-renders, Fast Refresh) — only the first call
 * installs anything.
 */
export function configurePush(): void {
  if (pushConfigured) return;
  pushConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      // SDK 57 additions — banners + list are the iOS 14+/Android 13 default
      // presentation surfaces for the alert we just opted into.
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    }).catch(() => undefined);
  }
}

/** Test seam — resets the idempotence flag (never call from app code). */
export function __resetPushConfiguredForTests(): void {
  pushConfigured = false;
}
