import { useEffect, useRef, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, radii } from '@/theme';

/**
 * Motion primitives (Phase 10-c) — react-native-reanimated wrappers shared by
 * the screens. NOT re-exported from the components barrel on purpose: the
 * jest suites never import reanimated, keeping the test graph animation-free.
 *
 *  - AnimatedEntrance: list-card entrance (fade + 12px rise, 220ms, staggered
 *    across the first 6 items).
 *  - AnimatedChip: selection chip with a 120ms background/border crossfade,
 *    an Android ripple and a pressed state.
 *  - useChangePulse + PulseView: a one-shot ~600ms accent tint that flags a
 *    LIVE data change (now-serving token, the "You" row, a queue row that
 *    just became CALLED).
 *
 * Every primitive respects the system Reduce Motion setting (Reanimated's
 * useReducedMotion / ReduceMotion.System) — reduced motion renders settled
 * states with no movement.
 */

const ENTRANCE_DURATION_MS = 220;
const ENTRANCE_OFFSET = 12; // translateY 12 → 0
const ENTRANCE_STAGGER_MS = 40;
const MAX_STAGGERED_ITEMS = 6;
const CHIP_CROSSFADE_MS = 120;
const PULSE_IN_MS = 300;
const PULSE_OUT_MS = 300;

// ---------------------------------------------------------------------------
// AnimatedEntrance
// ---------------------------------------------------------------------------

interface AnimatedEntranceProps {
  /** Position in the list — drives the stagger (capped at 6 items). */
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Card entrance: fade + translateY(12→0) over 220ms, staggered per index. */
export function AnimatedEntrance({ index = 0, style, children }: AnimatedEntranceProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return; // Reduce Motion: render settled, never animate
    const stagger = Math.min(index, MAX_STAGGERED_ITEMS - 1) * ENTRANCE_STAGGER_MS;
    progress.value = withDelay(
      stagger,
      withTiming(1, { duration: ENTRANCE_DURATION_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: ENTRANCE_OFFSET * (1 - progress.value) }],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// AnimatedChip
// ---------------------------------------------------------------------------

interface AnimatedChipProps {
  active: boolean;
  /** Background crossfade pair: [inactive, active]. */
  bg: readonly [string, string];
  /** Border crossfade pair: [inactive, active]. */
  border: readonly [string, string];
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  /** Corner radius (chip law: 12 by default). */
  radius?: number;
  /** Structural styles (padding, minWidth, layout) — colors belong to bg/border. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Selection chip — 120ms background/border crossfade when `active` flips, an
 * Android ripple (clipped to the radius) and a pressed dim. The text color
 * swap stays instant: only the surface crossfades.
 */
export function AnimatedChip({
  active,
  bg,
  border,
  onPress,
  accessibilityLabel,
  accessibilityState,
  radius = radii.chip,
  style,
  children,
}: AnimatedChipProps) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: CHIP_CROSSFADE_MS,
      reduceMotion: ReduceMotion.System,
    });
  }, [active, progress]);

  const surface = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [bg[0], bg[1]]),
    borderColor: interpolateColor(progress.value, [0, 1], [border[0], border[1]]),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      android_ripple={{ color: colors.ripple, borderless: false, foreground: true }}
      style={({ pressed }) => [
        { borderRadius: radius, overflow: 'hidden' },
        pressed && chipPressed,
      ]}
    >
      <Animated.View style={[chipSurface, { borderRadius: radius }, surface, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const chipSurface: ViewStyle = { borderWidth: 1 };
const chipPressed: ViewStyle = { opacity: 0.9 };

// ---------------------------------------------------------------------------
// useChangePulse + PulseView
// ---------------------------------------------------------------------------

/**
 * One-shot accent pulse whenever `trigger` CHANGES after the first real value
 * arrives (the initial data load never pulses — only live changes do), while
 * `active` is true. Use `active` to scope the pulse, e.g. pulse only on
 * transitions TO CALLED: useChangePulse(status, status === 'CALLED').
 */
export function useChangePulse(trigger: unknown, active: boolean): SharedValue<number> {
  const pulse = useSharedValue(0);
  const previous = useRef<unknown>(undefined);

  useEffect(() => {
    const prev = previous.current;
    previous.current = trigger;
    if (prev === undefined || prev === null) return; // first value = load, not a change
    if (prev === trigger) return; // no change
    if (!active) return; // scoped out (e.g. not the transition we track)
    pulse.value = withSequence(
      withTiming(1, { duration: PULSE_IN_MS, reduceMotion: ReduceMotion.System }),
      withTiming(0, { duration: PULSE_OUT_MS, reduceMotion: ReduceMotion.System }),
    );
  }, [active, pulse, trigger]);

  return pulse;
}

interface PulseViewProps {
  /** The shared value returned by useChangePulse. */
  pulse: SharedValue<number>;
  /** Overlay tint pair [resting, peak] — defaults to the CALLED-blue tint. */
  tint?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
}

/**
 * Absolutely-positioned tint layer (~600ms in+out). Render it as the FIRST
 * child inside a GlassCard — the card's overflow:'hidden' clips the tint to
 * the rounded shape. pointerEvents none: purely decorative.
 */
export function PulseView({
  pulse,
  tint = ['rgba(77, 159, 222, 0)', 'rgba(77, 159, 222, 0.18)'],
  style,
}: PulseViewProps) {
  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pulse.value, [0, 1], [tint[0], tint[1]]),
  }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, animated, style]} />;
}
