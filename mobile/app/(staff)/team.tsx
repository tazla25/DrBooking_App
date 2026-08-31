import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
  useToast,
} from '@/components';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDateISO } from '@/lib/format';
import { istDateOfISO } from '@/lib/time';
import {
  createCompounder,
  deactivateCompounder,
  fetchCompounders,
  type CompounderRecord,
} from '@/lib/staff';
import { isValidName, isValidPhone, normalizePhoneInput } from '@/lib/validation';
import { hapticSelection, hapticWarning } from '@/lib/haptics';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

/**
 * Staff console — Team tab (DOCTOR ONLY; hidden from compounders in the tab
 * layout — the server 403s them anyway, which maps to a friendly message).
 *
 * The tempPassword returned by POST /api/compounders is shown EXACTLY ONCE
 * in a dedicated modal: large monospace text + Copy + an explicit "I've
 * saved it — close forever" confirmation. Closing without confirming is
 * blocked (the modal is not dismissable).
 */
export default function StaffTeamScreen() {
  const { toast, show } = useToast();

  const [compounders, setCompounders] = useState<CompounderRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // State updates happen ONLY in the async callbacks (never synchronously
  // inside the effect body — react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true;
    fetchCompounders()
      .then((data) => {
        if (!alive) return;
        setCompounders(data.compounders);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(toFriendlyMessage(err)); // e.g. 403 for a compounder caller
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /** Pull-to-refresh + refetch-after-mutation — event handler. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await fetchCompounders();
      setCompounders(data.compounders);
      setError(null);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  // -- add compounder -----------------------------------------------------------
  const [addVisible, setAddVisible] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // -- one-time temp password -----------------------------------------------------
  const [created, setCreated] = useState<{
    name: string;
    phone: string;
    tempPassword: string;
  } | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const openAdd = () => {
    setName('');
    setPhone('');
    setFieldErrors({});
    setAddError(null);
    setAddVisible(true);
  };

  const submitAdd = async () => {
    const errors: typeof fieldErrors = {};
    if (!isValidName(name)) errors.name = 'Enter the compounder name (2–100)';
    if (!isValidPhone(phone)) errors.phone = 'Enter a valid phone number';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setAdding(true);
    setAddError(null);
    try {
      const normalized = normalizePhoneInput(phone);
      if (!normalized) throw new Error('Invalid phone number');
      const data = await createCompounder(name, normalized);
      setAddVisible(false);
      setSavedConfirmed(false);
      setCopied(false);
      setCreated({ name: data.user.name, phone: data.user.phone, tempPassword: data.tempPassword });
      await refresh(); // refetch-after-success
    } catch (err) {
      // 409 PHONE_EXISTS and validation errors stay inside the form.
      setAddError(toFriendlyMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const copyTempPassword = async () => {
    if (!created) return;
    try {
      await Clipboard.setStringAsync(created.tempPassword);
      setCopied(true);
      hapticSelection();
      show('Temp password copied', 'success');
    } catch {
      show('Could not access the clipboard — copy it manually', 'error');
    }
  };

  const closeTempPassword = () => {
    if (!savedConfirmed) return; // blocked until the user confirms saving
    setCreated(null);
    show('Compounder ready — share the password securely', 'info');
  };

  // -- deactivate -------------------------------------------------------------------
  const [deactivateTarget, setDeactivateTarget] = useState<CompounderRecord | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await deactivateCompounder(deactivateTarget.id);
      setDeactivateTarget(null);
      hapticWarning(); // destructive confirmation
      show(`${deactivateTarget.name} deactivated — sessions revoked`, 'success');
      await refresh(); // refetch-after-success
    } catch (err) {
      show(toFriendlyMessage(err), 'error');
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <GlassScreen>
      <GlassHeader title="Team" back={false} />
      <View style={styles.body}>
        {compounders === null && !error ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : error && compounders === null ? (
          <GlassCard padded style={styles.card}>
            <ErrorBanner message={error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => setReloadKey((k) => k + 1)}
            />
          </GlassCard>
        ) : (
          <FlatList
            data={compounders ?? []}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon="people-circle-outline"
                title="No compounders yet"
                caption="Add a compounder so they can run the queue for you. They sign in on a temp password and change it on first login."
                ctaLabel="Add compounder"
                onCta={openAdd}
              />
            }
            ListFooterComponent={
              (compounders ?? []).length > 0 ? (
                <PrimaryButton label="Add compounder" icon="person-add-outline" onPress={openAdd} />
              ) : null
            }
            renderItem={({ item }) => (
              <CompounderRow compounder={item} onDeactivate={() => setDeactivateTarget(item)} />
            )}
          />
        )}
      </View>

      {/* -- add compounder --------------------------------------------------------- */}
      <GlassModal
        visible={addVisible}
        title="Add compounder"
        dismissable={!adding}
        onClose={() => setAddVisible(false)}
      >
        <Text style={styles.addHint}>
          A one-time temp password is generated for them — they must change it at first login.
        </Text>
        <GlassTextField
          label="Name"
          icon="person-outline"
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
          placeholder="Full name"
        />
        <GlassTextField
          label="Phone"
          icon="call-outline"
          value={phone}
          onChangeText={setPhone}
          error={fieldErrors.phone}
          placeholder="98765 43210"
          keyboardType="phone-pad"
        />
        {addError ? <ErrorBanner message={addError} /> : null}
        <View style={styles.confirmButtons}>
          <PrimaryButton
            label="Create account"
            icon="person-add-outline"
            loading={adding}
            onPress={() => void submitAdd()}
          />
          <GlassButton label="Cancel" disabled={adding} onPress={() => setAddVisible(false)} />
        </View>
      </GlassModal>

      {/* -- one-time temp password ---------------------------------------------------- */}
      <GlassModal
        visible={created !== null}
        title="Save this temp password"
        dismissable={false} // closing without confirming is BLOCKED
      >
        {created ? (
          <>
            <Text style={styles.tempIntro}>
              {created.name} · {created.phone}
            </Text>
            <View style={styles.tempPasswordCard}>
              <Text style={styles.tempPassword} selectable>
                {created.tempPassword}
              </Text>
            </View>
            <Text style={styles.tempWarning}>
              Shown exactly once — it is never retrievable again. Copy it now and share it securely.
            </Text>
            <GlassButton
              label={copied ? 'Copied' : 'Copy password'}
              icon={copied ? 'checkmark-circle-outline' : 'copy-outline'}
              onPress={() => void copyTempPassword()}
            />
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>I&apos;ve saved it</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: savedConfirmed }}
                accessibilityLabel="I've saved it"
                onPress={() => {
                  hapticSelection();
                  setSavedConfirmed((v) => !v);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) => [styles.checkboxWrap, pressed && styles.checkboxPressed]}
              >
                <Ionicons
                  name={savedConfirmed ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={savedConfirmed ? colors.success : colors.text.secondary}
                />
              </Pressable>
            </View>
            <PrimaryButton
              label="Close forever"
              icon="lock-closed-outline"
              disabled={!savedConfirmed}
              onPress={closeTempPassword}
            />
          </>
        ) : null}
      </GlassModal>

      {/* -- deactivate confirm ----------------------------------------------------------- */}
      <GlassModal
        visible={deactivateTarget !== null}
        title="Deactivate compounder?"
        dismissable={!deactivating}
        onClose={() => setDeactivateTarget(null)}
      >
        {deactivateTarget ? (
          <>
            <Text style={styles.confirmText}>
              {deactivateTarget.name} ({deactivateTarget.phone}) will be signed out immediately —
              all their sessions are revoked and they cannot log in again. This cannot be undone:
              there is no reactivate. Their history is kept.
            </Text>
            <View style={styles.confirmButtons}>
              <PrimaryButton
                label="Yes, deactivate"
                tone="destructive"
                loading={deactivating}
                onPress={() => void doDeactivate()}
              />
              <GlassButton
                label="Keep them"
                disabled={deactivating}
                onPress={() => setDeactivateTarget(null)}
              />
            </View>
          </>
        ) : null}
      </GlassModal>

      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

function CompounderRow({
  compounder,
  onDeactivate,
}: {
  compounder: CompounderRecord;
  onDeactivate: () => void;
}) {
  const active = compounder.isActive;
  return (
    <GlassCard padded style={[styles.card, !active && styles.inactiveCard]}>
      <View style={styles.row}>
        <Avatar name={compounder.name} size={44} />
        <View style={styles.identity}>
          <Text style={[styles.name, !active && styles.mutedText]} numberOfLines={1}>
            {compounder.name}
          </Text>
          <Text style={styles.phone}>{compounder.phone}</Text>
        </View>
        <View style={[styles.statusChip, active ? styles.activeChip : styles.goneChip]}>
          <Text style={active ? styles.activeChipText : styles.goneChipText}>
            {active ? 'ACTIVE' : 'DEACTIVATED'}
          </Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        {active && compounder.mustChangePassword ? (
          <View style={styles.pendingChip}>
            <Ionicons name="key-outline" size={12} color={colors.status.PENDING.fg} />
            <Text style={styles.pendingChipText}>Must change password — never signed in</Text>
          </View>
        ) : null}
        <Text style={styles.joined}>
          Joined {formatDateISO(istDateOfISO(compounder.createdAt))}
        </Text>
      </View>
      {active ? (
        <GlassButton
          label="Deactivate"
          icon="remove-circle-outline"
          tone="destructive"
          onPress={onDeactivate}
          style={styles.deactivateBtn}
        />
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.base },
  card: { gap: spacing.sm },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.xs },
  name: { ...typography.bodySemi, color: colors.text.primary, flexShrink: 1 },
  phone: { ...typography.caption, color: colors.text.secondary },
  mutedText: { color: colors.unavailable },
  inactiveCard: { opacity: 0.72 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  joined: { ...typography.micro, color: colors.text.secondary },

  statusChip: {
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  activeChip: {
    backgroundColor: 'rgba(61, 178, 115, 0.18)',
    borderColor: 'rgba(61, 178, 115, 0.35)',
  },
  activeChipText: {
    ...typography.micro,
    color: colors.status.CONFIRMED.fg,
    letterSpacing: 0.4,
  },
  goneChip: { backgroundColor: 'rgba(138, 147, 166, 0.20)', borderColor: colors.glass.border },
  goneChipText: { ...typography.micro, color: colors.status.NO_SHOW.fg, letterSpacing: 0.4 },

  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(245, 166, 35, 0.18)',
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pendingChipText: { ...typography.micro, color: colors.status.PENDING.fg },

  deactivateBtn: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: spacing.lg },
  checkboxWrap: { padding: spacing.xs },
  checkboxPressed: { opacity: 0.6 },

  // add modal
  addHint: { ...typography.caption, color: colors.text.secondary, textAlign: 'center' },
  confirmButtons: { gap: spacing.sm },

  // temp password modal
  tempIntro: { ...typography.captionSemi, color: colors.text.secondary, textAlign: 'center' },
  tempPasswordCard: {
    alignItems: 'center',
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
  },
  tempPassword: {
    ...typography.h2, // was a 26px literal — Phase 10-c token sweep
    color: colors.text.primary,
    letterSpacing: 1.5,
    // One-time password stays UNAMBIGUOUS: platform monospace via the
    // fontFamily.mono token ('Courier' iOS / 'monospace' Android).
    fontFamily: fontFamily.mono,
  },
  tempWarning: { ...typography.caption, color: colors.destructive, textAlign: 'center' },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  confirmLabel: { ...typography.body, color: colors.text.primary },

  // deactivate modal
  confirmText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
});
