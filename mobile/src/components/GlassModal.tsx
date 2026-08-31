import { BlurView } from 'expo-blur';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
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
 * Centered glass sheet (RN Modal) — Phase 10 legibility pass.
 *
 * The backdrop is a REAL blur: expo-blur BlurView (Android uses
 * experimentalBlurMethod="dimezisBlurView"; iOS uses the native blur) under a
 * 60% navy dim, so the screen behind a modal is blurred and NOT readable —
 * the reported "walk-in modal shows the queue text behind it" case. The panel
 * itself is near-opaque white (92%, radius 22) with the standard glass border
 * and shadow, so modal text always sits on a readable surface. Used for the
 * booking confirm, cancel/no-show confirms, walk-in sheet and feedback sheets.
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
              {children}
            </View>
          </Pressable>
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
  cardWrap: {
    width: '100%',
    maxWidth: 420,
  },
  panel: {
    backgroundColor: colors.modalPanel,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.glass.border,
    ...colors.shadow.card,
    padding: spacing.lg,
    gap: spacing.base,
  },
  title: {
    textAlign: 'center',
  },
});
