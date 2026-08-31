import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from './GlassCard';
import { GlassToast, useToast } from './GlassToast';
import { registerPushToken } from '@/lib/push';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * "Notifications" settings card (Phase 8, B4) — shared by the patient,
 * staff and admin profile screens.
 *
 *  - Shows the CURRENT permission state (Granted / Denied / Unknown) from
 *    Notifications.getPermissionsAsync().
 *  - Tap re-runs registerPushToken() (best-effort: asks permission when
 *    undetermined, then registers the Expo token for this device) and toasts
 *    the outcome. When permission is DENIED the OS will not re-prompt — the
 *    card says so and points to the system settings (text only; no new deps).
 */

type PermissionState = 'granted' | 'denied' | 'unknown';

const PERMISSION_META: Record<PermissionState, { label: string; color: string }> = {
  granted: { label: 'Granted', color: colors.success },
  denied: { label: 'Denied', color: colors.destructive },
  unknown: { label: 'Unknown', color: colors.text.secondary },
};

function classify(settings: Notifications.PermissionResponse): PermissionState {
  if (settings.granted || settings.status === 'granted') return 'granted';
  if (settings.status === 'denied') return 'denied';
  return 'unknown';
}

export function NotificationsCard() {
  const { toast, show } = useToast();
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [checking, setChecking] = useState(false);

  // Permission state is loaded in the async callback only (never setState
  // synchronously inside the effect body — house lint rule).
  useEffect(() => {
    let alive = true;
    Notifications.getPermissionsAsync()
      .then((settings) => {
        if (alive) setPermission(classify(settings));
      })
      .catch(() => {
        if (alive) setPermission('unknown');
      });
    return () => {
      alive = false;
    };
  }, []);

  const recheck = async (): Promise<PermissionState> => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      const next = classify(settings);
      setPermission(next);
      return next;
    } catch {
      setPermission('unknown');
      return 'unknown';
    }
  };

  const onPress = async () => {
    setChecking(true);
    try {
      // Best-effort register (asks permission when undetermined, then POSTs
      // the token). On Expo Go without an EAS projectId the token call throws
      // internally and is swallowed BY DESIGN — the permission recheck below
      // still reflects the real OS state.
      await registerPushToken();
      const next = await recheck();
      if (next === 'granted') {
        show('Notifications are enabled for this device', 'success');
      } else if (next === 'denied') {
        show(
          'Notifications are blocked — enable them for Dr Booking in your device settings',
          'error',
        );
      } else {
        show('Notification permission is still pending for this device', 'info');
      }
    } finally {
      setChecking(false);
    }
  };

  const meta = permission !== null ? PERMISSION_META[permission] : null;

  return (
    <GlassCard padded style={styles.card}>
      <Text style={styles.sectionTitle}>Notifications</Text>
      <View style={styles.rowBox}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          accessibilityHint="Re-checks permission and re-registers this device for push notifications"
          disabled={checking}
          onPress={() => void onPress()}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.ctaGradient.end} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Push notifications</Text>
            <Text style={styles.rowCaption}>
              {permission === null
                ? 'Checking permission…'
                : permission === 'denied'
                  ? 'Blocked — enable Dr Booking notifications in your device settings, then tap here to re-register.'
                  : 'Booking confirmations, queue updates and cancellations. Tap to re-register this device.'}
            </Text>
          </View>
          {checking ? (
            <ActivityIndicator size="small" color={colors.ctaGradient.end} />
          ) : (
            <View
              style={[
                styles.statusPill,
                { borderColor: `${meta?.color ?? colors.text.secondary}55` },
              ]}
            >
              <Text style={[styles.statusText, { color: meta?.color ?? colors.text.secondary }]}>
                {meta?.label ?? '…'}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
      <GlassToast toast={toast} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  // C3 offender fix: the notification row now sits on a proper nested inner
  // panel (radius 16, nested alpha, hairline border) instead of floating loose.
  rowBox: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowPressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodySemi, color: colors.text.primary },
  rowCaption: { ...typography.caption, color: colors.text.secondary },
  statusPill: {
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    backgroundColor: colors.glass.chip,
  },
  statusText: { ...typography.micro, letterSpacing: 0.4 },
});
