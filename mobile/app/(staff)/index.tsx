import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
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
  useWindowDimensions,
} from 'react-native';
import {
  AuroraButton,
  AuroraChip,
  AuroraEmptyState,
  AuroraErrorBanner,
  AuroraHeader,
  AuroraLivePill,
  AuroraModal,
  AuroraScreen,
  AuroraStatusChip,
  AuroraTextField,
  GlassCardV2,
  MaterialIcon,
  MetricTile,
} from '@/components/aurora';
import { GlassToast, useToast } from '@/components';
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
import { AnimatedEntrance, PulseView, useChangePulse } from '@/components/motion';
import {
  auroraColors,
  auroraGlass,
  auroraGradients,
  auroraRadii,
  auroraSpacing,
  auroraTints,
  auroraTypography,
  type AuroraStatus,
} from '@/theme';

/** Date strip window: 3 days back … 7 days forward, IST today centered. */
const DATE_STRIP_BACK = 3;
const DATE_STRIP_FORWARD = 7;

const COUNT_CARDS: {
  key: keyof TodayQueueCounts;
  label: string;
  caption: string;
  tone: 'primary' | 'secondary' | 'tertiary' | 'tertiaryDim' | 'error' | 'muted';
}[] = [
  { key: 'pending', label: 'Pending', caption: 'Booked', tone: 'primary' },
  { key: 'confirmed', label: 'Confirmed', caption: 'Waiting', tone: 'secondary' },
  { key: 'called', label: 'Called', caption: 'Serving', tone: 'tertiary' },
  { key: 'completed', label: 'Completed', caption: 'Done', tone: 'tertiaryDim' },
  { key: 'cancelled', label: 'Cancelled', caption: 'Cancelled', tone: 'error' },
  { key: 'noShow', label: 'No-show', caption: 'Absent', tone: 'muted' },
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
 * cards above it) — no floating cards, no separate sections per date.
 *
 * mobilefix3 FIX-C (supersedes the mobilefix2 tap-to-reveal UX — owner's
 * design decision after device use): the pending surface is ONE horizontal
 * snap carousel (selected-date cards first, then upcoming by date
 * ascending) under a single "Awaiting confirmation (N)" header whose count
 * comes from the SAME combined array the cards render. Each card carries
 * its Confirm/Reject actions ALWAYS VISIBLE (side-by-side at the card
 * bottom) — no tap-to-expand, no chevron, no hint. The queue (confirmed
 * rows) stays vertical below it.
 *
 * Phase 12 "Aurora Glass v2" (Stage A): this screen is the design-adoption
 * pilot — ported 1:1 from the Stitch staff-console reference (spec §8).
 * VISUAL-ONLY diff (L5 functional freeze): every text, a11y label, testID,
 * handler, hook call and modal flow from mobilefix1/2 is preserved verbatim.
 * The CALLED (now-serving) patient renders as the design's "Currently in
 * chamber" hero card above the list; the next CONFIRMED patient headlines
 * the gradient call-next banner; the availability switch lives in the
 * admission-control card at the bottom (same handler + a11y label).
 * Documented design deviations (no API behind them): the chamber hero's
 * "No-Show" button, the header location chip, the "queue pause" quick action
 * and the sms/print row buttons are NOT ported.
 *
 * Queue actions follow the server's transition matrix exactly; "Call next"
 * and walk-ins are TODAY-gated per the server rules (queue/next always
 * operates on IST today; walk-in dates must be today-or-future).
 */

/** mobilefix2 FIX-C → mobilefix3 FIX-C — the unified Today list item union:
 * the pending CAROUSEL (one horizontal item carrying every pending card),
 * section headers and confirmed queue rows — ONE list, composition order
 * fixed (carousel first, then the vertical queue). */
type TodayListItem =
  | { kind: 'header'; id: string; label: string; count?: number }
  | { kind: 'pendingCarousel' }
  | { kind: 'queue'; appointment: StaffQueueAppointment };

/** One pending carousel card's data: the appointment + its IST date when the
 * booking is on a FUTURE date (selected-date cards omit `date`). */
interface PendingCardData {
  appointment: StaffQueueAppointment;
  /** 'YYYY-MM-DD' IST — present ONLY on upcoming (future-date) cards. */
  date?: string;
}

/**
 * mobilefix3 FIX-C — the pending card width, ~78% of the window width (the
 * owner's carousel spec: the next card always peeks). A documented screen
 * constant in the B4-96 family: a RATIO is not a spacing/radius token, and
 * the design's intent (peek fraction) lives with the carousel, not the
 * theme. The snap interval derives from it + the track gap (spacing.sm).
 */
