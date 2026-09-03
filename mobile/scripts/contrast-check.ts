/**
 * HARD CONTRAST GATE — Phase 10 "Glass Reality" (A3).
 *
 * Composites the text tokens over the worst-case glass surface — the canvas
 * gradient stops x the card-alpha bounds (.62–.78, per spec) — and asserts
 * every gated pair keeps a WCAG ratio of at least 4.5:1. A failing pair means
 * the TOKEN is wrong (fix the token, never the gate).
 *
 * Model: surface = canvas_stop * (1 − a) + white * a   (a = card alpha)
 * Excluded by design (conservative for dark text): the corner glow blobs only
 * BRIGHTEN the surface behind dark text, so ignoring them can only make the
 * measured ratios stricter, never looser.
 *
 * Run:  cd mobile && bun scripts/contrast-check.ts
 * Exit: 0 = all gated pairs pass · 1 = a gated pair failed
 * Also writes docs/contrast-report.md (the committed audit trail).
 */
/* eslint-disable no-console -- this file IS a CLI tool; stdout is the product. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Independent double-entry ledger: the gate parses the token SOURCE text
 * instead of importing it (importing would drag react-native's Flow-typed
 * index through bun). If the token file's structure changes, extraction
 * throws — the gate fails loudly, never silently tests stale values.
 */
const TOKENS_SRC = readFileSync(join(__dirname, '..', 'src', 'theme', 'tokens.ts'), 'utf8');

function tokenString(key: string): string {
  const m = new RegExp(`${key}:\\s*'([^']+)'`).exec(TOKENS_SRC);
  if (!m) throw new Error(`token not found in src/theme/tokens.ts: ${key}`);
  return m[1];
}

const tokens = {
  gradient: {
    top: tokenString('top'),
    mid: tokenString('mid'),
    bottom: tokenString('bottom'),
  },
  text: {
    primary: tokenString('primary'),
    secondary: tokenString('secondary'),
  },
  glass: {
    card: tokenString('card'),
    cardSoft: tokenString('cardSoft'),
    nested: tokenString('nested'),
    field: tokenString('field'),
    chip: tokenString('chip'),
    header: tokenString('header'),
  },
  ctaGradient: {
    start: tokenString('start'),
    end: tokenString('end'),
  },
  navy: tokenString('navy'),
  status: {
    CONFIRMED: { fg: tokenString('CONFIRMED: { fg'), bg: '' },
  } as Record<string, { fg: string; bg: string }>,
};

// status entries: `NAME: { fg: '#hex', bg: 'rgba(...)' }`
for (const m of TOKENS_SRC.matchAll(/([A-Z_]+):\s*\{\s*fg:\s*'([^']+)',\s*bg:\s*'([^']+)'\s*\}/g)) {
  tokens.status[m[1]] = { fg: m[2], bg: m[3] };
}
if (Object.keys(tokens.status).length < 6) {
  throw new Error('status palette extraction failed — token file structure changed?');
}
// --- double-entry ledger (independent of the token file, like the Phase 9
// schema drift alarm): if these literals drift from tokens.gradient, the gate
// itself fails loudly instead of silently testing the wrong colors. ----------
const CANVAS_STOPS = ['#4A9FE8', '#5E7BE0', '#7C63D8'] as const;
const CANVAS_NAMES = ['top', 'mid', 'bottom'] as const;
const CARD_ALPHA_BOUNDS = [0.62, 0.66, 0.72, 0.78] as const;
const AA_NORMAL = 4.5;

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Parse '#RRGGBB' or 'rgba(r, g, b, a)' into {rgb, alpha}. */
function parseColor(token: string): { rgb: Rgb; alpha: number } {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(token.trim());
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  }
  return { rgb: hexToRgb(token), alpha: 1 };
}

