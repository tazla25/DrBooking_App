import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  auroraColors,
  auroraGlass,
  auroraRadii,
  auroraShadows,
  auroraSpacing,
  auroraTypography,
} from '@/theme';
import { Avatar } from '../Avatar';
import { MaterialIcon } from './MaterialIcon';

interface AuroraHeaderProps {
  /** Brand wordmark (the app name next to the logo mark). */
  brand?: string;
  /** Screen-context label on the right (e.g. "Staff Console"). */
  context?: string;
  /** Show the glass back circle (stack screens). */
  back?: boolean;
  /** Right-side slot (overrides context when provided). */
  right?: ReactNode;
  /** Logged-in user's name (drives the avatar initials). */
  userName?: string;
}

/**
 * Aurora fixed chrome header (Phase 12, spec §8.1) — the Stitch design's
 * app-wide bar: logo mark + wordmark (headline-sm) on the left, context
 * label + avatar on the right, hairline glass surface (white .70) with the
 * soft 0-1-8 shadow. h-64px tall (h-16 in the design).
 *
 * The design's location chip is OMITTED by design (documented deviation):
 * the app has no location feature or city data — rendering a fake
 * "Bengaluru, KA" chip would mislead real users. Restoring it requires a
 * data-model decision (Phase 13 candidate).
 *
 * `back` renders the design's inner-screen pattern (arrow_back circle +
 * wordmark) for stack screens; the avatar falls back to the context slot.
 */
export function AuroraHeader({
  brand = 'DrBooking',
  context,
  back = false,
  right,
  userName,
}: AuroraHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canGoBack = typeof router.canGoBack === 'function' ? router.canGoBack() : false;
  const showBack = back && canGoBack;

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {showBack ? (
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.circle, pressed && styles.circlePressed]}
            >
              <MaterialIcon name="arrow_back" size={20} color={auroraColors.onSurface} />
            </Pressable>
          ) : (
            <View style={styles.logoTile}>
              <MaterialIcon name="medical_services" size={20} color={auroraColors.primary} />
            </View>
          )}
          <Text style={styles.brand}>{brand}</Text>
        </View>
        <View style={styles.right}>
          {right ?? (context ? <Text style={styles.context}>{context}</Text> : null)}
          {userName ? <Avatar name={userName} size={32} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: auroraGlass.header,
    borderBottomWidth: 1,
    borderBottomColor: auroraGlass.hairline,
    ...auroraShadows.header,
    zIndex: 50,
  },
  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: auroraSpacing.base,
    gap: auroraSpacing.sm,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xs,
    flexShrink: 1,
  },
  logoTile: {
    width: 32,
    height: 32,
    borderRadius: auroraRadii.tile,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraGlass.nested,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
  },
  brand: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xs,
  },
  context: {
    ...auroraTypography.labelSm,
    color: auroraColors.onSurfaceVariant,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: auroraRadii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraGlass.nested,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
  },
  circlePressed: {
    opacity: 0.8,
  },
});
