import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

type Tone = 'default' | 'destructive' | 'accent';

interface GlassButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: Tone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TONE_FG: Record<Tone, string> = {
  default: colors.text.primary,
  destructive: colors.destructive,
  accent: colors.status.PENDING.fg,
};

const TONE_BG: Record<Tone, string> = {
  default: colors.glass.chip,
  destructive: 'rgba(226, 85, 85, 0.14)',
  accent: 'rgba(245, 166, 35, 0.18)',
};

const TONE_BORDER: Record<Tone, string> = {
  default: colors.glass.border,
  destructive: 'rgba(226, 85, 85, 0.30)',
  accent: 'rgba(245, 166, 35, 0.35)',
};

/**
 * Translucent glass rounded-rect (radius 16) — secondary actions (logout,
 * links, dev tools). Phase 10-c: Pressable with a visible pressed state
 * (opacity 0.8) + an Android ripple clipped to the shape; disabled/loading
 * logic unchanged.
 */
export function GlassButton({
  label,
  onPress,
  icon,
  tone = 'default',
  disabled = false,
  style,
}: GlassButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: colors.ripple, borderless: false, foreground: true }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: TONE_BG[tone], borderColor: TONE_BORDER[tone] },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={TONE_FG[tone]} style={styles.icon} /> : null}
      <Text style={[styles.label, { color: TONE_FG[tone] }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radii.button,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    overflow: 'hidden', // ripple clips to the rounded shape
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
  icon: {},
  label: { ...typography.bodySemi },
});
