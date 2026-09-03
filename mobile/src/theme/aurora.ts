/**
 * AURORA design tokens — Phase 12 "Aurora Glass v2" (design source: the
 * owner's Stitch project, screen e35580ba… "Staff Console" + the 9-screen
 * "real glassmorphic" family; values extracted verbatim into
 * download/phase12_aurora_design_spec.md).
 *
 * LAW (L4): Aurora-migrated screens consume ONLY these tokens — no
 * per-screen color literals (the one legacy B4 `paddingBottom: 96` literal
 * stays as-is). The legacy `tokens.ts` remains untouched for non-migrated
 * screens (additive v2 kit — nothing breaks until its stage).
 *
 * Canvas: LIGHT pastel aurora (160deg #BFD9F2 → #C7E3EC → #CBC6E8) with soft
 * primary/secondary/tertiary orbs — frosted WHITE glass sits on top (the
 * "acrylic over aurora" language). Headlines: Plus Jakarta Sans 600/700
 * (assets/fonts/PlusJakartaSans-*, SIL OFL 1.1); body/labels: Inter (legacy
 * assets); icons: Material Symbols Outlined (subset, Apache 2.0).
 * Radii: card 22 / tile 16 / field 12 / pill 999 (Aurora buttons ARE
 * capsules — a deliberate, documented departure from the Phase-10
 * rounded-rect law; the Stitch design overrides it).
 */

import { spacing } from './tokens';

/** Canvas — the aurora gradient stops (top → mid → bottom, drawn ~160°). */
export const auroraCanvas = {
  top: '#BFD9F2',
  mid: '#C7E3EC',
  bottom: '#CBC6E8',
} as const;

/**
 * Decorative canvas orbs (spec §1) — large soft color washes BEHIND content.
 * RN approximation: each orb renders as concentric low-alpha circles (the
 * Phase-10 vector-glow technique; NO BlurView — the blur budget law, §7).
 * Tints: primary-container / secondary-container / tertiary-fixed-dim.
 */
export const auroraOrbs = {
  primary: 'rgba(79, 70, 229, 0.20)',
  primaryHalo: 'rgba(79, 70, 229, 0.10)',
  secondary: 'rgba(87, 223, 254, 0.30)',
  secondaryHalo: 'rgba(87, 223, 254, 0.15)',
  tertiary: 'rgba(78, 222, 163, 0.20)',
  tertiaryHalo: 'rgba(78, 222, 163, 0.10)',
} as const;

/** Material 3 palette — verbatim from the Stitch tailwind config (spec §2). */
export const auroraColors = {
  primary: '#3525cd',
  onPrimary: '#ffffff',
  primaryContainer: '#4f46e5',
  onPrimaryContainer: '#dad7ff',
  primaryFixed: '#e2dfff',
  primaryFixedDim: '#c3c0ff',
  onPrimaryFixed: '#0f0069',
  onPrimaryFixedVariant: '#3323cc',

  secondary: '#00687a',
  onSecondary: '#ffffff',
  secondaryContainer: '#57dffe',
  onSecondaryContainer: '#006172',
  secondaryFixed: '#acedff',
  secondaryFixedDim: '#4cd7f6',
  onSecondaryFixed: '#001f26',
  onSecondaryFixedVariant: '#004e5c',

  tertiary: '#005338',
  onTertiary: '#ffffff',
  tertiaryContainer: '#006e4b',
  onTertiaryContainer: '#67f4b7',
  tertiaryFixed: '#6ffbbe',
  tertiaryFixedDim: '#4edea3',
  onTertiaryFixed: '#002113',
  onTertiaryFixedVariant: '#005236',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  background: '#faf8ff',
  onBackground: '#131b2e',
  surface: '#faf8ff',
  onSurface: '#131b2e',
  surfaceVariant: '#dae2fd',
  onSurfaceVariant: '#464555',
  surfaceDim: '#d2d9f4',
  surfaceBright: '#faf8ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f2f3ff',
  surfaceContainer: '#eaedff',
  surfaceContainerHigh: '#e2e7ff',
  surfaceContainerHighest: '#dae2fd',
  inverseSurface: '#283044',
  inverseOnSurface: '#eef0ff',
  inversePrimary: '#c3c0ff',
  outline: '#777587',
  outlineVariant: '#c7c4d8',
} as const;

