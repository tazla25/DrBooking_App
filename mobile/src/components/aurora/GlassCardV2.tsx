import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { auroraGlass, auroraRadii, auroraShadows, auroraSpacing } from '@/theme';

export type GlassCardV2Tier = 'card' | 'tile' | 'hero' | 'nested' | 'nestedSoft';

interface GlassCardV2Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Glass tier (spec §3): card (white .80, r22) · tile (.70, r16) ·
   * hero (.90, r22) · nested (surface-low .60, r12) · nestedSoft (.40). */
  tier?: GlassCardV2Tier;
  /** Apply the standard card content padding (lg = 20, spec §5). */
  padded?: boolean;
}

/**
 * Frosted acrylic glass panel — the Aurora card (Phase 12, spec §3).
 *
 * Tiers mirror the Stitch recipes: standard content cards are white at .80
 * over the aurora canvas with the 1px hairline and a soft indigo shadow;
 * tiles are quieter (.70, r16); the hero tier emphasizes the chamber-style
 * card (.90, stronger shadow + an optional decorative orb passed by the
 * screen); nested rows sit ON a card as surface-container-low tint (the
 * design's `bg-surface-container-low/60` inner rows).
 *
 * Android note (inherited law): overflow:'hidden' clips children to the
 * rounded shape — Android does not clip to borderRadius by default.
 * Blur budget (spec §7): rgba-only glass, NO BlurView here by design.
 */
export function GlassCardV2({ children, style, tier = 'card', padded = false }: GlassCardV2Props) {
  return <View style={[tierStyle(tier), padded && styles.padded, style]}>{children}</View>;
}

function tierStyle(tier: GlassCardV2Tier): StyleProp<ViewStyle> {
  switch (tier) {
    case 'tile':
      return styles.tile;
    case 'hero':
      return styles.hero;
    case 'nested':
      return styles.nested;
    case 'nestedSoft':
      return styles.nestedSoft;
    default:
      return styles.card;
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: auroraGlass.card,
    borderRadius: auroraRadii.card,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    overflow: 'hidden',
    ...auroraShadows.card,
  },
  tile: {
    backgroundColor: auroraGlass.tile,
    borderRadius: auroraRadii.tile,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    overflow: 'hidden',
    ...auroraShadows.tile,
  },
  hero: {
    backgroundColor: auroraGlass.hero,
    borderRadius: auroraRadii.card,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    overflow: 'hidden',
    ...auroraShadows.hero,
  },
  nested: {
    backgroundColor: auroraGlass.nested,
    borderRadius: auroraRadii.field,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    overflow: 'hidden',
  },
  nestedSoft: {
    backgroundColor: auroraGlass.nestedSoft,
    borderRadius: auroraRadii.field,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    overflow: 'hidden',
  },
  padded: {
    padding: auroraSpacing.lg,
  },
});
