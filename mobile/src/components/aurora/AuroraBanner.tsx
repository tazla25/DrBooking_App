import { StyleSheet, Text, View } from 'react-native';
import { auroraColors, auroraRadii, auroraSpacing, auroraTints, auroraTypography } from '@/theme';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';
import { AuroraButton } from './AuroraButton';
import { GlassCardV2 } from './GlassCardV2';

/** Aurora error banner — error-container tint + on-error-container text
 * (Phase 12, spec §2 error roles). Friendly English text, same contract as
 * the legacy ErrorBanner (renders nothing for null). */
export function AuroraErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <MaterialIcon name="error" size={18} color={auroraColors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

interface AuroraEmptyStateProps {
  icon: MaterialIconName;
  title: string;
  caption: string;
  ctaLabel?: string;
  onCta?: () => void;
}

/** Aurora empty-state card — icon + headline + caption + optional CTA
 * (the same UX law as the legacy EmptyState: every empty list offers a next
 * step; texts are owned by the screen). */
export function AuroraEmptyState({ icon, title, caption, ctaLabel, onCta }: AuroraEmptyStateProps) {
  return (
    <GlassCardV2 tier="card" padded style={styles.emptyCard}>
      <MaterialIcon name={icon} size={30} color={auroraColors.onSurfaceVariant} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCaption}>{caption}</Text>
      {ctaLabel && onCta ? (
        <AuroraButton label={ctaLabel} icon="person_add" variant="gradient" onPress={onCta} />
      ) : null}
    </GlassCardV2>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: auroraSpacing.sm,
    backgroundColor: auroraColors.errorContainer,
    borderWidth: 1,
    borderColor: auroraTints.errorBorder30,
    borderRadius: auroraRadii.field,
    paddingHorizontal: auroraSpacing.base,
    paddingVertical: auroraSpacing.sm,
  },
  errorText: {
    flex: 1,
    ...auroraTypography.bodyMd,
    color: auroraColors.onErrorContainer,
  },
  emptyCard: {
    alignItems: 'center',
    gap: auroraSpacing.sm,
  },
  emptyTitle: {
    ...auroraTypography.headlineSm,
    color: auroraColors.onSurface,
    textAlign: 'center',
  },
  emptyCaption: {
    ...auroraTypography.bodyMd,
    color: auroraColors.onSurfaceVariant,
    textAlign: 'center',
  },
});
