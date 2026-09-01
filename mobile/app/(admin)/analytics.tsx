import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
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
import {
  REVENUE_DAY_OPTIONS,
  downloadAppointmentsCsv,
  fetchVerifiedDoctors,
  type AnalyticsSummaryResponse,
  type AnalyticsWindow,
  type AnalyticsWindowKey,
  type DoctorSummary,
} from '@/lib/admin';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDayMonth, formatFee } from '@/lib/format';
import { addDaysISO, istTodayISO } from '@/lib/time';
import { validateExportRange } from '@/lib/validation';
import { useAnalyticsSummary, useRevenueSeries } from '@/hooks/useAdminAnalytics';
import { hapticSelection } from '@/lib/haptics';
import { AnimatedChip } from '@/components/motion';
import { colors, radii, spacing, typography } from '@/theme';

const WINDOWS: { key: AnalyticsWindowKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7d', label: 'Last 7d' },
  { key: 'last30d', label: 'Last 30d' },
];

/** Bar chart geometry (plain Views — no chart library, per the dep freeze). */
const BAR_MAX_HEIGHT = 110;
const BAR_MIN_HEIGHT = 3;
const BAR_WIDTH = 12;
const BAR_GAP = 8;

/**
 * A2 — Analytics tab: doctor picker (public VERIFIED list — PENDING doctors
 * are invisible by design), window metric tiles, a plain-View revenue bar
 * chart (7/30/90 days, horizontal scroll, sparse labels) and A4's CSV export
 * modal. The picker ALWAYS supplies ?doctorId= (scoping law — 422 becomes
 * unreachable from this screen; the error is still mapped if it ever fires).
 */
