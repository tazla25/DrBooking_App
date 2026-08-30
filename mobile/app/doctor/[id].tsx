import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  ErrorBanner,
  GlassCard,
  GlassHeader,
  GlassScreen,
  PrimaryButton,
} from '@/components';
import { api } from '@/lib/api';
import { ApiError, friendlyMessage } from '@/lib/errors';
import { dayName, formatFee, formatRating, formatDateISO } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';
import type { DoctorDetail, OverrideView, ScheduleView } from '@/lib/types';

export default function DoctorDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // State updates happen ONLY in the async callbacks (never synchronously
    // inside the effect body — react-hooks/set-state-in-effect).
    api
      .get<DoctorDetail>(`/api/doctors/${id}`)
      .then((data) => {
        if (alive) {
          setDoctor(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(
          err instanceof ApiError
            ? friendlyMessage(err)
            : friendlyMessage({ code: 'NETWORK_ERROR', status: 0 }),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <GlassScreen>
      <GlassHeader title={doctor ? doctor.fullName : 'Doctor'} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ctaGradient.end} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ErrorBanner message={error} />
          {error && !doctor ? (
            <GlassCard padded style={styles.retryCard}>
              <Text style={styles.retryText}>
                We could not load this doctor. They may not be publicly listed.
              </Text>
              <PrimaryButton
                label="Go back"
                icon="arrow-back-outline"
                onPress={() => router.back()}
              />
            </GlassCard>
          ) : doctor ? (
            <DoctorProfile doctor={doctor} />
          ) : null}
        </ScrollView>
      )}
    </GlassScreen>
  );
}

function DoctorProfile({ doctor }: { doctor: DoctorDetail }) {
  const router = useRouter();
  return (
    <View style={styles.body}>
      {/* -- Profile card ------------------------------------------------ */}
      <GlassCard padded style={styles.card}>
        <View style={styles.identityRow}>
          <Avatar name={doctor.fullName} size={72} />
          <View style={styles.identity}>
            <Text style={styles.name}>{doctor.fullName}</Text>
            <Text style={styles.spec}>{doctor.specialization ?? 'General practice'}</Text>
            <View style={styles.availabilityRow}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: doctor.isAvailableNow ? colors.available : colors.unavailable,
                  },
                ]}
              />
              <Text style={styles.availabilityText}>
                {doctor.isAvailableNow ? 'Available now' : 'Not available right now'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <Metric
            icon="star"
            value={
              doctor.reviewCount > 0
                ? `${formatRating(doctor.avgRating)} (${doctor.reviewCount})`
                : 'New'
            }
            label="Rating"
          />
          <Metric icon="wallet-outline" value={formatFee(doctor.fee)} label="Consultation" />
          <Metric
            icon="ribbon-outline"
            value={doctor.yearsExperience !== null ? `${doctor.yearsExperience} yrs` : '—'}
            label="Experience"
          />
        </View>

        {doctor.bio ? (
          <GlassCard nested style={styles.bio}>
            <Text style={styles.bioText}>{doctor.bio}</Text>
          </GlassCard>
        ) : null}
      </GlassCard>

      {/* -- Weekly schedules --------------------------------------------- */}
      <SectionTitle icon="calendar-outline" title="Weekly schedule" />
      {doctor.schedules.length === 0 ? (
        <GlassCard padded>
          <Text style={styles.emptyText}>No active schedules published yet.</Text>
        </GlassCard>
      ) : (
        doctor.schedules.map((schedule) => <SchedulePanel key={schedule.id} schedule={schedule} />)
      )}

      {/* -- Upcoming overrides -------------------------------------------- */}
      {doctor.overrides.length > 0 ? (
        <>
          <SectionTitle icon="alert-circle-outline" title="Upcoming changes" />
          {doctor.overrides.map((override) => (
            <OverridePanel key={override.id} override={override} />
          ))}
        </>
      ) : null}

      {/* -- Booking (Phase 6) ---------------------------------------------- */}
      <GlassCard padded style={styles.bookingCard}>
        <PrimaryButton
          label="Book appointment"
          icon="calendar"
          onPress={() => router.push(`/book/${doctor.id}`)}
        />
        <Text style={styles.bookingHint}>
          Pick a clinic and date — see the live token queue before you confirm.
        </Text>
      </GlassCard>
    </View>
  );
}

