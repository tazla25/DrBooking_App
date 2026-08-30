import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassModal,
  GlassScreen,
  PrimaryButton,
} from '@/components';
import { api } from '@/lib/api';
import { availabilityClosedMessage, bookAppointment } from '@/lib/appointments';
import { ApiError, friendlyMessage, toFriendlyMessage } from '@/lib/errors';
import { dayName, formatDayMonth, formatDateISO, formatFee } from '@/lib/format';
import { dayOfWeekISO, firstDateForDay, istTodayISO, nextDates } from '@/lib/time';
import { useAvailability } from '@/hooks/useAvailability';
import { colors, radii, spacing, typography } from '@/theme';
import type { DoctorDetail, ScheduleView } from '@/lib/types';

/** How many days the date strip offers. */
const DATE_STRIP_DAYS = 7;

export default function BookingScreen() {
  const router = useRouter();
  const { doctorId } = useLocalSearchParams<{ doctorId: string }>();

  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(istTodayISO());

  const schedules = doctor?.schedules ?? [];

  // Default-select the first clinic and its next consulting day as soon as a
  // doctor loads — the render-time "adjust state" pattern (no effect needed).
  if (doctor && schedules.length > 0 && !scheduleId) {
    const first = schedules[0];
    setScheduleId(first.id);
    setDate(firstDateForDay(istTodayISO(), first.dayOfWeek) ?? istTodayISO());
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // -- doctor detail -------------------------------------------------------
  useEffect(() => {
    let alive = true;
    api
      .get<DoctorDetail>(`/api/doctors/${doctorId}`)
      .then((data) => {
        if (!alive) return;
        setDoctor(data);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(toFriendlyMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [doctorId, reloadKey]);

  const schedule = schedules.find((s) => s.id === scheduleId) ?? null;

  const availability = useAvailability(scheduleId, date);

  const dates = useMemo(() => nextDates(istTodayISO(), DATE_STRIP_DAYS), []);

  const pickSchedule = (next: ScheduleView) => {
    setScheduleId(next.id);
    // Jump the strip to this clinic's next consulting day.
    setDate(firstDateForDay(istTodayISO(), next.dayOfWeek) ?? istTodayISO());
  };

  const open = availability.data?.open === true ? availability.data : null;
  const fullyBooked = open !== null && open.capacityLeft <= 0;

  // -- confirm + submit ------------------------------------------------------
  const onConfirm = async () => {
    if (!scheduleId || !date) return;
    setBooking(true);
    setBookingError(null);
    try {
      const result = await bookAppointment(scheduleId, date);
      router.replace({
        pathname: '/booking-success',
        params: {
          appointmentId: result.appointment.id,
          position: String(result.position),
          estWaitMin: String(result.estWaitMin),
          clinicName: schedule?.clinicName ?? '',
          clinicAddress: schedule?.clinicAddress ?? '',
          doctorName: doctor?.fullName ?? '',
          doctorProfileId: doctorId,
          scheduleId,
          date,
          startTime: schedule?.startTime ?? '',
          endTime: schedule?.endTime ?? '',
        },
      });
    } catch (err) {
      // All codes via friendlyMessage — RATE_LIMITED includes the seconds.
      setBookingError(
        err instanceof ApiError
          ? friendlyMessage({
              code: err.code,
              status: err.status,
              message: err.message,
              retryAfter: (err.meta.retryAfter as number | undefined) ?? undefined,
            })
          : toFriendlyMessage(err),
      );
    } finally {
      setBooking(false);
    }
  };

  const canContinue = open !== null && !fullyBooked && !availability.loading;

  return (
    <GlassScreen>
      <GlassHeader title="Book appointment" />
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
              <GlassButton
                label="Try again"
                icon="refresh-outline"
                onPress={() => setReloadKey((k) => k + 1)}
              />
              <GlassButton
                label="Go back"
                icon="arrow-back-outline"
                onPress={() => router.back()}
              />
            </GlassCard>
          ) : doctor ? (
            <View style={styles.body}>
              {/* -- doctor strip ------------------------------------------------ */}
              <GlassCard padded style={styles.card}>
                <View style={styles.identityRow}>
                  <Avatar name={doctor.fullName} size={52} />
                  <View style={styles.identity}>
                    <Text style={styles.name} numberOfLines={1}>
                      {doctor.fullName}
                    </Text>
                    <Text style={styles.spec} numberOfLines={1}>
                      {doctor.specialization ?? 'General practice'}
                    </Text>
                  </View>
                  <Text style={styles.fee}>{formatFee(doctor.fee)}</Text>
                </View>
              </GlassCard>

              {/* -- schedule picker --------------------------------------------- */}
              <SectionTitle icon="business-outline" title="Choose a clinic" />
              {schedules.length === 0 ? (
                <EmptyState
                  icon="calendar-clear-outline"
                  title="No active schedules"
                  caption="This doctor has not published any clinic schedule yet. Check back later."
                  ctaLabel="Back to doctor"
                  onCta={() => router.back()}
                />
              ) : (
                schedules.map((s) => (
                  <ScheduleOption
                    key={s.id}
                    schedule={s}
                    selected={s.id === scheduleId}
                    onPress={() => pickSchedule(s)}
                  />
                ))
              )}

              {/* -- date strip --------------------------------------------------- */}
              <SectionTitle icon="calendar-outline" title="Pick a date" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dateRow}
              >
                {dates.map((d) => {
                  const dow = dayOfWeekISO(d);
                  const isScheduleDay = schedule !== null && schedule.dayOfWeek === dow;
                  const selected = d === date;
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${formatDateISO(d)}`}
                      accessibilityState={{ selected }}
                      onPress={() => setDate(d)}
                      style={[styles.dateChip, selected && styles.dateChipActive]}
                    >
                      <Text style={[styles.dateWeekday, selected && styles.dateTextActive]}>
                        {dayName(dow, true)}
                      </Text>
                      <Text style={[styles.dateDay, selected && styles.dateTextActive]}>
                        {formatDayMonth(d)}
                      </Text>
                      {isScheduleDay ? (
                        <View style={[styles.dayDot, selected && styles.dayDotActive]} />
                      ) : (
                        <View style={styles.dayDotSpacer} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* -- availability -------------------------------------------------- */}
              <SectionTitle icon="pulse-outline" title="Availability" />
              {availability.loading ? (
                <GlassCard padded style={styles.availLoading}>
                  <ActivityIndicator color={colors.ctaGradient.end} />
                </GlassCard>
              ) : availability.error ? (
                <GlassCard padded style={styles.card}>
                  <ErrorBanner message={availability.error} />
                  <GlassButton
                    label="Try again"
                    icon="refresh-outline"
                    onPress={availability.refetch}
                  />
                </GlassCard>
              ) : availability.data && !availability.data.open ? (
                <GlassCard padded style={styles.closedCard}>
                  <Ionicons name="close-circle-outline" size={26} color={colors.destructive} />
                  <Text style={styles.closedTitle}>Not available</Text>
                  <Text style={styles.closedText}>
                    {availabilityClosedMessage(availability.data.reason)}
                  </Text>
                </GlassCard>
              ) : open ? (
                <GlassCard padded style={styles.card}>
                  <View style={styles.metricsRow}>
                    <Metric icon="ticket-outline" value={`#${open.nextQueue}`} label="Next token" />
                    <Metric
                      icon="time-outline"
                      value={open.estWaitMin > 0 ? `~${open.estWaitMin}m` : 'Now'}
                      label="Est. wait"
                    />
                    <Metric
                      icon="people-outline"
                      value={String(open.capacityLeft)}
                      label="Slots left"
                    />
                  </View>
                  <Text style={styles.availHint}>
                    About {open.avgMinutesPerPatient} min per patient · Queue updates live.
                  </Text>
                  {fullyBooked ? (
                    <View style={styles.fullRow}>
                      <Ionicons name="ban-outline" size={16} color={colors.destructive} />
                      <Text style={styles.fullText}>Fully booked for this date</Text>
                    </View>
                  ) : null}
                </GlassCard>
              ) : null}

              {/* -- CTA ----------------------------------------------------------- */}
              {schedules.length > 0 ? (
                <PrimaryButton
                  label={fullyBooked ? 'Fully booked' : 'Continue'}
                  icon={fullyBooked ? 'ban-outline' : 'arrow-forward-outline'}
                  disabled={!canContinue || fullyBooked}
                  onPress={() => {
                    setBookingError(null);
                    setConfirmOpen(true);
                  }}
                  style={styles.cta}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* -- confirm sheet ------------------------------------------------------ */}
      <GlassModal
        visible={confirmOpen}
        title="Confirm booking"
        dismissable={!booking}
        onClose={() => setConfirmOpen(false)}
      >
        <View style={styles.confirmRows}>
          <ConfirmRow icon="person-outline" label="Doctor" value={doctor?.fullName ?? '—'} />
          <ConfirmRow icon="business-outline" label="Clinic" value={schedule?.clinicName ?? '—'} />
          <ConfirmRow
            icon="calendar-outline"
            label="Date"
            value={
              schedule
                ? `${dayName(schedule.dayOfWeek)}, ${formatDateISO(date)}`
                : formatDateISO(date)
            }
          />
          <ConfirmRow
            icon="time-outline"
            label="Time"
            value={schedule ? `${schedule.startTime} – ${schedule.endTime}` : '—'}
          />
          {doctor?.fee !== null && doctor?.fee !== undefined ? (
            <ConfirmRow icon="wallet-outline" label="Fee" value={formatFee(doctor.fee)} />
          ) : null}
        </View>
        <ErrorBanner message={bookingError} />
        <PrimaryButton
          label={booking ? 'Booking…' : 'Confirm booking'}
          icon="checkmark-circle-outline"
          loading={booking}
          onPress={onConfirm}
        />
        <GlassButton label="Not now" disabled={booking} onPress={() => setConfirmOpen(false)} />
      </GlassModal>
    </GlassScreen>
  );
}

// -- pieces -------------------------------------------------------------------

function ScheduleOption({
  schedule,
  selected,
  onPress,
}: {
  schedule: ScheduleView;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      <GlassCard padded style={[styles.scheduleCard, selected && styles.scheduleCardSelected]}>
        <View style={styles.scheduleHead}>
          <Text style={styles.scheduleDay}>{dayName(schedule.dayOfWeek)}</Text>
          <Text style={styles.scheduleTime}>
            {schedule.startTime} – {schedule.endTime}
          </Text>
        </View>
        <Text style={styles.clinic} numberOfLines={1}>
          {schedule.clinicName}
        </Text>
        <Text style={styles.address} numberOfLines={2}>
          {schedule.clinicAddress}
        </Text>
      </GlassCard>
    </Pressable>
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

function ConfirmRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.confirmRow}>
      <Ionicons name={icon} size={16} color={colors.text.secondary} />
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={styles.confirmValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
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
  retryCard: { gap: spacing.md, marginTop: spacing.xl },
  retryText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  body: { gap: spacing.md },
  card: { gap: spacing.base },
  identityRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  identity: { flex: 1, gap: 2 },
  name: { ...typography.h3, color: colors.text.primary },
  spec: { ...typography.caption, color: colors.text.secondary },
  fee: { ...typography.h3, color: colors.text.primary },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: -spacing.xs,
  },
  sectionTitleText: { ...typography.captionSemi, color: colors.text.secondary },
  scheduleCard: { gap: spacing.xs + 2 },
  scheduleCardSelected: {
    borderColor: 'rgba(77, 159, 222, 0.65)',
    borderWidth: 2,
  },
  scheduleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scheduleDay: { ...typography.h3, color: colors.text.primary },
  scheduleTime: { ...typography.bodySemi, color: '#2D6FB4' },
  clinic: { ...typography.bodySemi, color: colors.text.primary, marginTop: 2 },
  address: { ...typography.caption, color: colors.text.secondary },
  dateRow: { gap: spacing.sm, paddingRight: spacing.base },
  dateChip: {
    alignItems: 'center',
    backgroundColor: colors.glass.chip,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 64,
    gap: 2,
  },
  dateChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  dateWeekday: { ...typography.micro, color: colors.text.secondary, textTransform: 'uppercase' },
  dateDay: { ...typography.bodySemi, color: colors.text.primary },
  dateTextActive: { color: colors.white },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4D9FDE', marginTop: 2 },
  dayDotActive: { backgroundColor: colors.accent },
  dayDotSpacer: { width: 6, height: 6, marginTop: 2 },
  availLoading: { alignItems: 'center', paddingVertical: spacing.xl },
  closedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(226, 85, 85, 0.10)',
    borderColor: 'rgba(226, 85, 85, 0.30)',
  },
  closedTitle: { ...typography.h3, color: colors.destructive },
  closedText: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  metricsRow: { flexDirection: 'row', gap: spacing.sm },
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
  availHint: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  fullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(226, 85, 85, 0.12)',
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: 'rgba(226, 85, 85, 0.30)',
    paddingVertical: spacing.sm,
  },
  fullText: { ...typography.captionSemi, color: colors.destructive },
  cta: { marginTop: spacing.sm },
  confirmRows: { gap: spacing.md },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmLabel: { ...typography.caption, color: colors.text.secondary, width: 70 },
  confirmValue: { ...typography.bodySemi, color: colors.text.primary, flex: 1 },
});