/** Frosted glass tiers (spec §3) — white acrylic over the aurora canvas. */
export const auroraGlass = {
  /** card — the standard content card (white .80, r22, shadow-md). */
  card: 'rgba(255, 255, 255, 0.80)',
  /** tile — metric/quick-action tiles (white .70, r16, shadow-sm). */
  tile: 'rgba(255, 255, 255, 0.70)',
  /** hero — the chamber/banner-adjacent emphasis card (white .90, r22). */
  hero: 'rgba(255, 255, 255, 0.90)',
  /** nested — inner rows on a card (surface-container-low .60, r12). */
  nested: 'rgba(242, 243, 255, 0.60)',
  /** nestedSoft — quieter inner rows (the /40 rows). */
  nestedSoft: 'rgba(242, 243, 255, 0.40)',
  /** header — the fixed chrome bar (white .70). */
  header: 'rgba(255, 255, 255, 0.70)',
  /** nav — the floating pill bar (white .80, r999). */
  nav: 'rgba(255, 255, 255, 0.80)',
  /** modal panel — near-opaque (white .95, r22). */
  modalPanel: 'rgba(255, 255, 255, 0.95)',
  /** input fields (surface-container-low). */
  field: '#f2f3ff',
  /** hairline — the 1px structural border on glass. */
  hairline: 'rgba(255, 255, 255, 0.55)',
  /** modal backdrop dim (over the existing blur layer). */
  modalBackdrop: 'rgba(19, 27, 46, 0.45)',
} as const;

/**
 * Gradient CTAs (spec §3): the banner card runs primary-container → primary →
 * secondary; pill submits run primary → secondary.
 */
export const auroraGradients = {
  banner: ['#4f46e5', '#3525cd', '#00687a'] as [string, string, string],
  cta: ['#3525cd', '#00687a'] as [string, string],
  iconTile: ['#4f46e5', '#00687a'] as [string, string],
} as const;

/**
 * Status chips (spec §2 mapping) — Aurora-family translucent pills. The fg
 * colors are the gated high-contrast values (contrast-check.ts verifies).
 */
export const auroraStatus = {
  PENDING: { fg: '#3525cd', bg: 'rgba(79, 70, 229, 0.10)' },
  CONFIRMED: { fg: '#006172', bg: 'rgba(87, 223, 254, 0.40)' },
  CALLED: { fg: '#005338', bg: 'rgba(0, 110, 75, 0.15)' },
  COMPLETED: { fg: '#005236', bg: 'rgba(78, 222, 163, 0.25)' },
  CANCELLED: { fg: '#93000a', bg: '#ffdad6' },
  NO_SHOW: { fg: '#464555', bg: '#dae2fd' },
} as const;

export type AuroraStatus = keyof typeof auroraStatus;