function Metric({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <Ionicons name={icon} size={15} color={colors.text.secondary} />
        <Text style={styles.metricValue}>{value}</Text>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SchedulePanel({ schedule }: { schedule: ScheduleView }) {
  const openMap = () => {
    if (schedule.mapLink) {
      void Linking.openURL(schedule.mapLink).catch(() => undefined);
    }
  };

  return (
    <GlassCard padded style={styles.scheduleCard}>
      <View style={styles.scheduleHead}>
        <Text style={styles.scheduleDay}>{dayName(schedule.dayOfWeek)}</Text>
        <Text style={styles.scheduleTime}>
          {schedule.startTime} – {schedule.endTime}
        </Text>
      </View>
      <Text style={styles.clinic}>{schedule.clinicName}</Text>
      <Text style={styles.address}>{schedule.clinicAddress}</Text>
      {schedule.landmark ? <Text style={styles.address}>Near {schedule.landmark}</Text> : null}
      <View style={styles.scheduleFoot}>
        {schedule.pinCode ? <Text style={styles.pin}>PIN {schedule.pinCode}</Text> : <View />}
        {schedule.mapLink ? (
          <Text onPress={openMap} style={styles.mapLink}>
            Open map
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
}

function OverridePanel({ override }: { override: OverrideView }) {
  const isClosed = override.type === 'CLOSED';
  const times =
    override.newStartTime && override.newEndTime
      ? `${override.newStartTime} – ${override.newEndTime}`
      : null;

  return (
    <GlassCard nested padded={false} style={styles.overrideCard}>
      <View style={styles.overrideRow}>
        <Ionicons
          name={isClosed ? 'close-circle-outline' : 'time-outline'}
          size={20}
          color={isClosed ? colors.destructive : colors.status.PENDING.fg}
        />
        <View style={styles.overrideText}>
          <Text style={styles.overrideTitle}>
            {isClosed ? 'Closed' : override.type === 'SPECIAL' ? 'Special hours' : 'Changed hours'}{' '}
            · {formatDateISO(override.date)}
          </Text>
          {times ? <Text style={styles.overrideTime}>{times}</Text> : null}
          {override.reason ? <Text style={styles.overrideReason}>{override.reason}</Text> : null}
        </View>
      </View>
    </GlassCard>
  );
}

function SectionTitle({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={16} color={colors.text.secondary} />
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.md },
  retryCard: { gap: spacing.base, marginTop: spacing.xl },
  retryText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  body: { gap: spacing.md },
  card: { gap: spacing.base },
  identityRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  identity: { flex: 1, gap: 2 },
  name: { ...typography.h2, color: colors.text.primary },
  spec: { ...typography.body, color: colors.text.secondary },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    marginTop: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  availabilityText: { ...typography.captionSemi, color: colors.text.secondary },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    padding: spacing.md,
    gap: 2,
  },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metricValue: { ...typography.bodySemi, color: colors.text.primary },
  metricLabel: { ...typography.micro, color: colors.text.secondary, letterSpacing: 0.3 },
  bio: { padding: spacing.md },
  bioText: { ...typography.caption, color: colors.text.secondary },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: -spacing.xs,
  },
  sectionTitleText: { ...typography.captionSemi, color: colors.text.secondary },
  scheduleCard: { gap: spacing.xs + 2 },
  scheduleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scheduleDay: { ...typography.h3, color: colors.text.primary },
  scheduleTime: { ...typography.bodySemi, color: '#2D6FB4' },
  clinic: { ...typography.bodySemi, color: colors.text.primary, marginTop: 2 },
  address: { ...typography.caption, color: colors.text.secondary },
  scheduleFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  pin: { ...typography.caption, color: colors.text.secondary },
  mapLink: { ...typography.captionSemi, color: '#2D6FB4' },
  emptyText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  overrideCard: { padding: spacing.md },
  overrideRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  overrideText: { flex: 1, gap: 2 },
  overrideTitle: { ...typography.bodySemi, color: colors.text.primary },
  overrideTime: { ...typography.caption, color: colors.text.secondary },
  overrideReason: { ...typography.caption, color: colors.text.secondary },
  bookingCard: { gap: spacing.sm, marginTop: spacing.md },
  bookingHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
