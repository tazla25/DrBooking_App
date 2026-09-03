import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
  StatusChip,
  useToast,
  type AppointmentStatus,
} from '@/components';
import { api } from '@/lib/api';
import { hapticSelection, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { ApiError, toFriendlyMessage } from '@/lib/errors';
import { formatDateISO, formatFee } from '@/lib/format';
import {
  callNextPatient,
  createWalkIn,
  fetchStaffSchedules,
  queueNextMessage,
  setAppointmentStatus,
  setAvailability,
  STATUS_TRANSITIONS,
  type SettableStatus,
  type StaffQueueAppointment,
  type StaffSchedule,
  type TodayQueueCounts,
} from '@/lib/staff';
import { addDaysISO, dayOfWeekISO, istTimeOfISO, istTodayISO } from '@/lib/time';
import type { MeResponse } from '@/lib/types';
import {
  normalizePhoneInput,
  validateWalkInForm,
  type WalkInFormErrors,
  type WalkInFormValues,
} from '@/lib/validation';
import { useTodayQueue } from '@/hooks/useTodayQueue';
import { useAuthStore } from '@/store/auth';
import { AnimatedChip, AnimatedEntrance, PulseView, useChangePulse } from '@/components/motion';
import { colors, radii, spacing, typography } from '@/theme';

/** Date strip window: 3 days back … 7 days forward, IST today centered. */
const DATE_STRIP_BACK = 3;
const DATE_STRIP_FORWARD = 7;

const COUNT_CARDS: { key: keyof TodayQueueCounts; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'called', label: 'Called' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'noShow', label: 'No-show' },
];

/**
 * Staff console — Today tab (DOCTOR + COMPOUNDER). The scoped doctor's queue
 * for a business date (default IST today; history browsing allowed — past
 * dates are read-only), 15s focus-polling, full patient names + phones BY
 * DESIGN (masking exists only on the public patient queue).
 *
 * Phase 11 B3: online bookings land PENDING awaiting manual confirmation.
 * Confirm = single tap (optimistic, rolls back on failure); Reject = glass
 * confirm modal with an optional note (persisted as a patient note) →
 * CANCELLED. The serial never changes on confirmation (it was allocated at
 * booking).
 *
 * mobilefix2 FIX-C: pending patients live IN the patient list (no floating
 * cards above it). The unified list renders section headers + pending rows
 * (selected date) + upcoming pending rows (future dates, each with its date)
 * + the confirmed queue. A pending row is COMPACT and expands in place on
 * tap to reveal its Confirm/Reject actions — one row expanded at a time.
 *
 * Queue actions follow the server's transition matrix exactly; "Call next"
 * and walk-ins are TODAY-gated per the server rules (queue/next always
 * operates on IST today; walk-in dates must be today-or-future).
 */

/** mobilefix2 FIX-C — the unified Today list item union: section headers,
 * pending patients (selected date), upcoming pending patients (future dates)
 * and confirmed queue rows — ONE list, composition order fixed. */
type TodayListItem =
  | { kind: 'header'; id: string; label: string; count?: number }
  | { kind: 'pending'; appointment: StaffQueueAppointment }
  | { kind: 'upcomingPending'; appointment: StaffQueueAppointment; date: string }
  | { kind: 'queue'; appointment: StaffQueueAppointment };

