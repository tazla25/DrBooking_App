import type { Href } from 'expo-router';
import { create } from 'zustand';
import { apiRequest } from '@/lib/api';
import { registerPushToken } from '@/lib/push';
import { clearSession, loadSession, saveSession, updateUser as persistUser } from '@/lib/session';
import type { LoginResponse, MeResponse, RegisterResponse, SafeUser } from '@/lib/types';

/**
 * Auth state — the single source of truth for "who is logged in".
 * Persistence lives in expo-secure-store via src/lib/session.ts; this store
 * mirrors it for the UI. Routing decisions happen in screens (this store
 * never imports expo-router, so it stays unit-testable).
 */

export type AuthStatus = 'hydrating' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  token: string | null;
  user: SafeUser | null;

  /** Boot-time restore from secure-store. Call once from the root layout. */
  hydrate: () => Promise<void>;
  /** Persist + adopt a fresh login (or restored-token register). */
  setSession: (token: string, user: SafeUser) => Promise<void>;
  /** Adopt an updated user object (e.g. after change-password). */
  setUser: (user: SafeUser) => Promise<void>;
  /** Best-effort server logout (errors ignored), then wipe and sign out. */
  logout: () => Promise<void>;
}

/** Best-effort push registration fires once per app run (B2) — flag guards
 * against hydrate somehow being called twice. */
let pushRegistrationKicked = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  token: null,
  user: null,

  hydrate: async () => {
    const session = await loadSession().catch(() => null);
    if (session) {
      set({ status: 'authenticated', token: session.token, user: session.user });
      // Push registration (B2): kicked at boot for ANY restored session, so
      // reinstalls and refreshed tokens register without a new login. Never
      // blocks hydration — registerPushToken swallows every failure.
      if (!pushRegistrationKicked) {
        pushRegistrationKicked = true;
        void registerPushToken();
      }
      // Refresh the profile in the background (verification status may have
      // changed since the token was issued). Failure keeps the cached user.
      try {
        const me = await apiRequest<MeResponse>('/api/auth/me');
        await get().setUser(me.user);
      } catch {
        // 401 already cleared the session via the api client; otherwise keep.
      }
      return;
    }
    set({ status: 'unauthenticated', token: null, user: null });
  },

  setSession: async (token, user) => {
    await saveSession({ token, user });
    set({ status: 'authenticated', token, user });
  },

  setUser: async (user) => {
    await persistUser(user);
    set({ user, status: get().token ? 'authenticated' : 'unauthenticated' });
  },

  logout: async () => {
    const { token } = get();
    if (token) {
      // Server revocation is best-effort — a network failure must still
      // sign the user out locally (the token stays revoked only server-side
      // until its 30-day expiry, an accepted trade-off for offline logout).
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignored by design
      }
    }
    await clearSession().catch(() => undefined);
    set({ status: 'unauthenticated', token: null, user: null });
  },
}));

// -- Login / register actions (kept outside the store for testability) --------

export async function loginWith(phone: string, password: string): Promise<LoginResponse> {
  const data = await apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { phone, password },
    auth: false,
  });
  await useAuthStore.getState().setSession(data.token, data.user);
  return data;
}

export interface RegisterInput {
  name: string;
  phone: string;
  password: string;
  role: 'PATIENT' | 'DOCTOR';
}

/**
 * POST /api/auth/register. The API returns { user } with NO token (doctors
 * are PENDING and unloggable until verified; patients auto-login afterwards
 * via loginWith). The token case is handled defensively if the API ever
 * starts returning one.
 */
export async function registerAccount(
  input: RegisterInput,
): Promise<{ user: SafeUser; token: string | null }> {
  const data = await apiRequest<RegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: input,
    auth: false,
  });
  if (data.token) {
    await useAuthStore.getState().setSession(data.token, data.user);
    return { user: data.user, token: data.token };
  }
  return { user: data.user, token: null };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<SafeUser> {
  const data = await apiRequest<{ user: SafeUser }>('/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  await useAuthStore.getState().setUser(data.user);
  return data.user;
}

/** Where this account lands after auth (or after change-password). */
export function homeRouteFor(user: SafeUser): Href {
  switch (user.role) {
    case 'PATIENT':
      return '/(tabs)';
    case 'DOCTOR':
    case 'COMPOUNDER':
      return '/(staff)';
    case 'SUPER_ADMIN':
      return '/(admin)';
  }
}
