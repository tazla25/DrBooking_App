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
 * Translucent white glass panel: 50% white alpha, radius 24, 1px white border,
 * soft navy shadow (rgba(23,38,74,0.12) blur 24).
 * `nested` renders the inner-variant panel (32% alpha, radius 16).
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
    ...colors.shadow.card,
  },
  nested: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  padded: {
    padding: spacing.lg,
  },
});
