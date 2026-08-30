/**
 * Design tokens — "glassmorphism pastel blue-purple" (mandatory system from Phase 5 on).
 *
 * LAW: screens render a soft pastel diagonal gradient (sky-blue #BFD9F2 → mint
 * #C7E3EC → lavender #CBC6E8); content sits on translucent white glass cards
 * (white 35–55% alpha, radius 24, 1px rgba(255,255,255,0.6) border, soft navy
 * shadow); primary CTA is a full-radius pill with the light-blue gradient.
 * All UI text is ENGLISH.
 */

export const colors = {
  /** Screen gradient stops — top → middle → bottom, drawn diagonally. */
  gradient: {
    top: '#BFD9F2',
    mid: '#C7E3EC',
    bottom: '#CBC6E8',
  },

  /** Light-blue gradient for primary CTAs. */
  ctaGradient: {
    start: '#6EC1F5',
    end: '#4D9FDE',
  },

  /** Text on light glass. */
  text: {
    primary: '#17264A', // dark navy
    secondary: '#5A6B8C', // gray-blue (also placeholder color)
    onDark: '#FFFFFF',
    inverted: '#FFFFFF', // text over navy pill / blue gradient
  },

  /** Translucent glass surfaces (white alpha per the spec's 35–55% band). */
  glass: {
    card: 'rgba(255, 255, 255, 0.50)',
    cardSoft: 'rgba(255, 255, 255, 0.38)',
    nested: 'rgba(255, 255, 255, 0.32)',
    field: 'rgba(255, 255, 255, 0.55)',
    chip: 'rgba(255, 255, 255, 0.45)',
    border: 'rgba(255, 255, 255, 0.60)',
    fieldBorder: 'rgba(255, 255, 255, 0.65)',
    tabBar: 'rgba(255, 255, 255, 0.62)',
    header: 'rgba(255, 255, 255, 0.45)',
  },

  navy: '#16213A', // dark pill secondary button
  destructive: '#E25555',
  accent: '#F5A623', // selected/highlight — use sparingly

  /** Status palette — chips stay in the translucent glass style. */
  status: {
    CONFIRMED: { fg: '#2E7D5B', bg: 'rgba(61, 178, 115, 0.18)' },
    CALLED: { fg: '#2D6FB4', bg: 'rgba(77, 159, 222, 0.20)' },
    COMPLETED: { fg: '#5E7A6A', bg: 'rgba(123, 160, 140, 0.20)' },
    CANCELLED: { fg: '#B94A4A', bg: 'rgba(226, 85, 85, 0.16)' },
    NO_SHOW: { fg: '#5F6B80', bg: 'rgba(138, 147, 166, 0.20)' },
    PENDING: { fg: '#B27415', bg: 'rgba(245, 166, 35, 0.20)' },
  } as const,

  /** Soft shadow used by glass panels: rgba(23,38,74,0.12) blur 24. */
  shadow: {
    card: {
      shadowColor: '#17264A',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
    ctaGlow: {
      shadowColor: '#4D9FDE',
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  },

  /** Semantic extras that stay inside the pastel family. */
  success: '#3BB273',
  available: '#3BB273',
  unavailable: '#9AA5B8',
  star: '#F5A623',
  white: '#FFFFFF',
} as const;

/** Spacing scale (multiples of 4). */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

/** Corner radii. */
export const radii = {
  pill: 999,
  card: 24,
  inner: 16,
  field: 15,
  round: 999,
} as const;

/** Typography scale — weights map onto the platform system font. */
export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodySemi: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  captionSemi: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const },
} as const;

export type TypographyToken = keyof typeof typography;
export type SpacingToken = keyof typeof spacing;
