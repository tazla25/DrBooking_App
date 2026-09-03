import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  auroraColors,
  auroraGlass,
  auroraGradients,
  auroraRadii,
  auroraShadows,
  auroraSpacing,
  auroraTypography,
} from '@/theme';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';

export type AuroraButtonVariant =
  | 'gradient' // primary → secondary capsule CTA (submit-style)
  | 'primary' // solid primary, on-primary text (row Call pill)
  | 'white' // white pill, primary text (Call-next on the banner)
  | 'tertiary' // solid tertiary, on-tertiary (Mark Completed)
  | 'neutral' // surface-variant, on-surface-variant (secondary action)
  | 'glass' // white/80 glass tile with primary text (quick actions)
  | 'danger' // error-container tint with on-error-container text (Reject/Cancel)
  | 'onDark'; // white/20 over the gradient banner, on-primary text (chips)

interface AuroraButtonProps {
  label: string;
  onPress: () => void;
  /** Material Symbols name rendered before the label. */
  icon?: MaterialIconName;
  variant?: AuroraButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Destructive tone alias — maps to the danger variant. */
  tone?: 'default' | 'destructive';
  style?: StyleProp<ViewStyle>;
}

/**
 * Aurora capsule CTA (Phase 12, spec §3/§8) — the Stitch design's button
 * language: TRUE PILLS (r999; an intentional, documented departure from the
 * Phase-10 rounded-rect law), label text, leading Material Symbol, pressed
 * feedback (scale 0.98 + opacity), loading + disabled states.
 *
 * Variants map 1:1 to the design's buttons: the gradient submit capsule
 * ("Generate token…"), the solid primary row pill ("Call"), the white
 * Call-next pill on the banner, the tertiary "Mark Completed" capsule, the
 * neutral secondary, the glass quick-action tile and the danger tint for
 * destructive confirms.
 */
export function AuroraButton({
  label,
  onPress,
  icon,
  variant,
  loading = false,
  disabled = false,
  tone,
  style,
}: AuroraButtonProps) {
  const resolved: AuroraButtonVariant = variant ?? (tone === 'destructive' ? 'danger' : 'gradient');
  const inactive = disabled || loading;

  const isGradient = resolved === 'gradient';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {isGradient ? (
        <LinearGradient
          colors={auroraGradients.cta}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientBody}
        >
          {loading ? (
            <ActivityIndicator color={auroraColors.onPrimary} />
          ) : (
            <>
              {icon ? <MaterialIcon name={icon} size={18} color={auroraColors.onPrimary} /> : null}
              <Text style={[styles.label, { color: auroraColors.onPrimary }]}>{label}</Text>
            </>
          )}
        </LinearGradient>
      ) : (
        <View style={[variantBody(resolved), styles.body]}>
          {loading ? (
            <ActivityIndicator color={variantFg(resolved)} />
          ) : (
            <>
              {icon ? <MaterialIcon name={icon} size={18} color={variantFg(resolved)} /> : null}
              <Text style={[styles.label, { color: variantFg(resolved) }]}>{label}</Text>
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

function variantFg(variant: AuroraButtonVariant): string {
  switch (variant) {
    case 'primary':
      return auroraColors.onPrimary;
    case 'white':
      return auroraColors.primary;
    case 'tertiary':
      return auroraColors.onTertiary;
    case 'neutral':
      return auroraColors.onSurfaceVariant;
    case 'glass':
      return auroraColors.primary;
    case 'danger':
      return auroraColors.onErrorContainer;
    case 'onDark':
      return auroraColors.onPrimary;
    default:
      return auroraColors.onPrimary;
  }
}

function variantBody(variant: AuroraButtonVariant): StyleProp<ViewStyle> {
  switch (variant) {
    case 'primary':
      return styles.primaryBody;
    case 'white':
      return styles.whiteBody;
    case 'tertiary':
      return styles.tertiaryBody;
    case 'neutral':
      return styles.neutralBody;
    case 'glass':
      return styles.glassBody;
    case 'danger':
      return styles.dangerBody;
    case 'onDark':
      return styles.onDarkBody;
    default:
      return {};
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: auroraRadii.pill,
    alignSelf: 'stretch',
    ...auroraShadows.cta,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  disabled: {
    opacity: 0.55,
  },
  gradientBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: auroraSpacing.sm,
    minHeight: 46,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.lg,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: auroraSpacing.xs,
    minHeight: 44,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.lg,
  },
  primaryBody: {
    backgroundColor: auroraColors.primary,
  },
  whiteBody: {
    backgroundColor: auroraColors.surfaceContainerLowest,
    minHeight: 50,
  },
  tertiaryBody: {
    backgroundColor: auroraColors.tertiary,
  },
  neutralBody: {
    backgroundColor: auroraColors.surfaceVariant,
    ...auroraShadows.tile,
  },
  glassBody: {
    backgroundColor: auroraGlass.tile,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    minHeight: 48,
    borderRadius: auroraRadii.tile,
    ...auroraShadows.tile,
  },
  dangerBody: {
    backgroundColor: auroraColors.errorContainer,
  },
  onDarkBody: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  label: {
    ...auroraTypography.labelMd,
    textAlign: 'center',
  },
});
