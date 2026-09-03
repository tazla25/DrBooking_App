import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { auroraColors, auroraTypography } from '@/theme';
import { GlassCardV2 } from './GlassCardV2';

interface MetricTileProps {
  label: string;
  value: number | string;
  /** Small caption under the value (e.g. "Booked"). */
  caption: string;
  /** Accent role for the value + caption (spec §8.3). */
  tone?: 'primary' | 'secondary' | 'tertiary' | 'tertiaryDim' | 'error' | 'muted';
  style?: StyleProp<ViewStyle>;
}

function toneColor(tone: NonNullable<MetricTileProps['tone']>): string {
  switch (tone) {
    case 'primary':
      return auroraColors.primary;
    case 'secondary':
      return auroraColors.onSecondaryContainer;
    case 'tertiary':
      return auroraColors.tertiary;
    case 'tertiaryDim':
      return auroraColors.onTertiaryFixedVariant;
    case 'error':
      return auroraColors.error;
    default:
      return auroraColors.onSurfaceVariant;
  }
}

/**
 * Aurora metric tile (Phase 12, spec §8.3) — the design's bento glass stat:
 * label (body-sm on-surface-variant) over a bold colored headline-md value
 * over a tiny label-sm caption. Sits in a `tile` glass card.
 */
export function MetricTile({ label, value, caption, tone = 'primary', style }: MetricTileProps) {
  const color = toneColor(tone);
  return (
    <GlassCardV2 tier="tile" style={[styles.tile, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={[styles.caption, { color }]}>{caption}</Text>
    </GlassCardV2>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexBasis: '31%',
    flexGrow: 1,
  },
  label: {
    ...auroraTypography.bodySm,
    color: auroraColors.onSurfaceVariant,
  },
  value: {
    ...auroraTypography.headlineMd,
    fontWeight: '700',
    marginTop: 2,
  },
  caption: {
    ...auroraTypography.labelSm,
  },
});
