import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassModal,
  GlassScreen,
  GlassTextField,
  NotificationsCard,
  PrimaryButton,
  StatusChip,
} from '@/components';
import { api } from '@/lib/api';
import {
  updateDoctorProfile,
  type DoctorProfilePatchBody,
  type DoctorProfileView,
} from '@/lib/staff';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDateISO } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';
import { istDateOfISO } from '@/lib/time';
import {
  validateProfileEditForm,
  type ProfileEditFormErrors,
  type ProfileEditFormValues,
} from '@/lib/validation';
import type { MeResponse } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Staff console — Profile tab: identity (name, phone, role, verification,
 * delegated doctor for compounders), change-password deep link, sign out,
 * version label.
 *
 * Phase 11 (A4/A5): DOCTOR accounts get an "Edit profile" mode (GlassModal)
 * — avatar pick → compress → upload via PATCH /api/doctors/me, plus the
 * editable text fields including the medical council Registration No.
 * (shown to patients for trust). Tapping the avatar opens a full preview.
 * Compounders see the same identity card read-only (PATCH is doctor-only).
 */

/** Avatar pipeline: single square edit → ≤512×512 JPEG q0.7 → base64 data URL. */
async function pickAvatarDataUrl(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;

  // allowsEditing already cropped to a square — resize to at most 512×512
  // (never upscale a smaller photo) and re-encode as JPEG q0.7.
  const side = Math.min(512, Math.max(asset.width, asset.height) || 512);
  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: side, height: side } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  return `data:image/jpeg;base64,${manipulated.base64}`;
}

export default function StaffProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<MeResponse>('/api/auth/me')
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const isCompounder = user.role === 'COMPOUNDER';
  const roleLabel = isCompounder ? 'Compounder' : 'Doctor';
  const doctorProfile = me?.doctorProfile ?? null;

  return (
    <GlassScreen>
      <GlassHeader title="Profile" back={false} />
      <View style={styles.body}>
        {/* -- identity -------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={user.name} size={56} uri={doctorProfile?.avatarUrl ?? null} />
            <View style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <View style={styles.chipRow}>
                <View style={styles.roleChip}>
                  <Text style={styles.roleChipText}>{roleLabel.toUpperCase()}</Text>
                </View>
                <StatusChip
                  status={user.verificationStatus === 'VERIFIED' ? 'COMPLETED' : 'PENDING'}
                />
              </View>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Ionicons name="call-outline" size={15} color={colors.text.secondary} />
            <Text style={styles.metaText}>{user.phone}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.text.secondary} />
            <Text style={styles.metaText}>
              Member since {formatDateISO(istDateOfISO(user.createdAt))}
            </Text>
          </View>
          {isCompounder && me?.doctorProfile ? (
            <View style={styles.metaRow}>
              <Ionicons name="medkit-outline" size={15} color={colors.text.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                Assisting Dr. {me.doctorProfile.fullName}
              </Text>
            </View>
          ) : null}
          {!isCompounder && doctorProfile?.specialization ? (
            <View style={styles.metaRow}>
              <Ionicons name="ribbon-outline" size={15} color={colors.text.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {doctorProfile.specialization}
              </Text>
            </View>
          ) : null}
          {!isCompounder && doctorProfile?.registrationNumber ? (
            <View style={styles.metaRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.text.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                Reg. {doctorProfile.registrationNumber}
              </Text>
            </View>
          ) : null}
        </GlassCard>

        {/* -- edit profile (Phase 11 A4, doctor-only) ------------------------------ */}
        {!isCompounder ? (
          <ProfileEditCard me={me} onSaved={(view) => applySavedProfile(view)} />
        ) : null}

        {/* -- notifications (B4) -------------------------------------------------- */}
        <NotificationsCard />

        {/* -- change password --------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Security</Text>
          <GlassButton
            label="Change password"
            icon="key-outline"
            onPress={() => router.push('/(auth)/change-password')}
          />
        </GlassCard>

        {/* -- sign out -------------------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <Text style={styles.sectionTitle}>Session</Text>
          <GlassButton
            label="Sign out"
            icon="log-out-outline"
            tone="destructive"
            onPress={() => void onLogout()}
          />
        </GlassCard>

        <Text style={styles.version}>ClinIQ · Phase 11</Text>
      </View>
    </GlassScreen>
  );

  /** Optimistic profile hydration after a successful save (me stays the
   * single source for the identity card + the next edit form). */
  function applySavedProfile(view: DoctorProfileView): void {
    setMe((prev) =>
      prev
        ? {
            ...prev,
            doctorProfile: {
              id: view.id,
              fullName: view.fullName,
              specialization: view.specialization,
              fee: view.fee,
              yearsExperience: view.yearsExperience,
              bio: view.bio ?? null,
              registrationNumber: view.registrationNumber,
              avatarUrl: view.avatarUrl,
            },
          }
        : prev,
    );
  }
}

// ---------------------------------------------------------------------------
// Edit profile card + modal (Phase 11 A4)
// ---------------------------------------------------------------------------

function ProfileEditCard({
  me,
  onSaved,
}: {
  me: MeResponse | null;
  onSaved: (view: DoctorProfileView) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  // Bumped on every open — remounts the modal so the form re-hydrates from
  // the CURRENT profile (rule-safe: no setState inside effects).
  const [editKey, setEditKey] = useState(0);

  const profile = me?.doctorProfile ?? null;
  const avatarUri = profile?.avatarUrl ?? null;

  const openEdit = () => {
    setEditKey((k) => k + 1);
    setVisible(true);
  };

  return (
    <GlassCard padded style={styles.card}>
      <Text style={styles.sectionTitle}>Doctor profile</Text>
      <Text style={styles.editCaption}>
        Your photo and registration number are shown to patients — keep them current for trust.
      </Text>
      <GlassButton
        label="Edit profile"
        icon="create-outline"
        disabled={profile === null}
        onPress={openEdit}
      />
      {/* Tap the avatar → full preview (works from the card too). */}
      {avatarUri ? (
        <GlassButton
          label="View photo"
          icon="eye-outline"
          onPress={() => setPreviewVisible(true)}
        />
      ) : null}

      <ProfileEditModal
        key={editKey}
        visible={visible}
        me={me}
        onClose={() => setVisible(false)}
        onSaved={onSaved}
      />

      {/* -- full avatar preview -------------------------------------------------- */}
      <GlassModal
        visible={previewVisible && avatarUri !== null}
        title="Profile photo"
        onClose={() => setPreviewVisible(false)}
      >
        {avatarUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: avatarUri }} style={styles.previewImage} />
            <Text style={styles.previewCaption}>
              Shown to patients on your profile and booking screens.
            </Text>
          </View>
        ) : null}
      </GlassModal>
    </GlassCard>
  );
}

