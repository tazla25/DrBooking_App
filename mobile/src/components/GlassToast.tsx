import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

// ---------------------------------------------------------------------------
// useToast — tiny in-house toast (no extra dependency). Auto-hides after 2.6s.
// ---------------------------------------------------------------------------

export interface ToastState {
  visible: boolean;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export function useToast(durationMs = 2600) {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    tone: 'info',
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = (message: string, tone: ToastState['tone'] = 'info') => {
    const id = ++seq.current;
    setToast({ visible: true, message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // A newer toast may already be showing — only hide our own.
      if (id === seq.current) setToast((t) => ({ ...t, visible: false }));
    }, durationMs);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setToast((t) => ({ ...t, visible: false }));
  };

  return { toast, show, hide };
}

// ---------------------------------------------------------------------------
// GlassToast — translucent pill pinned to the bottom of the screen.
// Render it as the LAST child of a screen; it overlays without layout impact.
// ---------------------------------------------------------------------------

const TONE_META = {
  info: { icon: 'information-circle', color: colors.status.CALLED.fg },
  success: { icon: 'checkmark-circle', color: colors.success },
  error: { icon: 'alert-circle', color: colors.destructive },
} as const;

export function GlassToast({ toast }: { toast: ToastState }) {
  if (!toast.visible || !toast.message) return null;
  const meta = TONE_META[toast.tone] ?? TONE_META.info;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={19} color={meta.color} />
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: spacing.xxxl,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.base,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 480,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: 1,
    borderColor: colors.glass.border,
    borderRadius: radii.button, // floating panel — rounded-rect per the Phase 10 radius law
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...colors.shadow.card,
  },
  text: {
    ...typography.captionSemi,
    color: colors.text.primary,
    flexShrink: 1,
  },
});
