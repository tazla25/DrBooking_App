import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

interface StarRatingProps {
  /** Current rating 0–5 (0 = none selected). */
  value: number;
  /** Called when a star is tapped. Omit for a display-only row. */
  onChange?: (value: number) => void;
  size?: number;
  disabled?: boolean;
}

/**
 * 1–5 star rating. Interactive when `onChange` is provided (tappable stars,
 * each star sets its own value); display-only otherwise (filled ≤ value).
 */
export function StarRating({ value, onChange, size = 34, disabled = false }: StarRatingProps) {
  const interactive = typeof onChange === 'function' && !disabled;

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value >= star;
        const starIcon = (
          <Ionicons
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? colors.star : colors.text.secondary}
          />
        );
        if (!interactive) return <View key={star}>{starIcon}</View>;
        return (
          <Pressable
            key={star}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${star} star${star > 1 ? 's' : ''}`}
            accessibilityState={{ selected: value === star, disabled }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={() => onChange?.(star)}
            style={styles.star}
          >
            {starIcon}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  star: {
    padding: 2,
  },
});
