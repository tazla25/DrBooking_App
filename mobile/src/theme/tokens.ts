import { Platform } from 'react-native';

/**
 * Design tokens — "glassmorphism pastel blue-purple" (mandatory system from Phase 5 on).
 *
 * LAW (Phase 10 "Glass Reality" revision): the screen is a vivid diagonal
 * canvas (#4A9FE8 → #5E7BE0 → #7C63D8 + soft white corner glows); content
 * sits on RAISED translucent white glass (card 66%, nested 34%) so every
 * layer separates from the canvas. Text contrast is GATED —
 * scripts/contrast-check.ts fails if any text/glass pair drops below 4.5:1
 * (report: docs/contrast-report.md).
 * Radii are LAW: card 22, inner 16, field 14, chip 12, button 16; a full pill
 * (999) is reserved for TRUE CIRCLES only (avatars, round icon buttons, the
 * availability toggle). Primary CTA is the light-blue gradient rounded-rect.
 * All UI text is ENGLISH.
 */

export const colors = {
  /** Canvas stops — top → middle → bottom, drawn diagonally (Glass Reality). */
  gradient: {
    top: '#4A9FE8',
    mid: '#5E7BE0',
    bottom: '#7C63D8',
  },

  /**
   * LEGACY (unused since the Glass Reality pass — the canvas is pure vector
   * now, there is no wallpaper and no load-failure fallback): the old 5-stop
   * pastel fallback. #A9CCF0 → #B7DCE9 → #C3D9EA → #C6C1E6 → #BFB9E4.
   */
  auroraFallback: ['#A9CCF0', '#B7DCE9', '#C3D9EA', '#C6C1E6', '#BFB9E4'] as const,

  /** Light-blue gradient for primary CTAs. */
  ctaGradient: {
    start: '#6EC1F5',
    end: '#4D9FDE',
  },

  /** Text on light glass. */
  text: {
    primary: '#17264A', // dark navy
    secondary: '#445273', // gray-blue (gate-forced darker than spec's #475679 — the A3 gate needs 4.5:1 at the worst corner)
    onDark: '#FFFFFF',
    inverted: '#FFFFFF', // text over navy pill / blue gradient
  },

  /**
   * Translucent glass surfaces (white alpha) — GLASS REALITY band, raised so
   * every layer separates against the vivid canvas: card .66 / cardSoft .52 /
   * nested .34 / field .58 / chip .46 (borders .60–.65, tab bar .72, header
   * .55). Still translucent — nested panels stack on cards.
   */
  glass: {
    card: 'rgba(255, 255, 255, 0.66)',
    cardSoft: 'rgba(255, 255, 255, 0.52)',
    nested: 'rgba(255, 255, 255, 0.34)',
    field: 'rgba(255, 255, 255, 0.58)',
    chip: 'rgba(255, 255, 255, 0.46)',
    border: 'rgba(255, 255, 255, 0.65)',
    fieldBorder: 'rgba(255, 255, 255, 0.60)',
    tabBar: 'rgba(255, 255, 255, 0.72)',
    header: 'rgba(255, 255, 255, 0.55)',
  },

  /** Opaque near-white modal panel — content must be fully readable. */
  modalPanel: 'rgba(255, 255, 255, 0.92)',

  /** Modal backdrop dim (paired with the expo-blur BlurView in GlassModal). */
  modalBackdrop: 'rgba(22, 33, 58, 0.60)',

  /** Android ripple tint for every tappable list/content surface (Phase 10-c). */
  ripple: 'rgba(23, 38, 74, 0.18)',

  /**
   * Interactive selection tint — the chip "active" pair + selected text
   * (filters, sort chips, analytics windows, audit filters). Reused by every
   * selected chip so selection always looks identical app-wide.
   */
  interactive: {
    selectedBg: 'rgba(77, 159, 222, 0.28)',
    selectedBorder: 'rgba(77, 159, 222, 0.55)',
    selectedFg: '#2D6FB4',
  } as const,

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

  /** Glass panel shadow — navy alpha .22, elevation 10 (Glass Reality). */
  shadow: {
    card: {
      shadowColor: '#17264A',
      shadowOpacity: 0.22,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
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

/**
 * Corner radii — LAW (Phase 10 unification). Buttons are rounded-rects (16),
 * NOT capsules; `pill`/`round` are for true circles only (avatar, round icon
 * buttons, the availability toggle).
 */
export const radii = {
  pill: 999,
  card: 22,
  inner: 16,
  field: 14,
  chip: 12,
  button: 16,
  round: 999,
} as const;

/**
 * Font families — Inter static weights (SIL OFL 1.1, see
 * assets/fonts/Inter-OFL.txt), loaded via expo-font in app/_layout.tsx while
 * the splash stays visible (no font flash). If a family fails to load,
 * React Native silently falls back to the platform system font. Per-screen
 * fontFamily literals are FORBIDDEN — consume this token (or a typography
 * token, which all carry fontFamily) instead.
 */
export const fontFamily = {
  regular: 'Inter-Regular',
  semiBold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  /** One-time passwords / codes — platform monospace by design. */
  mono: Platform.select({ ios: 'Courier', android: 'monospace' }),
} as const;

/** Typography scale — Inter weights via the fontFamily token above. */
export const typography = {
  display: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '700' as const,
  },
  h1: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
  },
  h2: {
    fontFamily: fontFamily.semiBold,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
  },
  h3: {
    fontFamily: fontFamily.semiBold,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600' as const,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  bodySemi: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  caption: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  captionSemi: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  micro: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600' as const,
  },
} as const;

export type TypographyToken = keyof typeof typography;
export type SpacingToken = keyof typeof spacing;
