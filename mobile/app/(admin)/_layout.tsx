import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';
import { hapticSelection } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { colors, typography } from '@/theme';

/**
 * SUPER_ADMIN console (Phase 8) — tabbed panel mirroring (staff)/_layout.tsx.
 *
 * The role guard is UX DEFENSE only: every /api/admin/* endpoint validates the
 * bearer token server-side (any other role → 403). A PATIENT is bounced to
 * /(tabs); DOCTOR/COMPOUNDER to /(staff).
 *
 * Tabs: Verification (queue), Analytics (summary + revenue chart + CSV
 * export), Audit (append-only trail), Profile.
 */
export default function AdminLayout() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === 'hydrating' || !user) return null; // splash gate owns boot routing

  if (user.role !== 'SUPER_ADMIN') {
    return <Redirect href={user.role === 'PATIENT' ? '/(tabs)' : '/(staff)'} />;
  }

  return (
    <Tabs
      screenListeners={{ tabPress: () => hapticSelection() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ctaGradient.end,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarLabelStyle: { ...typography.micro },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: colors.glass.tabBar, // Phase 10 token (0.55)
          borderTopColor: colors.glass.border,
          borderTopWidth: 1,
        },
        tabBarBackground: () => (
          <BlurView intensity={35} tint="light" style={StyleSheet.absoluteFill} />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Verification',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="audit"
        options={{
          title: 'Audit',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