export default function AdminAnalyticsScreen() {
  const { toast, show } = useToast();

  // -- doctor picker ----------------------------------------------------------
  const [doctors, setDoctors] = useState<DoctorSummary[] | null>(null);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVerifiedDoctors()
      .then((data) => {
        if (!alive) return;
        setDoctors(data.doctors);
        setDoctorsError(null);
        // Default-select the first doctor (rating sort is the API default).
        setDoctorId((current) => current ?? data.doctors[0]?.id ?? null);
      })
      .catch((err) => {
        if (alive) setDoctorsError(toFriendlyMessage(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const retryDoctors = () => {
    setDoctorsError(null);
    setDoctors(null);
    fetchVerifiedDoctors()
      .then((data) => {
        setDoctors(data.doctors);
        setDoctorId((current) => current ?? data.doctors[0]?.id ?? null);
      })
      .catch((err) => setDoctorsError(toFriendlyMessage(err)));
  };

  const selectedDoctor = doctors?.find((d) => d.id === doctorId) ?? null;

  // -- summary + revenue series ------------------------------------------------
  const [days, setDays] = useState<number>(30);
  const [window, setWindow] = useState<AnalyticsWindowKey>('today');

  const summary = useAnalyticsSummary(doctorId);
  const revenue = useRevenueSeries(doctorId, days);

  // -- CSV export (A4) ----------------------------------------------------------
  const [exportOpen, setExportOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exportErrors, setExportErrors] = useState<{ from?: string; to?: string }>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const openExport = () => {
    // Defaults mirror the server: to = IST today, from = today − 30.
    const today = istTodayISO();
    setFrom(addDaysISO(today, -30));
    setTo(today);
    setExportErrors({});
    setExportError(null);
    setExportOpen(true);
  };

  const submitExport = async () => {
    if (!doctorId) return;
    const validation = validateExportRange(from, to);
    setExportErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setExporting(true);
    setExportError(null);
    try {
      const uri = await downloadAppointmentsCsv({ doctorId, from, to });
      await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
      setExportOpen(false);
      show('Export ready — share sheet opened', 'success');
    } catch (err) {
      // Envelope errors (422/403/401) and write/share failures all land here;
      // never crash — the modal keeps the form for a retry.
      setExportError(toFriendlyMessage(err));
      show(toFriendlyMessage(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------------------

  return (
    <GlassScreen>
      <GlassHeader title="Analytics" back={false} />
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* -- doctor picker -------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Doctor</Text>
          {doctorsError ? (
            <>
              <ErrorBanner message={doctorsError} />
              <GlassButton label="Try again" icon="refresh-outline" onPress={retryDoctors} />
            </>
          ) : doctors === null ? (
            <ActivityIndicator color={colors.ctaGradient.end} />
          ) : doctors.length === 0 ? (
            <Text style={styles.pickerEmpty}>
              No verified doctors yet — analytics appear once a doctor is verified.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pickerRow}
            >
              {doctors.map((doc) => {
                const selected = doc.id === doctorId;
                return (
                  <AnimatedChip
                    key={doc.id}
                    active={selected}
                    bg={[colors.glass.chip, colors.interactive.selectedBg]}
                    border={[colors.glass.border, colors.interactive.selectedBorder]}
                    onPress={() => {
                      if (!selected) hapticSelection();
                      setDoctorId(doc.id);
                    }}
                    accessibilityLabel={`Select Dr. ${doc.fullName}`}
                    accessibilityState={{ selected }}
                    style={styles.doctorChip}
                  >
                    <View style={styles.doctorChipRow}>
                      <Avatar name={doc.fullName} size={26} />
                      <View style={styles.chipTextWrap}>
                        <Text
                          style={[styles.chipName, selected && styles.chipNameSelected]}
                          numberOfLines={1}
                        >
                          Dr. {doc.fullName}
                        </Text>
                        {doc.specialization ? (
                          <Text
                            style={[styles.chipSpec, selected && styles.chipSpecSelected]}
                            numberOfLines={1}
                          >
                            {doc.specialization}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </AnimatedChip>
                );
              })}
            </ScrollView>
          )}
        </GlassCard>

        {/* -- summary tiles ---------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Appointments</Text>
          {doctorId === null && doctors !== null && doctors.length === 0 ? (
            <Text style={styles.pickerEmpty}>Nothing to summarise yet.</Text>
          ) : summary.loading ? (
            <ActivityIndicator color={colors.ctaGradient.end} style={styles.blockLoader} />
          ) : summary.error ? (
            <>
              <ErrorBanner message={summary.error} />
              <GlassButton label="Try again" icon="refresh-outline" onPress={summary.retry} />
            </>
          ) : summary.data ? (
            <SummaryPanel summary={summary.data} window={window} onWindow={setWindow} />
          ) : null}
        </GlassCard>

        {/* -- revenue chart ----------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <View style={styles.chartHeader}>
            <Text style={styles.sectionTitle}>Revenue</Text>
            <View style={styles.daysChips}>
              {REVENUE_DAY_OPTIONS.map((option) => (
                <AnimatedChip
                  key={option}
                  active={days === option}
                  bg={[colors.glass.chip, colors.interactive.selectedBg]}
                  border={[colors.glass.border, colors.interactive.selectedBorder]}
                  onPress={() => {
                    if (days !== option) hapticSelection();
                    setDays(option);
                  }}
                  accessibilityLabel={`Last ${option} days`}
                  accessibilityState={{ selected: days === option }}
                  style={styles.daysChip}
                >
                  <Text
                    style={[styles.daysChipText, days === option && styles.daysChipTextSelected]}
                  >
                    {option}d
                  </Text>
                </AnimatedChip>
              ))}
            </View>
          </View>
          {revenue.loading ? (
            <ActivityIndicator color={colors.ctaGradient.end} style={styles.blockLoader} />
          ) : revenue.error ? (
            <>
              <ErrorBanner message={revenue.error} />
              <GlassButton label="Try again" icon="refresh-outline" onPress={revenue.retry} />
            </>
          ) : revenue.series && revenue.series.length > 0 ? (
            <RevenueChart series={revenue.series} />
          ) : (
            <Text style={styles.pickerEmpty}>No revenue in this window.</Text>
          )}
        </GlassCard>

        {/* -- CSV export (A4) --------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Export</Text>
          <Text style={styles.exportHint}>
            Download the appointment log as a CSV (Excel-friendly; phones are formula-escaped) and
            share it.
          </Text>
          <PrimaryButton
            label="Export CSV"
            icon="download-outline"
            disabled={doctorId === null}
            onPress={openExport}
          />
        </GlassCard>
      </ScrollView>

      {/* -- export modal ------------------------------------------------------- */}
      <GlassModal
        visible={exportOpen}
        title={selectedDoctor ? `Export Dr. ${selectedDoctor.fullName}` : 'Export appointments'}
        dismissable={!exporting}
        onClose={() => setExportOpen(false)}
      >
        <Text style={styles.rejectHint}>
          IST date range, inclusive. Defaults to the last 30 days (from must be on or before to).
        </Text>
        <GlassTextField
          label="From (YYYY-MM-DD)"
          icon="calendar-outline"
          value={from}
          onChangeText={setFrom}
          error={exportErrors.from}
          placeholder="2026-08-01"
          keyboardType="numbers-and-punctuation"
        />
        <GlassTextField
          label="To (YYYY-MM-DD)"
          icon="calendar-outline"
          value={to}
          onChangeText={setTo}
          error={exportErrors.to}
          placeholder="2026-08-31"
          keyboardType="numbers-and-punctuation"
        />
        {exportError ? <ErrorBanner message={exportError} /> : null}
        <PrimaryButton
          label="Download & share"
          icon="share-outline"
          loading={exporting}
          onPress={() => void submitExport()}
        />
        <GlassButton label="Cancel" icon="close-outline" onPress={() => setExportOpen(false)} />
      </GlassModal>

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

// ---------------------------------------------------------------------------
// Summary panel — window chips + 6 metric tiles (revenue highlighted)
// ---------------------------------------------------------------------------

function SummaryPanel({
  summary,
  window,
  onWindow,
}: {
  summary: AnalyticsSummaryResponse;
  window: AnalyticsWindowKey;
  onWindow: (key: AnalyticsWindowKey) => void;
}) {
  const ranges: Record<AnalyticsWindowKey, string> = {
    today: `IST date ${summary.todayDate}`,
    last7d: `${summary.last7dStart} → ${summary.todayDate}`,
    last30d: `${summary.last30dStart} → ${summary.todayDate}`,
  };
  const active: AnalyticsWindow = summary[window];

  return (
    <View style={styles.summaryWrap}>
      <View style={styles.windowChips}>
        {WINDOWS.map((w) => (
          <AnimatedChip
            key={w.key}
            active={window === w.key}
            bg={[colors.glass.chip, colors.interactive.selectedBg]}
            border={[colors.glass.border, colors.interactive.selectedBorder]}
            onPress={() => {
              if (window !== w.key) hapticSelection();
              onWindow(w.key);
            }}
            accessibilityLabel={w.label}
            accessibilityState={{ selected: window === w.key }}
            style={styles.windowChip}
          >
            <Text
              style={[styles.windowChipText, window === w.key && styles.windowChipTextSelected]}
            >
              {w.label}
            </Text>
          </AnimatedChip>
        ))}
      </View>
      <Text style={styles.rangeHint}>{ranges[window]}</Text>

      <View style={styles.tileGrid}>
        <MetricTile label="Revenue" value={formatFee(active.revenue)} highlight />
        <MetricTile label="Booked" value={String(active.booked)} />
        <MetricTile label="Completed" value={String(active.completed)} />
        <MetricTile label="Cancelled" value={String(active.cancelled)} />
        <MetricTile label="No-show" value={String(active.noShow)} />
        <MetricTile label="Walk-ins" value={String(active.walkIns)} />
      </View>
    </View>
  );
}

function MetricTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.tile, highlight && styles.tileHighlighted]}>
      <Text style={[styles.tileValue, highlight && styles.tileValueHighlighted]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.tileLabel, highlight && styles.tileLabelHighlighted]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Revenue chart — plain Views (bar height ∝ revenue; sparse labels; h-scroll)
// ---------------------------------------------------------------------------

function RevenueChart({ series }: { series: { date: string; count: number; revenue: number }[] }) {
  const max = Math.max(...series.map((p) => p.revenue), 0);
  const labelStep = series.length <= 7 ? 1 : 5;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chartRow}
      >
        {series.map((point, index) => {
          const height =
            max > 0 && point.revenue > 0
              ? Math.max(BAR_MIN_HEIGHT, Math.round((point.revenue / max) * BAR_MAX_HEIGHT))
              : BAR_MIN_HEIGHT;
          const showLabel = index % labelStep === 0;
          return (
            <View key={point.date} style={styles.barColumn}>
              <View style={styles.barStack}>
                <View
                  style={[styles.bar, { height }, point.revenue === 0 && styles.barEmpty]}
                  accessibilityLabel={`${point.date}: ${formatFee(point.revenue)}, ${point.count} visits`}
                />
              </View>
              {showLabel ? (
                <Text style={styles.barLabel}>{formatDayMonth(point.date)}</Text>
              ) : (
                <Text style={styles.barLabelGhost}>·</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
      <Text style={styles.chartCaption}>
        {max > 0 ? `Peak day ${formatFee(max)}` : 'No completed visits in this window'} · completed
        visits only
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.base,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: spacing.base,
  },
  card: { gap: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  pickerRow: { gap: spacing.sm, paddingRight: spacing.sm },
  pickerEmpty: { ...typography.caption, color: colors.text.secondary },
  doctorChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  doctorChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipTextWrap: { maxWidth: 150, gap: 1 },
  chipName: { ...typography.captionSemi, color: colors.text.primary },
  chipNameSelected: { color: colors.interactive.selectedFg },
  chipSpec: { ...typography.micro, color: colors.text.secondary },
  chipSpecSelected: { color: colors.interactive.selectedFg },
  blockLoader: { paddingVertical: spacing.xl },
  summaryWrap: { gap: spacing.md },
  windowChips: { flexDirection: 'row', gap: spacing.sm },
  windowChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  windowChipText: { ...typography.captionSemi, color: colors.text.secondary },
  windowChipTextSelected: { color: colors.interactive.selectedFg },
  rangeHint: { ...typography.micro, color: colors.text.secondary },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 2,
  },
  tileHighlighted: {
    backgroundColor: colors.interactive.selectedBg,
    borderColor: colors.interactive.selectedBorder,
  },
  tileValue: { ...typography.h3, color: colors.text.primary },
  tileValueHighlighted: { color: colors.interactive.selectedFg },
  tileLabel: {
    ...typography.micro,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tileLabelHighlighted: { color: colors.interactive.selectedFg },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  daysChips: { flexDirection: 'row', gap: spacing.xs },
  daysChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  daysChipText: { ...typography.micro, color: colors.text.secondary },
  daysChipTextSelected: { color: colors.interactive.selectedFg },
  chartRow: { alignItems: 'flex-end', gap: BAR_GAP, paddingVertical: spacing.sm },
  barColumn: { width: BAR_WIDTH, alignItems: 'center', gap: 4 },
  barStack: { height: BAR_MAX_HEIGHT, justifyContent: 'flex-end' },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
    backgroundColor: colors.ctaGradient.end,
  },
  barEmpty: { backgroundColor: 'rgba(90, 107, 140, 0.30)' },
  // Deliberate override (Phase 10-c exception): 9px chart labels stay literal
  // — dense bar-chart captions must not grow to the 11px micro token.
  barLabel: { ...typography.micro, color: colors.text.secondary, fontSize: 9, lineHeight: 12 },
  barLabelGhost: { ...typography.micro, color: 'transparent', fontSize: 9, lineHeight: 12 },
  chartCaption: { ...typography.micro, color: colors.text.secondary },
  exportHint: { ...typography.caption, color: colors.text.secondary },
  rejectHint: { ...typography.caption, color: colors.text.secondary },
});
