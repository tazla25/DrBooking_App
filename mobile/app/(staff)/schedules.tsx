import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
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
  useToast,
} from '@/components';
import { toFriendlyMessage } from '@/lib/errors';
import { dayName, formatDateISO } from '@/lib/format';
import {
  createOverride,
  createSchedule,
  deactivateSchedule,
  deleteOverride,
  fetchOverrides,
  updateSchedule,
  type StaffOverride,
  type StaffSchedule,
} from '@/lib/staff';
import { istTodayISO, nextDates } from '@/lib/time';
import {
  overrideTypeSelected,
  validateOverrideForm,
  validateScheduleForm,
  type OverrideFormErrors,
  type OverrideFormValues,
  type OverrideTypeValue,
  type ScheduleFormErrors,
  type ScheduleFormValues,
} from '@/lib/validation';
import { useSchedules } from '@/hooks/useSchedules';
import { colors, radii, spacing, typography } from '@/theme';

const DAY_CHIPS = [0, 1, 2, 3, 4, 5, 6];
const OVERRIDE_DATES_AHEAD = 14;

const OVERRIDE_TYPES: OverrideTypeValue[] = ['CLOSED', 'MODIFIED_HOURS', 'SPECIAL'];

const OVERRIDE_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  CLOSED: { label: 'Closed', color: '#B94A4A', bg: 'rgba(226, 85, 85, 0.16)' },
  MODIFIED_HOURS: { label: 'Modified hours', color: '#2D6FB4', bg: 'rgba(77, 159, 222, 0.20)' },
  SPECIAL: { label: 'Special hours', color: '#B27415', bg: 'rgba(245, 166, 35, 0.20)' },
};

/**
 * Staff console — Schedules tab: weekly slots incl. inactive ones (soft-
 * deleted server-side, so the action is labelled "Deactivate" — never
 * "Delete"), create/edit via the shared form (PUT sends the FULL body),
 * per-schedule day overrides (CLOSED carries no times; MODIFIED_HOURS /
 * SPECIAL require both with start < end — enforced client-side BEFORE
 * submit, re-checked by the server).
 */
export default function StaffSchedulesScreen() {
  const { toast, show } = useToast();
  const list = useSchedules();

  // -- create / edit ----------------------------------------------------------
  const [formTarget, setFormTarget] = useState<StaffSchedule | 'new' | null>(null);

  // -- deactivate ---------------------------------------------------------------
  const [deactivateTarget, setDeactivateTarget] = useState<StaffSchedule | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await deactivateSchedule(deactivateTarget.id);
      setDeactivateTarget(null);
      show('Schedule deactivated — history is kept', 'success');
      await list.refresh();
    } catch (err) {
      show(toFriendlyMessage(err), 'error');
    } finally {
      setDeactivating(false);
    }
  };

  // -- overrides ------------------------------------------------------------------
  const [overridesTarget, setOverridesTarget] = useState<StaffSchedule | null>(null);

  const onOverridesChanged = async () => {
    // todayOverride on the card may have changed — refresh the list too.
    await list.refresh();
  };

  // -- grouped sections (dayOfWeek asc, startTime asc — server order) -------------
  const sections = groupByDay(list.items);

  return (
    <GlassScreen>
      <GlassHeader title="Schedules" back={false} />
      <View style={styles.body}>
        {list.loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : list.error ? (
          <GlassCard padded style={styles.card}>
            <ErrorBanner message={list.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void list.refresh()}
            />
          </GlassCard>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            refreshing={list.refreshing}
            onRefresh={() => void list.refresh()}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon="calendar-outline"
                title="No schedules yet"
                caption="Create your first weekly slot — patients can only book active schedules."
                ctaLabel="New schedule"
                onCta={() => setFormTarget('new')}
              />
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <ScheduleCard
                schedule={item}
                onEdit={() => setFormTarget(item)}
                onOverrides={() => setOverridesTarget(item)}
                onDeactivate={() => setDeactivateTarget(item)}
              />
            )}
            ListFooterComponent={
              <PrimaryButton
                label="New schedule"
                icon="add-outline"
                onPress={() => setFormTarget('new')}
              />
            }
          />
        )}
      </View>

      {/* -- create / edit modal -------------------------------------------------- */}
      <ScheduleFormModal
        target={formTarget}
        onClose={() => setFormTarget(null)}
        onSaved={async (created) => {
          setFormTarget(null);
          show(created ? 'Schedule created' : 'Schedule updated', 'success');
          await list.refresh();
        }}
        onError={(message) => show(message, 'error')}
      />

      {/* -- deactivate confirm ----------------------------------------------------- */}
      <GlassModal
        visible={deactivateTarget !== null}
        title="Deactivate this schedule?"
        dismissable={!deactivating}
        onClose={() => setDeactivateTarget(null)}
      >
        {deactivateTarget ? (
          <>
            <Text style={styles.confirmText}>
              {deactivateTarget.clinicName} · {dayName(deactivateTarget.dayOfWeek)}{' '}
              {deactivateTarget.startTime}–{deactivateTarget.endTime} will stop accepting new
              bookings. Nothing is deleted — past appointments and history are kept, and the slot
              stays listed as Inactive.
            </Text>
            <View style={styles.confirmButtons}>
              <PrimaryButton
                label="Yes, deactivate"
                tone="destructive"
                loading={deactivating}
                onPress={() => void doDeactivate()}
              />
              <GlassButton
                label="Keep it active"
                disabled={deactivating}
                onPress={() => setDeactivateTarget(null)}
              />
            </View>
          </>
        ) : null}
      </GlassModal>

      {/* -- overrides modal ---------------------------------------------------------- */}
      <OverridesModal
        schedule={overridesTarget}
        onClose={() => setOverridesTarget(null)}
        onChanged={() => void onOverridesChanged()}
        onError={(message) => show(message, 'error')}
      />

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

