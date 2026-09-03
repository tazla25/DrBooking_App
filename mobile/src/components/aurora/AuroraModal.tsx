import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ReactNode } from 'react';
import {
  auroraColors,
  auroraGlass,
  auroraRadii,
  auroraShadows,
  auroraSpacing,
  auroraTypography,
} from '@/theme';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';

interface AuroraModalProps {
  visible: boolean;
  title?: string;
  /** Icon beside the modal title (the design's how_to_reg pattern). */
  titleIcon?: MaterialIconName;
  dismissable?: boolean;
  onClose?: () => void;
  children: ReactNode;
}

/**
 * Aurora glass sheet (Phase 12, spec §3 "modal panel") — near-opaque white
 * (.95) r22 panel with the indigo shadow-xl and a Material Symbol beside the
 * headline-sm title. Structure inherits the battle-tested GlassModal
 * mechanics VERBATIM (10-e bounded-scroll: capped cardWrap → flexShrink
 * panel → bounded ScrollView; 10-f gesture fix: the dismiss surface is a
 * sibling BELOW the panel, nothing Pressable above the scroll; box-none
 * centering) — only the visual tokens changed. The backdrop keeps the
 * existing BlurView + dim (the ONE sanctioned real blur, spec §7).
 */
export function AuroraModal({
  visible,
  title,
  titleIcon,
  dismissable = true,
  onClose,
  children,
}: AuroraModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissable ? onClose : undefined}
    >
      <View style={styles.backdropWrap}>
        <Pressable
          accessibilityLabel="Close dialog"
          style={styles.dismiss}
          onPress={() => {
            if (dismissable && onClose) onClose();
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centerWrap}
          pointerEvents="box-none"
        >
          <View style={styles.cardWrap}>
            <View style={styles.panel}>
              {title ? (
                <View style={styles.titleRow}>
                  {titleIcon ? (
                    <MaterialIcon name={titleIcon} size={20} color={auroraColors.primary} />
                  ) : null}
                  <Text style={styles.title}>{title}</Text>
                  {onClose && dismissable ? (
                    <Pressable
                      accessibilityLabel="Close dialog"
                      accessibilityRole="button"
                      onPress={onClose}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={({ pressed }) => [styles.closeBtn, pressed && styles.closePressed]}
                    >
                      <MaterialIcon name="close" size={18} color={auroraColors.onSurfaceVariant} />
                    </Pressable>
                  ) : null}
                </View>
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
  backdropWrap: { flex: 1, backgroundColor: auroraGlass.modalBackdrop },
  dismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: auroraSpacing.xl,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
  },
  panel: {
    flexShrink: 1,
    backgroundColor: auroraGlass.modalPanel,
    borderRadius: auroraRadii.card,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    ...auroraShadows.hero,
    padding: auroraSpacing.lg,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    gap: auroraSpacing.base,
    paddingBottom: auroraSpacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.xs,
    marginBottom: auroraSpacing.base,
  },
  title: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: auroraGlass.nested,
  },
  closePressed: {
    opacity: 0.7,
  },
});
