import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassButton, GlassCard, GlassHeader, GlassScreen, PrimaryButton } from '@/components';
import { formatDateISO } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Booking received (Phase 11 B4) — the ONLINE booking lands PENDING: the
 * serial is allocated and FINAL, but the clinic confirms it manually. This
 * screen shows the pending state clearly — "Waiting for confirmation —
 * Serial #N" — distinct from a confirmed booking (which the appointments
 * list shows after the APPOINTMENT_CONFIRMED push). Reached via
 * router.replace from the booking screen, so Back naturally returns to the
 * doctor detail.
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

  // The "booking success" moment — one light success haptic (never on the
  // failure path: this screen is only reached after a 201).
  useEffect(() => {
    hapticSuccess();
  }, []);

  return (
    <GlassScreen>
      <GlassHeader title="Booking received" back={false} />
      <View style={styles.body}>
        {/* -- the token -------------------------------------------------- */}
        <GlassCard padded style={styles.heroCard}>
          <View style={styles.checkCircle}>
            <Ionicons name="hourglass-outline" size={30} color={colors.status.PENDING.fg} />
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
          <Text style={styles.tokenLabel}>Your serial</Text>
          <Text style={styles.token}>#{position}</Text>
          <Text style={styles.pendingChip}>Waiting for confirmation</Text>
          <Text style={styles.waitHint}>
            {estWaitMin > 0
              ? `Serial #${position} is reserved — estimated wait ~${estWaitMin} min once the clinic confirms.`
              : `Serial #${position} is reserved — you would be first once the clinic confirms.`}
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
          Show serial #{position} at the clinic desk. You will get a notification the moment your
          appointment is confirmed.
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
    borderRadius: radii.round, // true circle — token, not literal
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 166, 35, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.40)',
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
    color: colors.status.CALLED.fg,
    fontWeight: '800',
  },
  waitHint: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  pendingChip: {
    ...typography.micro,
    color: colors.status.PENDING.fg,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  footnote: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