// ---------------------------------------------------------------------------
// Schedule card
// ---------------------------------------------------------------------------

function ScheduleCard({
  schedule,
  onEdit,
  onOverrides,
  onDeactivate,
}: {
  schedule: StaffSchedule;
  onEdit: () => void;
  onOverrides: () => void;
  onDeactivate: () => void;
}) {
  const inactive = !schedule.isActive;
  const override = schedule.todayOverride;

  return (
    <GlassCard padded style={[styles.card, inactive && styles.inactiveCard]}>
      <View style={styles.cardTop}>
        <Text style={[styles.clinicName, inactive && styles.mutedText]} numberOfLines={1}>
          {schedule.clinicName}
        </Text>
        {inactive ? <InactiveChip /> : null}
      </View>
      <Text style={[styles.address, inactive && styles.mutedText]} numberOfLines={2}>
        {schedule.clinicAddress}
      </Text>

      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={colors.text.secondary} />
        <Text style={styles.metaText}>
          {schedule.startTime} – {schedule.endTime}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>~{schedule.avgMinutesPerPatient} min/patient</Text>
      </View>

      <View style={styles.chipRow}>
        {schedule.todayQueueCount > 0 ? (
          <View style={styles.queueChip}>
            <Text style={styles.queueChipText}>{schedule.todayQueueCount} today</Text>
          </View>
        ) : null}
        {override ? <OverrideChip type={String(override.type)} today /> : null}
      </View>

      {!inactive ? (
        <View style={styles.cardActions}>
          <GlassButton label="Edit" icon="create-outline" onPress={onEdit} style={styles.cardBtn} />
          <GlassButton
            label="Overrides"
            icon="swap-horizontal-outline"
            onPress={onOverrides}
            style={styles.cardBtn}
          />
          <GlassButton
            label="Deactivate"
            icon="pause-circle-outline"
            tone="destructive"
            onPress={onDeactivate}
            style={styles.cardBtn}
          />
        </View>
      ) : null}
    </GlassCard>
  );
}

function InactiveChip() {
  return (
    <View style={styles.inactiveChip}>
      <Text style={styles.inactiveChipText}>INACTIVE</Text>
    </View>
  );
}