export default function StaffTodayScreen() {
  const user = useAuthStore((s) => s.user);
  const { toast, show } = useToast();

  // -- date selection (IST strings, passed through VERBATIM) -----------------
  const [selectedDate, setSelectedDate] = useState(() => istTodayISO());
  const istToday = istTodayISO(); // recomputed each render — display only
  const isToday = selectedDate === istToday;
  const isPast = selectedDate < istToday;

  // -- focus-driven 15s polling ----------------------------------------------
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const queue = useTodayQueue(selectedDate, focused);

  // -- identity + availability ------------------------------------------------
  const [me, setMe] = useState<MeResponse | null>(null);
  const [availability, setAvailabilityState] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<MeResponse>('/api/auth/me')
      .then(async (data) => {
        if (!alive) return;
        setMe(data);
        // Availability lives on the public doctor view (the staff endpoints
        // never expose it) — PENDING doctors 404 here, hiding the switch.
        if (data.doctorProfile) {
          try {
            const detail = await api.get<{ isAvailableNow: boolean }>(
              `/api/doctors/${data.doctorProfile.id}`,
            );
            if (alive) setAvailabilityState(detail.isAvailableNow);
          } catch {
            // Unverified doctor or transient failure — switch stays hidden.
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const onToggleAvailability = (value: boolean) => {
    if (toggling || availability === null) return;
    const previous = availability;
    setAvailabilityState(value); // optimistic
    setToggling(true);
    setAvailability(value)
      .then(() => {
        show(value ? 'Marked available for new patients' : 'Marked unavailable', 'success');
      })
      .catch((err) => {
        setAvailabilityState(previous); // rollback
        show(toFriendlyMessage(err), 'error');
      })
      .finally(() => setToggling(false));
  };

  // -- queue mutations ---------------------------------------------------------

  const [advancing, setAdvancing] = useState(false);
  const callNext = async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      const result = await callNextPatient();
      if (!result.queueEmpty) hapticSuccess(); // a patient was actually called
      show(queueNextMessage(result), result.queueEmpty ? 'info' : 'success');
      await queue.refresh();
    } catch (err) {
      show(toFriendlyMessage(err), 'error');
    } finally {
      setAdvancing(false);
    }
  };

  const [mutating, setMutating] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<StaffQueueAppointment | null>(null);
  const [confirmAction, setConfirmAction] = useState<SettableStatus>('CANCELLED');
  const [confirming, setConfirming] = useState(false);
  const applyStatus = async (
    appointment: StaffQueueAppointment,
    status: SettableStatus,
  ): Promise<boolean> => {
    setMutating(`${appointment.id}:${status}`);
    try {
      await setAppointmentStatus(appointment.id, status);
      // Call/Complete are positive confirmations; Cancel/No-show are warnings.
      if (status === 'CALLED' || status === 'COMPLETED') {
        hapticSuccess();
      } else {
        hapticWarning();
      }
      show(`#${appointment.queueNumber} marked ${labelForStatus(status)}`, 'success');
      await queue.refresh();
      return true;
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'INVALID_TRANSITION' || err.code === 'NOT_FOUND')
      ) {
        // The list is stale — refetch and surface the mapped message.
        show(toFriendlyMessage(err), 'error');
        await queue.refresh();
      } else {
        show(toFriendlyMessage(err), 'error');
      }
      return false;
    } finally {
      setMutating(null);
    }
  };

  const openConfirm = (appointment: StaffQueueAppointment, action: SettableStatus) => {
    setConfirmAction(action);
    setConfirmTarget(appointment);
  };

  const doConfirm = async () => {
    if (!confirmTarget) return;
    setConfirming(true);
    await applyStatus(confirmTarget, confirmAction);
    setConfirming(false);
    setConfirmTarget(null); // outcome surfaces via toast + refreshed list
  };

  const onRowAction = (appointment: StaffQueueAppointment, status: SettableStatus) => {
    if (status === 'CANCELLED' || status === 'NO_SHOW') {
      openConfirm(appointment, status); // destructive → glass confirm modal
    } else {
      void applyStatus(appointment, status);
    }
  };

  // -- PENDING section: manual confirm / reject (Phase 11 B3) ------------------

  // mobilefix2 FIX-C: tap-to-reveal state — the expanded pending row shows
  // its actions; ONE row expanded at a time (tapping another collapses the
  // previous, tapping the expanded row collapses it). Cleared on mutation
  // settle — the row then leaves the list via normal data re-derivation.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** mutatingId-style double-tap guard for the pending confirm (ref = the
   * synchronous half; the state half drives the button disabled visuals). */
  const [pendingMutatingId, setPendingMutatingId] = useState<string | null>(null);
  const pendingMutatingRef = useRef<string | null>(null);

  const onConfirmPending = async (appointment: StaffQueueAppointment) => {
    if (pendingMutatingRef.current !== null) return; // double-tap can't double-fire
    pendingMutatingRef.current = appointment.id;
    setPendingMutatingId(appointment.id);
    hapticSelection(); // instant tick — the optimistic flip is immediate
    const error = await queue.confirmPending(appointment.id);
    pendingMutatingRef.current = null;
    setPendingMutatingId(null);
    if (error === null) {
      setExpandedId(null); // collapse on settle — the row leaves via re-derivation
      hapticSuccess();
      show(`Serial #${appointment.queueNumber} confirmed — patient notified`, 'success');
    } else {
      // The hook already rolled the optimistic flip back.
      show(error, 'error');
    }
  };

  const [rejectTarget, setRejectTarget] = useState<StaffQueueAppointment | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const openReject = (appointment: StaffQueueAppointment) => {
    setRejectError(null);
    setRejectNote('');
    setRejectTarget(appointment);
  };

  const doReject = async () => {
    if (!rejectTarget || rejecting) return;
    setRejecting(true);
    setRejectError(null);
    const { error, noteWarning } = await queue.rejectPending(rejectTarget.id, rejectNote);
    setRejecting(false);
    if (error) {
      setRejectError(error); // keep the modal open — nothing changed server-side
      return;
    }
    hapticWarning(); // destructive confirmation
    const token = rejectTarget.queueNumber;
    setRejectTarget(null);
    setRejectNote('');
    setExpandedId(null); // collapse on settle — the row leaves via re-derivation
    show(
      noteWarning ?? `Serial #${token} rejected — the patient is notified of the cancellation`,
      noteWarning ? 'info' : 'success',
    );
  };

  // -- walk-in modal ------------------------------------------------------------

  const [walkInVisible, setWalkInVisible] = useState(false);
  const [walkInSchedules, setWalkInSchedules] = useState<StaffSchedule[]>([]);
  const [walkInSchedulesLoading, setWalkInSchedulesLoading] = useState(false);
  const [walkInScheduleId, setWalkInScheduleId] = useState<string | null>(null);
  const [walkInForm, setWalkInForm] = useState<WalkInFormValues>({
    patientName: '',
    patientPhone: '',
    fee: '',
    notes: '',
  });
  const [walkInErrors, setWalkInErrors] = useState<WalkInFormErrors>({});
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInSubmitting, setWalkInSubmitting] = useState(false);

  const openWalkIn = async () => {
    setWalkInErrors({});
    setWalkInError(null);
    setWalkInForm({ patientName: '', patientPhone: '', fee: '', notes: '' });
    setWalkInScheduleId(null);
    setWalkInVisible(true);
    setWalkInSchedulesLoading(true);
    try {
      const data = await fetchStaffSchedules();
      // Only ACTIVE schedules operating on the viewed date's weekday.
      const matching = data.schedules.filter(
        (s) => s.isActive && s.dayOfWeek === dayOfWeekISO(selectedDate),
      );
      setWalkInSchedules(matching);
      setWalkInScheduleId(matching[0]?.id ?? null);
    } catch (err) {
      setWalkInVisible(false);
      show(toFriendlyMessage(err), 'error');
    } finally {
      setWalkInSchedulesLoading(false);
    }
  };

  const submitWalkIn = async () => {
    if (!walkInScheduleId) {
      setWalkInError('No active schedule for this day — pick another date.');
      return;
    }
    const errors = validateWalkInForm(walkInForm);
    setWalkInErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setWalkInSubmitting(true);
    setWalkInError(null);
    try {
      const phone = normalizePhoneInput(walkInForm.patientPhone);
      if (!phone) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid phone number');
      const { appointment } = await createWalkIn({
        scheduleId: walkInScheduleId,
        date: selectedDate, // verbatim IST string — never converted
        patientName: walkInForm.patientName,
        patientPhone: phone,
        notes: walkInForm.notes || undefined,
        fee: walkInForm.fee.trim() === '' ? undefined : Number(walkInForm.fee.trim()),
      });
      setWalkInVisible(false);
      show(`Token #${appointment.queueNumber} added for ${appointment.patientName}`, 'success');
      await queue.refresh();
    } catch (err) {
      // 409s (ALREADY_IN_QUEUE / SCHEDULE_INACTIVE / CAPACITY_FULL) and 422s
      // stay INSIDE the modal as mapped friendly text.
      setWalkInError(toFriendlyMessage(err));
    } finally {
      setWalkInSubmitting(false);
    }
  };

  // -- render --------------------------------------------------------------------

  const data = queue.data;
  const doctorName = me?.doctorProfile?.fullName ?? user?.name ?? '';
  const isCompounder = user?.role === 'COMPOUNDER';

  const stripDates = Array.from({ length: DATE_STRIP_BACK + DATE_STRIP_FORWARD + 1 }, (_, i) =>
    addDaysISO(istToday, i - DATE_STRIP_BACK),
  );

  // The confirmed queue EXCLUDES the pending rows — they render in their own
  // section inside the unified list (the pending rows come from the hook,
  // same underlying data).
  const queueRows = (data?.appointments ?? []).filter((a) => a.status !== 'PENDING');

  // mobilefix2 FIX-C — ONE unified list. Composition order: selected-date
  // pending → upcoming (future-date) pending → the confirmed queue; only
  // non-empty sections render their header, and counts derive from the SAME
  // arrays the rows render (never hand-counted literals).
  const queueHeaderLabel = `Queue · ${isToday ? 'Today' : formatDateISO(selectedDate)}`;
  const items: TodayListItem[] = [];
  if (queue.pending.length > 0) {
    items.push({
      kind: 'header',
      id: 'pending',
      label: 'Awaiting confirmation',
      count: queue.pending.length,
    });
    for (const appointment of queue.pending) items.push({ kind: 'pending', appointment });
  }
  if (queue.upcomingPending.length > 0) {
    items.push({
      kind: 'header',
      id: 'upcoming',
      label: 'Upcoming — awaiting confirmation',
      count: queue.upcomingPending.length,
    });
    for (const row of queue.upcomingPending)
      items.push({ kind: 'upcomingPending', appointment: row.appointment, date: row.date });
  }
  if (queueRows.length > 0) {
    items.push({ kind: 'header', id: 'queue', label: queueHeaderLabel });
    for (const appointment of queueRows) items.push({ kind: 'queue', appointment });
  }

  const toggleExpanded = (id: string) => {
    hapticSelection();
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const renderItem = ({ item, index }: { item: TodayListItem; index: number }) => {
    switch (item.kind) {
      case 'header':
        return (
          <AnimatedEntrance index={index}>
            <SectionHeader label={item.label} count={item.count} pending={item.id !== 'queue'} />
          </AnimatedEntrance>
        );
      case 'pending':
      case 'upcomingPending':
        return (
          <AnimatedEntrance index={index}>
            <PendingRow
              appointment={item.appointment}
              forDate={item.kind === 'upcomingPending' ? item.date : undefined}
              expanded={expandedId === item.appointment.id}
              busy={pendingMutatingId === item.appointment.id}
              onToggle={() => toggleExpanded(item.appointment.id)}
              onConfirm={() => void onConfirmPending(item.appointment)}
              onReject={() => openReject(item.appointment)}
            />
          </AnimatedEntrance>
        );
      case 'queue':
        return (
          <AnimatedEntrance index={index}>
            <QueueRow appointment={item.appointment} mutatingId={mutating} onAction={onRowAction} />
          </AnimatedEntrance>
        );
    }
  };

  return (
    <GlassScreen>
      <GlassHeader title="Today" back={false} />
      <View style={styles.body}>
        {queue.loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : queue.error && !data ? (
          <GlassCard padded style={styles.card}>
            <ErrorBanner message={queue.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void queue.refresh()}
            />
          </GlassCard>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) =>
              item.kind === 'header' ? `header:${item.id}` : `${item.kind}:${item.appointment.id}`
            }
            renderItem={renderItem}
            testID="today-queue-list"
            refreshing={queue.refreshing}
            onRefresh={() => {
              void queue.refresh();
              void queue.rescan(); // FIX B: pull-to-refresh rescans the horizon
            }}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.headerStack}>
                {/* -- identity + availability ---------------------------------- */}
                {/* (mobilefix2 FIX-C: the pending/upcoming cards MOVED into the
                    unified list below — patients live with patients; this
                    header stack keeps only the CONTEXT cards: identity, date
                    strip, counts, actions.) */}
                <GlassCard padded style={styles.card}>
                  <View style={styles.identityRow}>
                    <View style={styles.identityText}>
                      <Text style={styles.doctorName} numberOfLines={1}>
                        Dr. {doctorName}
                      </Text>
                      <Text style={styles.identityCaption} numberOfLines={1}>
                        {isCompounder
                          ? `Compounder · assisting Dr. ${me?.doctorProfile?.fullName ?? '—'}`
                          : (me?.doctorProfile?.specialization ?? 'Doctor console')}
                      </Text>
                    </View>
                    {availability !== null ? (
                      <View style={styles.availabilityRow}>
                        <Text style={styles.availabilityLabel}>Available now</Text>
                        <Switch
                          accessibilityLabel="Available now"
                          value={availability}
                          disabled={toggling}
                          onValueChange={onToggleAvailability}
                          trackColor={{
                            true: colors.ctaGradient.end,
                            false: colors.unavailable,
                          }}
                          thumbColor={colors.white}
                        />
                      </View>
                    ) : null}
                  </View>
                </GlassCard>

                {/* -- date strip -------------------------------------------------- */}
                <GlassCard padded style={styles.card}>
                  <Text style={styles.sectionTitle}>
                    {isToday ? 'Today' : formatDateISO(selectedDate)}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.dateStripScroll}
                    contentContainerStyle={styles.dateStrip}
                  >
                    {stripDates.map((date) => {
                      const selected = date === selectedDate;
                      return (
                        <AnimatedChip
                          key={date}
                          active={selected}
                          bg={[colors.glass.chip, colors.ctaGradient.end]}
                          border={[colors.glass.border, colors.ctaGradient.end]}
                          onPress={() => {
                            if (date !== selectedDate) hapticSelection();
                            setSelectedDate(date);
                          }}
                          accessibilityLabel={`View ${formatDateISO(date)}`}
                          accessibilityState={{ selected }}
                          style={styles.dateChip}
                        >
                          <Text
                            style={[styles.dateChipDay, selected && styles.dateChipTextSelected]}
                          >
                            {date === istToday ? 'Today' : formatDateISO(date).slice(0, 6)}
                          </Text>
                          <Text
                            style={[styles.dateChipNum, selected && styles.dateChipTextSelected]}
                          >
                            {date.slice(8, 10)}
                          </Text>
                        </AnimatedChip>
                      );
                    })}
                    {/* B1 trailing runway — width = the parent card padding,
                          so the last chip scrolls fully clear of the fold. */}
                    <View style={styles.dateStripTrailing} />
                  </ScrollView>
                  {!isToday ? (
                    <Text style={styles.todayHint}>
                      Viewing a different day · queue actions work on today&apos;s queue only
                    </Text>
                  ) : null}
                </GlassCard>

                {/* -- counts ------------------------------------------------------ */}
                {data ? (
                  <View style={styles.countsRow}>
                    {COUNT_CARDS.map(({ key, label }) => (
                      <GlassCard key={key} nested style={styles.countCard}>
                        <Text style={styles.countNum}>{data.counts[key]}</Text>
                        <Text style={styles.countLabel}>{label}</Text>
                      </GlassCard>
                    ))}
                  </View>
                ) : null}

                {/* -- primary actions --------------------------------------------- */}
                <View style={styles.actionsRow}>
                  <PrimaryButton
                    label="Call next"
                    icon="play-forward-outline"
                    loading={advancing}
                    disabled={!isToday}
                    onPress={() => void callNext()}
                    style={styles.callNextBtn}
                  />
                  <GlassButton
                    label="Add walk-in"
                    icon="person-add-outline"
                    disabled={isPast}
                    onPress={() => void openWalkIn()}
                  />
                </View>

                {queue.error && data ? (
                  <View style={styles.pollErrorWrap}>
                    <ErrorBanner message={queue.error} />
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                icon="calendar-clear-outline"
                title={isToday ? 'No appointments today' : 'No appointments on this date'}
                caption={
                  isPast
                    ? 'This date has passed. Browse the date strip to review past queues.'
                    : 'Patients will appear here as they book. Add a walk-in to start the queue.'
                }
                ctaLabel={isPast || !data ? undefined : 'Add walk-in'}
                onCta={isPast || !data ? undefined : () => void openWalkIn()}
              />
            }
          />
        )}
      </View>

      {/* -- cancel / no-show confirm --------------------------------------------- */}
      <GlassModal
        visible={confirmTarget !== null}
        title={confirmAction === 'CANCELLED' ? 'Cancel this token?' : 'Mark as no-show?'}
        dismissable={!confirming}
        onClose={() => setConfirmTarget(null)}
      >
        {confirmTarget ? (
          <>
            <Text style={styles.confirmText}>
              Token #{confirmTarget.queueNumber} · {confirmTarget.patientName} will be marked{' '}
              {labelForStatus(confirmAction).toLowerCase()}.{' '}
              {confirmAction === 'CANCELLED'
                ? 'The slot is freed and the patient is notified.'
                : 'This records a missed visit for the patient.'}
            </Text>
            <View style={styles.confirmButtons}>
              <PrimaryButton
                label={confirmAction === 'CANCELLED' ? 'Yes, cancel' : 'Yes, no-show'}
                tone="destructive"
                loading={confirming}
                onPress={() => void doConfirm()}
              />
              <GlassButton
                label="Keep it"
                disabled={confirming}
                onPress={() => setConfirmTarget(null)}
              />
            </View>
          </>
        ) : null}
      </GlassModal>

      {/* -- walk-in sheet ---------------------------------------------------------- */}
      <GlassModal
        visible={walkInVisible}
        title="Add walk-in patient"
        dismissable={!walkInSubmitting}
        onClose={() => setWalkInVisible(false)}
      >
        <Text style={styles.walkInDate}>
          {formatDateISO(selectedDate)} · token issued on arrival
        </Text>
        {walkInSchedulesLoading ? (
          <ActivityIndicator color={colors.ctaGradient.end} />
        ) : walkInSchedules.length === 0 ? (
          <Text style={styles.walkInNone}>
            No active schedule operates on this weekday — pick another date or add a schedule first.
          </Text>
        ) : (
          <>
            <View style={styles.scheduleChips}>
              {walkInSchedules.map((s) => {
                const selected = s.id === walkInScheduleId;
                return (
                  <AnimatedChip
                    key={s.id}
                    active={selected}
                    bg={[colors.glass.chip, colors.ctaGradient.end]}
                    border={[colors.glass.border, colors.ctaGradient.end]}
                    onPress={() => {
                      if (s.id !== walkInScheduleId) hapticSelection();
                      setWalkInScheduleId(s.id);
                    }}
                    style={styles.scheduleChip}
                  >
                    <Text
                      style={[styles.scheduleChipText, selected && styles.scheduleChipTextSelected]}
                      numberOfLines={1}
                    >
                      {s.startTime}–{s.endTime} · {s.clinicName}
                    </Text>
                  </AnimatedChip>
                );
              })}
            </View>
            <GlassTextField
              label="Patient name"
              icon="person-outline"
              value={walkInForm.patientName}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, patientName: v }))}
              error={walkInErrors.patientName}
              placeholder="Full name"
            />
            <GlassTextField
              label="Phone"
              icon="call-outline"
              value={walkInForm.patientPhone}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, patientPhone: v }))}
              error={walkInErrors.patientPhone}
              placeholder="98765 43210"
              keyboardType="phone-pad"
            />
            <GlassTextField
              label={`Fee (optional · doctor's fee applies)`}
              icon="cash-outline"
              value={walkInForm.fee}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, fee: v }))}
              error={walkInErrors.fee}
              placeholder="e.g. 300"
              keyboardType="number-pad"
            />
            <GlassTextField
              label="Notes (optional)"
              icon="document-text-outline"
              value={walkInForm.notes}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, notes: v }))}
              error={walkInErrors.notes}
              placeholder="Anything the doctor should know"
              multiline
            />
            {walkInError ? <ErrorBanner message={walkInError} /> : null}
            <View style={styles.confirmButtons}>
              <PrimaryButton
                label="Add to queue"
                icon="add-outline"
                loading={walkInSubmitting}
                onPress={() => void submitWalkIn()}
              />
              <GlassButton
                label="Close"
                disabled={walkInSubmitting}
                onPress={() => setWalkInVisible(false)}
              />
            </View>
          </>
        )}
      </GlassModal>

      {/* -- reject pending booking (Phase 11 B3) -------------------------------- */}
      <GlassModal
        visible={rejectTarget !== null}
        title="Reject this booking?"
        dismissable={!rejecting}
        onClose={() => setRejectTarget(null)}
      >
        {rejectTarget ? (
          <>
            <Text style={styles.confirmText}>
              Serial #{rejectTarget.queueNumber} · {rejectTarget.patientName} will be cancelled and
              the patient notified. The serial stays consumed (never reused).
            </Text>
            <GlassTextField
              label="Note (optional)"
              icon="document-text-outline"
              value={rejectNote}
              onChangeText={setRejectNote}
              error={rejectNote.trim().length > 2000 ? 'Note is too long (max 2000)' : null}
              placeholder="Why is this booking rejected? Saved to the patient record."
              multiline
            />
            {rejectError ? <ErrorBanner message={rejectError} /> : null}
            <View style={styles.confirmButtons}>
              <PrimaryButton
                label="Yes, reject"
                icon="close-circle-outline"
                tone="destructive"
                loading={rejecting}
                disabled={rejectNote.trim().length > 2000}
                onPress={() => void doReject()}
              />
              <GlassButton
                label="Keep it pending"
                disabled={rejecting}
                onPress={() => setRejectTarget(null)}
              />
            </View>
          </>
        ) : null}
      </GlassModal>

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

