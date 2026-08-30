import { StyleSheet, Text, type TextProps } from 'react-native';
import { colors, typography, type TypographyToken } from '@/theme';

interface GlassTextProps extends TextProps {
  variant?: TypographyToken;
  color?: string;
  semiBold?: boolean;
}

/** Themed text bound to the typography scale. Defaults: body, navy. */
export function GlassText({ variant = 'body', color, semiBold, style, ...props }: GlassTextProps) {
  return (
    <Text
      {...props}
      style={[
        typography[variant],
        styles.base,
        color ? { color } : null,
        semiBold ? styles.semi : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text.primary },
  semi: { fontWeight: '600' },
});
