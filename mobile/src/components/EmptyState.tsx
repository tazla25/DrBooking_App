import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';

import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';
import { colors, spacing, typography } from '@/theme';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  /** Optional call-to-action (UX law: every empty list offers a next step). */
  ctaLabel?: string;
  onCta?: () => void;
}

/** Glass empty-state card — icon + title + caption + optional CTA button. */
export function EmptyState({ icon, title, caption, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <GlassCard padded style={styles.card}>
      <Ionicons name={icon} size={30} color={colors.text.secondary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>{caption}</Text>
      {ctaLabel && onCta ? (
        <GlassButton label={ctaLabel} icon="arrow-forward-outline" onPress={onCta} />
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  title: { ...typography.h3, color: colors.text.primary, textAlign: 'center' },
  caption: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 300,
  },
});
