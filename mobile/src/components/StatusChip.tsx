import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

export type AppointmentStatus =
  'CONFIRMED' | 'CALLED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'PENDING';

const STATUS_STYLES: Record<AppointmentStatus, { fg: string; bg: string }> = {
  ...colors.status,
};

/**
 * Human label for a machine status (e.g. NO_SHOW → "No-show").
 *
 * C5: unknown runtime values (statuses the client build has never heard of)
 * render the RAW value instead of undefined — a chip must never show blank.
 */
export function statusLabel(status: AppointmentStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmed';
    case 'CALLED':
      return 'Called';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'NO_SHOW':
      return 'No-show';
    case 'PENDING':
      return 'Pending';
    default:
      // Runtime safety net — unreachable for the union, live for casts.
      return String(status);
  }
}

interface StatusChipProps {
  status: AppointmentStatus;
  /** Bigger variant for detail screens. */
  large?: boolean;
}

/**
 * Translucent tinted status chip (radius 12) — CONFIRMED green, CALLED blue,
 * COMPLETED gray-green, CANCELLED red, NO_SHOW gray, PENDING orange. The tint
 * stays translucent; label text keeps its high-contrast status color.
 */
export function StatusChip({ status, large = false }: StatusChipProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <View style={[styles.chip, large && styles.large, { backgroundColor: s.bg }]}>
      <Text style={[styles.text, large && styles.largeText, { color: s.fg }]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  large: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: {
    ...typography.micro,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  largeText: {
    ...typography.caption, // 13/18 — token, not literal
  },
});
