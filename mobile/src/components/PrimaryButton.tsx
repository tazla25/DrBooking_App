import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  /** Ionicons name shown before the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * Primary CTA — full-radius pill with the light-blue gradient
 * (#6EC1F5 → #4D9FDE), white semibold text and a soft blue glow shadow.
 * Pressed / loading / disabled states included.
 */
export function PrimaryButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
}: PrimaryButtonProps) {
  const inactive = disabled || loading;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      activeOpacity={0.85}
      style={inactive ? styles.disabledWrap : styles.wrap}
    >
      <LinearGradient
        colors={
          inactive ? ['#B9D8EF', '#B9D8EF'] : [colors.ctaGradient.start, colors.ctaGradient.end]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            {icon ? (
              <Ionicons name={icon} size={19} color={colors.white} style={styles.icon} />
            ) : null}
            <Text style={styles.label}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.pill,
    ...colors.shadow.ctaGlow,
  },
  disabledWrap: {
    borderRadius: radii.pill,
    opacity: 0.65,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
  },
  icon: {},
  label: {
    ...typography.bodySemi,
    color: colors.text.inverted,
    letterSpacing: 0.2,
  },
});