/** Composite one translucent layer over an opaque base. */
function over(base: Rgb, layer: { rgb: Rgb; alpha: number }): Rgb {
  const a = layer.alpha;
  return [
    Math.round(base[0] * (1 - a) + layer.rgb[0] * a),
    Math.round(base[1] * (1 - a) + layer.rgb[1] * a),
    Math.round(base[2] * (1 - a) + layer.rgb[2] * a),
  ];
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio. */
function ratio(fg: Rgb, bg: Rgb): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function fmt(r: number): string {
  return r.toFixed(2);
}

// --- sanity: token double-entry --------------------------------------------------
const tokenStops = [tokens.gradient.top, tokens.gradient.mid, tokens.gradient.bottom];
const drift = CANVAS_STOPS.some((s, i) => s !== tokenStops[i]);

// --- GATE: text tokens x (canvas stops x card alpha bounds) ----------------------
const gatedText: [string, string][] = [
  ['text.primary', tokens.text.primary],
  ['text.secondary', tokens.text.secondary],
];

interface GateRow {
  pair: string;
  stop: string;
  stopHex: string;
  alpha: number;
  ratio: number;
  pass: boolean;
}

const gateRows: GateRow[] = [];
let gateFailed = false;

for (const [name, fgHex] of gatedText) {
  const fg = hexToRgb(fgHex);
  for (let s = 0; s < CANVAS_STOPS.length; s++) {
    const stopHex = CANVAS_STOPS[s];
    const base = hexToRgb(stopHex);
    for (const a of CARD_ALPHA_BOUNDS) {
      const surface = over(base, { rgb: [255, 255, 255], alpha: a });
      const r = ratio(fg, surface);
      const pass = r >= AA_NORMAL;
      if (!pass) gateFailed = true;
      gateRows.push({
        pair: name,
        stop: CANVAS_NAMES[s],
        stopHex,
        alpha: a,
        ratio: r,
        pass,
      });
    }
  }
}

// --- APPENDIX: real extended pairs (informational — NOT the gate) -----------------
const glassLayers: [string, string][] = [
  ['nested .34', tokens.glass.nested],
  ['cardSoft .52', tokens.glass.cardSoft],
  ['field .58', tokens.glass.field],
  ['header .55', tokens.glass.header],
  ['chip .46', tokens.glass.chip],
];

interface AppendixRow {
  pair: string;
  surface: string;
  worst: number;
  stop: string;
}

const appendix: AppendixRow[] = [];
for (const [tName, fgHex] of gatedText) {
  const fg = hexToRgb(fgHex);
  for (const [sName, layerToken] of glassLayers) {
    const layer = parseColor(layerToken);
    let worst = Number.POSITIVE_INFINITY;
    let worstStop = '';
    for (let s = 0; s < CANVAS_STOPS.length; s++) {
      const surface = over(hexToRgb(CANVAS_STOPS[s]), layer);
      const r = ratio(fg, surface);
      if (r < worst) {
        worst = r;
        worstStop = CANVAS_NAMES[s];
      }
    }
    appendix.push({ pair: tName, surface: sName, worst, stop: worstStop });
  }
}
// white over the solid accent surfaces (selected chips, tab labels, CTA)
const solidSurfaces: [string, string][] = [
  ['cta.start (solid)', tokens.ctaGradient.start],
  ['cta.end (solid)', tokens.ctaGradient.end],
  ['navy (solid)', tokens.navy],
];
const white: Rgb = [255, 255, 255];
for (const [sName, hex] of solidSurfaces) {
  const r = ratio(white, hexToRgb(hex));
  appendix.push({ pair: 'white', surface: sName, worst: r, stop: '-' });
}
// status fg over its tinted chip composited over the card surface
const statusNames = Object.keys(tokens.status);
for (const st of statusNames) {
  const fg = hexToRgb(tokens.status[st].fg);
  const tint = parseColor(tokens.status[st].bg);
  let worst = Number.POSITIVE_INFINITY;
  let worstStop = '';
  for (let s = 0; s < CANVAS_STOPS.length; s++) {
    const cardSurface = over(hexToRgb(CANVAS_STOPS[s]), parseColor(tokens.glass.card));
    const chipSurface = over(cardSurface, tint);
    const r = ratio(fg, chipSurface);
    if (r < worst) {
      worst = r;
      worstStop = CANVAS_NAMES[s];
    }
  }
  appendix.push({
    pair: `status.${st}.fg`,
    surface: 'status tint on card .66',
    worst,
    stop: worstStop,
  });
}

// =============================================================================
// AURORA GATE (Phase 12 "Aurora Glass v2", spec §2/§3) — the light pastel
// canvas + white acrylic glass + M3 palette family. Same law as the legacy
// gate: composites the text tokens over the worst-case surface and asserts
// 4.5:1; a failing pair means the TOKEN is wrong (fix the token, never the
// gate). Double-entry: values are parsed from src/theme/aurora.ts and
// cross-checked against the ledger below — drift fails the run loudly.
// =============================================================================
const AURORA_SRC = readFileSync(join(__dirname, '..', 'src', 'theme', 'aurora.ts'), 'utf8');

function auroraToken(key: string): string {
  const m = new RegExp(`\\b${key}:\\s*'#([0-9a-fA-F]{6})'`).exec(AURORA_SRC);
  if (!m) throw new Error(`aurora token not found in src/theme/aurora.ts: ${key}`);
  return `#${m[1]}`;
}
function auroraAlpha(key: string): number {
  const m = new RegExp(`\\b${key}:\\s*'rgba\\(255, 255, 255, ([0-9.]+)\\)'`).exec(AURORA_SRC);
  if (!m) throw new Error(`aurora glass tier not found in src/theme/aurora.ts: ${key}`);
  return Number(m[1]);
}

const aurora = {
  canvas: {
    top: auroraToken('top'),
    mid: auroraToken('mid'),
    bottom: auroraToken('bottom'),
  },
  roles: {
    onSurface: auroraToken('onSurface'),
    onSurfaceVariant: auroraToken('onSurfaceVariant'),
    primary: auroraToken('primary'),
    primaryContainer: auroraToken('primaryContainer'),
    secondary: auroraToken('secondary'),
    tertiary: auroraToken('tertiary'),
    error: auroraToken('error'),
    errorContainer: auroraToken('errorContainer'),
    onErrorContainer: auroraToken('onErrorContainer'),
    onSecondaryContainer: auroraToken('onSecondaryContainer'),
    onTertiaryFixedVariant: auroraToken('onTertiaryFixedVariant'),
    onPrimary: auroraToken('onPrimary'),
    surfaceContainerLow: auroraToken('surfaceContainerLow'),
  },
  glass: {
    tile: auroraAlpha('tile'),
    card: auroraAlpha('card'),
    hero: auroraAlpha('hero'),
  },
};

// double-entry ledger for the aurora canvas (drift = loud failure)
const AURORA_CANVAS_LEDGER = ['#BFD9F2', '#C7E3EC', '#CBC6E8'] as const;
const auroraDrift = ['top', 'mid', 'bottom'].some(
  (k, i) => aurora.canvas[k as keyof typeof aurora.canvas] !== AURORA_CANVAS_LEDGER[i],
);
const AURORA_CANVAS_NAMES = ['top', 'mid', 'bottom'] as const;
const AURORA_TEXT_ROLES: [string, string][] = [
  ['onSurface', aurora.roles.onSurface],
  ['onSurfaceVariant', aurora.roles.onSurfaceVariant],
  ['primary', aurora.roles.primary],
  ['secondary', aurora.roles.secondary],
  ['tertiary', aurora.roles.tertiary],
  ['error', aurora.roles.error],
  ['onErrorContainer', aurora.roles.onErrorContainer],
  ['onSecondaryContainer', aurora.roles.onSecondaryContainer],
  ['onTertiaryFixedVariant', aurora.roles.onTertiaryFixedVariant],
];

interface AuroraGateRow {
  pair: string;
  surface: string;
  ratio: number;
  pass: boolean;
}

const auroraGateRows: AuroraGateRow[] = [];
let auroraFailed = false;
const auroraCardAlphas = [aurora.glass.tile, aurora.glass.card, aurora.glass.hero];

// A1) text roles x (canvas stops x glass tier alphas)
for (const [name, fgHex] of AURORA_TEXT_ROLES) {
  const fg = hexToRgb(fgHex);
  for (let s = 0; s < 3; s++) {
    const base = hexToRgb(aurora.canvas[AURORA_CANVAS_NAMES[s] as keyof typeof aurora.canvas]);
    for (const a of auroraCardAlphas) {
      const surface = over(base, { rgb: [255, 255, 255], alpha: a });
      const r = ratio(fg, surface);
      const pass = r >= AA_NORMAL;
      if (!pass) auroraFailed = true;
      auroraGateRows.push({
        pair: name,
        surface: `aurora ${AURORA_CANVAS_NAMES[s]} a=${a.toFixed(2)}`,
        ratio: r,
        pass,
      });
    }
  }
}

// A2) on-primary text over the gradient CTA stops (+ the onDark chip layer —
// the white overlay alpha is parsed LIVE from the auroraTints.onDarkChip
// token, so drift between the token and the gate fails loudly).
const gradientStops: [string, string][] = [
  ['primary-container', aurora.roles.primaryContainer],
  ['primary', aurora.roles.primary],
  ['secondary', aurora.roles.secondary],
];
const onPrimary = hexToRgb(aurora.roles.onPrimary);
function auroraTintAlpha(key: string): number {
  const m = new RegExp(`\\b${key}:\\s*'rgba\\(255, 255, 255, ([0-9.]+)\\)'`).exec(AURORA_SRC);
  if (!m) throw new Error(`aurora tint not found in src/theme/aurora.ts: ${key}`);
  return Number(m[1]);
}
const onDarkChipAlpha = auroraTintAlpha('onDarkChip');
for (const [gName, gHex] of gradientStops) {
  const r = ratio(onPrimary, hexToRgb(gHex));
  if (r < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onPrimary',
    surface: `gradient ${gName}`,
    ratio: r,
    pass: r >= AA_NORMAL,
  });
  const chip = over(hexToRgb(gHex), { rgb: [255, 255, 255], alpha: onDarkChipAlpha });
  const rChip = ratio(onPrimary, chip);
  if (rChip < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onPrimary',
    surface: `onDark chip on ${gName}`,
    ratio: rChip,
    pass: rChip >= AA_NORMAL,
  });
}

