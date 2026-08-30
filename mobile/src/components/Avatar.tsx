import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/theme';

interface AvatarProps {
  name: string;
  /** Circle diameter. */
  size?: number;
}

/** Translucent glass circle with the person's initials (no photos in the API). */
export function Avatar({ name, size = 48 }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: Math.max(13, size * 0.34) }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  initials: {
    ...typography.captionSemi,
    color: colors.text.primary,
    letterSpacing: 0.5,
  },
});
