import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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
  GlassScreen,
  GlassTextField,
} from '@/components';
import { useAuditLog } from '@/hooks/useAuditLog';
import { hapticSelection } from '@/lib/haptics';
import { AnimatedChip } from '@/components/motion';
import { AUDIT_ACTIONS, parseAuditDetail, type AuditLogEntry } from '@/lib/admin';
import { formatISTTimestamp } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * A3 — Audit tab: the append-only trail (newest first).
 *
 * Filters: action chips (All + the four known actions) and an optional exact
 * actorId text field. `actor` may be null (deleted user → "Unknown actor");
 * `detail` is the RAW JSON-encoded string — parsed defensively (try/catch,
 * raw string shown when it is not JSON). Load-more dedupes by id.
 */

const ACTION_META: Record<
  string,
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  DOCTOR_VERIFIED: {
    label: 'Doctor verified',
    color: colors.status.CONFIRMED.fg,
    bg: colors.status.CONFIRMED.bg,
    icon: 'shield-checkmark-outline',
  },
  DOCTOR_REJECTED: {
    label: 'Doctor rejected',
    color: colors.status.CANCELLED.fg,
    bg: colors.status.CANCELLED.bg,
    icon: 'close-circle-outline',
  },
  APPOINTMENT_CANCELLED: {
    label: 'Appointment cancelled',
    color: colors.status.PENDING.fg,
    bg: colors.status.PENDING.bg,
    icon: 'calendar-outline',
  },
  APPOINTMENT_NO_SHOW: {
    label: 'No-show recorded',
    color: colors.status.NO_SHOW.fg,
    bg: colors.status.NO_SHOW.bg,
    icon: 'eye-off-outline',
  },
};

const UNKNOWN_ACTION = {
  label: 'Unknown action',
  color: colors.text.secondary,
  bg: colors.glass.nested,
  icon: 'help-circle-outline' as const,
};

