import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

/**
 * Staff console (DOCTOR + COMPOUNDER) — tabbed panel (Phase 7).
 *
 * The role guard is UX DEFENSE only: the API is the real gate (every staff
 * endpoint validates the bearer token server-side). A PATIENT is bounced to
 * /(tabs), a SUPER_ADMIN to /(admin) (admin console = Phase 8).
 *
 * Tab visibility by role:
 *  - Today / Patients / Schedules / Profile — DOCTOR and COMPOUNDER;
 *  - Team — DOCTOR only (compounders calling /api/compounders get 403).
 * `patient/[phone]` is a pushed route, hidden from the tab bar (href: null).
 */
export default function StaffLayout() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === 'hydrating' || !user) return null; // splash gate owns boot routing

  if (user.role !== 'DOCTOR' && user.role !== 'COMPOUNDER') {
    return <Redirect href={user.role === 'PATIENT' ? '/(tabs)' : '/(admin)'} />;
  }

  const isDoctor = user.role === 'DOCTOR';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ctaGradient.end,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'rgba(255, 255, 255, 0.38)',
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
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'flash' : 'flash-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="patients"
        options={{
          title: 'Patients',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedules"
        options={{
          title: 'Schedules',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} />
          ),
        }}
      />
      {isDoctor ? (
        <Tabs.Screen
          name="team"
          options={{
            title: 'Team',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
                size={22}
                color={color}
              />
            ),
          }}
        />
      ) : null}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
      {/* Pushed detail route — reachable but never a tab. */}
      <Tabs.Screen
        name="patient/[phone]"
        options={{
          href: null,
          title: 'Patient notes',
          tabBarIcon: ({ color }) => <Ionicons name="person" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