// A3) primary text over the WHITE CTA / glass quick-action surface
{
  const r = ratio(hexToRgb(aurora.roles.primary), [255, 255, 255]);
  if (r < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({ pair: 'primary', surface: 'white CTA', ratio: r, pass: r >= AA_NORMAL });
}
// A4) on-tertiary over the tertiary solid button; on-error-container over the
// danger surface; on-primary over the tertiary (Mark Completed pill text).
{
  const r = ratio(onPrimary, hexToRgb(aurora.roles.tertiary));
  if (r < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onPrimary',
    surface: 'tertiary button',
    ratio: r,
    pass: r >= AA_NORMAL,
  });
  const r2 = ratio(hexToRgb(aurora.roles.onErrorContainer), hexToRgb(aurora.roles.errorContainer));
  if (r2 < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onErrorContainer',
    surface: 'errorContainer',
    ratio: r2,
    pass: r2 >= AA_NORMAL,
  });
}
// A5) chip pairs: selected (onPrimary over primaryContainer) and quiet
// (onSurfaceVariant over surfaceContainerLow).
{
  const r = ratio(onPrimary, hexToRgb(aurora.roles.primaryContainer));
  if (r < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onPrimary',
    surface: 'selected chip',
    ratio: r,
    pass: r >= AA_NORMAL,
  });
  const r2 = ratio(
    hexToRgb(aurora.roles.onSurfaceVariant),
    hexToRgb(aurora.roles.surfaceContainerLow),
  );
  if (r2 < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: 'onSurfaceVariant',
    surface: 'quiet chip',
    ratio: r2,
    pass: r2 >= AA_NORMAL,
  });
}
// A6) status fg over its tint composited over the aurora card (worst stop)
const auroraStatus: Record<string, { fg: string; bg: string }> = {};
for (const m of AURORA_SRC.matchAll(/([A-Z_]+):\s*\{\s*fg:\s*'([^']+)',\s*bg:\s*'([^']+)'\s*\}/g)) {
  auroraStatus[m[1]] = { fg: m[2], bg: m[3] };
}
if (Object.keys(auroraStatus).length < 6) {
  throw new Error('aurora status palette extraction failed — token file structure changed?');
}
for (const [st, { fg: fgHex, bg }] of Object.entries(auroraStatus)) {
  const fg = hexToRgb(fgHex);
  const tint = parseColor(bg);
  let worst = Number.POSITIVE_INFINITY;
  let worstSurface = '';
  for (let s = 0; s < 3; s++) {
    const base = hexToRgb(aurora.canvas[AURORA_CANVAS_NAMES[s] as keyof typeof aurora.canvas]);
    const cardSurface = over(base, { rgb: [255, 255, 255], alpha: aurora.glass.card });
    const chipSurface = over(cardSurface, tint);
    const r = ratio(fg, chipSurface);
    if (r < worst) {
      worst = r;
      worstSurface = `status ${st} on ${AURORA_CANVAS_NAMES[s]}`;
    }
  }
  if (worst < AA_NORMAL) auroraFailed = true;
  auroraGateRows.push({
    pair: `auroraStatus.${st}`,
    surface: worstSurface,
    ratio: worst,
    pass: worst >= AA_NORMAL,
  });
}