export default function AdminAuditScreen() {
  const [action, setAction] = useState<string | null>(null);
  const [userId, setUserId] = useState('');

  const list = useAuditLog(action, userId);

  return (
    <GlassScreen>
      <GlassHeader title="Audit Log" back={false} />
      <View style={styles.body}>
        {/* -- filters ---------------------------------------------------------- */}
        <View style={styles.filterWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <FilterChip label="All" active={action === null} onPress={() => setAction(null)} />
            {AUDIT_ACTIONS.map((a) => (
              <FilterChip key={a} label={a} active={action === a} onPress={() => setAction(a)} />
            ))}
          </ScrollView>
          <GlassTextField
            icon="person-outline"
            placeholder="Filter by exact actor id (optional)"
            value={userId}
            onChangeText={setUserId}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* -- list --------------------------------------------------------------- */}
        {list.error && list.items.length === 0 ? (
          <View style={styles.center}>
            <ErrorBanner message={list.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void list.refresh()}
            />
          </View>
        ) : list.loading && list.items.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : list.items.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              icon="documents-outline"
              title="No audit entries"
              caption={
                action || userId.trim()
                  ? 'Nothing matches these filters — try All.'
                  : 'Admin actions (verifications, cancellations) appear here.'
              }
              ctaLabel={action !== null ? 'Show all' : undefined}
              onCta={action !== null ? () => setAction(null) : undefined}
            />
          </View>
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(entry) => entry.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={list.refreshing}
                onRefresh={() => void list.refresh()}
                tintColor={colors.ctaGradient.end}
              />
            }
            onEndReached={() => void list.loadMore()}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <Text style={styles.counterText}>
                {list.total} entr{list.total === 1 ? 'y' : 'ies'}
              </Text>
            }
            ListFooterComponent={
              list.loadingMore ? (
                <ActivityIndicator color={colors.ctaGradient.end} style={styles.footer} />
              ) : list.complete ? (
                <Text style={styles.footerHint}>End of the trail</Text>
              ) : null
            }
            renderItem={({ item }) => <AuditRow entry={item} />}
          />
        )}
      </View>
    </GlassScreen>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <AnimatedChip
      active={active}
      bg={[colors.glass.chip, colors.interactive.selectedBg]}
      border={[colors.glass.border, colors.interactive.selectedBorder]}
      onPress={() => {
        if (!active) hapticSelection();
        onPress();
      }}
      accessibilityLabel={`Filter ${label}`}
      accessibilityState={{ selected: active }}
      style={styles.filterChip}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextSelected]}>{label}</Text>
    </AnimatedChip>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_META[entry.action] ?? UNKNOWN_ACTION;
  const detail = parseAuditDetail(entry.detail);
  const detailEntries = detail
    ? Object.entries(detail).filter(([, value]) => value !== null && value !== undefined)
    : [];

  return (
    <GlassCard padded style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.actionChip, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon} size={14} color={meta.color} />
          <Text style={[styles.actionChipText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.timestamp}>{formatISTTimestamp(entry.createdAt)}</Text>
      </View>

      <View style={styles.actorRow}>
        <Ionicons name="person-circle-outline" size={16} color={colors.text.secondary} />
        <Text style={styles.actorName} numberOfLines={1}>
          {entry.actor ? `${entry.actor.name} · ${roleLabel(entry.actor.role)}` : 'Unknown actor'}
        </Text>
      </View>
      {entry.actorId ? (
        <Text style={styles.actorId} numberOfLines={1}>
          {entry.actorId}
        </Text>
      ) : null}

      <Text style={styles.target} numberOfLines={1}>
        Target {entry.target}
      </Text>

      {entry.detail ? (
        detail ? (
          <View style={styles.detailWrap}>
            {detailEntries.slice(0, expanded ? undefined : 3).map(([key, value]) => (
              <Text key={key} style={styles.detailLine} numberOfLines={expanded ? undefined : 1}>
                {key}: {String(value)}
              </Text>
            ))}
            {detailEntries.length > 3 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setExpanded((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) => pressed && styles.detailTogglePressed}
              >
                <Text style={styles.detailToggle}>{expanded ? 'Less' : 'More'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          // Not JSON (or a JSON array/scalar) — show the raw string, truncated.
          <Text style={styles.detailLine} numberOfLines={expanded ? undefined : 2}>
            {entry.detail}
          </Text>
        )
      ) : null}
    </GlassCard>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Admin';
    case 'DOCTOR':
      return 'Doctor';
    case 'COMPOUNDER':
      return 'Compounder';
    case 'PATIENT':
      return 'Patient';
    default:
      return role;
  }
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
    gap: spacing.base,
  },
  filterWrap: { padding: spacing.base, gap: spacing.sm },
  chipRow: { gap: spacing.sm, paddingRight: spacing.sm, paddingBottom: spacing.xs },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  filterChipText: { ...typography.captionSemi, color: colors.text.secondary },
  filterChipTextSelected: { color: colors.interactive.selectedFg },
  detailTogglePressed: { opacity: 0.6 },
  listContent: {
    padding: spacing.base,
    paddingTop: spacing.sm,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: spacing.base,
  },
  counterText: {
    ...typography.captionSemi,
    color: colors.text.secondary,
    marginBottom: -spacing.xs,
  },
  card: { gap: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  actionChipText: { ...typography.micro, letterSpacing: 0.3 },
  timestamp: {
    ...typography.micro,
    color: colors.text.secondary,
    flexShrink: 1,
    textAlign: 'right',
  },
  actorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actorName: { ...typography.bodySemi, color: colors.text.primary, flexShrink: 1 },
  actorId: {
    ...typography.micro,
    color: colors.text.secondary,
    paddingLeft: spacing.base + spacing.sm,
  },
  target: { ...typography.caption, color: colors.text.secondary },
  detailWrap: { gap: 2 },
  detailLine: { ...typography.caption, color: colors.text.secondary },
  detailToggle: { ...typography.captionSemi, color: colors.ctaGradient.end },
  footer: { marginTop: spacing.base },
  footerHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.base,
  },
});
