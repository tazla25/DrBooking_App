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
