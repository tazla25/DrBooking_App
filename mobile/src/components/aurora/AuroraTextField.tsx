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
import {
  auroraColors,
  auroraGlass,
  auroraRadii,
  auroraSpacing,
  auroraTints,
  auroraTypography,
} from '@/theme';
import { MaterialIcon, type MaterialIconName } from './MaterialIcon';

interface AuroraTextFieldProps extends TextInputProps {
  label?: string;
  /** Material Symbols name inside the field, left of the text. */
  icon?: MaterialIconName;
  /** Renders the show/hide toggle and masks input text. */
  secure?: boolean;
  /** Error text rendered under the field (field-level validation). */
  error?: string | null;
  containerStyle?: ViewStyle;
}

/**
 * Aurora input (Phase 12, spec §3 "input") — the design's
 * `bg-surface-container-low rounded-xl h-11` field with a label-sm
 * on-surface-variant label above, an optional Material Symbol at the left,
 * the outline-color placeholder and the field-level error line. The
 * show/hide toggle ports the legacy GlassTextField behavior verbatim.
 */
export function AuroraTextField({
  label,
  icon,
  secure = false,
  error = null,
  containerStyle,
  style,
  ...inputProps
}: AuroraTextFieldProps) {
  const [hidden, setHidden] = useState(true);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.fieldWrap, !!error && styles.fieldWrapError]}>
        {icon ? <MaterialIcon name={icon} size={18} color={auroraColors.outline} /> : null}
        <TextInput
          placeholderTextColor={auroraColors.onSurfaceVariant}
          autoCorrect={false}
          {...inputProps}
          secureTextEntry={secure ? hidden : false}
          style={[styles.input, style]}
        />
        {secure ? (
          <Pressable
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            accessibilityRole="button"
            onPress={() => setHidden((v) => !v)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={({ pressed }) => pressed && styles.eyePressed}
          >
            <MaterialIcon
              name={hidden ? 'expand_more' : 'expand_less'}
              size={20}
              color={auroraColors.onSurfaceVariant}
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
    ...auroraTypography.labelSm,
    color: auroraColors.onSurfaceVariant,
    marginBottom: 4,
    marginLeft: 2,
  },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: auroraGlass.field,
    borderRadius: auroraRadii.field,
    borderWidth: 1,
    borderColor: auroraTints.fieldBorder,
    paddingHorizontal: auroraSpacing.md,
    minHeight: 44,
    gap: auroraSpacing.sm,
  },
  fieldWrapError: {
    borderColor: auroraTints.errorBorder45,
    backgroundColor: auroraColors.errorContainer,
  },
  input: {
    flex: 1,
    ...auroraTypography.bodyMd,
    color: auroraColors.onSurface,
    paddingVertical: auroraSpacing.sm,
  },
  eyePressed: {
    opacity: 0.5,
  },
  error: {
    ...auroraTypography.bodySm,
    color: auroraColors.error,
    marginTop: 4,
    marginLeft: 2,
  },
});
