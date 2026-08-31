import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import {
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassScreen,
  StatusChip,
} from '@/components';
import { PulseView, useChangePulse } from '@/components/motion';
import { formatDateISO } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';
import { useLiveQueue } from '@/hooks/useLiveQueue';
import { colors, radii, spacing, typography } from '@/theme';
import type { AppointmentStatus } from '@/components';
import type { LiveQueueUpNext } from '@/lib/appointments';

/**
 * Live queue (public, masked) — auto-refreshes every 15s while focused and
 * stops on blur/unmount (the hook owns the interval). Pull-to-refresh for an
 * immediate update. When the caller is a PATIENT booked in this queue, their
 * row is highlighted with an accent border + "You" badge; anonymous visitors
 * see the identical screen minus that row (`my: null` never errors).
 */
export default function LiveQueueScreen() {
  const { scheduleId, date } = useLocalSearchParams<{ scheduleId: string; date: string }>();

  // Focus drives the hook's polling — true while the screen is on top.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const queue = useLiveQueue(scheduleId, date, focused);
  const data = queue.data;

  // -- live-change highlights (Phase 10-c motion) --------------------------------
  // Now-serving token changed → accent pulse on the Now-serving card.
  const nowPulse = useChangePulse(
    data?.current ? data.current.queueNumber : null,
    data?.current != null,
  );
  // "Your turn": my.status becomes CALLED → pulse the You card + one light
  // success haptic (guarded by a ref — exactly once per transition).
  const myStatus = data?.my ? data.my.status : null;
  const myPulse = useChangePulse(myStatus, myStatus === 'CALLED');
  const turnHapticFiredFor = useRef<unknown>(null);
  useEffect(() => {
    if (myStatus === 'CALLED' && turnHapticFiredFor.current !== myStatus) {
      turnHapticFiredFor.current = myStatus;
      hapticSuccess();
    }
    if (myStatus !== 'CALLED') turnHapticFiredFor.current = null;
  }, [myStatus]);

  return (
    <GlassScreen>
      <GlassHeader title="Live queue" />
      <View style={styles.body}>
        {/* -- header card ---------------------------------------------------- */}
        {data ? (
          <GlassCard padded style={styles.card}>
            <Text style={styles.clinic} numberOfLines={1}>
              {data.schedule.clinicName}
            </Text>
            <Text style={styles.doctor} numberOfLines={1}>
              Dr. {data.doctor.fullName}
              {data.doctor.specialization ? ` · ${data.doctor.specialization}` : ''}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={colors.text.secondary} />
              <Text style={styles.metaText}>
                {formatDateISO(data.date)} · {data.schedule.startTime} – {data.schedule.endTime}
              </Text>
            </View>
          </GlassCard>
        ) : null}

        {queue.error ? (
          <GlassCard padded style={styles.errorCard}>
            <ErrorBanner message={queue.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void queue.refresh()}
            />
          </GlassCard>
        ) : null}

        {queue.loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : data ? (
          <FlatList
            data={data.upNext}
            keyExtractor={(item) => String(item.queueNumber)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={queue.refreshing}
                onRefresh={() => void queue.refresh()}
                tintColor="#4D9FDE"
              />
            }
            ListHeaderComponent={
              <View style={styles.gapColumn}>
                {/* -- now serving -------------------------------------------------- */}
                <GlassCard padded style={styles.nowCard}>
                  <PulseView pulse={nowPulse} />
                  <Text style={styles.nowLabel}>Now serving</Text>
                  {data.current ? (
                    <>
                      <Text style={styles.nowToken}>#{data.current.queueNumber}</Text>
                      <Text style={styles.nowName}>{data.current.patientName}</Text>
                    </>
                  ) : (
                    <Text style={styles.nowIdle}>Queue not started yet</Text>
                  )}
                </GlassCard>

                {/* -- my row (anonymous-safe) -------------------------------------- */}
                {data.my ? (
                  <GlassCard padded style={styles.myCard}>
                    <PulseView
                      pulse={myPulse}
                      tint={['rgba(245, 166, 35, 0)', 'rgba(245, 166, 35, 0.18)']}
                    />
                    <View style={styles.myHead}>
                      <View style={styles.youBadge}>
                        <Text style={styles.youBadgeText}>You</Text>
                      </View>
                      <StatusChip status={data.my.status as AppointmentStatus} />
                    </View>
                    <View style={styles.myRow}>
                      <Text style={styles.myToken}>#{data.my.queueNumber}</Text>
                      <Text style={styles.myWait}>
                        {data.my.status === 'CALLED'
                          ? 'It is your turn — go to the desk'
                          : data.my.estWaitMin > 0
                            ? `~${data.my.estWaitMin} min to go`
                            : 'You are next'}
                      </Text>
                    </View>
                  </GlassCard>
                ) : null}

                {/* -- counts -------------------------------------------------------- */}
                <View style={styles.countsRow}>
                  <CountPill
                    icon="checkmark-done-outline"
                    label="Completed"
                    value={data.counts.completed}
                  />
                  <CountPill icon="megaphone-outline" label="Called" value={data.counts.called} />
                  <CountPill icon="hourglass-outline" label="Waiting" value={data.counts.waiting} />
                </View>

                <View style={styles.upNextTitleRow}>
                  <Ionicons name="list-outline" size={15} color={colors.text.secondary} />
                  <Text style={styles.upNextTitle}>Up next</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <UpNextRow item={item} myQueueNumber={data.my?.queueNumber ?? null} />
            )}
            ListEmptyComponent={
              <GlassCard padded style={styles.emptyCard}>
                <Ionicons name="time-outline" size={26} color={colors.text.secondary} />
                <Text style={styles.emptyTitle}>Nobody waiting</Text>
                <Text style={styles.emptyBody}>
                  {data.current
                    ? 'The current visit is still in progress.'
                    : 'Be the first — book a token for this schedule.'}
                </Text>
              </GlassCard>
            }
            ListFooterComponent={
              <Text style={styles.pollHint}>Auto-refreshes every 15 seconds</Text>
            }
          />
        ) : null}
      </View>
    </GlassScreen>
  );
}

