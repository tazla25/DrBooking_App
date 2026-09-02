import { BlurView } from 'expo-blur';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { ReactNode } from 'react';
import { GlassText } from './GlassText';
import { colors, radii, spacing } from '@/theme';

interface GlassModalProps {
  visible: boolean;
  title?: string;
  /** Disable backdrop-dismiss (e.g. while a mutation is in flight). */
  dismissable?: boolean;
  onClose?: () => void;
  children: ReactNode;
}

/**
 * Centered glass sheet (RN Modal) — Phase 10-e bounded-scroll rewrite +
 * Phase 10-f gesture fix.
 *
 * The backdrop is a REAL blur: expo-blur BlurView (Android uses
 * experimentalBlurMethod="dimezisBlurView"; iOS uses the native blur) under a
 * 60% navy dim, so the screen behind a modal is blurred and NOT readable. The
 * panel itself is near-opaque white (92%, radius 22) with the standard glass
 * border and shadow, so modal text always sits on a readable surface.
 *
 * The 10-e fix (device report: "Add walk-in patient" / "New schedule" /
 * "Add compounder" panels clipped content mid-line, submit CTAs unreachable,
 * no scrolling): the height cap lives on cardWrap (85% of the flex:1
 * backdrop) and the ScrollView is a BOUNDED flex child — flexGrow 0 (never
 * stretch to fill) + flexShrink 1 (yield to the capped parent) — so it
 * always lays out against a definite content height and actually scrolls. The
 * panel carries flexShrink 1 so the cardWrap cap propagates into the panel
 * box; the title stays pinned above the scroll; children live inside the
 * ScrollView with a base gap, so any amount of content scrolls and every
 * child (error banners, CTAs) stays reachable.
 *
 * The 10-f fix (follow-up device report: the scroll gesture is sticky — it
 * only starts from some spots): the dim+dismiss surface is a SIBLING BELOW
 * the panel, and NOTHING Pressable sits above the ScrollView. The old tree
 * had TWO nested Pressables above the panel (the backdrop wrapper itself +
 * a noop "swallow" wrapper around the card); on Android's new architecture a
 * drag starting inside those JS Pressables must win a responder negotiation
 * on move — with that nesting the handoff to the native ScrollView was
 * unreliable, so the owner had to tap around to find a draggable point. Now
 * a drag that starts anywhere on the scroll content reaches the ScrollView
 * directly; taps on the empty space around the panel still dismiss (the
 * centering wrapper is pointerEvents="box-none", so those taps fall through
 * to the dismiss layer); dismissable={false} still blocks backdrop dismiss
 * (the temp-password sheet); the 10-e bounded-scroll mechanics are untouched.
 */
export function GlassModal({
  visible,
  title,
  dismissable = true,
  onClose,
  children,
}: GlassModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissable ? onClose : undefined}
    >
      <View style={styles.backdropWrap}>
        {/* Blur first (bottom layer, never intercepts touches). */}
        <BlurView
          intensity={50}
          tint="light"
          experimentalBlurMethod={
            Platform.select({ android: 'dimezisBlurView', default: undefined }) ?? undefined
          }
          style={styles.blur}
        />
        {/* Dim + dismiss surface — a SIBLING BELOW the panel (10-f). The dim
            token lives here so the backdrop looks identical; the panel above
            keeps its own touches. */}
        <Pressable
          accessibilityLabel="Close dialog"
          style={styles.dismiss}
          onPress={() => {
            if (dismissable && onClose) onClose();
          }}
        />
        {/* 10-e structure: KAV → capped cardWrap → panel → bounded
            ScrollView. iOS lifts the sheet above the keyboard via padding;
            Android relies on window resizing. box-none lets taps on the
            empty space fall through to the dismiss layer under the blur. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centerWrap}
          pointerEvents="box-none"
        >
          <View style={styles.cardWrap}>
            <View style={styles.panel}>
              {title ? (
                <GlassText variant="h3" style={styles.title}>
                  {title}
                </GlassText>
              ) : null}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                bounces={false}
              >
                {children}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: {
    flex: 1,
  },
  blur: StyleSheet.absoluteFill,
  dismiss: {
    // Full-screen dismiss surface BELOW the panel (10-f): absolute-fill with
    // the dim token, so the blurred backdrop stays dimmed exactly as before.
    // (Written out longhand — this SDK's StyleSheet types export only the
    // opaque `absoluteFill` registered style, not the spreadable object.)
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.modalBackdrop,
  },
  centerWrap: {
    // Centers the capped card; pointerEvents="box-none" is set on the KAV so
    // taps on the empty space reach the dismiss layer below (10-f).
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 420,
    // The height cap — resolves against the flex:1 backdrop above.
    maxHeight: '85%',
  },
  panel: {
    // Shrinks into the cardWrap cap so the ScrollView below receives a
    // bounded content box (the missing piece of the 10-f/10-g version).
    flexShrink: 1,
    backgroundColor: colors.modalPanel,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.glass.border,
    ...colors.shadow.card,
    padding: spacing.lg,
  },
  scroll: {
    // THE 10-e FIX: never stretch (flexGrow 0), always yield to the cap
    // (flexShrink 1) — a constrained ScrollView actually scrolls.
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    // The panel's old body gap moved here: children live inside the scroll.
    gap: spacing.base,
    paddingBottom: spacing.xs,
  },
  title: {
    textAlign: 'center',
    // Keeps the old panel-gap rhythm between the pinned title and the body.
    marginBottom: spacing.base,
  },
});