/** Soft indigo shadows (spec §3) — elevation in the Aurora family. */
export const auroraShadows = {
  card: {
    shadowColor: '#4f46e5',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  tile: {
    shadowColor: '#4f46e5',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  hero: {
    shadowColor: '#4f46e5',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cta: {
    shadowColor: '#4f46e5',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  nav: {
    shadowColor: '#4f46e5',
    shadowOpacity: 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: {
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
} as const;

/** Font families — Plus Jakarta Sans statics + the legacy Inter statics. */
export const auroraFontFamily = {
  sans: 'Inter-Regular',
  sansSemiBold: 'Inter-SemiBold',
  sansBold: 'Inter-Bold',
  display: 'PlusJakartaSans-SemiBold',
  displayBold: 'PlusJakartaSans-Bold',
} as const;

/**
 * Typography scale (spec §4). Headlines carry Plus Jakarta Sans; body/labels
 * carry Inter. body-lg (Inter 500) is approximated with Inter-Regular —
 * Inter-Medium is not bundleable under L2 (documented in the spec).
 */
export const auroraTypography = {
  headlineXl: {
    fontFamily: auroraFontFamily.displayBold,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700' as const,
    letterSpacing: -0.68,
  },
  headlineLg: {
    fontFamily: auroraFontFamily.displayBold,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700' as const,
    letterSpacing: -0.39,
  },
  headlineMd: {
    fontFamily: auroraFontFamily.display,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  headlineSm: {
    fontFamily: auroraFontFamily.display,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  currency: {
    fontFamily: auroraFontFamily.displayBold,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as const,
  },
  bodyLg: {
    fontFamily: auroraFontFamily.sans,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyMd: {
    fontFamily: auroraFontFamily.sans,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  bodySm: {
    fontFamily: auroraFontFamily.sans,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  labelLg: {
    fontFamily: auroraFontFamily.sansSemiBold,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const,
    letterSpacing: 0.14,
  },
  labelMd: {
    fontFamily: auroraFontFamily.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.24,
  },
  labelSm: {
    fontFamily: auroraFontFamily.sansBold,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.44,
  },
} as const;

export type AuroraTypographyToken = keyof typeof auroraTypography;

/**
 * Radii (spec §5) — Aurora law: card 22 / tile 16 / field 12 / pill 999.
 * Pills ARE capsules here (buttons, chips, switches, token squares stay 12).
 */
export const auroraRadii = {
  card: 22,
  tile: 16,
  field: 12,
  pill: 999,
  round: 999,
} as const;

/** Spacing — the same 4px grid as the legacy tokens (spec §5). */
export const auroraSpacing = spacing;

/**
 * Derived alpha tints (spec §3 recipes + banner overlays) — the L4 law:
 * every rgba wash used by screens/components lives HERE, never inline.
 * The onDarkChip value is the contrast-gated white-text surface over the
 * gradient banner (0.10 keeps onPrimary ≥ 5:1 on every stop).
 */
export const auroraTints = {
  /** White overlay chips on the gradient banner (text surface). */
  onDarkChip: 'rgba(255, 255, 255, 0.10)',
  /** White overlay circles on the gradient banner (icon surface). */
  onDarkCircle: 'rgba(255, 255, 255, 0.15)',
  /** Secondary-container washes (chamber chip / sensor tile). */
  secondaryContainer20: 'rgba(87, 223, 254, 0.20)',
  secondaryContainer30: 'rgba(87, 223, 254, 0.30)',
  /** Primary washes (WALK-IN source chip pair). */
  primary10: 'rgba(79, 70, 229, 0.10)',
  primary35: 'rgba(79, 70, 229, 0.35)',
  /** Tertiary wash (the LIVE pill). */
  tertiary10: 'rgba(0, 110, 75, 0.10)',
  /** Token squares on queue rows. */
  tokenSquare: 'rgba(242, 243, 255, 0.80)',
  /** Error banner / field borders. */
  errorBorder30: 'rgba(186, 26, 26, 0.30)',
  errorBorder45: 'rgba(186, 26, 26, 0.45)',
  /** Field hairline. */
  fieldBorder: 'rgba(199, 196, 216, 0.90)',
  /** Now-serving pulse tint pair [resting, peak]. */
  pulsePair: ['rgba(0, 104, 122, 0)', 'rgba(77, 223, 254, 0.20)'] as [string, string],
} as const;

/** Interactive selection tint (chips: the active date/schedule chip pair). */
export const auroraInteractive = {
  selectedBg: auroraColors.primaryContainer,
  selectedFg: auroraColors.onPrimary,
  quietBg: auroraColors.surfaceContainerLow,
  quietFg: auroraColors.onSurfaceVariant,
} as const;
