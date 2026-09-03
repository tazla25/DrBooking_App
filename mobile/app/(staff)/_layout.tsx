import { Redirect, Tabs } from 'expo-router';
import { hapticSelection } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { AuroraNav, type MaterialIconName } from '@/components/aurora';

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
 *
 * Phase 12 "Aurora Glass v2" (Stage A): the tab bar is the design's floating
 * glass PILL (AuroraNav — white .80 capsule, r999, indigo shadow, Material
 * Symbols icons). Visual-only diff: the tab set, titles, press haptics and
 * route guards are unchanged (functional freeze L5).
 */
const STAFF_TAB_ICONS: Record<string, MaterialIconName> = {
  index: 'assignment',
  patients: 'groups',
  schedules: 'calendar_month',
  team: 'shield_person',
  profile: 'person',
};

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
      screenListeners={{ tabPress: () => hapticSelection() }}
      tabBar={(props) => <AuroraNav {...props} icons={STAFF_TAB_ICONS} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients' }} />
      <Tabs.Screen name="schedules" options={{ title: 'Schedules' }} />
      {isDoctor ? <Tabs.Screen name="team" options={{ title: 'Team' }} /> : null}
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* Pushed detail route — reachable but never a tab. */}
      <Tabs.Screen
        name="patient/[phone]"
        options={{
          href: null,
          title: 'Patient notes',
        }}
      />
    </Tabs>
  );
}
