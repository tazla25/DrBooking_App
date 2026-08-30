import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassModal,
  GlassScreen,
  GlassTextField,
  GlassToast,
  PrimaryButton,
  StatusChip,
  useToast,
} from '@/components';
import { usePendingDoctors } from '@/hooks/usePendingDoctors';
import { isApiError, toFriendlyMessage } from '@/lib/errors';
import { formatDateISO } from '@/lib/format';
import { istDateOfISO } from '@/lib/time';
import { verifyDoctor, type PendingDoctor } from '@/lib/admin';
import { validateVerificationNote } from '@/lib/validation';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * A1 — Verification tab: the pending-doctor queue (oldest-first FIFO).
 *
 * Card: name, phone, specialization, fee, years of experience, bio
 * (collapsible), applied date (IST — C4). `doctorProfile` CAN be null →
 * "no profile yet" state. Approve posts immediately; Reject opens a modal
 * with an optional note (max 500 chars). Success → refetch (the row is
 * dropped server-side) + toast. 409 INVALID_TRANSITION (another admin acted
 * first) → refetch + info toast, exactly the Phase 6 appointments pattern.
 */
export default function AdminVerificationScreen() {
  const list = usePendingDoctors();
  const { toast, show } = useToast();

  const [actingOn, setActingOn] = useState<string | null>(null); // userId being approved
  const [rejecting, setRejecting] = useState<PendingDoctor | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectNoteError, setRejectNoteError] = useState<string | null>(null);
  const [rejectingBusy, setRejectingBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const displayName = (item: PendingDoctor): string => item.doctorProfile?.fullName ?? item.name;

  const decide = async (item: PendingDoctor, decision: 'VERIFIED' | 'REJECTED', note?: string) => {
    const who = displayName(item);
    try {
      await verifyDoctor({ userId: item.id, decision, note });
      await list.refresh();
      show(decision === 'VERIFIED' ? `Dr. ${who} verified` : `Dr. ${who} rejected`, 'success');
    } catch (err) {
      // Another admin verified/rejected first (or the row vanished) — the
      // queue refetches and we surface the server's verdict as info.
      if (isApiError(err) && err.code === 'INVALID_TRANSITION') {
        await list.refresh().catch(() => undefined);
        show(`This application was already handled — queue refreshed`, 'info');
      } else {
        show(toFriendlyMessage(err), 'error');
      }
    }
  };

  const approve = async (item: PendingDoctor) => {
    setActingOn(item.id);
    try {
      await decide(item, 'VERIFIED');
    } finally {
      setActingOn(null);
    }
  };

  const openReject = (item: PendingDoctor) => {
    setRejecting(item);
    setRejectNote('');
    setRejectNoteError(null);
    setRejectError(null);
  };

  const submitReject = async () => {
    if (!rejecting) return;
    const noteError = validateVerificationNote(rejectNote);
    setRejectNoteError(noteError);
    if (noteError) return;

    setRejectingBusy(true);
    setRejectError(null);
    try {
      await decide(rejecting, 'REJECTED', rejectNote);
      setRejecting(null);
    } catch (err) {
      // Kept in the modal for a retry (network/permission failures).
      if (isApiError(err) && err.code === 'INVALID_TRANSITION') {
        setRejecting(null); // already handled elsewhere — modal closes, queue refreshed
      } else {
        setRejectError(toFriendlyMessage(err));
      }
    } finally {
      setRejectingBusy(false);
    }
  };

  return (
    <GlassScreen>
      <GlassHeader title="Verification" back={false} />
      <View style={styles.body}>
        {list.error && list.items.length === 0 ? (
          <View style={styles.center}>
            <ErrorBanner message={list.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void list.refresh()}
            />
          </View>
        ) : list.loading && list.items.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : list.items.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              icon="shield-checkmark-outline"
              title="No pending applications"
              caption="New doctor sign-ups land here for verification, oldest first."
            />
          </View>
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={list.refreshing}
                onRefresh={() => void list.refresh()}
                tintColor={colors.ctaGradient.end}
              />
            }
            onEndReached={() => void list.loadMore()}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={
              <View style={styles.counterRow}>
                <Ionicons name="hourglass-outline" size={15} color={colors.text.secondary} />
                <Text style={styles.counterText}>
                  {list.total} pending application{list.total === 1 ? '' : 's'}
                </Text>
              </View>
            }
            ListFooterComponent={
              list.loadingMore ? (
                <ActivityIndicator color={colors.ctaGradient.end} style={styles.footer} />
              ) : list.complete ? (
                <Text style={styles.footerHint}>End of the queue</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <GlassCard padded style={styles.card}>
                <View style={styles.topRow}>
                  <Avatar name={displayName(item)} size={48} />
                  <View style={styles.identity}>
                    <Text style={styles.name} numberOfLines={1}>
                      Dr. {displayName(item)}
                    </Text>
                    <Text style={styles.phone}>{item.phone}</Text>
                  </View>
                  <StatusChip status="PENDING" />
                </View>

                {item.doctorProfile ? (
                  <View style={styles.profileFacts}>
                    <FactRow
                      icon="ribbon-outline"
                      label={item.doctorProfile.specialization ?? 'General practice'}
                    />
                    <View style={styles.factPair}>
                      <FactRow icon="cash-outline" label={`Fee ${item.doctorProfile.fee ?? '—'}`} />
                      <FactRow
                        icon="briefcase-outline"
                        label={`${item.doctorProfile.yearsExperience ?? 0} yrs experience`}
                      />
                    </View>
                    {item.doctorProfile.bio ? (
                      <BioText bio={item.doctorProfile.bio} />
                    ) : (
                      <Text style={styles.bioMissing}>No bio provided.</Text>
                    )}
                  </View>
                ) : (
                  <View style={styles.noProfile}>
                    <Ionicons name="alert-circle-outline" size={16} color="#B27415" />
                    <Text style={styles.noProfileText}>
                      No profile yet — the doctor has not added clinic details.
                    </Text>
                  </View>
                )}

                <Text style={styles.applied}>
                  Applied {formatDateISO(istDateOfISO(item.createdAt))}
                </Text>

                <View style={styles.actions}>
                  <PrimaryButton
                    label="Approve"
                    icon="checkmark-outline"
                    loading={actingOn === item.id}
                    disabled={actingOn !== null || rejectingBusy}
                    onPress={() => void approve(item)}
                    style={styles.actionBtn}
                  />
                  <GlassButton
                    label="Reject"
                    icon="close-outline"
                    tone="destructive"
                    disabled={actingOn !== null || rejectingBusy}
                    onPress={() => openReject(item)}
                    style={styles.actionBtn}
                  />
                </View>
              </GlassCard>
            )}
          />
        )}
      </View>

      {/* -- reject modal ---------------------------------------------------- */}
      <GlassModal
        visible={rejecting !== null}
        title={rejecting ? `Reject Dr. ${displayName(rejecting)}` : 'Reject application'}
        dismissable={!rejectingBusy}
        onClose={() => setRejecting(null)}
      >
        <Text style={styles.rejectHint}>
          The doctor keeps their account but cannot log in until re-verified. An optional note is
          recorded in the audit trail (max 500 characters).
        </Text>
        <GlassTextField
          label="Note (optional)"
          icon="chatbubble-outline"
          value={rejectNote}
          onChangeText={(v) => setRejectNote(v)}
          error={rejectNoteError}
          placeholder="e.g. Specialization certificate missing"
          multiline
        />
        {rejectError ? <ErrorBanner message={rejectError} /> : null}
        <PrimaryButton
          label="Reject application"
          icon="close-outline"
          tone="destructive"
          loading={rejectingBusy}
          onPress={() => void submitReject()}
        />
        <GlassButton label="Cancel" icon="close-outline" onPress={() => setRejecting(null)} />
      </GlassModal>

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

function FactRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={14} color={colors.text.secondary} />
      <Text style={styles.factText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Bio clamped to 2 lines with a More/Less toggle (long profiles stay tidy). */
function BioText({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.bioWrap}>
      <Text style={styles.bio} numberOfLines={expanded ? undefined : 2}>
        {bio}
      </Text>
      {bio.length > 90 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((v) => !v)}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Text style={styles.bioToggle}>{expanded ? 'Less' : 'More'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
    gap: spacing.base,
  },
  listContent: { padding: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.base },
  card: { gap: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  name: { ...typography.h3, color: colors.text.primary, flexShrink: 1 },
  phone: { ...typography.caption, color: colors.text.secondary },
  profileFacts: { gap: spacing.sm },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  factText: { ...typography.caption, color: colors.text.secondary, flex: 1 },
  factPair: { flexDirection: 'row', gap: spacing.lg },
  bioWrap: { gap: 2 },
  bio: { ...typography.caption, color: colors.text.secondary },
  bioToggle: { ...typography.captionSemi, color: colors.ctaGradient.end },
  bioMissing: { ...typography.caption, color: colors.text.secondary, fontStyle: 'italic' },
  noProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(245, 166, 35, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.30)',
    borderRadius: radii.inner,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noProfileText: { ...typography.caption, color: '#B27415', flex: 1 },
  applied: { ...typography.caption, color: colors.text.secondary },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { flex: 1 },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: -spacing.xs,
  },
  counterText: { ...typography.captionSemi, color: colors.text.secondary },
  footer: { marginTop: spacing.base },
  footerHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.base,
  },
  rejectHint: { ...typography.caption, color: colors.text.secondary },
});
