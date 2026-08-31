import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassCircleButton,
  GlassHeader,
  GlassModal,
  GlassScreen,
  GlassText,
  GlassTextField,
  NavyButton,
  PrimaryButton,
  StatusChip,
} from '@/components';
import { AnimatedChip, AnimatedEntrance, PulseView, useChangePulse } from '@/components/motion';
import { hapticSelection, hapticSuccess, hapticWarning } from '@/lib/haptics';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * DEV-ONLY design-system demo — renders the entire Glass kit so the visual
 * system can be reviewed on one screen. Never reachable in production builds.
 */
export default function DemoScreen() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [demoChipActive, setDemoChipActive] = useState(false);
  const [demoPulseTick, setDemoPulseTick] = useState(0);
  const demoPulse = useChangePulse(demoPulseTick, true);

  if (!__DEV__) {
    // Production safety net: bounce out if this route is somehow hit.
    router.replace('/login');
    return null;
  }

  return (
    <GlassScreen>
      <GlassHeader
        title="Design System"
        right={
          <GlassCircleButton
            icon="close-outline"
            accessibilityLabel="Close demo"
            onPress={() => router.back()}
          />
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <DemoSection title="Typography">
          <GlassText variant="display">Display · 34</GlassText>
          <GlassText variant="h1">Heading 1 · 28</GlassText>
          <GlassText variant="h2">Heading 2 · 20</GlassText>
          <GlassText variant="h3">Heading 3 · 17</GlassText>
          <GlassText>Body · 16 — the quick brown fox jumps</GlassText>
          <GlassText variant="caption" color={colors.text.secondary}>
            Caption · 13 — secondary gray-blue text
          </GlassText>
        </DemoSection>

        <DemoSection title="Interaction feel">
          <GlassCard padded>
            <GlassText variant="caption" color={colors.text.secondary}>
              Every tappable list/content surface: Android ripple (rgba(23,38,74,0.18), clipped to
              the radius) + pressed dim 0.9. Buttons: pressed dim 0.8 or press-scale 0.98. Chips:
              120ms background/border crossfade. Haptics: selection / success / warning.
            </GlassText>
          </GlassCard>
          <AnimatedEntrance index={0}>
            <Pressable
              accessibilityRole="button"
              onPress={() => undefined}
              android_ripple={{ color: colors.ripple, borderless: false, foreground: true }}
              style={({ pressed }) => [styles.rippleCard, pressed && styles.rippleCardPressed]}
            >
              <GlassCard padded style={styles.rippleInnerCard}>
                <GlassText variant="h3">Ripple + pressed card</GlassText>
                <GlassText variant="caption" color={colors.text.secondary}>
                  Tap me — ripple clips to the 22 radius, the card dims to 0.9.
                </GlassText>
              </GlassCard>
            </Pressable>
          </AnimatedEntrance>
          <AnimatedEntrance index={1}>
            <GlassCard padded>
              <GlassText variant="h3">Entrance · 220ms · staggered</GlassText>
              <GlassText variant="caption" color={colors.text.secondary}>
                This card faded in 40ms after the one above (12px rise). Reduce Motion skips it.
              </GlassText>
            </GlassCard>
          </AnimatedEntrance>
          <View style={styles.row}>
            <AnimatedChip
              active={demoChipActive}
              bg={[colors.glass.chip, colors.interactive.selectedBg]}
              border={[colors.glass.border, colors.interactive.selectedBorder]}
              onPress={() => {
                hapticSelection();
                setDemoChipActive((v) => !v);
              }}
              style={styles.demoChip}
            >
              <Text style={[styles.demoChipText, demoChipActive && styles.demoChipTextActive]}>
                Crossfade chip
              </Text>
            </AnimatedChip>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDemoPulseTick((t) => t + 1)}
              style={({ pressed }) => [styles.pulseBtn, pressed && styles.pulseBtnPressed]}
            >
              <Text style={styles.pulseBtnText}>Fire pulse</Text>
            </Pressable>
          </View>
          <GlassCard padded style={styles.pulseCard}>
            <PulseView pulse={demoPulse} />
            <GlassText variant="h3">Live-change pulse</GlassText>
            <GlassText variant="caption" color={colors.text.secondary}>
              Tap the Fire pulse button — a 600ms accent tint flashes (the Now-serving / CALLED
              treatment).
            </GlassText>
          </GlassCard>
          <View style={styles.row}>
            <GlassButton
              label="Haptic · selection"
              onPress={() => hapticSelection()}
              style={styles.hapticBtn}
            />
            <GlassButton label="Haptic · success" onPress={() => hapticSuccess()} tone="accent" />
          </View>
          <GlassButton
            label="Haptic · warning"
            tone="destructive"
            onPress={() => hapticWarning()}
          />
        </DemoSection>

        <DemoSection title="Glass cards">
          <GlassCard padded>
            <GlassText variant="captionSemi">CARD · radius 22 · white 34%</GlassText>
            <GlassCard nested style={styles.innerPanel}>
              <GlassText variant="caption" color={colors.text.secondary}>
                Nested panel · radius 16 · white 18% — stacks translucent, never milky
              </GlassText>
            </GlassCard>
          </GlassCard>
        </DemoSection>

        <DemoSection title="Buttons">
          <PrimaryButton
            label="Primary CTA"
            icon="arrow-forward-outline"
            onPress={() => undefined}
          />
          <PrimaryButton label="Loading…" loading onPress={() => undefined} />
          <PrimaryButton label="Disabled" disabled onPress={() => undefined} />
          <NavyButton label="Navy secondary" icon="settings-outline" onPress={() => undefined} />
          <GlassButton label="Glass secondary" icon="link-outline" onPress={() => undefined} />
          <GlassButton
            label="Destructive"
            icon="trash-outline"
            tone="destructive"
            onPress={() => undefined}
          />
          <View style={styles.row}>
            <GlassCircleButton
              icon="chevron-back"
              accessibilityLabel="Back demo"
              onPress={() => undefined}
            />
            <GlassCircleButton
              icon="menu"
              accessibilityLabel="Menu demo"
              onPress={() => undefined}
            />
            <GlassCircleButton
              icon="color-palette-outline"
              accessibilityLabel="Palette demo"
              onPress={() => undefined}
            />
          </View>
        </DemoSection>

        <DemoSection title="Text fields">
          <GlassTextField label="Default" icon="person-outline" placeholder="Placeholder #5A6B8C" />
          <GlassTextField label="Password" icon="lock-closed-outline" placeholder="Secret" secure />
          <GlassTextField
            label="With error"
            icon="call-outline"
            placeholder="98765 43210"
            value="123"
            error="Enter a valid phone number (e.g. 98765 43210)"
          />
        </DemoSection>

        <DemoSection title="Status chips">
          <View style={styles.chipWrap}>
            <StatusChip status="CONFIRMED" />
            <StatusChip status="CALLED" />
            <StatusChip status="COMPLETED" />
            <StatusChip status="CANCELLED" />
            <StatusChip status="NO_SHOW" />
            <StatusChip status="PENDING" />
          </View>
          <StatusChip status="CONFIRMED" large />
        </DemoSection>

        <DemoSection title="Avatars">
          <View style={styles.row}>
            <Avatar name="Priya Nair" size={40} />
            <Avatar name="Ravi Kumar" size={52} />
            <Avatar name="Ananya" size={64} />
            <Avatar name="X" size={40} />
          </View>
        </DemoSection>

        <DemoSection title="Feedback">
          <ErrorBanner message="Too many failed attempts. Your account is locked for 15 minutes." />
          <ErrorBanner message={null} />
        </DemoSection>

        <DemoSection title="Modal (blurred backdrop)">
          <GlassCard padded>
            <GlassText variant="caption" color={colors.text.secondary}>
              GlassModal blurs + dims whatever sits behind it (Android dimezisBlurView, iOS native
              blur) so background text is never readable through a sheet.
            </GlassText>
            <GlassButton
              label="Open sample modal"
              icon="alert-circle-outline"
              onPress={() => setModalVisible(true)}
            />
          </GlassCard>
        </DemoSection>

        <DemoSection title="Screen background">
          <GlassCard padded>
            <GlassText variant="caption" color={colors.text.secondary}>
              This screen shows the pastel aurora wallpaper (assets/aurora-bg.png) under a
              low-opacity #BFD9F2 → #C7E3EC → #CBC6E8 veil. Cards, fields and chips are translucent
              white glass over it.
            </GlassText>
            <View style={[styles.swatchRow]}>
              {[
                ['top', colors.gradient.top],
                ['mid', colors.gradient.mid],
                ['bottom', colors.gradient.bottom],
                ['cta', colors.ctaGradient.start],
                ['cta2', colors.ctaGradient.end],
                ['navy', colors.navy],
                ['red', colors.destructive],
                ['amber', colors.accent],
              ].map(([label, color]) => (
                <View key={label} style={styles.swatchItem}>
                  <View style={[styles.swatch, { backgroundColor: color }]} />
                  <Text style={styles.swatchLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        </DemoSection>
      </ScrollView>

      <GlassModal
        visible={modalVisible}
        title="Sample glass modal"
        onClose={() => setModalVisible(false)}
      >
        <Text style={styles.modalBody}>
          The queue text behind this sheet is blurred and dimmed — this is the exact treatment the
          Add-walk-in sheet uses over the staff Today screen.
        </Text>
        <PrimaryButton label="Close" onPress={() => setModalVisible(false)} />
      </GlassModal>
    </GlassScreen>
  );
}

function DemoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.base, paddingBottom: spacing.huge, gap: spacing.lg },
  rippleCard: {
    borderRadius: radii.card,
    overflow: 'hidden', // ripple + card content clip to the rounded shape
  },
  rippleCardPressed: { opacity: 0.9 },
  rippleInnerCard: { gap: spacing.xs },
  demoChip: { paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  demoChipText: { ...typography.caption, color: colors.text.secondary },
  demoChipTextActive: { ...typography.captionSemi, color: colors.interactive.selectedFg },
  pulseBtn: {
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.glass.border,
    backgroundColor: colors.glass.chip,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  pulseBtnPressed: { opacity: 0.8 },
  pulseBtnText: { ...typography.captionSemi, color: colors.text.primary },
  pulseCard: { gap: spacing.xs, overflow: 'hidden' },
  hapticBtn: { flex: 1 },
  section: { gap: spacing.md },
  sectionTitle: {
    ...typography.captionSemi,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionBody: { gap: spacing.md },
  innerPanel: { marginTop: spacing.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  swatchItem: { alignItems: 'center', gap: spacing.xs },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  swatchLabel: { ...typography.micro, color: colors.text.secondary },
  modalBody: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
});