const PENDING_CARD_WIDTH_RATIO = 0.78;

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
      // Aurora canvas is LIGHT — dark status-bar glyphs while this screen is
      // front-most; blur restores the app-wide light style (imperative set +
      // restore, so the legacy screens keep their correct tint).
      StatusBar.setStyle('dark');
      return () => {
        setFocused(false);
        StatusBar.setStyle('light');
      };
    }, []),
  );
  const queue = useTodayQueue(selectedDate, focused);

  // -- identity + availability ------------------------------------------------
  const [me, setMe] = useState<MeResponse | null>(null);
  const [availability, setAvailabilityState] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  /** mobilefix3 FIX-B2 loading-guard ref — set SYNCHRONOUSLY by the mount
   * fetch below, so the mount-time run of the focus-refetch effect (declared
   * after it — effect order guarantees the sequencing) is absorbed: the
   * mount fetch stays ONCE and only a REGAINED focus refetches. */
  const meLoadingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    meLoadingRef.current = true; // FIX-B2: absorb the mount-time focus run
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
      .catch(() => undefined)
      .finally(() => {
        meLoadingRef.current = false; // FIX-B2: a regained focus may refetch
      });
    return () => {
      alive = false;
    };
  }, []);

  // mobilefix3 FIX-B2 — silent /api/auth/me refetch on REGAINED focus (the
  // P3 pattern: useFocusEffect + ref snapshot + loading-guard; no big
  // spinner). An avatar edited in Profile (PATCH /api/doctors/me) surfaces in
  // the header on return WITHOUT relaunching; failures keep the last-good
  // identity (silent — the header never blanks mid-use). Mount stays ONCE.
  useFocusEffect(
    useCallback(() => {
      if (meLoadingRef.current) return; // loading-guard — never stacks fetches
      meLoadingRef.current = true;
      void api
        .get<MeResponse>('/api/auth/me')
        .then((data) => setMe(data))
        .catch(() => undefined)
        .finally(() => {
          meLoadingRef.current = false;
        });
    }, []),
  );

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

  /** mutatingId-style double-tap guard for the pending confirm (ref = the
   * synchronous half; the state half drives the per-card busy visuals —
   * mobilefix3: BOTH buttons on the MUTATING card only disable; every other
   * card stays enabled). */
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
      // mobilefix3: no reveal state to collapse — the card leaves the
      // carousel via normal data re-derivation (the optimistic flip).
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
    // mobilefix3: no reveal state to collapse — the card leaves the carousel
    // via normal data re-derivation (refresh + rescan already ran).
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
  // carousel above it (the pending rows come from the hook, same underlying
  // data). Phase 12: the CALLED (now-serving) patient renders as the
  // "Currently in chamber" hero card ABOVE the list — the queue rows below
  // are everyone else (same data, the design's presentation).
  const nowServing = (data?.appointments ?? []).find((a) => a.status === 'CALLED') ?? null;
  const queueRows = (data?.appointments ?? []).filter(
    (a) => a.status !== 'PENDING' && a.id !== nowServing?.id,
  );
  const nextUp = queueRows.find((a) => a.status === 'CONFIRMED') ?? null;

  // mobilefix3 FIX-C — the ONE combined pending surface: selected-date cards
  // first, then upcoming (future-date) cards by date ascending. This array
  // feeds the carousel AND its section count (never hand-counted).
  const pendingCards: PendingCardData[] = [
    ...queue.pending.map((appointment) => ({ appointment })),
    ...queue.upcomingPending.map((row) => ({
      appointment: row.appointment,
      date: row.date,
    })),
  ];

  // ONE unified list: the pending carousel (when any card exists) → the
  // confirmed queue; only non-empty sections render, and the carousel count
  // derives from the SAME array the cards render.
  const queueHeaderLabel = `Queue · ${isToday ? 'Today' : formatDateISO(selectedDate)}`;
  const items: TodayListItem[] = [];
  if (pendingCards.length > 0) {
    items.push({ kind: 'pendingCarousel' });
  }
  if (queueRows.length > 0) {
    items.push({ kind: 'header', id: 'queue', label: queueHeaderLabel });
    for (const appointment of queueRows) items.push({ kind: 'queue', appointment });
  }

  const renderItem = ({ item, index }: { item: TodayListItem; index: number }) => {
    switch (item.kind) {
      case 'header':
        return (
          <AnimatedEntrance index={index}>
            <SectionHeader label={item.label} count={item.count} pending={item.id !== 'queue'} />
          </AnimatedEntrance>
        );
      case 'pendingCarousel':
        return (
          <AnimatedEntrance index={index}>
            <PendingCarousel
              cards={pendingCards}
              busyId={pendingMutatingId}
              onConfirm={(appointment) => void onConfirmPending(appointment)}
              onReject={openReject}
            />
          </AnimatedEntrance>
        );
      case 'queue':
        return (
          <AnimatedEntrance index={index}>
            <QueueRow
              appointment={item.appointment}
              emphasized={nextUp?.id === item.appointment.id}
              mutatingId={mutating}
              onAction={onRowAction}
            />
          </AnimatedEntrance>
        );
    }
  };

  return (
    <AuroraScreen noTopInset>
      <AuroraHeader
        context="Staff Console"
        userName={user?.name ?? undefined}
        avatarUrl={me?.doctorProfile?.avatarUrl ?? null}
      />
      <View style={styles.body}>
        {queue.loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={auroraColors.primary} />
          </View>
        ) : queue.error && !data ? (
          <GlassCardV2 padded style={styles.card}>
            <AuroraErrorBanner message={queue.error} />
            <AuroraButton label="Try again" icon="refresh" onPress={() => void queue.refresh()} />
          </GlassCardV2>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) =>
              item.kind === 'header'
                ? `header:${item.id}`
                : item.kind === 'pendingCarousel'
                  ? 'pending-carousel'
                  : `queue:${item.appointment.id}`
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
                {/* -- identity header card (design: gradient icon tile +
                    LIVE pill + compounder/date row) ----------------------- */}
                <GlassCardV2 padded style={styles.card}>
                  <View style={styles.identityTop}>
                    <View style={styles.identityLeft}>
                      <LinearGradient
                        colors={auroraGradients.iconTile}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.iconTile}
                      >
                        <MaterialIcon name="domain" size={22} color={auroraColors.onPrimary} />
                      </LinearGradient>
                      <View style={styles.identityText}>
                        <Text style={styles.identityLabel}>Staff Console</Text>
                        <Text style={styles.doctorName} numberOfLines={1}>
                          Dr. {doctorName}
                        </Text>
                      </View>
                    </View>
                    {focused ? <AuroraLivePill /> : null}
                  </View>
                  <View style={styles.identityMeta}>
                    <View style={styles.identityMetaItem}>
                      <MaterialIcon name="badge" size={16} color={auroraColors.primary} />
                      <Text style={styles.identityCaption} numberOfLines={1}>
                        {isCompounder
                          ? `Compounder · assisting Dr. ${me?.doctorProfile?.fullName ?? '—'}`
                          : (me?.doctorProfile?.specialization ?? 'Doctor console')}
                      </Text>
                    </View>
                    <View style={styles.identityMetaItem}>
                      <MaterialIcon name="calendar_today" size={15} color={auroraColors.outline} />
                      <Text style={styles.identityDate}>{formatDateISO(selectedDate)} · IST</Text>
                    </View>
                  </View>
                </GlassCardV2>

                {/* -- metric bento (the design's glass stat grid) ------------- */}
                {data ? (
                  <View style={styles.countsRow}>
                    {COUNT_CARDS.map(({ key, label, caption, tone }) => (
                      <MetricTile
                        key={key}
                        label={label}
                        value={data.counts[key]}
                        caption={caption}
                        tone={tone}
                      />
                    ))}
                  </View>
                ) : null}

                {/* -- date strip -------------------------------------------------- */}
                <GlassCardV2 padded style={styles.card}>
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
                        <AuroraChip
                          key={date}
                          active={selected}
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
                        </AuroraChip>
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
                </GlassCardV2>

                {/* -- "Currently in chamber" hero (the CALLED patient) ---------- */}
                {nowServing ? (
                  <ChamberHero
                    appointment={nowServing}
                    busy={mutating !== null && mutating.startsWith(nowServing.id)}
                    onComplete={() => onRowAction(nowServing, 'COMPLETED')}
                  />
                ) : null}

                {/* -- call-next banner (gradient, the design's CTA hero) -------- */}
                <LinearGradient
                  colors={auroraGradients.banner}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.banner}
                >
                  <View style={styles.bannerTop}>
                    <View style={styles.bannerLabel}>
                      <MaterialIcon
                        name="forward_to_inbox"
                        size={18}
                        color={auroraColors.onPrimaryContainer}
                      />
                      <Text style={styles.bannerLabelText}>Ready for chamber</Text>
                    </View>
                    {nextUp ? (
                      <View style={styles.bannerChip}>
                        <Text style={styles.bannerChipText}>Waiting in lobby</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.bannerBody}>
                    <View style={styles.bannerInfo}>
                      <Text style={styles.bannerKicker}>Next in queue</Text>
                      <Text style={styles.bannerName} numberOfLines={1}>
                        {nextUp
                          ? `Token #${nextUp.queueNumber} — ${nextUp.patientName}`
                          : 'No one is waiting'}
                      </Text>
                      <Text style={styles.bannerMeta} numberOfLines={1}>
                        {nextUp
                          ? `${nextUp.patientPhone} · ~${nextUp.estWaitMin}m wait`
                          : 'Bookings and walk-ins appear here as they arrive'}
                      </Text>
                    </View>
                    <View style={styles.bannerIcon}>
                      <MaterialIcon
                        name="notifications_active"
                        size={24}
                        color={auroraColors.onPrimary}
                      />
                    </View>
                  </View>
                  <AuroraButton
                    label="Call next"
                    icon="campaign"
                    variant="white"
                    loading={advancing}
                    disabled={!isToday}
                    onPress={() => void callNext()}
                  />
                </LinearGradient>

                {/* -- quick actions ------------------------------------------------ */}
                <View style={styles.actionsRow}>
                  <AuroraButton
                    label="Add walk-in"
                    icon="person_add"
                    variant="glass"
                    disabled={isPast}
                    onPress={() => void openWalkIn()}
                  />
                </View>

                {queue.error && data ? (
                  <View style={styles.pollErrorWrap}>
                    <AuroraErrorBanner message={queue.error} />
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <AuroraEmptyState
                icon="calendar_month"
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
            ListFooterComponent={
              availability !== null ? (
                <GlassCardV2 padded style={styles.card}>
                  <View style={styles.availabilityRow}>
                    <View style={styles.availabilityLeft}>
                      <View style={styles.sensorTile}>
                        <MaterialIcon
                          name="sensor_door"
                          size={22}
                          color={auroraColors.onSecondaryContainer}
                        />
                      </View>
                      <View style={styles.identityText}>
                        <Text style={styles.availabilityLabel}>Available now</Text>
                        <Text style={availability ? styles.availabilityOn : styles.availabilityOff}>
                          {availability ? 'Accepting new patients' : 'Not accepting new patients'}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      accessibilityLabel="Available now"
                      value={availability}
                      disabled={toggling}
                      onValueChange={onToggleAvailability}
                      trackColor={{
                        true: auroraColors.primary,
                        false: auroraColors.surfaceVariant,
                      }}
                      thumbColor={auroraColors.surfaceContainerLowest}
                    />
                  </View>
                </GlassCardV2>
              ) : null
            }
          />
        )}
      </View>

      {/* -- cancel / no-show confirm --------------------------------------------- */}
      <AuroraModal
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
              <AuroraButton
                label={confirmAction === 'CANCELLED' ? 'Yes, cancel' : 'Yes, no-show'}
                variant="danger"
                loading={confirming}
                onPress={() => void doConfirm()}
              />
              <AuroraButton
                label="Keep it"
                variant="neutral"
                disabled={confirming}
                onPress={() => setConfirmTarget(null)}
              />
            </View>
          </>
        ) : null}
      </AuroraModal>

      {/* -- walk-in sheet ---------------------------------------------------------- */}
      <AuroraModal
        visible={walkInVisible}
        title="Add walk-in patient"
        titleIcon="how_to_reg"
        dismissable={!walkInSubmitting}
        onClose={() => setWalkInVisible(false)}
      >
        <Text style={styles.walkInDate}>
          {formatDateISO(selectedDate)} · token issued on arrival
        </Text>
        {walkInSchedulesLoading ? (
          <ActivityIndicator color={auroraColors.primary} />
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
                  <AuroraChip
                    key={s.id}
                    active={selected}
                    onPress={() => {
                      if (s.id !== walkInScheduleId) hapticSelection();
                      setWalkInScheduleId(s.id);
                    }}
                    style={styles.scheduleChip}
                  >
                    <Text
                      style={[styles.scheduleChipText, selected && styles.dateChipTextSelected]}
                      numberOfLines={1}
                    >
                      {s.startTime}–{s.endTime} · {s.clinicName}
                    </Text>
                  </AuroraChip>
                );
              })}
            </View>
            <AuroraTextField
              label="Patient name"
              icon="person"
              value={walkInForm.patientName}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, patientName: v }))}
              error={walkInErrors.patientName}
              placeholder="Full name"
            />
            <AuroraTextField
              label="Phone"
              icon="call"
              value={walkInForm.patientPhone}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, patientPhone: v }))}
              error={walkInErrors.patientPhone}
              placeholder="98765 43210"
              keyboardType="phone-pad"
            />
            <AuroraTextField
              label={`Fee (optional · doctor's fee applies)`}
              icon="payments"
              value={walkInForm.fee}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, fee: v }))}
              error={walkInErrors.fee}
              placeholder="e.g. 300"
              keyboardType="number-pad"
            />
            <AuroraTextField
              label="Notes (optional)"
              icon="notes"
              value={walkInForm.notes}
              onChangeText={(v) => setWalkInForm((f) => ({ ...f, notes: v }))}
              error={walkInErrors.notes}
              placeholder="Anything the doctor should know"
              multiline
            />
            {walkInError ? <AuroraErrorBanner message={walkInError} /> : null}
            <View style={styles.confirmButtons}>
              <AuroraButton
                label="Add to queue"
                icon="confirmation_number"
                loading={walkInSubmitting}
                onPress={() => void submitWalkIn()}
              />
              <AuroraButton
                label="Close"
                variant="neutral"
                disabled={walkInSubmitting}
                onPress={() => setWalkInVisible(false)}
              />
            </View>
          </>
        )}
      </AuroraModal>

      {/* -- reject pending booking (Phase 11 B3) -------------------------------- */}
      <AuroraModal
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
            <AuroraTextField
              label="Note (optional)"
              icon="notes"
              value={rejectNote}
              onChangeText={setRejectNote}
              error={rejectNote.trim().length > 2000 ? 'Note is too long (max 2000)' : null}
              placeholder="Why is this booking rejected? Saved to the patient record."
              multiline
            />
            {rejectError ? <AuroraErrorBanner message={rejectError} /> : null}
            <View style={styles.confirmButtons}>
              <AuroraButton
                label="Yes, reject"
                icon="close"
                variant="danger"
                loading={rejecting}
                disabled={rejectNote.trim().length > 2000}
                onPress={() => void doReject()}
              />
              <AuroraButton
                label="Keep it pending"
                variant="neutral"
                disabled={rejecting}
                onPress={() => setRejectTarget(null)}
              />
            </View>
          </>
        ) : null}
      </AuroraModal>

      <GlassToast toast={toast} />
    </AuroraScreen>
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
  /** Pending sections use the primary tint + hourglass icon; the queue
   * header uses the on-surface color + the list icon (design §8.8). */
  pending: boolean;
}) {
  return (
    <View style={styles.sectionHeader}>
      <MaterialIcon
        name={pending ? 'hourglass_top' : 'format_list_numbered'}
        size={18}
        color={pending ? auroraColors.primary : auroraColors.onSurface}
      />
      <Text
        style={pending ? styles.pendingSectionTitle : styles.queueSectionTitle}
        accessibilityLabel={count !== undefined ? `${label}: ${count}` : label}
      >
        {count !== undefined ? `${label} (${count})` : label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// "Currently in chamber" hero (Phase 12, design §8.5) — the CALLED patient
// ---------------------------------------------------------------------------

function ChamberHero({
  appointment,
  busy,
  onComplete,
}: {
  appointment: StaffQueueAppointment;
  /** mutatingId-style busy for this row's actions. */
  busy: boolean;
  onComplete: () => void;
}) {
  // Live-change highlight: pulse exactly when this patient TRANSITIONS to
  // CALLED (the "now serving" moment on the staff console).
  const calledPulse = useChangePulse(appointment.status, appointment.status === 'CALLED');
  const actions = STATUS_TRANSITIONS[appointment.status] ?? [];

  return (
    <GlassCardV2 tier="hero" padded style={styles.card}>
      <PulseView pulse={calledPulse} tint={auroraTints.pulsePair} />
      <View style={styles.chamberTop}>
        <View style={styles.chamberLabel}>
          <View style={styles.pulseDot} />
          <Text style={styles.chamberLabelText}>Currently in chamber</Text>
        </View>
        <View style={styles.chamberChip}>
          <Text style={styles.chamberChipText}>Now serving</Text>
        </View>
      </View>
      <View style={styles.chamberPatient}>
        <View style={styles.tokenSquareHero}>
          <Text style={styles.tokenSquareHeroText}>#{appointment.queueNumber}</Text>
        </View>
        <View style={styles.rowIdentity}>
          <Text style={styles.patientName} numberOfLines={1}>
            {appointment.patientName}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{formatFee(appointment.fee)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>~{appointment.estWaitMin}m wait</Text>
            <AuroraStatusChip status={appointment.status as AuroraStatus} label="Called" />
          </View>
        </View>
      </View>
      {actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actions.map((status) => (
            <RowActionButton key={status} status={status} busy={busy} onPress={onComplete} />
          ))}
        </View>
      ) : null}
    </GlassCardV2>
  );
}

// ---------------------------------------------------------------------------
// Pending carousel (Phase 11 B3; mobilefix2 FIX-C → mobilefix3 FIX-C) — the
// manual-confirmation inbox: ONE horizontal snap carousel above the queue
// ---------------------------------------------------------------------------

function PendingCarousel({
  cards,
  busyId,
  onConfirm,
  onReject,
}: {
  /** The combined pending surface (selected-date first, then upcoming by
   * date ascending) — the SAME array drives the section count. */
  cards: PendingCardData[];
  /** pendingMutatingId — the busy card (its BOTH buttons disable). */
  busyId: string | null;
  onConfirm: (appointment: StaffQueueAppointment) => void;
  onReject: (appointment: StaffQueueAppointment) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  // ~78% window width (PENDING_CARD_WIDTH_RATIO) so the NEXT card peeks; the
  // snap interval = card width + the track gap (spacing.sm) — one card per snap.
  const cardWidth = windowWidth * PENDING_CARD_WIDTH_RATIO;
  const snapInterval = cardWidth + auroraSpacing.sm;

  return (
    <View style={styles.carouselBlock}>
      <SectionHeader label="Awaiting confirmation" count={cards.length} pending />
      <ScrollView
        horizontal
        snapToInterval={snapInterval}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        testID="today-pending-carousel"
        style={styles.carouselScroll}
        contentContainerStyle={styles.carouselTrack}
      >
        {cards.map((card) => (
          <PendingCard
            key={card.appointment.id}
            appointment={card.appointment}
            forDate={card.date}
            width={cardWidth}
            busy={busyId === card.appointment.id}
            onConfirm={() => onConfirm(card.appointment)}
            onReject={() => onReject(card.appointment)}
          />
        ))}
        {/* Trailing runway — the last card snaps fully clear of the fold
          (same B1 law as the date strip). */}
        <View style={styles.carouselTrailing} />
      </ScrollView>
    </View>
  );
}

function PendingCard({
  appointment,
  forDate,
  width,
  busy,
  onConfirm,
  onReject,
}: {
  appointment: StaffQueueAppointment;
  /** mobilefix1 FIX B: the booking's IST date ('YYYY-MM-DD') — present ONLY on
   * upcoming (future-date) cards; selected-date cards omit it. */
  forDate?: string;
  /** The carousel card width (~78% of the window — the peek fraction). */
  width: number;
  /** mutatingId-style busy: disables BOTH buttons on THIS card only while a
   * confirm mutation for it is in flight (double-tap guard; every other card
   * stays enabled). */
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const bookedAt = istTimeOfISO(appointment.createdAt);
  const forDateLabel = forDate ? formatDateISO(forDate) : null;
  return (
    <View
      role="group"
      accessibilityLabel={`${appointment.patientName}, token ${appointment.queueNumber}, awaiting confirmation${
        forDateLabel ? ` for ${forDateLabel}` : ''
      }`}
      testID="today-pending-card"
      style={[styles.pendingCardWrap, { width }]}
    >
      <GlassCardV2 tier="tile" style={styles.pendingCard}>
        <View style={styles.rowTop}>
          <View style={styles.tokenCircle}>
            <Text style={styles.tokenNum}>#{appointment.queueNumber}</Text>
          </View>
          <View style={styles.rowIdentity}>
            <Text style={styles.patientName} numberOfLines={1}>
              {appointment.patientName}
            </Text>
            <Text style={styles.patientPhone}>{appointment.patientPhone}</Text>
          </View>
          <AuroraStatusChip status="PENDING" label="Pending" />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>Booked {bookedAt ? `${bookedAt} IST` : 'earlier'}</Text>
        </View>
        {forDateLabel ? (
          <View style={styles.forDateChip}>
            <MaterialIcon name="calendar_today" size={14} color={auroraColors.primary} />
            <Text
              style={styles.forDateChipText}
              accessibilityLabel={`Appointment date ${forDateLabel}`}
            >
              For {forDateLabel}
            </Text>
          </View>
        ) : null}
        {/* ALWAYS visible, side-by-side at the card bottom — no tap-to-reveal. */}
        <View style={styles.pendingCardActions}>
          <AuroraButton
            label="Confirm"
            icon="check_circle"
            disabled={busy}
            onPress={onConfirm}
            style={styles.pendingConfirmBtn}
          />
          <AuroraButton
            label="Reject"
            icon="close"
            variant="danger"
            disabled={busy}
            onPress={onReject}
            style={styles.pendingRejectBtn}
          />
        </View>
      </GlassCardV2>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Queue row
// ---------------------------------------------------------------------------

function QueueRow({
  appointment,
  emphasized,
  mutatingId,
  onAction,
}: {
  appointment: StaffQueueAppointment;
  /** The next-up (first CONFIRMED) row carries the design's emphasis. */
  emphasized: boolean;
  mutatingId: string | null;
  onAction: (appointment: StaffQueueAppointment, status: SettableStatus) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const busy = mutatingId !== null && mutatingId.startsWith(appointment.id);
  const actions = STATUS_TRANSITIONS[appointment.status] ?? [];

  return (
    <GlassCardV2 tier="tile" style={styles.queueRow}>
      <View style={styles.rowTop}>
        <View style={[styles.tokenSquare, emphasized && styles.tokenSquareEmphasized]}>
          <Text style={[styles.tokenNum, emphasized && styles.tokenNumEmphasized]}>
            #{appointment.queueNumber}
          </Text>
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
        <AuroraStatusChip
          status={appointment.status as AuroraStatus}
          label={labelForStatus(appointment.status as SettableStatus)}
        />
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
            <MaterialIcon
              name="notes"
              size={16}
              color={notesOpen ? auroraColors.primary : auroraColors.onSurfaceVariant}
            />
          </Pressable>
        ) : null}
      </View>

      {notesOpen && appointment.notes ? (
        <GlassCardV2 tier="nested" style={styles.notesCard}>
          <Text style={styles.notesText}>{appointment.notes}</Text>
        </GlassCardV2>
      ) : null}

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
    </GlassCardV2>
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
      <AuroraButton
        label={status === 'CANCELLED' ? 'Cancel' : 'No-show'}
        icon={status === 'CANCELLED' ? 'close' : 'person_off'}
        variant={status === 'CANCELLED' ? 'danger' : 'neutral'}
        disabled={busy}
        onPress={onPress}
        style={styles.rowBtn}
      />
    );
  }
  return (
    <AuroraButton
      label={status === 'CALLED' ? 'Call' : 'Complete'}
      icon={status === 'CALLED' ? 'call' : 'task_alt'}
      variant={status === 'CALLED' ? 'primary' : 'tertiary'}
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
    padding: auroraSpacing.base,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: auroraSpacing.base,
  },
  headerStack: { gap: auroraSpacing.base },
  card: { gap: auroraSpacing.md },

  // identity header card
  identityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  identityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xs,
    flexShrink: 1,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: auroraRadii.tile,
    alignItems: 'center',
    justifyContent: 'center',
    ...auroraTypography.labelSm,
  },
  identityText: { flex: 1, gap: 2 },
  identityLabel: {
    ...auroraTypography.labelSm,
    color: auroraColors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  doctorName: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
  },
  identityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: auroraSpacing.xs,
    paddingTop: auroraSpacing.xxs,
  },
  identityMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  identityCaption: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },
  identityDate: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },

  // metric bento
  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: auroraSpacing.xs },

  // date strip
  sectionTitle: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
  },
  dateStrip: { gap: auroraSpacing.sm, paddingVertical: auroraSpacing.xs },
  // B1 full-bleed: negative margin = GlassCardV2 padded (auroraSpacing.lg) —
  // the strip scrolls to the CARD edges; content padding restores alignment.
  dateStripScroll: { marginHorizontal: -auroraSpacing.lg },
  dateStripTrailing: { width: auroraSpacing.lg },
  dateChip: {
    alignItems: 'center',
    gap: auroraSpacing.xxs,
    paddingHorizontal: auroraSpacing.md,
    paddingVertical: auroraSpacing.sm,
    minWidth: 58,
  },
  dateChipDay: {
    ...auroraTypography.labelSm,
    color: auroraColors.onSurfaceVariant,
  },
  dateChipNum: {
    ...auroraTypography.labelLg,
    color: auroraColors.onSurface,
  },
  dateChipTextSelected: { color: auroraColors.onPrimary },
  todayHint: {
    ...auroraTypography.bodySm,
    color: auroraColors.primary,
  },

  // chamber hero
  chamberTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: auroraSpacing.sm,
  },
  chamberLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: auroraColors.secondary,
  },
  chamberLabelText: {
    ...auroraTypography.labelSm,
    color: auroraColors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chamberChip: {
    backgroundColor: auroraTints.secondaryContainer20,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
  },
  chamberChipText: {
    ...auroraTypography.labelSm,
    color: auroraColors.onSecondaryContainer,
  },
  chamberPatient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.sm,
    backgroundColor: auroraGlass.nested,
    borderRadius: auroraRadii.tile,
    padding: auroraSpacing.sm,
    marginBottom: auroraSpacing.sm,
  },
  tokenSquareHero: {
    width: 48,
    height: 48,
    borderRadius: auroraRadii.field,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraColors.primaryContainer,
  },
  tokenSquareHeroText: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onPrimary,
  },

  // call-next banner
  banner: {
    borderRadius: auroraRadii.card,
    padding: auroraSpacing.md,
    gap: auroraSpacing.sm,
    ...auroraTypography.labelSm,
  },
  bannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerLabelText: {
    ...auroraTypography.labelSm,
    color: auroraColors.onPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  bannerChip: {
    backgroundColor: auroraTints.onDarkChip,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
  },
  bannerChipText: {
    ...auroraTypography.labelSm,
    color: auroraColors.onPrimary,
  },
  bannerBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: auroraSpacing.sm,
  },
  bannerInfo: { flex: 1, gap: 2 },
  bannerKicker: {
    ...auroraTypography.labelSm,
    color: auroraColors.onPrimary,
  },
  bannerName: {
    ...auroraTypography.headlineMd,
    fontWeight: '700',
    color: auroraColors.onPrimary,
  },
  bannerMeta: {
    ...auroraTypography.bodySm,
    color: auroraColors.onPrimary,
  },
  bannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraTints.onDarkCircle,
  },

  // quick actions
  actionsRow: { flexDirection: 'row', gap: auroraSpacing.xs, alignItems: 'center' },
  pollErrorWrap: { marginBottom: auroraSpacing.sm },

  // availability card (the design's admission control)
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: auroraSpacing.sm,
  },
  availabilityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xs,
    flexShrink: 1,
  },
  sensorTile: {
    width: 40,
    height: 40,
    borderRadius: auroraRadii.tile,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraTints.secondaryContainer30,
  },
  availabilityLabel: {
    ...auroraTypography.labelMd,
    color: auroraColors.onSurface,
  },
  availabilityOn: {
    ...auroraTypography.bodySm,
    color: auroraColors.tertiary,
  },
  availabilityOff: {
    ...auroraTypography.bodySm,
    color: auroraColors.error,
  },

  // queue / pending rows (tile tier)
  queueRow: { gap: auroraSpacing.sm, padding: auroraSpacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: auroraSpacing.xs },
  tokenSquare: {
    width: 40,
    height: 40,
    borderRadius: auroraRadii.field,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraTints.tokenSquare,
  },
  tokenSquareEmphasized: {
    backgroundColor: auroraColors.surfaceContainerHighest,
  },
  tokenNum: {
    ...auroraTypography.labelLg,
    color: auroraColors.onSurfaceVariant,
  },
  tokenNumEmphasized: { color: auroraColors.primary },
  rowIdentity: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: auroraSpacing.sm },
  patientName: {
    ...auroraTypography.labelMd,
    color: auroraColors.onSurface,
    flexShrink: 1,
  },
  patientPhone: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xxs,
    flexWrap: 'wrap',
  },
  metaText: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },
  metaDot: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },
  notesButton: { marginLeft: 'auto', padding: auroraSpacing.xs },
  notesButtonPressed: { opacity: 0.6 },
  notesCard: { padding: auroraSpacing.md },
  notesText: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurface,
  },
  rowActions: { flexDirection: 'row', gap: auroraSpacing.sm, flexWrap: 'wrap' },
  completedCaption: {
    ...auroraTypography.labelSm,
    color: auroraColors.onSurfaceVariant,
  },
  rowBtn: { minHeight: 44, paddingHorizontal: auroraSpacing.lg, alignSelf: 'flex-start' },

  sourceChip: {
    backgroundColor: auroraTints.primary10,
    borderRadius: auroraRadii.pill,
    borderWidth: 1,
    borderColor: auroraTints.primary35,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
  },
  sourceChipText: {
    ...auroraTypography.labelSm,
    color: auroraColors.primary,
    letterSpacing: 0.4,
  },

  // confirm modals
  confirmText: {
    ...auroraTypography.bodyMd,
    color: auroraColors.onSurfaceVariant,
    textAlign: 'center',
  },
  confirmButtons: { gap: auroraSpacing.sm },

  // pending carousel (Phase 11 B3; mobilefix3 FIX-C: one snap carousel)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xxs,
  },
  pendingSectionTitle: {
    ...auroraTypography.headlineSm,
    color: auroraColors.primary,
  },
  queueSectionTitle: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
  },
  carouselBlock: { gap: auroraSpacing.xs },
  // B1 full-bleed law: the track scrolls to the SCREEN edges — the negative
  // margin cancels the list's content padding (base), the track padding
  // restores card alignment with the rest of the content.
  carouselScroll: { marginHorizontal: -auroraSpacing.base },
  carouselTrack: { gap: auroraSpacing.sm, paddingHorizontal: auroraSpacing.base },
  carouselTrailing: { width: auroraSpacing.base },
  pendingCardWrap: { flexShrink: 1 },
  pendingCard: { gap: auroraSpacing.sm, padding: auroraSpacing.md },
  tokenCircle: {
    width: 40,
    height: 40,
    borderRadius: 20, // true circle = size/2 (the pill/round law)
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraTints.tokenSquare,
  },
  forDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xxs,
    alignSelf: 'flex-start',
    backgroundColor: auroraTints.primary10,
    borderColor: auroraTints.primary35,
    borderWidth: 1,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
  },
  forDateChipText: {
    ...auroraTypography.labelSm,
    color: auroraColors.primary,
  },
  pendingCardActions: { flexDirection: 'row', gap: auroraSpacing.sm },
  pendingConfirmBtn: { flex: 1 },
  pendingRejectBtn: { flex: 1 },

  // walk-in modal
  walkInDate: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
    textAlign: 'center',
  },
  walkInNone: {
    ...auroraTypography.bodyMd,
    color: auroraColors.onSurfaceVariant,
    textAlign: 'center',
  },
  scheduleChips: { gap: auroraSpacing.sm },
  scheduleChip: {
    paddingHorizontal: auroraSpacing.md,
    paddingVertical: auroraSpacing.sm,
    alignSelf: 'flex-start',
  },
  scheduleChipText: {
    ...auroraTypography.labelSm,
    color: auroraColors.onSurface,
  },
});
