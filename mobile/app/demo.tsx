import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassCircleButton,
  GlassHeader,
  GlassScreen,
  GlassText,
  GlassTextField,
  NavyButton,
  PrimaryButton,
  StatusChip,
} from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * DEV-ONLY design-system demo — renders the entire Glass kit so the visual
 * system can be reviewed on one screen. Never reachable in production builds.
 */
export default function DemoScreen() {
  const router = useRouter();

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

        <DemoSection title="Glass cards">
          <GlassCard padded>
            <GlassText variant="captionSemi">CARD · radius 24 · white 50%</GlassText>
            <GlassCard nested style={styles.innerPanel}>
              <GlassText variant="caption" color={colors.text.secondary}>
                Nested panel · radius 16 · white 32%
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

        <DemoSection title="Screen gradient">
          <GlassCard padded>
            <GlassText variant="caption" color={colors.text.secondary}>
              This screen shows the full pastel diagonal gradient: #BFD9F2 → #C7E3EC → #CBC6E8.
              Cards, fields and chips are translucent white glass over it.
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
});
