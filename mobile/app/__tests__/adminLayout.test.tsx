import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/auth';
import type { SafeUser } from '@/lib/types';
import AdminLayout from '../(admin)/_layout';

/**
 * Admin console role guard (acceptance item): only SUPER_ADMIN may enter
 * /(admin). PATIENT bounces to /(tabs); DOCTOR/COMPOUNDER bounce to /(staff);
 * during hydration the layout renders nothing (the splash gate owns routing).
 * The guard is UX defense — the API 403s every /api/admin/* call regardless.
 *
 * expo-router is replaced with inert Tabs/Redirect stand-ins. The factory is
 * SELF-CONTAINED (jest.setup.js law — factories cannot reference out-of-scope
 * bindings because jest hoists the call above every const).
 */

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native') as typeof import('react-native');
  const MockRedirect = ({ href }: { href: unknown }) => (
    <Text testID="redirect">{typeof href === 'string' ? href : JSON.stringify(href)}</Text>
  );
  const MockTabs = ({ children }: { children: ReactNode }) => <Text testID="tabs">{children}</Text>;
  const MockTabScreen = () => null;
  MockTabs.Screen = MockTabScreen;
  return {
    __esModule: true,
    Redirect: MockRedirect,
    Tabs: MockTabs,
  };
});

function userOf(role: SafeUser['role']): SafeUser {
  return {
    id: `user-${role.toLowerCase()}`,
    phone: '+919999000001',
    name: 'Root Admin',
    role,
    verificationStatus: 'VERIFIED',
    mustChangePassword: false,
    isActive: true,
    delegatedDoctorId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function setSession(status: 'hydrating' | 'authenticated', user: SafeUser | null) {
  useAuthStore.setState({ status, token: status === 'authenticated' ? 'tok' : null, user });
}

type RenderResult = Awaited<ReturnType<typeof render>>;

function redirectTargetOf(tree: RenderResult): string | null {
  const node = tree.queryByTestId('redirect');
  if (!node) return null;
  return (node as unknown as { props: { children: string } }).props.children;
}

describe('(admin) role guard', () => {
  test('SUPER_ADMIN gets the console tabs (no redirect)', async () => {
    setSession('authenticated', userOf('SUPER_ADMIN'));
    const tree = await render(<AdminLayout />);
    expect(tree.queryByTestId('tabs')).toBeTruthy();
    expect(tree.queryByTestId('redirect')).toBeNull();
  });

  test('PATIENT is redirected to /(tabs)', async () => {
    setSession('authenticated', userOf('PATIENT'));
    const tree = await render(<AdminLayout />);
    expect(redirectTargetOf(tree)).toBe('/(tabs)');
    expect(tree.queryByTestId('tabs')).toBeNull();
  });

  test('DOCTOR is redirected to /(staff)', async () => {
    setSession('authenticated', userOf('DOCTOR'));
    const tree = await render(<AdminLayout />);
    expect(redirectTargetOf(tree)).toBe('/(staff)');
  });

  test('COMPOUNDER is redirected to /(staff)', async () => {
    setSession('authenticated', userOf('COMPOUNDER'));
    const tree = await render(<AdminLayout />);
    expect(redirectTargetOf(tree)).toBe('/(staff)');
  });

  test('while hydrating the layout renders nothing (splash gate owns routing)', async () => {
    setSession('hydrating', null);
    const tree = await render(<AdminLayout />);
    expect(tree.toJSON()).toBeNull();
  });
});
