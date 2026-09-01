import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@/theme';

interface GlassCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Inner translucent panel — for sections nested inside a card. */
  nested?: boolean;
  /** Apply the standard content padding (lg). */
  padded?: boolean;
}

/**
 * Translucent white glass panel (Phase 10 glass band: card alpha .34 / nested
 * .18 from tokens, radius card 22 / inner 16, 1px white border, soft navy
 * shadow). `nested` renders the inner-variant panel.
 *
 * Phase 10-b FIX A: both variants set overflow:'hidden' — Android does NOT
 * clip children to a parent's borderRadius by default, so chips, strips,
 * switches and scroll content could paint over the rounded corners.
 */
export function GlassCard({ children, style, nested = false, padded = false }: GlassCardProps) {
  return (
    <View style={[nested ? styles.nested : styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.glass.border,
    overflow: 'hidden', // FIX A: children clip to the rounded shape (Android)
    ...colors.shadow.card,
  },
  nested: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    overflow: 'hidden', // FIX A: nested panels clip too
  },
  padded: {
    padding: spacing.lg,
  },
});
