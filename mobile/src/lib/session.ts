import * as SecureStore from 'expo-secure-store';
import type { SafeUser } from './types';

/**
 * Session persistence — the ONLY place that touches device secrets.
 * Token + user live in expo-secure-store (NEVER AsyncStorage) under the
 * keys "auth.token" / "auth.user".
 */

const TOKEN_KEY = 'auth.token';
const USER_KEY = 'auth.user';

export interface PersistedSession {
  token: string;
  user: SafeUser;
}

export async function saveSession(session: PersistedSession): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, session.token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user));
}

export async function loadSession(): Promise<PersistedSession | null> {
  const [token, userJson] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);
  if (!token || !userJson) return null;
  try {
    const user = JSON.parse(userJson) as SafeUser;
    if (!user || typeof user.id !== 'string' || typeof user.role !== 'string') return null;
    return { token, user };
  } catch {
    return null;
  }
}

export async function updateUser(user: SafeUser): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
