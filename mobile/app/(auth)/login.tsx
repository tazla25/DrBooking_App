import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorBanner, GlassCard, GlassScreen, GlassTextField, PrimaryButton } from '@/components';
import { ApiError, friendlyMessage } from '@/lib/errors';
import { registerPushToken } from '@/lib/push';
import { normalizePhoneInput } from '@/lib/validation';
import { homeRouteFor, loginWith } from '@/store/auth';
import { colors, radii, spacing, typography } from '@/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setApiError(null);
    setPhoneError(null);

    const normalized = normalizePhoneInput(phone);
    if (!normalized) {
      setPhoneError('Enter a valid phone number (e.g. 98765 43210)');
      return;
    }
    if (!password) {
      setApiError('Enter your password.');
      return;
    }

    setLoading(true);
    try {
      const { user } = await loginWith(normalized, password);
      // Best-effort push registration — never blocks login (Expo Go without
      // a projectId skips silently inside registerPushToken).
      void registerPushToken();
      if (user.mustChangePassword) {
        router.replace('/change-password');
      } else {
        router.replace(homeRouteFor(user));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setPhoneError(friendlyMessage(err));
      } else if (err instanceof ApiError) {
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
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>Dr</Text>
            </View>
            <Text style={styles.title}>ClinIQ</Text>
            <Text style={styles.subtitle}>Book clinic visits without the wait</Text>
          </View>

          <GlassCard padded style={styles.card}>
            <GlassTextField
              label="Phone number"
              icon="call-outline"
              placeholder="98765 43210"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              error={phoneError}
            />
            <GlassTextField
              label="Password"
              icon="lock-closed-outline"
              placeholder="Your password"
              secure
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
              containerStyle={styles.fieldGap}
            />

            <ErrorBanner message={apiError} />

            <PrimaryButton
              label="Sign in"
              icon="log-in-outline"
              loading={loading}
              onPress={onSubmit}
            />

            <View style={styles.footer}>
              <Text style={styles.footerText}>New here? </Text>
              <Link href="/register" style={styles.footerLink}>
                Create an account
              </Link>
            </View>
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
    paddingVertical: spacing.huge,
  },
  hero: { alignItems: 'center', marginBottom: spacing.xxl },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: radii.round, // true circle — token, not literal
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.chip,
    borderWidth: 1,
    borderColor: colors.glass.border,
    marginBottom: spacing.base,
  },
  // Deliberate override (Phase 10-c exception): the wordmark glyph is tuned
  // to the 76px circle — 30px stays, NOT the display token.
  logoText: { ...typography.display, color: colors.text.primary, fontSize: 30 },
  title: { ...typography.display, color: colors.text.primary },
  subtitle: { ...typography.body, color: colors.text.secondary, marginTop: spacing.xs },
  card: { gap: spacing.base },
  fieldGap: { marginTop: spacing.base },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  footerText: { ...typography.caption, color: colors.text.secondary },
  footerLink: { ...typography.captionSemi, color: colors.status.CALLED.fg },
});
