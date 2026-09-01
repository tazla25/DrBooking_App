import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';
import { hapticSelection } from '@/lib/haptics';
import { colors, typography } from '@/theme';

/** Patient tab bar — translucent glass with a real blur behind it. */
export default function TabsLayout() {
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
          title: 'Find Doctors',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={22} color={color} />
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
