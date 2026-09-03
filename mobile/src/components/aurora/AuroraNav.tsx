import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import {
  auroraColors,
  auroraGlass,
  auroraRadii,
  auroraShadows,
  auroraSpacing,
  auroraTypography,
} from '@/theme';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';

interface AuroraNavProps extends BottomTabBarProps {
  /** Icon per route name (Material Symbols, spec §6). */
  icons: Record<string, MaterialIconName>;
}

/**
 * AuroraNav — the floating glass pill bottom bar (Phase 12, spec §3/§8.10).
 * The design's `h-16 rounded-full bg-white/80 shadow-[0_8px_32px]` capsule:
 * one column per tab (Material Symbol 22 + label-sm), active tab in primary,
 * inactive in on-surface-variant, 44px minimum touch targets, floating with
 * screen margins + safe-area bottom padding.
 *
 * Drop-in for expo-router Tabs: `tabBar={(props) => <AuroraNav {...props}
 * icons={STAFF_ICONS} />}` — tab set, titles, badges and press listeners
 * stay owned by the navigator (functional freeze: navigation preserved;
 * labels come from each screen's `options.title`).
 *
 * Blur budget (spec §7): rgba-only glass — NO BlurView on the bar.
 */
export function AuroraNav({ state, descriptors, navigation, icons }: AuroraNavProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.float, { paddingBottom: Math.max(insets.bottom, auroraSpacing.sm) }]}
    >
      <View style={styles.pill}>
        {state.routes.map((route, index) => {
          const focused = index === state.index;
          const { title } = descriptors[route.key]?.options ?? {};
          const label = typeof title === 'string' ? title : route.name;
          const icon = icons[route.name];
          if (!icon) return null; // route without an icon mapping stays hidden

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              <MaterialIcon
                name={icon}
                size={22}
                color={focused ? auroraColors.primary : auroraColors.onSurfaceVariant}
              />
              <Text
                style={[
                  styles.label,
                  { color: focused ? auroraColors.primary : auroraColors.onSurfaceVariant },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  float: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: auroraSpacing.base,
  },
  pill: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: auroraRadii.pill,
    backgroundColor: auroraGlass.nav,
    borderWidth: 1,
    borderColor: auroraGlass.hairline,
    ...auroraShadows.nav,
  },
  item: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: auroraRadii.pill,
    paddingHorizontal: auroraSpacing.xs,
  },
  itemPressed: {
    opacity: 0.8,
  },
  label: {
    ...auroraTypography.labelSm,
    letterSpacing: 0,
  },
});
