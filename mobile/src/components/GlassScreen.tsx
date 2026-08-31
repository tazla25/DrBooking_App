import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ImageBackground, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

/** Owner-supplied pastel aurora wallpaper (committed at mobile/assets/). */
const AURORA_SOURCE = require('../../assets/aurora-bg.png');

interface GlassScreenProps {
  children: ReactNode;
  /** Disable the top safe-area padding (e.g. when a header handles it). */
  noTopInset?: boolean;
}

/**
 * Full-screen brand background — the base surface of every screen (Phase 10).
 * The pastel aurora wallpaper (assets/aurora-bg.png, resizeMode cover) with the
 * soft top→mid→bottom gradient laid over it at low opacity so the wallpaper
 * shows through while text contrast stays preserved. If the wallpaper fails to
 * load at runtime, a 5-stop saturated gradient (colors.auroraFallback) renders
 * instead. Content is NOT scrollable here; wrap in ScrollView where needed.
 */
export function GlassScreen({ children, noTopInset = false }: GlassScreenProps) {
  const [auroraFailed, setAuroraFailed] = useState(false);

  return (
    <ImageBackground
      source={AURORA_SOURCE}
      resizeMode="cover"
      style={styles.gradient}
      onError={() => setAuroraFailed(true)}
    >
      {auroraFailed ? (
        <LinearGradient
          colors={[...colors.auroraFallback]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {/* Pastel veil over the wallpaper — low opacity keeps the aurora visible
          while tinting it back into the brand family. */}
      <LinearGradient
        colors={[colors.gradient.top, colors.gradient.mid, colors.gradient.bottom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.veil]}
      />
      <SafeAreaView edges={noTopInset ? ['bottom'] : ['top', 'bottom']} style={styles.safe}>
        {children}
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  veil: { opacity: 0.35 },
  safe: { flex: 1 },
});
