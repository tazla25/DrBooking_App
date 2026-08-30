import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radii, spacing, typography } from '@/theme';
import type { ReactNode } from 'react';

interface GlassHeaderProps {
  title: string;
  /** Show the circular glass back button (hidden when there is nothing to go back to). */
  back?: boolean;
  /** Right-side slot (e.g. a circular menu button). */
  right?: ReactNode;
}

/**
 * Translucent header: circular glass back button on the left, centered title.
 * Sits on the pastel gradient — no opaque bar.
 */
export function GlassHeader({ title, back = true, right }: GlassHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canGoBack = typeof router.canGoBack === 'function' ? router.canGoBack() : false;
  const showBack = back && canGoBack;

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {showBack ? (
            <TouchableOpacity
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.circle}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.side}>{right}</View>
      </View>
    </View>
  );
}

/** Circular translucent glass button used for back / menu / actions. */
export function GlassCircleButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.circle}
    >
      <Ionicons name={icon} size={20} color={colors.text.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: spacing.sm,
  },
  side: {
    minWidth: 44,
    alignItems: 'flex-start',
  },
  title: {
    ...typography.h2,
    color: colors.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: radii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
});