function ProfileEditModal({
  visible,
  me,
  onClose,
  onSaved,
}: {
  visible: boolean;
  me: MeResponse | null;
  onClose: () => void;
  onSaved: (view: DoctorProfileView) => void;
}) {
  const profile = me?.doctorProfile ?? null;

  // Initialized ON MOUNT from the CURRENT profile (the parent remounts this
  // modal on every open via `key` — fresh form, no setState-in-effect).
  const [form, setForm] = useState<ProfileEditFormValues>(() => emptyForm(profile));
  const [errors, setErrors] = useState<ProfileEditFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);

  const set = <K extends keyof ProfileEditFormValues>(key: K, value: ProfileEditFormValues[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const currentAvatar = form.avatarUrl ?? profile?.avatarUrl ?? null;

  const changePhoto = async () => {
    if (picking || submitting) return;
    setPicking(true);
    setError(null);
    try {
      const dataUrl = await pickAvatarDataUrl();
      if (dataUrl === null) return; // user cancelled — not an error
      // Client mirror of the server rules (type + size) with a human message.
      set('avatarUrl', dataUrl);
    } catch {
      setError('Could not read that photo. Try picking it again.');
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (submitting || !profile) return;
    const found = validateProfileEditForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    setError(null);

    // The PATCH body — blank optional fields clear (null); an untouched
    // avatar is omitted entirely (sending null would CLEAR the stored photo).
    const patch: DoctorProfilePatchBody = {
      specialization: form.specialization.trim() === '' ? null : form.specialization.trim(),
      fee: form.fee.trim() === '' ? null : Number(form.fee.trim()),
      yearsExperience:
        form.yearsExperience.trim() === '' ? null : Number(form.yearsExperience.trim()),
      bio: form.bio.trim() === '' ? null : form.bio.trim(),
      registrationNumber:
        form.registrationNumber.trim() === '' ? null : form.registrationNumber.trim(),
    };
    if (form.avatarUrl !== null) patch.avatarUrl = form.avatarUrl;

    // Optimistic: apply to the identity card immediately; roll back on failure.
    const previous = profile;
    onSaved(optimisticView(previous, patch, form.avatarUrl));

    try {
      const saved = await updateDoctorProfile(patch);
      hapticSuccess();
      onSaved(saved);
      onClose();
    } catch (err) {
      // Rollback + keep the modal open with the mapped error.
      onSaved(optimisticView(previous, null, null));
      setError(toFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassModal
      visible={visible && profile !== null}
      title="Edit profile"
      dismissable={!submitting}
      onClose={onClose}
    >
      {profile ? (
        <>
          {/* -- avatar row -------------------------------------------------------- */}
          <View style={styles.avatarRow}>
            {picking ? (
              <View style={styles.avatarPicking}>
                <ActivityIndicator color={colors.ctaGradient.end} />
              </View>
            ) : (
              <Avatar name={profile.fullName} size={72} uri={currentAvatar} />
            )}
            <View style={styles.avatarActions}>
              <GlassButton
                label={currentAvatar ? 'Change photo' : 'Add photo'}
                icon="image-outline"
                disabled={submitting || picking}
                onPress={() => void changePhoto()}
              />
              <Text style={styles.avatarHint}>Square crop, compressed to at most 512×512.</Text>
            </View>
          </View>
          {errors.avatarUrl ? <ErrorBanner message={errors.avatarUrl} /> : null}

          <GlassTextField
            label="Specialization"
            icon="ribbon-outline"
            value={form.specialization}
            onChangeText={(v) => set('specialization', v)}
            error={errors.specialization}
            placeholder="e.g. Cardiologist"
          />
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <GlassTextField
                label="Fee (₹)"
                icon="cash-outline"
                value={form.fee}
                onChangeText={(v) => set('fee', v)}
                error={errors.fee}
                placeholder="e.g. 300"
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.fieldHalf}>
              <GlassTextField
                label="Experience (yrs)"
                icon="time-outline"
                value={form.yearsExperience}
                onChangeText={(v) => set('yearsExperience', v)}
                error={errors.yearsExperience}
                placeholder="e.g. 9"
                keyboardType="number-pad"
              />
            </View>
          </View>
          <GlassTextField
            label="Bio"
            icon="document-text-outline"
            value={form.bio}
            onChangeText={(v) => set('bio', v)}
            error={errors.bio}
            placeholder="A short introduction patients will see"
            multiline
          />
          <GlassTextField
            label="Registration No."
            icon="shield-checkmark-outline"
            value={form.registrationNumber}
            onChangeText={(v) => set('registrationNumber', v)}
            error={errors.registrationNumber}
            placeholder="e.g. BMDC-A-12345"
          />
          <Text style={styles.regHelper}>
            Your medical council registration number — shown to patients for trust.
          </Text>

          {error ? <ErrorBanner message={error} /> : null}

          <View style={styles.modalButtons}>
            <PrimaryButton
              label="Save changes"
              icon="checkmark-outline"
              loading={submitting}
              onPress={() => void submit()}
            />
            <GlassButton label="Cancel" disabled={submitting} onPress={onClose} />
          </View>
        </>
      ) : null}
    </GlassModal>
  );
}

function emptyForm(profile: MeResponse['doctorProfile']): ProfileEditFormValues {
  return {
    specialization: profile?.specialization ?? '',
    fee: profile?.fee !== null && profile?.fee !== undefined ? String(profile.fee) : '',
    yearsExperience:
      profile?.yearsExperience !== null && profile?.yearsExperience !== undefined
        ? String(profile.yearsExperience)
        : '',
    bio: profile?.bio ?? '',
    registrationNumber: profile?.registrationNumber ?? '',
    avatarUrl: null, // null = keep the existing photo (omitted from the PATCH)
  };
}

/** Build the optimistic/rollback view for the identity card. `patch` null
 * means rollback to the stored profile (used on failure). */
function optimisticView(
  previous: NonNullable<MeResponse['doctorProfile']>,
  patch: DoctorProfilePatchBody | null,
  avatarOverride: string | null,
): DoctorProfileView {
  return {
    id: previous.id,
    fullName: previous.fullName,
    specialization: patch ? (patch.specialization ?? null) : previous.specialization,
    fee: patch ? (patch.fee ?? null) : previous.fee,
    yearsExperience: patch ? (patch.yearsExperience ?? null) : previous.yearsExperience,
    bio: (patch ? (patch.bio ?? null) : previous.bio) ?? undefined,
    registrationNumber: patch ? (patch.registrationNumber ?? null) : previous.registrationNumber,
    avatarUrl: avatarOverride ?? previous.avatarUrl,
    avgRating: 0,
    reviewCount: 0,
    isAvailableNow: false,
  };
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.base },
  card: { gap: spacing.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.sm },
  name: { ...typography.h2, color: colors.text.primary, flexShrink: 1 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleChip: {
    backgroundColor: 'rgba(77, 159, 222, 0.20)',
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: 'rgba(77, 159, 222, 0.35)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  roleChipText: {
    ...typography.micro,
    color: colors.status.CALLED.fg,
    letterSpacing: 0.4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { ...typography.caption, color: colors.text.secondary, flexShrink: 1 },
  sectionTitle: { ...typography.h3, color: colors.text.primary },
  editCaption: { ...typography.caption, color: colors.text.secondary },
  version: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // avatar preview modal
  previewWrap: { alignItems: 'center', gap: spacing.md },
  previewImage: {
    width: 280,
    height: 280,
    borderRadius: radii.round, // true circle — token, not literal
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  previewCaption: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
  },

  // edit modal
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarPicking: {
    width: 72,
    height: 72,
    borderRadius: radii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  avatarActions: { flex: 1, gap: spacing.xs },
  avatarHint: { ...typography.micro, color: colors.text.secondary },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
  fieldHalf: { flex: 1 },
  regHelper: { ...typography.micro, color: colors.text.secondary },
  modalButtons: { gap: spacing.sm },
});
