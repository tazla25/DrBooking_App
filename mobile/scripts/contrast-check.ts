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
console.log(`Report written: ${reportPath}`);
if (drift) {
  console.error(
    'DOUBLE-ENTRY DRIFT: canvas stops in this script do not match colors.gradient — update one of them.',
  );
  process.exit(1);
}
if (gateFailed) {
  console.error('GATE FAILED — fix the token, not the gate.');
  process.exit(1);
}
console.log('GATE PASSED.');
