import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) return null;

  const onLogout = async () => {
    await logout(); // POST /api/auth/logout (errors ignored) + wipe secure-store
    router.replace('/login');
  };

  return (
    <GlassScreen>
      <GlassHeader title="Profile" back={false} />
      {/* mobilefix1 BUG-1: same defect class as the staff profile — bounded
          ScrollView so Sign out stays reachable when content grows. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={64} />
            <View style={styles.identity}>
              <Text style={styles.name}>{user.name}</Text>
              <Text style={styles.phone}>{user.phone}</Text>
            </View>
          </View>

          <View style={styles.chipRow}>
            <View style={styles.roleChip}>
              <Text style={styles.roleChipText}>{roleLabel(user.role)}</Text>
            </View>
            <StatusChip
              status={
                user.verificationStatus === 'VERIFIED'
                  ? 'COMPLETED'
                  : user.verificationStatus === 'PENDING'
                    ? 'PENDING'
                    : 'CANCELLED'
              }
              large={false}
            />
          </View>
          <Text style={styles.chipHint}>
            {user.verificationStatus === 'PENDING'
              ? 'Account pending admin verification'
              : user.verificationStatus === 'REJECTED'
                ? 'Account rejected by admin'
                : 'Account verified'}
          </Text>

          <View style={styles.infoPanel}>
            <InfoRow icon="call-outline" label="Phone" value={user.phone} />
            <InfoRow
              icon="calendar-outline"
              label="Member since"
              value={formatDateISO(istDateOfISO(user.createdAt))}
            />
            <InfoRow icon="id-card-outline" label="Role" value={roleLabel(user.role)} />
          </View>
        </GlassCard>

        <NotificationsCard />

        <GlassButton
          label="Sign out"
          icon="log-out-outline"
          tone="destructive"
          onPress={onLogout}
          style={styles.logout}
        />

        {__DEV__ ? (
          <GlassButton
            label="Design system demo (dev)"
            icon="color-palette-outline"
            onPress={() => router.push('/demo')}
          />
        ) : null}

        <Text style={styles.version}>ClinIQ · Phase 10</Text>
      </ScrollView>
    </GlassScreen>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'PATIENT':
      return 'Patient';
    case 'DOCTOR':
      return 'Doctor';
    case 'COMPOUNDER':
      return 'Compounder';
    case 'SUPER_ADMIN':
      return 'Admin';
    default:
      return role;
  }
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.text.secondary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // mobilefix1: flex:1 dropped from body (sizes to content inside the
  // ScrollView); the 96 runway stays — the documented tab-screen literal.
  scroll: { flex: 1 },
  body: {
    padding: spacing.base,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: spacing.base,
  },
  card: { gap: spacing.base },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identity: { flex: 1 },
  name: { ...typography.h2, color: colors.text.primary },
  phone: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roleChip: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  roleChipText: {
    ...typography.micro,
    color: colors.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  chipHint: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: -spacing.xs,
  },
  infoPanel: {
    gap: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoLabel: { ...typography.caption, color: colors.text.secondary, width: 110 },
  infoValue: { ...typography.bodySemi, color: colors.text.primary, flex: 1 },
  logout: {},
  version: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
