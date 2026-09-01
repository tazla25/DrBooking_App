import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '@/theme';

interface GlassTextFieldProps extends TextInputProps {
  label?: string;
  /** Ionicons name rendered inside the pill, left of the text. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders the show/hide toggle and masks input text. */
  secure?: boolean;
  /** Error text rendered under the field (field-level validation). */
  error?: string | null;
  containerStyle?: ViewStyle;
}

/**
 * Translucent pill text field: radius 15, light border, optional left icon,
 * gray-blue placeholder (#5A6B8C), optional password visibility toggle.
 */
export function GlassTextField({
  label,
  icon,
  secure = false,
  error = null,
  containerStyle,
  style,
  ...inputProps
}: GlassTextFieldProps) {
  const [hidden, setHidden] = useState(true);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.fieldWrap, !!error && styles.fieldWrapError]}>
        {icon ? (
          <Ionicons name={icon} size={19} color={colors.text.secondary} style={styles.icon} />
        ) : null}
        <TextInput
          placeholderTextColor={colors.text.secondary}
          autoCorrect={false}
          {...inputProps}
          secureTextEntry={secure ? hidden : false}
          style={[styles.input, !icon && styles.inputNoIcon, style]}
        />
        {secure ? (
          <Pressable
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            accessibilityRole="button"
            onPress={() => setHidden((v) => !v)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={({ pressed }) => pressed && styles.eyePressed}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.text.secondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  label: {
    ...typography.captionSemi,
    color: colors.text.primary,
    marginBottom: spacing.xs,
    marginLeft: spacing.md,
  },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass.field,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.glass.fieldBorder,
    paddingHorizontal: spacing.base,
    minHeight: 50,
    gap: spacing.sm,
  },
  fieldWrapError: {
    borderColor: 'rgba(226, 85, 85, 0.55)',
  },
  icon: {
    marginRight: 0,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    paddingVertical: spacing.md,
  },
  inputNoIcon: {
    marginLeft: 0,
  },
  eyePressed: {
    opacity: 0.5,
  },
  error: {
    ...typography.caption,
    color: colors.destructive,
    marginTop: spacing.xs,
    marginLeft: spacing.md,
  },
});