// A7) regression law (Phase 12 §5): the Aurora palette's gated worst must not
// regress below the Phase-10 worst (4.72:1) — report the worst pair either way.
const AURORA_FLOOR = 4.72;
const auroraMinRow = auroraGateRows.reduce((m, r) => (r.ratio < m.ratio ? r : m));
const auroraRegression = auroraMinRow.ratio < AURORA_FLOOR;
if (auroraRegression) auroraFailed = true;

// --- report ----------------------------------------------------------------------
const report: string[] = [];
report.push('# Contrast audit — Glass Reality (Phase 10, A3)');
report.push('');
report.push(
  `Model: \`surface = canvas_stop × (1 − a) + white × a\` for the canvas stops \`#4A9FE8 → #5E7BE0 → #7C63D8\` (read live from \`src/theme/tokens.ts\` — drift between the token stops and this script's double-entry ledger fails the run) and the spec card-alpha bounds \`${CARD_ALPHA_BOUNDS.join(' / ')}\`. Corner glow blobs are excluded by design: they only brighten the surface behind dark text, so excluding them keeps every measured ratio conservative.`,
);
report.push('');
report.push(`## Gate — text tokens × glass card envelope (must be ≥ ${AA_NORMAL}:1)`);
report.push('');
report.push('| Text token | Canvas stop | Card α | Ratio | Verdict |');
report.push('| --- | --- | --- | ---: | --- |');
for (const row of gateRows) {
  report.push(
    `| ${row.pair} | ${row.stop} (${row.stopHex}) | ${row.alpha.toFixed(2)} | ${fmt(row.ratio)} | ${row.pass ? 'PASS' : '**FAIL**'} |`,
  );
}
report.push('');
report.push(
  gateFailed
    ? `**GATE FAILED** — ${gateRows.filter((r) => !r.pass).length} pair(s) below ${AA_NORMAL}:1. Fix the token, not the gate.`
    : `**GATE PASSED** — all ${gateRows.length} pairs ≥ ${AA_NORMAL}:1.`,
);
report.push('');
report.push('## Appendix — real pairs outside the gate envelope (informational)');
report.push('');
report.push(
  "These pairs render in the app but sit outside the spec's card-alpha envelope (nested panels, fields, solid accent surfaces, status tints). They are REPORTED, not gated: fixing them means touching tokens this phase explicitly freezes. Recommendations are listed below.",
);
report.push('');
report.push('| Text | Surface (worst stop) | Ratio | Note |');
report.push('| --- | --- | ---: | --- |');
for (const row of appendix) {
  const note = row.worst >= AA_NORMAL ? 'ok' : 'below 4.5:1 — see recommendations';
  report.push(`| ${row.pair} | ${row.surface} (${row.stop}) | ${fmt(row.worst)} | ${note} |`);
}
report.push('');
report.push("### Recommendations (follow-up, outside this phase's frozen scope)");
report.push('');
report.push(
  '- `text.secondary` on nested `.34` panels (staff count cards): falls in the low-3s. Prefer `text.primary` for micro labels on nested panels, or raise `nested` in a future phase and re-run this gate.',
);
report.push(
  '- `text.secondary` placeholders over `field .58`: ~4.2 at the darkest stop. Acceptable for placeholder semantics; if the owner wants it gated, darken `text.secondary` one step and re-run.',
);
report.push(
  '- White on the solid CTA accent (~2.9): pre-existing brand choice for 11–16px semibold labels on `ctaGradient`. A future phase could deepen the accent end-stop or switch labels to navy; out of scope here (B6 rejected adjacent label changes).',
);
report.push(
  '- Status tints over card: inherited from the Phase 8 frozen palette; re-check if the band changes again.',
);
report.push('');
report.push('');
report.push('## Aurora gate (Phase 12 — light pastel canvas + white acrylic + M3)');
report.push('');
report.push(
  `Model: aurora text tokens composited over the light canvas stops \`${aurora.canvas.top} → ${aurora.canvas.mid} → ${aurora.canvas.bottom}\` (parsed live from \`src/theme/aurora.ts\`) × the glass tier alphas \`${auroraCardAlphas.map((a) => a.toFixed(2)).join(' / ')}\`, plus the gradient CTA stops, chip pairs, solid buttons and the status tints. Regression law: the gated worst must stay ≥ ${AURORA_FLOOR}:1 (the Phase-10 worst — no regression below it).`,
);
report.push('');
report.push('| Text token | Surface (worst) | Ratio | Verdict |');
report.push('| --- | --- | ---: | --- |');
for (const row of auroraGateRows) {
  report.push(
    `| ${row.pair} | ${row.surface} | ${fmt(row.ratio)} | ${row.pass ? 'PASS' : '**FAIL**'} |`,
  );
}
report.push('');
report.push(
  auroraFailed
    ? `**AURORA GATE FAILED** — worst ${fmt(auroraMinRow.ratio)}:1 (${auroraMinRow.pair} @ ${auroraMinRow.surface}). Fix the token, not the gate.`
    : `**AURORA GATE PASSED** — all ${auroraGateRows.length} pairs ≥ ${AA_NORMAL}:1; worst ${fmt(auroraMinRow.ratio)}:1 (${auroraMinRow.pair} @ ${auroraMinRow.surface}, floor ${AURORA_FLOOR}:1).`,
);
report.push('');
report.push('---');
report.push(
  'Generated by `scripts/contrast-check.ts` — run `bun scripts/contrast-check.ts` from `mobile/` after any token change. Failing the gate fails the delivery.',
);

