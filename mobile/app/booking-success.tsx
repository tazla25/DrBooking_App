import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { GlassButton, GlassCard, GlassHeader, GlassScreen, PrimaryButton } from '@/components';
import { formatDateISO } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';

/**
 * Booking success — the confirmation the spec asks for: big token number,
 * estimated wait, clinic, and the two ways forward (live queue / back to the
 * doctor). Reached via router.replace from the booking screen, so Back
 * naturally returns to the doctor detail.
 */
export default function BookingSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    position: string;
    estWaitMin: string;
    clinicName: string;
    clinicAddress: string;
    doctorName: string;
    doctorProfileId: string;
    scheduleId: string;
    date: string;
    startTime: string;
    endTime: string;
  }>();

  const position = Number(params.position ?? '0');
  const estWaitMin = Number(params.estWaitMin ?? '0');
  const time =
    params.startTime && params.endTime ? `${params.startTime} – ${params.endTime}` : null;

  return (
    <GlassScreen>
      <GlassHeader title="Booking confirmed" back={false} />
      <View style={styles.body}>
        {/* -- the token -------------------------------------------------- */}
        <GlassCard padded style={styles.heroCard}>
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={34} color={colors.success} />
          </View>
          <Text style={styles.doctorName}>{params.doctorName}</Text>
          <Text style={styles.clinicName}>{params.clinicName}</Text>
          <Text style={styles.address}>{params.clinicAddress}</Text>
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.text.secondary} />
            <Text style={styles.dateText}>
              {formatDateISO(params.date ?? '')}
              {time ? ` · ${time}` : ''}
            </Text>
          </View>
        </GlassCard>

        {/* -- token + wait ------------------------------------------------- */}
        <GlassCard padded style={styles.tokenCard}>
          <Text style={styles.tokenLabel}>Your token</Text>
          <Text style={styles.token}>#{position}</Text>
          <Text style={styles.waitHint}>
            {estWaitMin > 0
              ? `Estimated wait ~${estWaitMin} min — watch the live queue`
              : 'You are first in the queue'}
          </Text>
        </GlassCard>

        {/* -- actions ------------------------------------------------------ */}
        <PrimaryButton
          label="View live queue"
          icon="pulse-outline"
          onPress={() => router.push(`/queue/${params.scheduleId}/${params.date}`)}
        />
        <GlassButton
          label="Back to doctor"
          icon="arrow-back-outline"
          onPress={() => router.push(`/doctor/${params.doctorProfileId}`)}
        />
        <Text style={styles.footnote}>
          Show token #{position} at the clinic desk. A confirmation notification is on its way.
        </Text>
      </View>
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    padding: spacing.base,
    gap: spacing.base,
  },
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxl },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 178, 115, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(59, 178, 115, 0.40)',
    marginBottom: spacing.sm,
  },
  doctorName: { ...typography.h2, color: colors.text.primary },
  clinicName: { ...typography.bodySemi, color: colors.text.primary },
  address: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dateText: { ...typography.caption, color: colors.text.secondary },
  tokenCard: { alignItems: 'center', gap: spacing.xs },
  tokenLabel: {
    ...typography.micro,
    color: colors.text.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  token: {
    ...typography.display,
    color: '#2D6FB4',
    fontWeight: '800',
  },
  waitHint: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  footnote: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
