import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar, GlassButton, GlassCard, GlassHeader, GlassScreen, StatusChip } from '@/components';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { colors, spacing, typography } from '@/theme';
import type { MeResponse } from '@/lib/types';

/**
 * Staff home (DOCTOR + COMPOUNDER) — Phase 5 placeholder.
 * The real queue / walk-in / schedule panel arrives in Phase 7.
 */
export default function StaffHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    api
      .get<MeResponse>('/api/auth/me')
      .then(setMe)
      .catch(() => undefined);
  }, []);

  if (!user) return null;

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const delegated = user.role === 'COMPOUNDER' && me?.doctorProfile;

  return (
    <GlassScreen>
      <GlassHeader
        title={user.role === 'COMPOUNDER' ? 'Compounder Panel' : 'Doctor Panel'}
        back={false}
      />
      <View style={styles.body}>
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={56} />
            <View style={styles.identity}>
              <Text style={styles.name}>{user.name}</Text>
              <View style={styles.chipRow}>
                <StatusChip
                  status={user.verificationStatus === 'VERIFIED' ? 'COMPLETED' : 'PENDING'}
                />
                {delegated ? (
                  <Text style={styles.delegated} numberOfLines={1}>
                    Assisting {me.doctorProfile?.fullName}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </GlassCard>

        <GlassCard padded style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="medkit-outline" size={34} color={colors.ctaGradient.end} />
          </View>
          <Text style={styles.title}>The staff panel arrives in Phase 7</Text>
          <Text style={styles.bodyText}>
            Queue management, walk-ins, schedules and patient notes are on the way. Your account is
            set up and signed in — nothing else to do right now.
          </Text>
        </GlassCard>

        <GlassButton
          label="Sign out"
          icon="log-out-outline"
          tone="destructive"
          onPress={onLogout}
        />
      </View>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.base },
  card: { gap: spacing.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.sm },
  name: { ...typography.h2, color: colors.text.primary },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  delegated: { ...typography.caption, color: colors.text.secondary, flex: 1 },
  iconCircle: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.nested,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  title: { ...typography.h2, color: colors.text.primary, textAlign: 'center' },
  bodyText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
});
