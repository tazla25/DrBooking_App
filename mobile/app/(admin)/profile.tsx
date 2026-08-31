import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassScreen,
  NotificationsCard,
  StatusChip,
} from '@/components';
import { formatDateISO } from '@/lib/format';
import { istDateOfISO } from '@/lib/time';
import { useAuthStore } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * A5 — Admin profile tab: mirrors (staff)/profile.tsx — identity card (an
 * admin is always VERIFIED), the shared Notifications settings card (B4),
 * change-password deep link (SUPER_ADMIN accounts can carry
 * mustChangePassword too), destructive sign-out, version label.
 */
export default function AdminProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <GlassScreen>
      <GlassHeader title="Profile" back={false} />
      <View style={styles.body}>
        {/* -- identity ------------------------------------------------------------ */}
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={56} />
            <View style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <View style={styles.chipRow}>
                <View style={styles.roleChip}>
                  <Text style={styles.roleChipText}>SUPER ADMIN</Text>
                </View>
                <StatusChip
                  status={user.verificationStatus === 'VERIFIED' ? 'COMPLETED' : 'PENDING'}
                />
              </View>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Phone</Text>
            <Text style={styles.metaValue}>{user.phone}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Member since</Text>
            <Text style={styles.metaValue}>{formatDateISO(istDateOfISO(user.createdAt))}</Text>
          </View>
          {user.mustChangePassword ? (
            <Text style={styles.mustChange}>
              A password change is required — use the button below.
            </Text>
          ) : null}
        </GlassCard>

        {/* -- notifications (B4) -------------------------------------------------- */}
        <NotificationsCard />

        {/* -- security -------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Security</Text>
          <GlassButton
            label="Change password"
            icon="key-outline"
            onPress={() => router.push('/(auth)/change-password')}
          />
        </GlassCard>

        {/* -- session ---------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Session</Text>
          <GlassButton
            label="Sign out"
            icon="log-out-outline"
            tone="destructive"
            onPress={() => void onLogout()}
          />
        </GlassCard>

        <Text style={styles.version}>
          Dr Booking · Phase 10
          {Constants.expoConfig?.version ? ` · v${Constants.expoConfig.version}` : ''}
        </Text>
      </View>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.base },
  card: { gap: spacing.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.sm },
  name: { ...typography.h2, color: colors.text.primary, flexShrink: 1 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleChip: {
    backgroundColor: 'rgba(77, 159, 222, 0.20)',
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: 'rgba(77, 159, 222, 0.35)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  roleChipText: { ...typography.micro, color: '#2D6FB4', letterSpacing: 0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaLabel: { ...typography.caption, color: colors.text.secondary, width: 110 },
  metaValue: { ...typography.bodySemi, color: colors.text.primary, flex: 1 },
  mustChange: {
    ...typography.caption,
    color: '#B27415',
    backgroundColor: 'rgba(245, 166, 35, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.30)',
    borderRadius: radii.inner,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  version: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