const reportPath = join(__dirname, '..', 'docs', 'contrast-report.md');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report.join('\n') + '\n', 'utf8');

// --- stdout summary ---------------------------------------------------------------
const minRow = gateRows.reduce((m, r) => (r.ratio < m.ratio ? r : m));
console.log(
  `Contrast gate — ${gateRows.length} pairs, minimum ${fmt(minRow.ratio)}:1 (${minRow.pair} @ ${minRow.stop} a=${minRow.alpha}).`,
);
for (const row of gateRows.filter((r) => !r.pass)) {
  console.log(`  FAIL ${row.pair} @ ${row.stop} a=${row.alpha.toFixed(2)} -> ${fmt(row.ratio)}:1`);
}
const worstAppendix = Math.min(...appendix.map((a) => a.worst));
console.log(`Appendix: ${appendix.length} informational pairs (worst ${fmt(worstAppendix)}:1).`);
const auroraPass = auroraGateRows.every((r) => r.pass);
console.log(
  `Aurora gate — ${auroraGateRows.length} pairs, minimum ${fmt(auroraMinRow.ratio)}:1 (${auroraMinRow.pair} @ ${auroraMinRow.surface}); floor ${AURORA_FLOOR}:1.`,
);
for (const row of auroraGateRows.filter((r) => !r.pass)) {
  console.log(`  AURORA FAIL ${row.pair} @ ${row.surface} -> ${fmt(row.ratio)}:1`);
}
console.log(`Report written: ${reportPath}`);
if (drift) {
  console.error(
    'DOUBLE-ENTRY DRIFT: canvas stops in this script do not match colors.gradient — update one of them.',
  );
  process.exit(1);
}
if (auroraDrift) {
  console.error(
    'AURORA DOUBLE-ENTRY DRIFT: canvas stops in this script do not match src/theme/aurora.ts — update one of them.',
  );
  process.exit(1);
}
if (gateFailed) {
  console.error('GATE FAILED — fix the token, not the gate.');
  process.exit(1);
}
if (!auroraPass) {
  console.error('AURORA GATE FAILED — fix the token, not the gate.');
  process.exit(1);
}
console.log('GATE PASSED (legacy + aurora).');
