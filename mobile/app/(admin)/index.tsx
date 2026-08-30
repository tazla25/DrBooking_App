import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar, GlassButton, GlassCard, GlassHeader, GlassScreen } from '@/components';
import { useAuthStore } from '@/store/auth';
import { colors, spacing, typography } from '@/theme';

/**
 * Admin home (SUPER_ADMIN) — Phase 5 placeholder.
 * Doctor verification, analytics and exports arrive in Phase 8.
 */
export default function AdminHomeScreen() {
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
      <GlassHeader title="Admin Console" back={false} />
      <View style={styles.body}>
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={56} />
            <View style={styles.identity}>
              <Text style={styles.name}>{user.name}</Text>
              <Text style={styles.phone}>{user.phone}</Text>
            </View>
          </View>
        </GlassCard>

        <GlassCard padded style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="shield-checkmark-outline" size={34} color={colors.ctaGradient.end} />
          </View>
          <Text style={styles.title}>The admin console arrives in Phase 8</Text>
          <Text style={styles.bodyText}>
            Doctor verification, analytics dashboards and CSV exports are on the way. You are signed
            in with full admin access.
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
  identity: { flex: 1 },
  name: { ...typography.h2, color: colors.text.primary },
  phone: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
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
