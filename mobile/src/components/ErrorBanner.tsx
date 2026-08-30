import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

/** Translucent red-tinted banner for API-level errors (friendly English text). */
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.banner}>
      <Ionicons name="alert-circle" size={18} color={colors.destructive} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(226, 85, 85, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(226, 85, 85, 0.30)',
    borderRadius: radii.inner,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  text: {
    ...typography.caption,
    color: colors.destructive,
    flex: 1,
  },
});
