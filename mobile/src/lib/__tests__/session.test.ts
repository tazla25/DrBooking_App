import * as SecureStore from 'expo-secure-store';
import { clearSession, loadSession, saveSession, getToken, updateUser } from '../session';
import type { SafeUser } from '../types';

/** secure-store round-trip against the in-memory mock from jest.setup.js. */

const USER: SafeUser = {
  id: 'u1',
  phone: '+919876543210',
  name: 'Test Patient',
  role: 'PATIENT',
  verificationStatus: 'VERIFIED',
  mustChangePassword: false,
  isActive: true,
  delegatedDoctorId: null,
  createdAt: '2026-08-30T10:00:00.000Z',
};

describe('session persistence (expo-secure-store)', () => {
  test('saveSession writes "auth.token" and "auth.user" keys', async () => {
    await saveSession({ token: 'tok123', user: USER });

    expect(await SecureStore.getItemAsync('auth.token')).toBe('tok123');
    expect(JSON.parse((await SecureStore.getItemAsync('auth.user')) as string)).toEqual(USER);
  });

  test('round-trip: loadSession returns what saveSession stored', async () => {
    await saveSession({ token: 'tok123', user: USER });

    const restored = await loadSession();

    expect(restored).toEqual({ token: 'tok123', user: USER });
  });

  test('getToken returns only the token', async () => {
    await saveSession({ token: 'tok456', user: USER });
    expect(await getToken()).toBe('tok456');
  });

  test('clearSession wipes both keys; loadSession returns null', async () => {
    await saveSession({ token: 'tok123', user: USER });

    await clearSession();

    expect(await loadSession()).toBeNull();
    expect(await getToken()).toBeNull();
  });

  test('loadSession returns null when nothing was stored', async () => {
    expect(await loadSession()).toBeNull();
  });

  test('loadSession returns null for corrupted user JSON', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok123');
    await SecureStore.setItemAsync('auth.user', '{not json');

    expect(await loadSession()).toBeNull();
  });

  test('loadSession rejects a user payload without an id/role', async () => {
    await SecureStore.setItemAsync('auth.token', 'tok123');
    await SecureStore.setItemAsync('auth.user', JSON.stringify({ name: 'partial' }));

    expect(await loadSession()).toBeNull();
  });

  test('updateUser overwrites only the user record', async () => {
    await saveSession({ token: 'tok123', user: USER });
    const updated: SafeUser = { ...USER, name: 'Renamed', mustChangePassword: false };

    await updateUser(updated);

    expect(await getToken()).toBe('tok123');
    expect((await loadSession())?.user.name).toBe('Renamed');
  });
});
