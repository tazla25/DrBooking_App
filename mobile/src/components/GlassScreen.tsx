import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface GlassScreenProps {
  children: ReactNode;
  /** Disable the top safe-area padding (e.g. when a header handles it). */
  noTopInset?: boolean;
}

/**
 * Full-screen pastel gradient background — the base surface of every screen.
 * Sky-blue #BFD9F2 blending diagonally through mint #C7E3EC to lavender
 * #CBC6E8. Content is NOT scrollable here; wrap in ScrollView where needed.
 */
export function GlassScreen({ children, noTopInset = false }: GlassScreenProps) {
  return (
    <LinearGradient
      colors={[colors.gradient.top, colors.gradient.mid, colors.gradient.bottom]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView edges={noTopInset ? ['bottom'] : ['top', 'bottom']} style={styles.safe}>
        {children}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
});
