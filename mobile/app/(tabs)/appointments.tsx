import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import {
  EmptyState,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassModal,
  GlassScreen,
  GlassTextField,
  GlassToast,
  PrimaryButton,
  StarRating,
  StatusChip,
  useToast,
} from '@/components';
import {
  cancelAppointment,
  resolveScheduleId,
  submitFeedback,
  type AppointmentRange,
  type MyAppointment,
} from '@/lib/appointments';
import { ApiError, friendlyMessage, toFriendlyMessage } from '@/lib/errors';
import { formatDateISO } from '@/lib/format';
import { useAppointments } from '@/hooks/useAppointments';
import { colors, radii, spacing, typography } from '@/theme';

const RANGES: { key: AppointmentRange; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

/** Helper: friendly message with retryAfter lifted from ApiError.meta. */
function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    return friendlyMessage({
      code: err.code,
      status: err.status,
      message: err.message,
      retryAfter: (err.meta.retryAfter as number | undefined) ?? undefined,
    });
  }
  return toFriendlyMessage(err);
}

export default function MyAppointmentsScreen() {
  const router = useRouter();
  const { toast, show } = useToast();

  const [range, setRange] = useState<AppointmentRange>('upcoming');
  const list = useAppointments(range);

  // -- cancel flow -----------------------------------------------------------
  const [cancelTarget, setCancelTarget] = useState<MyAppointment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const openCancel = (appointment: MyAppointment) => {
    setCancelError(null);
    setCancelTarget(appointment);
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelAppointment(cancelTarget.id);
      // Update the list in place — a cancelled token leaves "Upcoming".
      const token = cancelTarget.queueNumber;
      list.updateItems((items) => items.filter((a) => a.id !== cancelTarget.id));
      setCancelTarget(null);
      show(`Token #${token} cancelled`, 'success');
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'INVALID_TRANSITION' || err.code === 'NOT_FOUND')
      ) {
        // The list is stale — refetch and surface the mapped message.
        setCancelTarget(null);
        void list.refresh();
        show(messageOf(err), 'error');
      } else {
        // Transient (network/5xx) — keep the sheet open so the user can retry.
        setCancelError(messageOf(err));
      }
    } finally {
      setCancelling(false);
    }
  };

  // -- live queue deep link (scheduleId is resolved via the doctor detail) ----
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const openLiveQueue = async (appointment: MyAppointment) => {
    setResolvingId(appointment.id);
    try {
      const scheduleId = await resolveScheduleId(appointment);
      if (!scheduleId) {
        show('Live queue is not available for this appointment.', 'error');
        return;
      }
      router.push(`/queue/${scheduleId}/${appointment.date}`);
    } catch (err) {
      show(messageOf(err), 'error');
    } finally {
      setResolvingId(null);
    }
  };

  // -- feedback flow -----------------------------------------------------------
  const [feedbackTarget, setFeedbackTarget] = useState<MyAppointment | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [ratedIds, setRatedIds] = useState<ReadonlySet<string>>(new Set());

  const openFeedback = (appointment: MyAppointment) => {
    setFeedbackError(null);
    setRating(0);
    setComment('');
    setFeedbackTarget(appointment);
  };

  const doSubmitFeedback = async () => {
    if (!feedbackTarget || rating < 1) return;
    setSubmitting(true);
    setFeedbackError(null);
    try {
      await submitFeedback(feedbackTarget.id, rating, comment || undefined);
      setRatedIds((prev) => new Set(prev).add(feedbackTarget.id));
      setFeedbackTarget(null);
      show('Thanks for your feedback!', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_REVIEWED') {
        // Already rated server-side — mark the card and move on silently.
        setRatedIds((prev) => new Set(prev).add(feedbackTarget.id));
        setFeedbackTarget(null);
        show('You have already reviewed this visit.', 'info');
        return;
      }
      setFeedbackError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  // -- render -------------------------------------------------------------------
  return (
    <GlassScreen>
      <GlassHeader title="My appointments" back={false} />

      <View style={styles.controls}>
        <View style={styles.segmentRow}>
          {RANGES.map((r) => (
            <GlassButton
              key={r.key}
              label={r.label}
              onPress={() => setRange(r.key)}
              disabled={list.loading}
              style={[styles.segmentButton, range === r.key && styles.segmentActive]}
            />
          ))}
        </View>
        <ErrorBanner message={list.error} />
        {list.error ? (
          <GlassButton
            label="Try again"
            icon="refresh-outline"
            onPress={() => void list.refresh()}
            style={styles.retryRow}
          />
        ) : null}
      </View>

      {list.loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ctaGradient.end} />
        </View>
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={() => void list.refresh()}
              tintColor="#4D9FDE"
            />
          }
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            range === 'upcoming' ? (
              <EmptyState
                icon="calendar-outline"
                title="No upcoming appointments"
                caption="Book a doctor and your live token will appear here."
                ctaLabel="Find doctors"
                onCta={() => router.push('/(tabs)')}
              />
            ) : (
              <EmptyState
                icon="time-outline"
                title="No past visits"
                caption="Completed, cancelled and missed visits will show up here."
              />
            )
          }
          ListFooterComponent={
            list.loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.ctaGradient.end} />
              </View>
            ) : list.complete && list.items.length > 0 ? (
              <Text style={styles.footerHint}>
                {list.items.length} of {list.total} visits
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <AppointmentCard
              appointment={item}
              range={range}
              rated={ratedIds.has(item.id)}
              resolvingQueue={resolvingId === item.id}
              onCancel={() => openCancel(item)}
              onLiveQueue={() => void openLiveQueue(item)}
              onRate={() => openFeedback(item)}
            />
          )}
        />
      )}

      {/* -- cancel confirm ------------------------------------------------------ */}
      <GlassModal
        visible={cancelTarget !== null}
        title="Cancel appointment?"
        dismissable={!cancelling}
        onClose={() => setCancelTarget(null)}
      >
        <Text style={styles.cancelText}>
          {cancelTarget
            ? `Cancel token #${cancelTarget.queueNumber} with Dr. ${cancelTarget.doctor.fullName}? Your slot will be released to other patients.`
            : ''}
        </Text>
        <ErrorBanner message={cancelError} />
        <PrimaryButton
          label={cancelling ? 'Cancelling…' : 'Yes, cancel it'}
          icon="close-circle-outline"
          tone="destructive"
          loading={cancelling}
          onPress={() => void doCancel()}
        />
        <GlassButton label="Keep it" disabled={cancelling} onPress={() => setCancelTarget(null)} />
      </GlassModal>

      {/* -- feedback sheet -------------------------------------------------------- */}
      <GlassModal
        visible={feedbackTarget !== null}
        title="Rate your visit"
        dismissable={!submitting}
        onClose={() => setFeedbackTarget(null)}
      >
        {feedbackTarget ? (
          <>
            <Text style={styles.feedbackIntro}>
              How was your visit with Dr. {feedbackTarget.doctor.fullName} on{' '}
              {formatDateISO(feedbackTarget.date)}?
            </Text>
            <StarRating value={rating} onChange={setRating} />
            <View style={styles.commentWrap}>
              <GlassTextField
                placeholder="Anything to add? (optional)"
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={1000}
              />
            </View>
            <ErrorBanner message={feedbackError} />
            <PrimaryButton
              label={submitting ? 'Sending…' : 'Submit feedback'}
              icon="star-outline"
              loading={submitting}
              disabled={rating < 1}
              onPress={() => void doSubmitFeedback()}
            />
            <GlassButton
              label="Maybe later"
              disabled={submitting}
              onPress={() => setFeedbackTarget(null)}
            />
          </>
        ) : null}
      </GlassModal>

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