// ---------------------------------------------------------------------------
// Section header (mobilefix2 FIX-C) — the unified list's section dividers
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  count,
  pending,
}: {
  label: string;
  count?: number;
  /** Pending sections use the pending tint; the queue header uses the
   * primary text color (mirrors the old card titles' two styles). */
  pending: boolean;
}) {
  return (
    <Text
      style={pending ? styles.pendingSectionTitle : styles.queueSectionTitle}
      accessibilityLabel={count !== undefined ? `${label}: ${count}` : label}
    >
      {count !== undefined ? `${label} (${count})` : label}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Pending row (Phase 11 B3; mobilefix2 FIX-C tap-to-reveal) — the
// manual-confirmation inbox, IN the patient list
// ---------------------------------------------------------------------------

function PendingRow({
  appointment,
  forDate,
  expanded,
  busy,
  onToggle,
  onConfirm,
  onReject,
}: {
  appointment: StaffQueueAppointment;
  /** mobilefix1 FIX B: the booking's IST date ('YYYY-MM-DD') — present ONLY on
   * upcoming (future-date) rows; the selected-date section omits it. */
  forDate?: string;
  /** mobilefix2 FIX-C: tap-to-reveal — the actions render only when the row
   * is expanded (compact otherwise; the whole row is the toggle). */
  expanded: boolean;
  /** mutatingId-style busy: disables the revealed actions while a confirm
   * mutation for THIS row is in flight (double-tap guard). */
  busy: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const bookedAt = istTimeOfISO(appointment.createdAt);
  const forDateLabel = forDate ? formatDateISO(forDate) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${appointment.patientName}, token ${appointment.queueNumber}, awaiting confirmation`}
      onPress={onToggle}
      style={({ pressed }) => [pressed && styles.pendingRowPressed]}
    >
      <GlassCard nested style={styles.pendingRow}>
        <View style={styles.rowTop}>
          <View style={styles.tokenCircle}>
            <Text style={styles.tokenNum}>#{appointment.queueNumber}</Text>
          </View>
          <View style={styles.rowIdentity}>
            <View style={styles.nameRow}>
              <Text style={styles.patientName} numberOfLines={1}>
                {appointment.patientName}
              </Text>
            </View>
            <Text style={styles.patientPhone}>{appointment.patientPhone}</Text>
          </View>
          <StatusChip status="PENDING" />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            Booked {bookedAt ? `${bookedAt} IST` : 'earlier'} · awaiting confirmation
          </Text>
          <View style={styles.tapHint}>
            <Ionicons
              name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
              size={14}
              color={colors.text.secondary}
            />
            <Text style={styles.tapHintText}>Tap to confirm</Text>
          </View>
        </View>
        {forDateLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.text.secondary} />
            <Text style={styles.metaText} accessibilityLabel={`Appointment date ${forDateLabel}`}>
              For {forDateLabel}
            </Text>
          </View>
        ) : null}
        {expanded ? (
          <View style={styles.rowActions}>
            <PrimaryButton
              label="Confirm"
              icon="checkmark-circle-outline"
              disabled={busy}
              onPress={onConfirm}
              style={styles.pendingConfirmBtn}
            />
            <GlassButton
              label="Reject"
              icon="close-circle-outline"
              tone="destructive"
              disabled={busy}
              onPress={onReject}
              style={styles.rowBtn}
            />
          </View>
        ) : null}
      </GlassCard>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Queue row
// ---------------------------------------------------------------------------

function QueueRow({
  appointment,
  mutatingId,
  onAction,
}: {
  appointment: StaffQueueAppointment;
  mutatingId: string | null;
  onAction: (appointment: StaffQueueAppointment, status: SettableStatus) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const busy = mutatingId !== null && mutatingId.startsWith(appointment.id);
  const nowServing = appointment.status === 'CALLED';
  const actions = STATUS_TRANSITIONS[appointment.status] ?? [];

  // Live-change highlight: pulse exactly when this row TRANSITIONS to CALLED
  // (the "Now serving" moment on the staff console).
  const calledPulse = useChangePulse(appointment.status, nowServing);

  return (
    <GlassCard padded style={[styles.card, nowServing && styles.nowServingCard]}>
      <PulseView pulse={calledPulse} />
      <View style={styles.rowTop}>
        <View style={styles.tokenCircle}>
          <Text style={styles.tokenNum}>#{appointment.queueNumber}</Text>
        </View>
        <View style={styles.rowIdentity}>
          <View style={styles.nameRow}>
            <Text style={styles.patientName} numberOfLines={1}>
              {appointment.patientName}
            </Text>
            {appointment.source === 'WALK_IN' ? <SourceChip /> : null}
          </View>
          <Text style={styles.patientPhone}>{appointment.patientPhone}</Text>
        </View>
        <StatusChip status={appointment.status as AppointmentStatus} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{formatFee(appointment.fee)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>~{appointment.estWaitMin}m wait</Text>
        {appointment.notes ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle note"
            onPress={() => setNotesOpen((v) => !v)}
            style={({ pressed }) => [styles.notesButton, pressed && styles.notesButtonPressed]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={notesOpen ? 'document-text' : 'document-text-outline'}
              size={16}
              color={colors.accent}
            />
          </Pressable>
        ) : null}
      </View>

      {notesOpen && appointment.notes ? (
        <GlassCard nested style={styles.notesCard}>
          <Text style={styles.notesText}>{appointment.notes}</Text>
        </GlassCard>
      ) : null}

      {nowServing ? <Text style={styles.nowServingLabel}>Now serving</Text> : null}

      {actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actions.map((status) => (
            <RowActionButton
              key={status}
              status={status}
              busy={busy}
              onPress={() => onAction(appointment, status)}
            />
          ))}
        </View>
      ) : appointment.status === 'COMPLETED' ? (
        /* Terminal state — no actions to offer; a quiet caption closes the row
           (the API has no completedAt, so no time is ever shown). */
        <Text style={styles.completedCaption}>Visit completed</Text>
      ) : null}
    </GlassCard>
  );
}

function RowActionButton({
  status,
  busy,
  onPress,
}: {
  status: SettableStatus;
  busy: boolean;
  onPress: () => void;
}) {
  if (status === 'CANCELLED' || status === 'NO_SHOW') {
    return (
      <GlassButton
        label={status === 'CANCELLED' ? 'Cancel' : 'No-show'}
        tone="destructive"
        disabled={busy}
        onPress={onPress}
        style={styles.rowBtn}
      />
    );
  }
  return (
    <GlassButton
      label={status === 'CALLED' ? 'Call' : 'Complete'}
      tone={status === 'CALLED' ? 'accent' : 'default'}
      disabled={busy}
      onPress={onPress}
      style={styles.rowBtn}
    />
  );
}

function SourceChip() {
  return (
    <View style={styles.sourceChip}>
      <Text style={styles.sourceChipText}>WALK-IN</Text>
    </View>
  );
}

function labelForStatus(status: SettableStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmed';
    case 'CALLED':
      return 'Called';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'NO_SHOW':
      return 'No-show';
  }
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: {
    padding: spacing.base,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: spacing.base,
  },
  headerStack: { gap: spacing.base },
  card: { gap: spacing.md },

  // identity
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: spacing.xs },
  doctorName: { ...typography.h2, color: colors.text.primary },
  identityCaption: { ...typography.caption, color: colors.text.secondary },
  availabilityRow: { alignItems: 'flex-end', gap: spacing.sm },
  availabilityLabel: { ...typography.micro, color: colors.text.secondary },

  // date strip
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  dateStrip: { gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  // B1 full-bleed: negative margin = GlassCard padded (spacing.lg) — the strip
  // scrolls to the CARD edges; the content padding restores at-rest alignment.
  dateStripScroll: { marginHorizontal: -spacing.lg },
  dateStripTrailing: { width: spacing.lg },
  dateChip: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 58,
  },
  dateChipDay: { ...typography.micro, color: colors.text.secondary },
  dateChipNum: { ...typography.bodySemi, color: colors.text.primary },
  dateChipTextSelected: { color: colors.white },
  todayHint: { ...typography.caption, color: colors.accent },

  // counts
  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  countCard: { flexBasis: '31%', flexGrow: 1, alignItems: 'center', paddingVertical: spacing.md },
  countNum: { ...typography.h2, color: colors.text.primary },
  countLabel: { ...typography.micro, color: colors.text.secondary },

  // actions
  actionsRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  callNextBtn: { flex: 1 },
  pollErrorWrap: { marginBottom: spacing.sm },

  // queue row
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tokenCircle: {
    width: 46,
    height: 46,
    borderRadius: radii.round, // true circle — token, not literal
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.nested,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  tokenNum: { ...typography.captionSemi, color: colors.text.primary },
  rowIdentity: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  patientName: { ...typography.bodySemi, color: colors.text.primary, flexShrink: 1 },
  patientPhone: { ...typography.caption, color: colors.text.secondary },
  nowServingCard: { borderColor: 'rgba(77, 159, 222, 0.65)', borderWidth: 1.5 },
  nowServingLabel: {
    ...typography.micro,
    color: colors.ctaGradient.end,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.text.secondary },
  metaDot: { ...typography.caption, color: colors.text.secondary },
  notesButton: { marginLeft: 'auto', padding: spacing.xs },
  notesButtonPressed: { opacity: 0.6 },
  notesCard: { padding: spacing.md },
  notesText: { ...typography.caption, color: colors.text.primary },
  rowActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  completedCaption: { ...typography.micro, color: colors.text.secondary },
  rowBtn: { minHeight: 44, paddingHorizontal: spacing.lg },

  sourceChip: {
    backgroundColor: 'rgba(245, 166, 35, 0.18)',
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  sourceChipText: {
    ...typography.micro,
    color: colors.status.PENDING.fg,
    letterSpacing: 0.4,
  },

  // confirm modal
  confirmText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  confirmButtons: { gap: spacing.sm },

  // pending section (Phase 11 B3; mobilefix2 FIX-C: in-list sections)
  pendingSectionTitle: {
    ...typography.h3,
    color: colors.status.PENDING.fg,
  },
  queueSectionTitle: { ...typography.h3, color: colors.text.primary },
  pendingRow: { gap: spacing.sm },
  pendingConfirmBtn: { flex: 1 },
  // tap-to-reveal affordance + press feedback (0.6 = the file's established
  // pressed-opacity literal, same value as notesButtonPressed)
  tapHint: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tapHintText: { ...typography.micro, color: colors.text.secondary },
  pendingRowPressed: { opacity: 0.6 },

  // walk-in modal
  walkInDate: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  walkInNone: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  scheduleChips: { gap: spacing.sm },
  scheduleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  scheduleChipText: { ...typography.captionSemi, color: colors.text.primary },
  scheduleChipTextSelected: { color: colors.white },
});
