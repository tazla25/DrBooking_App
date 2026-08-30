import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

interface NavyButtonProps {
  label: string;
  onPress: () => void;
  /** Ionicons name shown before the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: ViewStyle;
}

/** Dark navy pill (#16213A) with white text — compact secondary action. */
export function NavyButton({ label, onPress, icon, disabled = false, style }: NavyButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.button, disabled && styles.disabled, style]}
    >
      {icon ? <Ionicons name={icon} size={17} color={colors.white} style={styles.icon} /> : null}
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.xl,
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