// -- card -----------------------------------------------------------------------

function AppointmentCard({
  appointment,
  range,
  rated,
  resolvingQueue,
  onCancel,
  onLiveQueue,
  onRate,
}: {
  appointment: MyAppointment;
  range: AppointmentRange;
  rated: boolean;
  resolvingQueue: boolean;
  onCancel: () => void;
  onLiveQueue: () => void;
  onRate: () => void;
}) {
  const isConfirmed = appointment.status === 'CONFIRMED';
  const canRate = range === 'past' && appointment.status === 'COMPLETED' && !rated;

  return (
    <GlassCard padded style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.token}>#{appointment.queueNumber}</Text>
        <StatusChip status={appointment.status as 'CONFIRMED'} />
      </View>

      <View style={styles.cardMid}>
        <View style={styles.doctorCol}>
          <Text style={styles.doctor} numberOfLines={1}>
            Dr. {appointment.doctor.fullName}
          </Text>
          {appointment.doctor.specialization ? (
            <Text style={styles.spec} numberOfLines={1}>
              {appointment.doctor.specialization}
            </Text>
          ) : null}
        </View>
        {range === 'upcoming' && typeof appointment.estWaitMin === 'number' ? (
          <View style={styles.waitPill}>
            <Ionicons name="time-outline" size={13} color={colors.text.secondary} />
            <Text style={styles.waitText}>
              {appointment.estWaitMin > 0 ? `~${appointment.estWaitMin}m` : 'next'}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.clinic} numberOfLines={1}>
        {appointment.schedule.clinicName}
      </Text>
      <Text style={styles.meta}>
        {formatDateISO(appointment.date)} · {appointment.schedule.startTime} –{' '}
        {appointment.schedule.endTime}
      </Text>

      {range === 'upcoming' ? (
        <View style={styles.actions}>
          <GlassButton
            label="Live queue"
            icon="pulse-outline"
            onPress={onLiveQueue}
            disabled={resolvingQueue}
            style={styles.actionButton}
          />
          {isConfirmed ? (
            <GlassButton
              label={resolvingQueue ? 'Opening…' : 'Cancel'}
              icon="close-circle-outline"
              tone="destructive"
              onPress={onCancel}
              style={styles.actionButton}
            />
          ) : null}
        </View>
      ) : canRate ? (
        <View style={styles.actions}>
          <GlassButton
            label="Rate visit"
            icon="star-outline"
            tone="accent"
            onPress={onRate}
            style={styles.actionButton}
          />
        </View>
      ) : rated ? (
        <View style={styles.ratedRow}>
          <Ionicons name="star" size={14} color={colors.star} />
          <Text style={styles.ratedText}>Rated</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: spacing.base, gap: spacing.md, paddingBottom: spacing.sm },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentButton: { flex: 1 },
  segmentActive: {
    backgroundColor: 'rgba(77, 159, 222, 0.28)',
    borderColor: 'rgba(77, 159, 222, 0.55)',
  },
  retryRow: { alignSelf: 'flex-start' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { gap: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  token: { ...typography.h2, color: '#2D6FB4', fontWeight: '800' },
  cardMid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  doctorCol: { flex: 1, gap: 2 },
  doctor: { ...typography.h3, color: colors.text.primary },
  spec: { ...typography.caption, color: colors.text.secondary },
  waitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glass.nested,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  waitText: { ...typography.caption, color: colors.text.secondary },
  clinic: { ...typography.bodySemi, color: colors.text.primary },
  meta: { ...typography.caption, color: colors.text.secondary },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionButton: { flex: 1, minHeight: 42 },
  ratedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 166, 35, 0.14)',
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  ratedText: { ...typography.captionSemi, color: '#B27415' },
  cancelText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  feedbackIntro: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  commentWrap: { marginTop: spacing.sm },
  footerLoader: { paddingVertical: spacing.base },
  footerHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
