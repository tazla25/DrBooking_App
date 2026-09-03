import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  auroraColors,
  auroraInteractive,
  auroraRadii,
  auroraSpacing,
  auroraStatus,
  auroraTints,
  auroraTypography,
} from '@/theme';

interface AuroraChipProps {
  children: ReactNode;
  onPress?: () => void;
  /** Selected state (the active date/schedule chip pair). */
  active?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Aurora pill chip (Phase 12, spec §3/§8) — the design's rounded-full chips:
 * quiet = surface-container-low with on-surface-variant text; active =
 * primary-container with on-primary text (the appointments screen's filter
 * pattern). Selection always looks identical app-wide (the interactive law).
 */
export function AuroraChip({
  children,
  onPress,
  active = false,
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  style,
}: AuroraChipProps) {
  const body = <View style={[styles.chip, active && styles.active, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

interface AuroraStatusChipProps {
  status: keyof typeof auroraStatus;
  label: string;
}

/**
 * Aurora status pill (spec §2 mapping) — uppercase label-sm on the
 * translucent status tint. The fg/bg pairs are gated in contrast-check.ts.
 */
export function AuroraStatusChip({ status, label }: AuroraStatusChipProps) {
  const s = auroraStatus[status] ?? auroraStatus.PENDING;
  return (
    <View style={[styles.statusChip, { backgroundColor: s.bg }]}>
      <Text style={[styles.statusText, { color: s.fg }]}>{label}</Text>
    </View>
  );
}

/** LIVE pill — the tertiary pulse-dot + "LIVE" label (identity card). */
export function AuroraLivePill({ label = 'LIVE' }: { label?: string }) {
  return (
    <View style={styles.livePill}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: auroraInteractive.quietBg,
    borderRadius: auroraRadii.pill,
    borderWidth: 1,
    borderColor: auroraColors.outlineVariant,
    paddingHorizontal: auroraSpacing.md,
    paddingVertical: auroraSpacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: auroraInteractive.selectedBg,
    borderColor: auroraInteractive.selectedBg,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  statusChip: {
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  statusText: {
    ...auroraTypography.labelSm,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xxs,
    backgroundColor: auroraTints.tertiary10,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.sm,
    paddingVertical: 2,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: auroraColors.tertiary,
  },
  liveText: {
    ...auroraTypography.labelSm,
    color: auroraColors.tertiary,
  },
});
