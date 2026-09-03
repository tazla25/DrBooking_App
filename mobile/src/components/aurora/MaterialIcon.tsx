import { createIconSet } from '@expo/vector-icons';

/**
 * Material Symbols Outlined — the Aurora icon set (Phase 12, spec §6).
 *
 * The font is the Google variable TTF instanced to the default axes
 * (FILL 0, GRAD 0, opsz 24, wght 400) and SUBSETTED to the committed
 * inventory below (7 KB), then loaded via expo-font in app/_layout.tsx as
 * family "MaterialSymbolsOutlined" (Apache 2.0 — see
 * assets/fonts/MaterialSymbolsOutlined-LICENSE.txt).
 *
 * LAW: the glyphMap is the closed inventory — every key was verified against
 * Google's official MaterialSymbolsOutlined.codepoints at build time
 * (scripts/stage-a-fonts.sh fails loudly on a missing name). An unknown name
 * renders a question-mark box: TypeScript catches it at compile time via
 * MaterialIconName, so the union below is the single source of truth.
 *
 * Codepoints are Google's published values — do not invent new ones; extend
 * by re-running the font pipeline with the additional names.
 */
export const MATERIAL_SYMBOL_GLYPHMAP = {
  assignment: 0xe85d,
  badge: 0xea67,
  calendar_month: 0xebcc,
  calendar_today: 0xe935,
  call: 0xf0d4,
  campaign: 0xef49,
  check_circle: 0xf0be,
  close: 0xe5cd,
  confirmation_number: 0xe638,
  domain: 0xe7ee,
  error: 0xf8b6,
  expand_less: 0xe5ce,
  expand_more: 0xe5cf,
  format_list_numbered: 0xe242,
  forward_to_inbox: 0xf187,
  groups: 0xf233,
  how_to_reg: 0xe174,
  medical_services: 0xf109,
  notes: 0xe26c,
  notifications_active: 0xe7f7,
  payments: 0xef63,
  person: 0xf0d3,
  person_add: 0xea4d,
  person_off: 0xe510,
  refresh: 0xe5d5,
  schedule: 0xefd6,
  search: 0xef7a,
  sensor_door: 0xf1b5,
  shield_person: 0xf650,
  star: 0xf09a,
  task_alt: 0xe2e6,
  timelapse: 0xe422,
  tune: 0xe429,
  arrow_back: 0xe5c4,
  hourglass_top: 0xea5b,
} as const;

export type MaterialIconName = keyof typeof MATERIAL_SYMBOL_GLYPHMAP;

export const MaterialIcon = createIconSet(
  MATERIAL_SYMBOL_GLYPHMAP,
  'MaterialSymbolsOutlined',
  // The expo-font asset (loaded in app/_layout.tsx via useFonts; the asset id
  // here also enables loadFont()/getImageSource for tooling).
  require('../../../assets/fonts/MaterialSymbolsOutlined.ttf') as unknown as number,
);

/** The font family name (as registered in app/_layout.tsx via expo-font). */
export const MATERIAL_SYMBOLS_FAMILY = 'MaterialSymbolsOutlined';
