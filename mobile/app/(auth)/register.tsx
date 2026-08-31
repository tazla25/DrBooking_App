import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ErrorBanner, GlassCard, GlassScreen, GlassTextField, PrimaryButton } from '@/components';
import { ApiError, friendlyMessage } from '@/lib/errors';
import { isValidName, isValidPassword, isValidPhone, normalizePhoneInput } from '@/lib/validation';
import { loginWith, registerAccount } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

type RegisterRole = 'PATIENT' | 'DOCTOR';

export default function RegisterScreen() {
  const router = useRouter();
  const [role, setRole] = useState<RegisterRole>('PATIENT');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    phone?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Doctor registration completed — account awaits admin verification. */
  const [pendingDoctor, setPendingDoctor] = useState<string | null>(null);

  const validate = (): string | null => {
    const errors: typeof fieldErrors = {};
    if (!isValidName(name)) errors.name = 'Enter your full name (at least 2 characters)';
    if (!isValidPhone(phone)) errors.phone = 'Enter a valid phone number (e.g. 98765 43210)';
    if (!isValidPassword(password)) {
      errors.password = 'At least 8 characters, with a letter and a number';
    }
    if (confirm !== password) errors.confirm = 'Passwords do not match';
    setFieldErrors(errors);
    const first = Object.values(errors)[0];
    return first ?? null;
  };

  const onSubmit = async () => {
    setApiError(null);
    const invalid = validate();
    if (invalid) return;

    setLoading(true);
    const normalized = normalizePhoneInput(phone) as string;
    try {
      const result = await registerAccount({
        name: name.trim(),
        phone: normalized,
        password,
        role,
      });

      if (result.token) {
        // Defensive: the API currently returns no token on register, but if it
        // ever does, the session is already stored — go straight home.
        router.replace('/(tabs)');
        return;
      }

      if (role === 'PATIENT') {
        // PATIENT registers as VERIFIED — auto-login with the same credentials.
        await loginWith(normalized, password);
        router.replace('/(tabs)');
        return;
      }

      // DOCTOR: starts PENDING — show the verification-pending success screen.
      setPendingDoctor(result.user.name);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PHONE_EXISTS') {
          setFieldErrors((prev) => ({
            ...prev,
            phone: 'An account with this phone number already exists',
          }));
        } else if (err.code === 'VALIDATION_ERROR') {
          setApiError(friendlyMessage(err));
        } else {
          setApiError(friendlyMessage(err));
        }
      } else {
        setApiError(friendlyMessage({ code: 'NETWORK_ERROR', status: 0 }));
      }
    } finally {
      setLoading(false);
    }
  };

  if (pendingDoctor) {
    return (
      <GlassScreen>
        <View style={styles.pendingWrap}>
          <GlassCard padded style={styles.pendingCard}>
            <View style={styles.pendingIcon}>
              <Ionicons name="time-outline" size={34} color={colors.status.PENDING.fg} />
            </View>
            <Text style={styles.pendingTitle}>Registration received</Text>
            <Text style={styles.pendingBody}>
              Welcome, {pendingDoctor}. Your doctor account is now{' '}
              <Text style={styles.pendingBold}>pending verification</Text>. A clinic admin will
              review and verify your account before you can use the doctor panel.
            </Text>
            <Text style={styles.pendingBody}>
              You can sign in anytime — the panel unlocks once verification is complete.
            </Text>
            <PrimaryButton
              label="Continue to sign in"
              icon="log-in-outline"
              onPress={() => router.replace('/login')}
            />
          </GlassCard>
        </View>
      </GlassScreen>
    );
  }

  return (
    <GlassScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Join in less than a minute</Text>
          </View>

          <GlassCard padded style={styles.card}>
            <View style={styles.roleToggle}>
              <RolePill
                label="Patient"
                icon="person-outline"
                active={role === 'PATIENT'}
                onPress={() => setRole('PATIENT')}
              />
              <RolePill
                label="Doctor"
                icon="medical-outline"
                active={role === 'DOCTOR'}
                onPress={() => setRole('DOCTOR')}
              />
            </View>

            {role === 'DOCTOR' ? (
              <View style={styles.doctorNote}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color={colors.text.secondary}
                />
                <Text style={styles.doctorNoteText}>
                  Specialization and consultation fee are set by an admin when your account is
                  verified.
                </Text>
              </View>
            ) : null}

            <GlassTextField
              label="Full name"
              icon="person-outline"
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              error={fieldErrors.name ?? null}
            />
            <GlassTextField
              label="Phone number"
              icon="call-outline"
              placeholder="98765 43210"
              keyboardType="phone-pad"
              autoCapitalize="none"
              value={phone}
              onChangeText={setPhone}
              error={fieldErrors.phone ?? null}
            />
            <GlassTextField
              label="Password"
              icon="lock-closed-outline"
              placeholder="At least 8 characters, 1 letter, 1 number"
              secure
              value={password}
              onChangeText={setPassword}
              error={fieldErrors.password ?? null}
            />
            <GlassTextField
              label="Confirm password"
              icon="shield-checkmark-outline"
              placeholder="Repeat your password"
              secure
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={onSubmit}
              error={fieldErrors.confirm ?? null}
            />

            <ErrorBanner message={apiError} />

            <PrimaryButton
              label={role === 'PATIENT' ? 'Create account' : 'Submit for verification'}
              icon="person-add-outline"
              loading={loading}
              onPress={onSubmit}
            />

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already registered? </Text>
              <Pressable onPress={() => router.replace('/login')}>
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </View>
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}

function RolePill({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.rolePill, active && styles.rolePillActive]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.white : colors.text.secondary} />
      <Text style={[styles.rolePillText, active && styles.rolePillTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text.primary },
  subtitle: { ...typography.body, color: colors.text.secondary, marginTop: spacing.xs },
  card: { gap: spacing.base },
  roleToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner, // segmented-control container = inner panel (16)
    padding: spacing.xs,
  },
  rolePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 42,
    borderRadius: radii.button, // option buttons (16) inside the inner panel
  },
  rolePillActive: {
    backgroundColor: colors.ctaGradient.end,
  },
  rolePillText: {
    ...typography.captionSemi,
    color: colors.text.secondary,
  },
  rolePillTextActive: { color: colors.white },
  doctorNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.glass.nested,
    borderRadius: radii.inner,
    padding: spacing.md,
  },
  doctorNoteText: {
    ...typography.caption,
    color: colors.text.secondary,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  footerText: { ...typography.caption, color: colors.text.secondary },
  footerLink: { ...typography.captionSemi, color: '#2D6FB4' },
  pendingWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pendingCard: { gap: spacing.base },
  pendingIcon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.PENDING.bg,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  pendingTitle: {
    ...typography.h2,
    color: colors.text.primary,
    textAlign: 'center',
  },
  pendingBody: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  pendingBold: { color: colors.status.PENDING.fg, fontWeight: '600' },
});
