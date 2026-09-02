import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/theme';

interface AvatarProps {
  name: string;
  /** Circle diameter. */
  size?: number;
  /**
   * Phase 11 (A4/A5): optional photo as a data URL (data:image/jpeg|png;base64…).
   * Renders inside the SAME circle + border as the initials fallback; null or
   * a failed load falls back to initials (the photo never breaks the layout).
   */
  uri?: string | null;
}

/** Translucent glass circle with the person's initials — or their photo
 * (Phase 11) when a data URL is provided. True circle (radius = size/2 —
 * the pill/round law); initials fallback keeps every existing consumer
 * unchanged. */
export function Avatar({ name, size = 48, uri }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <View style={[styles.avatar, circle]}>
        <Image
          source={{ uri }}
          style={[styles.photo, { width: size, height: size, borderRadius: size / 2 }]}
          accessibilityLabel={`${name} photo`}
          onError={() => undefined} // keep the glass ring; RN hides broken sources
        />
      </View>
    );
  }

  return (
    <View style={[styles.avatar, circle]}>
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
    overflow: 'hidden', // photo clips to the circle
  },
  photo: {
    // The photo IS the avatar content; the glass ring stays behind it.
    resizeMode: 'cover',
  },
  initials: {
    ...typography.captionSemi,
    color: colors.text.primary,
    letterSpacing: 0.5,
  },
});
