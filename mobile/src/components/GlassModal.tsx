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
 * Centered glass sheet (RN Modal) — Phase 10-e bounded-scroll rewrite.
 *
 * The backdrop is a REAL blur: expo-blur BlurView (Android uses
 * experimentalBlurMethod="dimezisBlurView"; iOS uses the native blur) under a
 * 60% navy dim, so the screen behind a modal is blurred and NOT readable. The
 * panel itself is near-opaque white (92%, radius 22) with the standard glass
 * border and shadow, so modal text always sits on a readable surface.
 *
 * The 10-e fix (device report: "Add walk-in patient" / "New schedule" /
 * "Add compounder" panels clipped content mid-line, submit CTAs unreachable,
 * no scrolling): the height cap now lives on cardWrap (85% of the flex:1
 * backdrop) and the ScrollView became a BOUNDED flex child — flexGrow 0
 * (never stretch to fill) + flexShrink 1 (yield to the capped parent) — so it
 * always lays out against a definite content height and actually scrolls. The
 * panel carries flexShrink 1 so the cardWrap cap propagates into the panel
 * box (without it the panel overflows the capped wrapper and the ScrollView
 * stays unbounded — the old bug). The title stays pinned above the scroll;
 * children live inside the ScrollView with a base gap, so any amount of
 * content scrolls and every child (error banners, CTAs) stays reachable.
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
        {/* Dim + dismiss pressable above the blur. */}
        <Pressable
          accessibilityLabel="Close dialog"
          style={styles.backdrop}
          onPress={() => {
            if (dismissable && onClose) onClose();
          }}
        >
          {/* 10-e structure: KAV → capped cardWrap → panel → bounded
              ScrollView. iOS lifts the sheet above the keyboard via padding;
              Android relies on window resizing. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
          >
            <Pressable
              accessibilityLabel="Dialog"
              onPress={() => undefined} // swallow taps so the panel never dismisses
              style={styles.cardWrap}
            >
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
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropWrap: {
    flex: 1,
  },
  blur: StyleSheet.absoluteFill,
  backdrop: {
    flex: 1,
    backgroundColor: colors.modalBackdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  kav: {
    width: '100%',
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
