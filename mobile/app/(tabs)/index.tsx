import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Avatar,
  ErrorBanner,
  GlassCard,
  GlassCircleButton,
  GlassHeader,
  GlassScreen,
  GlassTextField,
} from '@/components';
import { api } from '@/lib/api';
import { hapticSelection } from '@/lib/haptics';
import { ApiError, friendlyMessage } from '@/lib/errors';
import { formatFee, formatRating } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { AnimatedChip, AnimatedEntrance } from '@/components/motion';
import { colors, radii, spacing, typography } from '@/theme';
import type { DoctorSort, DoctorSummary, DoctorsListResponse } from '@/lib/types';

const PAGE_SIZE = 20;

/** Common Indian clinic specializations — chips map onto the ?q= filter. */
const SPECIALIZATIONS = [
  'General Physician',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'Orthopedist',
  'Gynecologist',
  'Neurologist',
] as const;

const SORTS: { key: DoctorSort; label: string }[] = [
  { key: 'rating', label: 'Top rated' },
  { key: 'fee_asc', label: 'Fee ↑' },
  { key: 'fee_desc', label: 'Fee ↓' },
];

export default function FindDoctorsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [specialization, setSpecialization] = useState<string | null>(null);
  const [sort, setSort] = useState<DoctorSort>('rating');

  const [items, setItems] = useState<DoctorSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef(0);

  const activeQuery = specialization ?? (debouncedSearch.trim() || null);

  // Filter/sort change → fresh page 1. All state updates happen in the async
  // callbacks only (never synchronously inside the effect body —
  // react-hooks/set-state-in-effect); the requestSeq guard drops stale
  // responses when the user keeps typing.
  useEffect(() => {
    const seq = ++requestSeq.current;
    api
      .get<DoctorsListResponse>('/api/doctors', {
        q: activeQuery ?? undefined,
        sort,
        page: 1,
        pageSize: PAGE_SIZE,
      })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setItems(data.doctors);
        setTotal(data.total);
        setPage(1);
        setError(null);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(
          err instanceof ApiError
            ? friendlyMessage(err)
            : friendlyMessage({ code: 'NETWORK_ERROR', status: 0 }),
        );
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [activeQuery, sort]);

  // Event handlers (pull-to-refresh / end-reached) may set state freely.
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await api.get<DoctorsListResponse>('/api/doctors', {
        q: activeQuery ?? undefined,
        sort,
        page: 1,
        pageSize: PAGE_SIZE,
      });
      setItems(data.doctors);
      setTotal(data.total);
      setPage(1);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? friendlyMessage(err)
          : friendlyMessage({ code: 'NETWORK_ERROR', status: 0 }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || loading || items.length >= total) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await api.get<DoctorsListResponse>('/api/doctors', {
        q: activeQuery ?? undefined,
        sort,
        page: next,
        pageSize: PAGE_SIZE,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        return [...prev, ...data.doctors.filter((d) => !seen.has(d.id))];
      });
      setTotal(data.total);
      setPage(next);
    } catch {
      // Silent: pull-to-refresh retries; keep the current page.
    } finally {
      setLoadingMore(false);
    }
  };

  const pickSpecialization = (spec: string) => {
    setSearch('');
    setSpecialization((prev) => (prev === spec ? null : spec));
  };

  return (
    <GlassScreen>
      <GlassHeader
        title="Find Doctors"
        back={false}
        right={
          __DEV__ ? (
            <GlassCircleButton
              icon="color-palette-outline"
              accessibilityLabel="Open design system demo"
              onPress={() => router.push('/demo')}
            />
          ) : undefined
        }
      />

      <View style={styles.controls}>
        <GlassTextField
          icon="search-outline"
          placeholder="Search by name or specialization"
          value={search}
          onChangeText={(text) => {
            setSearch(text);
            if (specialization) setSpecialization(null);
          }}
          returnKeyType="search"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRowScroll}
          contentContainerStyle={styles.chipRow}
        >
          <FilterChip
            label="All"
            active={specialization === null}
            onPress={() => {
              setSearch('');
              setSpecialization(null);
            }}
          />
          {SPECIALIZATIONS.map((spec) => (
            <FilterChip
              key={spec}
              label={spec}
              active={specialization === spec}
              onPress={() => pickSpecialization(spec)}
            />
          ))}
          {/* B1 trailing runway — width = the parent controls padding. */}
          <View style={styles.chipTrailing} />
        </ScrollView>

        <View style={styles.sortRow}>
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === s.key }}
              onPress={() => {
                if (sort !== s.key) hapticSelection();
                setSort(s.key);
              }}
              style={[styles.sortChip, sort === s.key && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sort === s.key && styles.sortChipTextActive]}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <ErrorBanner message={error} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ctaGradient.end} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <AnimatedEntrance index={index}>
              <DoctorCard doctor={item} onPress={() => router.push(`/doctor/${item.id}`)} />
            </AnimatedEntrance>
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4D9FDE" />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <GlassCard padded style={styles.emptyCard}>
              <Ionicons name="medkit-outline" size={30} color={colors.text.secondary} />
              <Text style={styles.emptyTitle}>No doctors found</Text>
              <Text style={styles.emptyBody}>
                Try a different name or specialization — or clear the filters.
              </Text>
            </GlassCard>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.ctaGradient.end} />
              </View>
            ) : items.length > 0 && items.length < total ? (
              <Text style={styles.moreHint}>
                Showing {items.length} of {total}
              </Text>
            ) : null
          }
        />
      )}
    </GlassScreen>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const handlePress = () => {
    if (!active) hapticSelection();
    onPress();
  };
  return (
    <AnimatedChip
      active={active}
      bg={[colors.glass.chip, colors.interactive.selectedBg]}
      border={[colors.glass.border, colors.interactive.selectedBorder]}
      onPress={handlePress}
      accessibilityState={{ selected: active }}
      style={styles.chip}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </AnimatedChip>
  );
}

