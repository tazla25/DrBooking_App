import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface GlassScreenProps {
  children: ReactNode;
  /** Disable the top safe-area padding (e.g. when a header handles it). */
  noTopInset?: boolean;
}

/**
 * Full-screen brand canvas — the base surface of every screen (Phase 10
 * "Glass Reality" revision). A vivid diagonal gradient (start/end diagonally
 * opposite) with two soft radial glows — concentric translucent white circles
 * (~10% cumulative alpha at their centers) anchored at the top-left and
 * bottom-right corners. Pure vector: no wallpaper asset, no load-failure
 * fallback. Content is NOT scrollable here; wrap in ScrollView where needed.
 */
export function GlassScreen({ children, noTopInset = false }: GlassScreenProps) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.gradient.top, colors.gradient.mid, colors.gradient.bottom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft radial glows — three concentric low-alpha circles each fake the
          falloff (no radial-gradient dependency; white 3% + 3.5% + 4% stacks to
          ~10% at the center). Rendered under the content layer. */}
      <View style={styles.glowTlOuter} />
      <View style={styles.glowTlMid} />
      <View style={styles.glowTlInner} />
      <View style={styles.glowBrOuter} />
      <View style={styles.glowBrMid} />
      <View style={styles.glowBrInner} />
      <SafeAreaView edges={noTopInset ? ['bottom'] : ['top', 'bottom']} style={styles.safe}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // Top-left glow (concentric circles bleeding off the corner)
  glowTlOuter: {
    position: 'absolute',
    top: -200,
    left: -170,
    width: 560,
    height: 560,
    borderRadius: 280,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  glowTlMid: {
    position: 'absolute',
    top: -160,
    left: -130,
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  glowTlInner: {
    position: 'absolute',
    top: -120,
    left: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  // Bottom-right glow (mirrored)
  glowBrOuter: {
    position: 'absolute',
    bottom: -200,
    right: -170,
    width: 560,
    height: 560,
    borderRadius: 280,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  glowBrMid: {
    position: 'absolute',
    bottom: -160,
    right: -130,
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  glowBrInner: {
    position: 'absolute',
    bottom: -120,
    right: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
});
