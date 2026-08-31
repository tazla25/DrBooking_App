import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

interface NavyButtonProps {
  label: string;
  onPress: () => void;
  /** Ionicons name shown before the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Dark navy pill (#16213A) with white text — compact secondary action.
 * Phase 10-c: Pressable with a visible pressed state (opacity 0.85).
 */
export function NavyButton({ label, onPress, icon, disabled = false, style }: NavyButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={colors.white} style={styles.icon} /> : null}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radii.button,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.xl,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.55,
  },
  icon: {},
  label: {
    ...typography.bodySemi,
    color: colors.text.onDark,
    letterSpacing: 0.2,
  },
});