function UpNextRow({
  item,
  myQueueNumber,
}: {
  item: LiveQueueUpNext;
  myQueueNumber: number | null;
}) {
  const isMe = myQueueNumber !== null && item.queueNumber === myQueueNumber;
  return (
    <GlassCard nested style={[styles.upNextRow, isMe && styles.upNextRowMine]}>
      <Text style={styles.upNextToken}>#{item.queueNumber}</Text>
      <Text style={styles.upNextName} numberOfLines={1} ellipsizeMode="tail">
        {item.patientName}
      </Text>
      <Text style={styles.upNextWait}>{item.estWaitMin > 0 ? `~${item.estWaitMin}m` : 'next'}</Text>
    </GlassCard>
  );
}

function CountPill({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.countPill}>
      <Ionicons name={icon} size={14} color={colors.text.secondary} />
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  clinic: { ...typography.h3, color: colors.text.primary },
  doctor: { ...typography.caption, color: colors.text.secondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  metaText: { ...typography.caption, color: colors.text.secondary },
  errorCard: { gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingBottom: spacing.xxl, gap: spacing.sm },
  gapColumn: { gap: spacing.md, marginBottom: spacing.sm },
  nowCard: { alignItems: 'center', gap: 2, paddingVertical: spacing.lg },
  nowLabel: {
    ...typography.micro,
    color: colors.text.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nowToken: {
    ...typography.display,
    color: colors.status.CALLED.fg,
    fontWeight: '800',
  },
  nowName: { ...typography.caption, color: colors.text.secondary },
  nowIdle: { ...typography.h3, color: colors.text.secondary, marginTop: spacing.xs },
  myCard: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(245, 166, 35, 0.10)',
  },
  myHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  youBadge: {
    backgroundColor: colors.accent,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  youBadgeText: {
    ...typography.micro,
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  myRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  myToken: { ...typography.h1, color: colors.text.primary, fontWeight: '800' },
  myWait: { ...typography.bodySemi, color: colors.text.primary, flexShrink: 1, textAlign: 'right' },
  countsRow: { flexDirection: 'row', gap: spacing.sm },
  countPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingVertical: spacing.md,
  },
  countValue: { ...typography.bodySemi, color: colors.text.primary },
  countLabel: { ...typography.micro, color: colors.text.secondary },
  upNextTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  upNextTitle: { ...typography.captionSemi, color: colors.text.secondary },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  upNextRowMine: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
  },
  upNextToken: { ...typography.bodySemi, color: colors.status.CALLED.fg, width: 44 },
  upNextName: { ...typography.body, color: colors.text.primary, flex: 1 },
  upNextWait: { ...typography.caption, color: colors.text.secondary },
  emptyCard: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.lg },
  emptyTitle: { ...typography.h3, color: colors.text.primary },
  emptyBody: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  pollHint: {
    ...typography.micro,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
