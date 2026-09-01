import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { api } from '@/lib/api';
import { formatDateISO } from '@/lib/format';
import { istDateOfISO } from '@/lib/time';
import type { MeResponse } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Staff console — Profile tab: identity (name, phone, role, verification,
 * delegated doctor for compounders), change-password deep link (the existing
 * (auth)/change-password screen — compounders land there via the
 * mustChangePassword gate on first login), sign out, version label.
 */
export default function StaffProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<MeResponse>('/api/auth/me')
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const isCompounder = user.role === 'COMPOUNDER';
  const roleLabel = isCompounder ? 'Compounder' : 'Doctor';

  return (
    <GlassScreen>
      <GlassHeader title="Profile" back={false} />
      <View style={styles.body}>
        {/* -- identity -------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={56} />
            <View style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <View style={styles.chipRow}>
                <View style={styles.roleChip}>
                  <Text style={styles.roleChipText}>{roleLabel.toUpperCase()}</Text>
                </View>
                <StatusChip
                  status={user.verificationStatus === 'VERIFIED' ? 'COMPLETED' : 'PENDING'}
                />
              </View>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Ionicons name="call-outline" size={15} color={colors.text.secondary} />
            <Text style={styles.metaText}>{user.phone}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.text.secondary} />
            <Text style={styles.metaText}>
              Member since {formatDateISO(istDateOfISO(user.createdAt))}
            </Text>
          </View>
          {isCompounder && me?.doctorProfile ? (
            <View style={styles.metaRow}>
              <Ionicons name="medkit-outline" size={15} color={colors.text.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                Assisting Dr. {me.doctorProfile.fullName}
              </Text>
            </View>
          ) : null}
          {!isCompounder && me?.doctorProfile?.specialization ? (
            <View style={styles.metaRow}>
              <Ionicons name="ribbon-outline" size={15} color={colors.text.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {me.doctorProfile.specialization}
              </Text>
            </View>
          ) : null}
        </GlassCard>

        {/* -- notifications (B4) -------------------------------------------------- */}
        <NotificationsCard />

        {/* -- change password --------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Security</Text>
          <GlassButton
            label="Change password"
            icon="key-outline"
            onPress={() => router.push('/(auth)/change-password')}
          />
        </GlassCard>

        {/* -- sign out -------------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Session</Text>
          <GlassButton
            label="Sign out"
            icon="log-out-outline"
            tone="destructive"
            onPress={() => void onLogout()}
          />
        </GlassCard>

        <Text style={styles.version}>ClinIQ · Phase 10</Text>
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
  roleChipText: {
    ...typography.micro,
    color: colors.status.CALLED.fg,
    letterSpacing: 0.4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { ...typography.caption, color: colors.text.secondary, flexShrink: 1 },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  version: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
