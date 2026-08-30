import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { usePushDeepLinks } from '@/hooks/usePushDeepLinks';
import { configurePush } from '@/lib/push';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

// Keep the native splash visible until the session is hydrated from
// expo-secure-store (the "splash gate").
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  // Push setup (B1): foreground presentation + Android channel — idempotent,
  // so calling it in the render body is safe on every re-render.
  configurePush();
  // Deep-link taps (B3): live taps + the cold-start notification.
  usePushDeepLinks();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status !== 'hydrating') {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [status]);

  return (
    <>
      <StatusBar style="dark" />
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