function OverrideChip({ type, today }: { type: string; today?: boolean }) {
  const meta = OVERRIDE_TYPE_META[type] ?? OVERRIDE_TYPE_META.SPECIAL;
  return (
    <View style={[styles.overrideChip, { backgroundColor: meta.bg }]}>
      <Text style={[styles.overrideChipText, { color: meta.color }]}>
        {today ? 'Today: ' : ''}
        {meta.label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form modal (PUT sends the FULL body)
// ---------------------------------------------------------------------------

const EMPTY_FORM: ScheduleFormValues = {
  dayOfWeek: null,
  startTime: '',
  endTime: '',
  clinicName: '',
  clinicAddress: '',
  pinCode: '',
  landmark: '',
  mapLink: '',
  avgMinutesPerPatient: '10',
};

function ScheduleFormModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: StaffSchedule | 'new' | null;
  onClose: () => void;
  onSaved: (created: boolean) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const isEdit = target !== null && target !== 'new';
  const [form, setForm] = useState<ScheduleFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<ScheduleFormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Render-time state adjustment (the Phase 6 pattern): reset the form when
  // the modal (re)opens for a target — setState during render is the
  // React-endorsed way to derive state from props without an effect.
  const [prevTarget, setPrevTarget] = useState<StaffSchedule | 'new' | null>(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setErrors({});
    setApiError(null);
    if (target === null || target === 'new') {
      setForm(EMPTY_FORM);
    } else {
      setForm({
        dayOfWeek: target.dayOfWeek,
        startTime: target.startTime,
        endTime: target.endTime,
        clinicName: target.clinicName,
        clinicAddress: target.clinicAddress,
        pinCode: target.pinCode ?? '',
        landmark: target.landmark ?? '',
        mapLink: target.mapLink ?? '',
        avgMinutesPerPatient: String(target.avgMinutesPerPatient),
      });
    }
  }

  const submit = async () => {
    const validation = validateScheduleForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSubmitting(true);
    setApiError(null);
    try {
      const input = {
        dayOfWeek: form.dayOfWeek as number,
        startTime: form.startTime.trim(),
        endTime: form.endTime.trim(),
        clinicName: form.clinicName,
        clinicAddress: form.clinicAddress,
        pinCode: form.pinCode,
        landmark: form.landmark,
        mapLink: form.mapLink,
        avgMinutesPerPatient: Number(form.avgMinutesPerPatient.trim()),
      };
      if (isEdit) {
        await updateSchedule(target.id, input); // FULL body — omit nothing
        await onSaved(false);
      } else {
        await createSchedule(input);
        await onSaved(true);
      }
    } catch (err) {
      setApiError(toFriendlyMessage(err));
      onError(toFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassModal
      visible={target !== null}
      title={isEdit ? 'Edit schedule' : 'New schedule'}
      dismissable={!submitting}
      onClose={onClose}
    >
      <ScrollView bounces={false} contentContainerStyle={styles.formScroll}>
        <Text style={styles.fieldsetLabel}>Day of the week</Text>
        <View style={styles.dayChips}>
          {DAY_CHIPS.map((day) => {
            const selected = form.dayOfWeek === day;
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={dayName(day)}
                onPress={() => setForm((f) => ({ ...f, dayOfWeek: day }))}
                style={[styles.dayChip, selected && styles.dayChipSelected]}
              >
                <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>
                  {dayName(day, true)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errors.dayOfWeek ? <Text style={styles.fieldError}>{errors.dayOfWeek}</Text> : null}

        <View style={styles.timeRow}>
          <GlassTextField
            label="Starts"
            icon="play-outline"
            value={form.startTime}
            onChangeText={(v) => setForm((f) => ({ ...f, startTime: v }))}
            error={errors.startTime}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            containerStyle={styles.timeField}
          />
          <GlassTextField
            label="Ends"
            icon="stop-outline"
            value={form.endTime}
            onChangeText={(v) => setForm((f) => ({ ...f, endTime: v }))}
            error={errors.endTime}
            placeholder="13:00"
            keyboardType="numbers-and-punctuation"
            containerStyle={styles.timeField}
          />
        </View>

        <GlassTextField
          label="Clinic name"
          icon="business-outline"
          value={form.clinicName}
          onChangeText={(v) => setForm((f) => ({ ...f, clinicName: v }))}
          error={errors.clinicName}
          placeholder="Sunrise Clinic"
        />
        <GlassTextField
          label="Clinic address"
          icon="location-outline"
          value={form.clinicAddress}
          onChangeText={(v) => setForm((f) => ({ ...f, clinicAddress: v }))}
          error={errors.clinicAddress}
          placeholder="Street, area, city"
        />
        <View style={styles.timeRow}>
          <GlassTextField
            label="PIN code (optional)"
            icon="mail-outline"
            value={form.pinCode}
            onChangeText={(v) => setForm((f) => ({ ...f, pinCode: v }))}
            error={errors.pinCode}
            placeholder="560001"
            keyboardType="number-pad"
            containerStyle={styles.timeField}
          />
          <GlassTextField
            label="Minutes per patient"
            icon="speedometer-outline"
            value={form.avgMinutesPerPatient}
            onChangeText={(v) => setForm((f) => ({ ...f, avgMinutesPerPatient: v }))}
            error={errors.avgMinutesPerPatient}
            placeholder="10"
            keyboardType="number-pad"
            containerStyle={styles.timeField}
          />
        </View>
        <GlassTextField
          label="Landmark (optional)"
          icon="flag-outline"
          value={form.landmark}
          onChangeText={(v) => setForm((f) => ({ ...f, landmark: v }))}
          error={errors.landmark}
          placeholder="Near the metro station"
        />
        <GlassTextField
          label="Map link (optional)"
          icon="map-outline"
          value={form.mapLink}
          onChangeText={(v) => setForm((f) => ({ ...f, mapLink: v }))}
          error={errors.mapLink}
          placeholder="https://maps.example.com/..."
          autoCapitalize="none"
        />

        {apiError ? <ErrorBanner message={apiError} /> : null}
      </ScrollView>
      <View style={styles.confirmButtons}>
        <PrimaryButton
          label={isEdit ? 'Save changes' : 'Create schedule'}
          icon={isEdit ? 'checkmark-outline' : 'add-outline'}
          loading={submitting}
          onPress={() => void submit()}
        />
        <GlassButton label="Cancel" disabled={submitting} onPress={onClose} />
      </View>
    </GlassModal>
  );
}

// ---------------------------------------------------------------------------
// Overrides modal
// ---------------------------------------------------------------------------

const EMPTY_OVERRIDE_FORM: OverrideFormValues = {
  date: '',
  type: null,
  newStartTime: '',
  newEndTime: '',
  reason: '',
};

function OverridesModal({
  schedule,
  onClose,
  onChanged,
  onError,
}: {
  schedule: StaffSchedule | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [overrides, setOverrides] = useState<StaffOverride[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<OverrideFormValues>(EMPTY_OVERRIDE_FORM);
  const [errors, setErrors] = useState<OverrideFormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  // Render-time state adjustment: reset the add-form whenever the modal
  // (re)opens for a schedule (setState during render — no effect needed).
  const [prevSchedule, setPrevSchedule] = useState<StaffSchedule | null>(schedule);
  if (schedule !== prevSchedule) {
    setPrevSchedule(schedule);
    setForm(EMPTY_OVERRIDE_FORM);
    setErrors({});
    setApiError(null);
  }

  // Load the schedule's overrides — state updates happen ONLY in the async
  // callbacks (never synchronously inside the effect body).
  useEffect(() => {
    if (schedule === null) return;
    let alive = true;
    fetchOverrides(schedule.id)
      .then((data) => {
        if (!alive) return;
        setOverrides(data.overrides);
        setListError(null);
      })
      .catch((err) => {
        if (alive) setListError(toFriendlyMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [schedule]);

  /** Retry button + refetch after mutations — event handler, may setState. */
  const load = async () => {
    if (!schedule) return;
    setLoading(true);
    try {
      const data = await fetchOverrides(schedule.id);
      setOverrides(data.overrides);
      setListError(null);
    } catch (err) {
      setListError(toFriendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const dateChips = nextDates(istTodayISO(), OVERRIDE_DATES_AHEAD);

  const submit = async () => {
    if (!schedule) return;
    const validation = validateOverrideForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSubmitting(true);
    setApiError(null);
    try {
      await createOverride(schedule.id, {
        date: form.date,
        type: form.type as OverrideTypeValue,
        newStartTime: form.newStartTime.trim() || undefined,
        newEndTime: form.newEndTime.trim() || undefined,
        reason: form.reason || undefined,
      });
      setForm(EMPTY_OVERRIDE_FORM);
      await load();
      await onChanged();
    } catch (err) {
      // OVERRIDE_EXISTS (409) and validation errors stay in the form.
      setApiError(toFriendlyMessage(err));
      onError(toFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (date: string) => {
    if (!schedule) return;
    setDeletingDate(date);
    try {
      await deleteOverride(schedule.id, date);
      await load();
      await onChanged();
    } catch (err) {
      onError(toFriendlyMessage(err));
    } finally {
      setDeletingDate(null);
    }
  };

  return (
    <GlassModal
      visible={schedule !== null}
      title="Day overrides"
      dismissable={!submitting}
      onClose={onClose}
    >
      {schedule ? (
        <ScrollView bounces={false} contentContainerStyle={styles.formScroll}>
          <Text style={styles.overrideSubtitle} numberOfLines={1}>
            {schedule.clinicName} · {dayName(schedule.dayOfWeek)} {schedule.startTime}–
            {schedule.endTime}
          </Text>

          {/* -- existing overrides -------------------------------------------------- */}
          {loading ? (
            <ActivityIndicator color={colors.ctaGradient.end} />
          ) : listError ? (
            <>
              <ErrorBanner message={listError} />
              <GlassButton label="Try again" icon="refresh-outline" onPress={() => void load()} />
            </>
          ) : (overrides ?? []).length === 0 ? (
            <Text style={styles.overrideEmpty}>
              No overrides — the regular weekly hours apply every week.
            </Text>
          ) : (
            (overrides ?? []).map((o) => (
              <GlassCard key={o.id} nested style={styles.overrideRow}>
                <View style={styles.overrideRowTop}>
                  <OverrideChip type={o.type} />
                  <Text style={styles.overrideDate}>{formatDateISO(o.date)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete override for ${formatDateISO(o.date)}`}
                    disabled={deletingDate === o.date}
                    onPress={() => void remove(o.date)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons
                      name={deletingDate === o.date ? 'hourglass-outline' : 'trash-outline'}
                      size={18}
                      color={colors.destructive}
                    />
                  </Pressable>
                </View>
                {o.type !== 'CLOSED' ? (
                  <Text style={styles.overrideTimes}>
                    {o.newStartTime} – {o.newEndTime}
                  </Text>
                ) : null}
                {o.reason ? (
                  <Text style={styles.overrideReason} numberOfLines={2}>
                    {o.reason}
                  </Text>
                ) : null}
              </GlassCard>
            ))
          )}

          {/* -- add form --------------------------------------------------------------- */}
          <Text style={styles.fieldsetLabel}>Add an override</Text>
          <View style={styles.typeChips}>
            {OVERRIDE_TYPES.map((type) => {
              const selected = form.type === type;
              const meta = OVERRIDE_TYPE_META[type];
              return (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  onPress={() => setForm((f) => overrideTypeSelected(f, type))}
                  style={[
                    styles.typeChip,
                    selected && {
                      backgroundColor: meta.bg,
                      borderColor: meta.color,
                    },
                  ]}
                >
                  <Text style={[styles.typeChipText, selected && { color: meta.color }]}>
                    {meta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {errors.type ? <Text style={styles.fieldError}>{errors.type}</Text> : null}

          <Text style={styles.fieldsetLabel}>Date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateStrip}
          >
            {dateChips.map((date) => {
              const selected = form.date === date;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={formatDateISO(date)}
                  onPress={() => setForm((f) => ({ ...f, date }))}
                  style={[styles.dateChip2, selected && styles.dateChip2Selected]}
                >
                  <Text style={[styles.dateChipDay, selected && styles.dateChipTextSelected]}>
                    {date === istTodayISO()
                      ? 'Today'
                      : dayName(new Date(`${date}T12:00:00Z`).getUTCDay(), true)}
                  </Text>
                  <Text style={[styles.dateChipNum, selected && styles.dateChipTextSelected]}>
                    {formatDateISO(date).slice(0, 6)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {errors.date ? <Text style={styles.fieldError}>{errors.date}</Text> : null}

          {form.type !== null && form.type !== 'CLOSED' ? (
            <View style={styles.timeRow}>
              <GlassTextField
                label="New start"
                icon="play-outline"
                value={form.newStartTime}
                onChangeText={(v) => setForm((f) => ({ ...f, newStartTime: v }))}
                error={errors.newStartTime}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                containerStyle={styles.timeField}
              />
              <GlassTextField
                label="New end"
                icon="stop-outline"
                value={form.newEndTime}
                onChangeText={(v) => setForm((f) => ({ ...f, newEndTime: v }))}
                error={errors.newEndTime}
                placeholder="13:00"
                keyboardType="numbers-and-punctuation"
                containerStyle={styles.timeField}
              />
            </View>
          ) : null}
          {form.type === 'CLOSED' ? (
            <Text style={styles.closedHint}>A closed day hides this schedule for the date.</Text>
          ) : null}

          <GlassTextField
            label="Reason (optional)"
            icon="chatbubble-outline"
            value={form.reason}
            onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
            error={errors.reason}
            placeholder="e.g. Conference out of town"
          />

          {apiError ? <ErrorBanner message={apiError} /> : null}

          <PrimaryButton
            label="Add override"
            icon="add-outline"
            loading={submitting}
            disabled={form.type === null || form.date === ''}
            onPress={() => void submit()}
          />
        </ScrollView>
      ) : null}
    </GlassModal>
  );
}

// ---------------------------------------------------------------------------

function groupByDay(schedules: StaffSchedule[]): { title: string; data: StaffSchedule[] }[] {
  const byDay = new Map<number, StaffSchedule[]>();
  for (const schedule of schedules) {
    const bucket = byDay.get(schedule.dayOfWeek) ?? [];
    bucket.push(schedule);
    byDay.set(schedule.dayOfWeek, bucket);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, data]) => ({ title: dayName(day), data }));
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.base },
  card: { gap: spacing.sm },
  sectionHeader: {
    ...typography.captionSemi,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.base,
  },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  clinicName: { ...typography.h3, color: colors.text.primary, flex: 1 },
  address: { ...typography.caption, color: colors.text.secondary },
  mutedText: { color: colors.unavailable },
  inactiveCard: { opacity: 0.72 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.text.secondary },
  metaDot: { ...typography.caption, color: colors.text.secondary },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  cardActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  cardBtn: { minHeight: 38, paddingHorizontal: spacing.lg },

  inactiveChip: {
    backgroundColor: 'rgba(138, 147, 166, 0.20)',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  inactiveChipText: { ...typography.micro, color: '#5F6B80', letterSpacing: 0.4 },

  queueChip: {
    backgroundColor: 'rgba(61, 178, 115, 0.18)',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(61, 178, 115, 0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  queueChipText: { ...typography.micro, color: '#2E7D5B', letterSpacing: 0.4 },

  overrideChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  overrideChipText: { ...typography.micro, letterSpacing: 0.4 },

  // modals
  confirmText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  confirmButtons: { gap: spacing.sm },
  formScroll: { gap: spacing.md },
  fieldsetLabel: { ...typography.captionSemi, color: colors.text.primary, marginLeft: spacing.md },
  fieldError: {
    ...typography.caption,
    color: colors.destructive,
    marginLeft: spacing.md,
    marginTop: -spacing.xs,
  },

  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dayChip: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dayChipSelected: {
    backgroundColor: colors.ctaGradient.end,
    borderColor: colors.ctaGradient.end,
  },
  dayChipText: { ...typography.captionSemi, color: colors.text.primary },
  dayChipTextSelected: { color: colors.white },

  timeRow: { flexDirection: 'row', gap: spacing.md },
  timeField: { flex: 1 },

  // overrides modal
  overrideSubtitle: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  overrideEmpty: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  overrideRow: { padding: spacing.md, gap: spacing.xs },
  overrideRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  overrideDate: { ...typography.captionSemi, color: colors.text.primary, flex: 1 },
  overrideTimes: { ...typography.caption, color: colors.text.secondary },
  overrideReason: { ...typography.caption, color: colors.text.secondary },

  typeChips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  typeChip: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  typeChipText: { ...typography.captionSemi, color: colors.text.primary },

  dateStrip: { gap: spacing.sm, paddingVertical: spacing.xs },
  dateChip2: {
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 58,
  },
  dateChip2Selected: {
    backgroundColor: colors.ctaGradient.end,
    borderColor: colors.ctaGradient.end,
  },
  dateChipDay: { ...typography.micro, color: colors.text.secondary },
  dateChipNum: { ...typography.bodySemi, color: colors.text.primary },
  dateChipTextSelected: { color: colors.white },

  closedHint: { ...typography.caption, color: colors.text.secondary, marginLeft: spacing.md },
});