function DoctorCard({ doctor, onPress }: { doctor: DoctorSummary; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: colors.ripple, borderless: false, foreground: true }}
      style={({ pressed }) => [styles.cardWrap, pressed && styles.cardWrapPressed]}
    >
      <GlassCard padded style={styles.card}>
        <View style={styles.cardTop}>
          <Avatar name={doctor.fullName} size={52} uri={doctor.avatarUrl} />
          <View style={styles.cardInfo}>
            <Text style={styles.name} numberOfLines={1}>
              {doctor.fullName}
            </Text>
            <Text style={styles.spec} numberOfLines={1}>
              {doctor.specialization ?? 'General practice'}
            </Text>
            {doctor.registrationNumber ? (
              <Text style={styles.regNo} numberOfLines={1}>
                Reg. {doctor.registrationNumber}
              </Text>
            ) : null}
            <View style={styles.availabilityRow}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: doctor.isAvailableNow ? colors.available : colors.unavailable,
                  },
                ]}
              />
              <Text style={styles.availabilityText}>
                {doctor.isAvailableNow ? 'Available now' : 'Not available right now'}
              </Text>
            </View>
          </View>
          <View style={styles.cardMetrics}>
            <Text style={styles.fee}>{formatFee(doctor.fee)}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color={colors.star} />
              <Text style={styles.rating}>
                {formatRating(doctor.avgRating)}
                {doctor.reviewCount > 0 ? ` (${doctor.reviewCount})` : ''}
              </Text>
            </View>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: spacing.base,
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  chipRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  // B1 full-bleed: negative margin = the controls row's padding.
  chipRowScroll: { marginHorizontal: -spacing.base },
  chipTrailing: { width: spacing.base },
  // chip keeps structure only — bg/border crossfade in AnimatedChip.
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm - 2,
  },
  chipText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  chipTextActive: {
    ...typography.captionSemi,
    color: colors.interactive.selectedFg,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortChip: {
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
    backgroundColor: colors.glass.nested,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  sortChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  sortChipText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  sortChipTextActive: {
    ...typography.captionSemi,
    color: colors.white,
  },
  list: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    // B4: floating glass tab bar (~48px + safe inset) + breathing room. 96 is
    // the ONE documented literal (worklog 10-g) — the largest spacing token
    // (48) does not reach it.
    paddingBottom: 96,
    gap: spacing.md,
  },
  cardWrap: {
    borderRadius: radii.card,
    overflow: 'hidden', // FIX A: ripple + card content clip to the rounded shape
  },
  cardWrapPressed: {
    opacity: 0.9,
  },
  card: {},
  cardTop: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  cardInfo: { flex: 1, gap: 2 },
  name: { ...typography.h3, color: colors.text.primary },
  spec: { ...typography.caption, color: colors.text.secondary },
  // Registration number (Phase 11 A5) — rendered ONLY when set, never "N/A".
  regNo: { ...typography.micro, color: colors.status.CONFIRMED.fg, letterSpacing: 0.3 },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  availabilityText: { ...typography.micro, color: colors.text.secondary },
  cardMetrics: { alignItems: 'flex-end', gap: 2 },
  fee: { ...typography.h3, color: colors.text.primary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rating: { ...typography.caption, color: colors.text.secondary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCard: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xl },
  emptyTitle: { ...typography.h3, color: colors.text.primary },
  emptyBody: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  footerLoader: { paddingVertical: spacing.base },
  moreHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
