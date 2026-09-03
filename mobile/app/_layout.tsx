import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { usePushDeepLinks } from '@/hooks/usePushDeepLinks';
import { configurePush } from '@/lib/push';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

// Keep the native splash visible until the session is hydrated from
// expo-secure-store AND the Inter fonts are loaded (the "splash gate" +
// keepVisibleOnMount font pattern — no font flash).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  // Inter (SIL OFL 1.1 — assets/fonts/Inter-OFL.txt). A load error counts as
  // "done": the app proceeds on the system font fallback, never a blank gate.
  // Phase 12 (Aurora): Plus Jakarta Sans 600/700 headlines (SIL OFL 1.1 —
  // assets/fonts/PlusJakartaSans-OFL.txt) + Material Symbols Outlined
  // (subset, Apache 2.0 — assets/fonts/MaterialSymbolsOutlined-LICENSE.txt).
  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
    'PlusJakartaSans-SemiBold': require('../assets/fonts/PlusJakartaSans-SemiBold.ttf'),
    'PlusJakartaSans-Bold': require('../assets/fonts/PlusJakartaSans-Bold.ttf'),
    MaterialSymbolsOutlined: require('../assets/fonts/MaterialSymbolsOutlined.ttf'),
  });

  // Push setup (B1): foreground presentation + Android channel — idempotent,
  // so calling it in the render body is safe on every re-render.
  configurePush();
  // Deep-link taps (B3): live taps + the cold-start notification.
  usePushDeepLinks();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status !== 'hydrating' && (fontsLoaded || fontError)) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontError, fontsLoaded, status]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.gradient.top },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(staff)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="doctor/[id]" />
        <Stack.Screen name="book/[doctorId]" />
        <Stack.Screen name="booking-success" />
        <Stack.Screen name="queue/[scheduleId]/[date]" />
        {__DEV__ ? <Stack.Screen name="demo" /> : null}
      </Stack>
    </>
  );
}
