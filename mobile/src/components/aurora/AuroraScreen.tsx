import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auroraCanvas, auroraOrbs } from '@/theme';

interface AuroraScreenProps {
  children: ReactNode;
  /** Disable the top safe-area padding (e.g. when a header handles it). */
  noTopInset?: boolean;
}

/**
 * Aurora canvas — the base surface of every Aurora-migrated screen (Phase 12
 * "Aurora Glass v2", spec §1). The LIGHT pastel aurora gradient (~160°:
 * powdery blue → mist cyan → lavender) with three soft color orbs BEHIND
 * content (primary/secondary/tertiary washes, concentric-circle vector
 * approximation — NO BlurView, zero GPU cost: the blur budget law, §7).
 *
 * Pure vector, like the Phase-10 GlassScreen it will progressively replace
 * (screens migrate per stage — GlassScreen stays for non-migrated screens).
 * Content is NOT scrollable here; wrap in ScrollView/FlatList where needed.
 */
export function AuroraScreen({ children, noTopInset = false }: AuroraScreenProps) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[auroraCanvas.top, auroraCanvas.mid, auroraCanvas.bottom]}
        start={{ x: 0.33, y: 0 }}
        end={{ x: 0.67, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Orb 1 — primary wash, upper-left (spec §1). */}
      <View style={styles.orb1Outer} />
      <View style={styles.orb1Mid} />
      <View style={styles.orb1Inner} />
      {/* Orb 2 — secondary wash, upper-right. */}
      <View style={styles.orb2Outer} />
      <View style={styles.orb2Mid} />
      <View style={styles.orb2Inner} />
      {/* Orb 3 — tertiary wash, mid-left. */}
      <View style={styles.orb3Outer} />
      <View style={styles.orb3Mid} />
      <View style={styles.orb3Inner} />
      <SafeAreaView edges={noTopInset ? ['bottom'] : ['top', 'bottom']} style={styles.safe}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // Orb 1 (primary-container/20 ≈ 192px @ ~(-48, -12)): three concentric
  // circles fake the blur-3xl falloff (~.06/.10/.20 cumulative at center).
  orb1Outer: {
    position: 'absolute',
    top: -72,
    left: -104,
    width: 304,
    height: 304,
    borderRadius: 152,
    backgroundColor: auroraOrbs.primaryHalo,
  },
  orb1Mid: {
    position: 'absolute',
    top: -48,
    left: -80,
    width: 256,
    height: 256,
    borderRadius: 128,
    backgroundColor: auroraOrbs.primaryHalo,
  },
  orb1Inner: {
    position: 'absolute',
    top: -28,
    left: -60,
    width: 216,
    height: 216,
    borderRadius: 108,
    backgroundColor: auroraOrbs.primary,
  },
  // Orb 2 (secondary-container/30 ≈ 208px @ ~(176, right 40)).
  orb2Outer: {
    position: 'absolute',
    top: 112,
    right: -104,
    width: 328,
    height: 328,
    borderRadius: 164,
    backgroundColor: auroraOrbs.secondaryHalo,
  },
  orb2Mid: {
    position: 'absolute',
    top: 140,
    right: -76,
    width: 272,
    height: 272,
    borderRadius: 136,
    backgroundColor: auroraOrbs.secondaryHalo,
  },
  orb2Inner: {
    position: 'absolute',
    top: 164,
    right: -56,
    width: 224,
    height: 224,
    borderRadius: 112,
    backgroundColor: auroraOrbs.secondary,
  },
  // Orb 3 (tertiary-fixed-dim/20 ≈ 176px @ ~(384, left 24)).
  orb3Outer: {
    position: 'absolute',
    top: 320,
    left: -88,
    width: 288,
    height: 288,
    borderRadius: 144,
    backgroundColor: auroraOrbs.tertiaryHalo,
  },
  orb3Mid: {
    position: 'absolute',
    top: 344,
    left: -64,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: auroraOrbs.tertiaryHalo,
  },
  orb3Inner: {
    position: 'absolute',
    top: 364,
    left: -48,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: auroraOrbs.tertiary,
  },
});
