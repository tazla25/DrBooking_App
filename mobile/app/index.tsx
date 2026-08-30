import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { homeRouteFor, useAuthStore } from '@/store/auth';

/**
 * Boot redirector (splash gate). Runs after the session is hydrated:
 *  - no session            → /login
 *  - mustChangePassword    → /change-password (compounder onboarding)
 *  - otherwise             → role home (/(tabs) | /(staff) | /(admin))
 *
 * Renders nothing — the native splash covers the screen until hydration
 * finishes, then this screen routes exactly once and never stays visible.
 */
export default function IndexRedirect() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (status === 'hydrating') return;
    if (status === 'unauthenticated' || !user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword) {
      router.replace('/change-password');
      return;
    }
    router.replace(homeRouteFor(user));
  }, [status, user, router]);

  return null;
}
