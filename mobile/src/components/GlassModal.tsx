import { Modal, Pressable, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';
import { GlassText } from './GlassText';
import { spacing } from '@/theme';

interface GlassModalProps {
  visible: boolean;
  title?: string;
  /** Disable backdrop-dismiss (e.g. while a mutation is in flight). */
  dismissable?: boolean;
  onClose?: () => void;
  children: ReactNode;
}

/**
 * Centered translucent glass sheet (RN Modal). Backdrop is a dim navy veil;
 * content is a GlassCard with optional title. Used for the booking confirm,
 * cancel confirm and feedback sheets.
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
      <Pressable
        accessibilityLabel="Close dialog"
        style={styles.backdrop}
        onPress={() => {
          if (dismissable && onClose) onClose();
        }}
      >
        <Pressable
          accessibilityLabel="Dialog"
          onPress={() => undefined} // swallow taps so the card never dismisses
          style={styles.cardWrap}
        >
          <GlassCard padded style={styles.card}>
            {title ? (
              <GlassText variant="h3" style={styles.title}>
                {title}
              </GlassText>
            ) : null}
            {children}
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(22, 33, 58, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    gap: spacing.base,
  },
  title: {
    textAlign: 'center',
  },
});
