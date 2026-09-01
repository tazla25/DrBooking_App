import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorBanner, GlassCard, GlassScreen, GlassTextField, PrimaryButton } from '@/components';
import { ApiError, friendlyMessage } from '@/lib/errors';
import { isValidPassword } from '@/lib/validation';
import { changePassword, homeRouteFor, useAuthStore } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Forced password change — shown when the signed-in account has
 * mustChangePassword = true (compounder first login). Must be completed
 * before any staff area is reachable.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setApiError(null);
    const errors: typeof fieldErrors = {};
    if (!current) errors.current = 'Enter your current password';
    if (!isValidPassword(next)) {
      errors.next = 'At least 8 characters, with a letter and a number';
    }
    if (confirm !== next) errors.confirm = 'Passwords do not match';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const updated = await changePassword(current, next);
      router.replace(homeRouteFor(updated));
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(friendlyMessage(err));
      } else {
        setApiError(friendlyMessage({ code: 'NETWORK_ERROR', status: 0 }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.iconCircle}>
              <Ionicons name="key-outline" size={30} color={colors.text.primary} />
            </View>
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.subtitle}>
              {user
                ? `${user.name}, for security you must change your password`
                : 'For security you must change your password'}
              {'\n'}before continuing.
            </Text>
          </View>

          <GlassCard padded style={styles.card}>
            <GlassTextField
              label="Current password"
              icon="lock-open-outline"
              placeholder="Password from the doctor's office"
              secure
              value={current}
              onChangeText={setCurrent}
              error={fieldErrors.current ?? null}
            />
            <GlassTextField
              label="New password"
              icon="lock-closed-outline"
              placeholder="At least 8 characters, 1 letter, 1 number"
              secure
              value={next}
              onChangeText={setNext}
              error={fieldErrors.next ?? null}
            />
            <GlassTextField
              label="Confirm new password"
              icon="shield-checkmark-outline"
              placeholder="Repeat your new password"
              secure
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={onSubmit}
              error={fieldErrors.confirm ?? null}
            />

            <ErrorBanner message={apiError} />

            <PrimaryButton
              label="Save and continue"
              icon="checkmark-circle-outline"
              loading={loading}
              onPress={onSubmit}
            />
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
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
  hero: { alignItems: 'center', marginBottom: spacing.xl, gap: spacing.sm },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: radii.round, // true circle — token, not literal
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
  },
  title: { ...typography.h1, color: colors.text.primary, textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  card: { gap: spacing.base },
});
