import {
  auroraCanvas,
  auroraColors,
  auroraFontFamily,
  auroraGlass,
  auroraGradients,
  auroraOrbs,
  auroraRadii,
  auroraShadows,
  auroraSpacing,
  auroraStatus,
  auroraTints,
  auroraTypography,
  spacing,
} from '@/theme';
import { MATERIAL_SYMBOL_GLYPHMAP } from '@/components/aurora';

/**
 * Phase 12 Stage A — aurora token export integrity (the L4 token law's
 * tripwire). These assertions pin the STRUCTURE of src/theme/aurora.ts: every
 * M3 role present and well-formed, the glass tiers and radii law, the status
 * palette covering all six app statuses, the type families, and the closed
 * glyph inventory. A refactor that drops or malforms a token fails HERE,
 * before it can reach a device.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;

describe('aurora canvas + orbs', () => {
  test('the canvas is the 3-stop light pastel aurora (spec §1)', () => {
    expect([auroraCanvas.top, auroraCanvas.mid, auroraCanvas.bottom]).toEqual([
      '#BFD9F2',
      '#C7E3EC',
      '#CBC6E8',
    ]);
  });

  test('the orb tints are well-formed rgba washes', () => {
    for (const value of Object.values(auroraOrbs)) {
      expect(value).toMatch(RGBA);
    }
  });
});

describe('aurora M3 palette', () => {
  test('every role is a 6-digit hex', () => {
    for (const [key, value] of Object.entries(auroraColors)) {
      expect(value).toMatch(HEX);
      expect(key).toBeTruthy();
    }
  });

  test('the load-bearing roles match the Stitch config verbatim (spec §2)', () => {
    expect(auroraColors.primary).toBe('#3525cd');
    expect(auroraColors.primaryContainer).toBe('#4f46e5');
    expect(auroraColors.secondary).toBe('#00687a');
    expect(auroraColors.secondaryContainer).toBe('#57dffe');
    expect(auroraColors.tertiary).toBe('#005338');
    expect(auroraColors.error).toBe('#ba1a1a');
    expect(auroraColors.errorContainer).toBe('#ffdad6');
    expect(auroraColors.onSurface).toBe('#131b2e');
    expect(auroraColors.onSurfaceVariant).toBe('#464555');
    expect(auroraColors.outline).toBe('#777587');
    expect(auroraColors.surfaceContainerLow).toBe('#f2f3ff');
    expect(auroraColors.surfaceContainerLowest).toBe('#ffffff');
  });
});

describe('aurora glass + tints + gradients', () => {
  test('the four glass tiers are white acrylic alphas in spec order', () => {
    expect(auroraGlass.card).toBe('rgba(255, 255, 255, 0.80)');
    expect(auroraGlass.tile).toBe('rgba(255, 255, 255, 0.70)');
    expect(auroraGlass.hero).toBe('rgba(255, 255, 255, 0.90)');
    expect(auroraGlass.nested).toBe('rgba(242, 243, 255, 0.60)');
  });

  test('every tint is well-formed', () => {
    for (const [key, value] of Object.entries(auroraTints)) {
      if (Array.isArray(value)) {
        for (const v of value) expect(v).toMatch(RGBA);
      } else {
        expect(value).toMatch(RGBA);
        expect(key).toBeTruthy();
      }
    }
  });

  test('the CTA gradients are 2-3 stops of brand colors', () => {
    expect(auroraGradients.cta).toEqual(['#3525cd', '#00687a']);
    expect(auroraGradients.banner).toEqual(['#4f46e5', '#3525cd', '#00687a']);
    expect(auroraGradients.iconTile).toEqual(['#4f46e5', '#00687a']);
  });

  test('the onDark chip tint keeps white text ≥ 4.5:1 on every gradient stop (gate law)', () => {
    // The contrast gate enforces this numerically; the token test pins the
    // value so a "quick visual tweak" cannot silently regress it.
    expect(auroraTints.onDarkChip).toBe('rgba(255, 255, 255, 0.10)');
  });
});

describe('aurora status palette', () => {
  test('covers all six app statuses with fg/bg pairs', () => {
    const keys = Object.keys(auroraStatus);
    expect(keys).toEqual(
      expect.arrayContaining([
        'PENDING',
        'CONFIRMED',
        'CALLED',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
      ]),
    );
    expect(keys).toHaveLength(6);
    for (const [status, { fg, bg }] of Object.entries(auroraStatus)) {
      expect(fg).toMatch(HEX);
      expect(bg).toMatch(/^(#[0-9a-fA-F]{6}|rgba\(\d+, \d+, \d+, [0-9.]+\))$/);
      expect(status).toBeTruthy();
    }
  });
});

describe('aurora typography + families', () => {
  test('headlines are Plus Jakarta Sans, body/labels are Inter', () => {
    expect(auroraFontFamily.display).toBe('PlusJakartaSans-SemiBold');
    expect(auroraFontFamily.displayBold).toBe('PlusJakartaSans-Bold');
    expect(auroraTypography.headlineMd.fontFamily).toBe('PlusJakartaSans-SemiBold');
    expect(auroraTypography.headlineLg.fontFamily).toBe('PlusJakartaSans-Bold');
    expect(auroraTypography.bodyMd.fontFamily).toBe('Inter-Regular');
    expect(auroraTypography.labelMd.fontFamily).toBe('Inter-SemiBold');
    expect(auroraTypography.labelSm.fontFamily).toBe('Inter-Bold');
  });

  test('the scale sizes match the Stitch type ramp (spec §4)', () => {
    expect(auroraTypography.headlineXl.fontSize).toBe(34);
    expect(auroraTypography.headlineLg.fontSize).toBe(26);
    expect(auroraTypography.headlineMd.fontSize).toBe(20);
    expect(auroraTypography.headlineSm.fontSize).toBe(18);
    expect(auroraTypography.bodyMd.fontSize).toBe(14);
    expect(auroraTypography.bodySm.fontSize).toBe(12);
    expect(auroraTypography.labelSm.fontSize).toBe(11);
    // every entry's line-height is ≥ its font size (never clipped type)
    for (const t of Object.values(auroraTypography)) {
      expect(t.lineHeight).toBeGreaterThanOrEqual(t.fontSize);
    }
  });
});

describe('aurora radii + spacing + shadows', () => {
  test('radii law: card 22 / tile 16 / field 12 / pill 999 (spec §5)', () => {
    expect(auroraRadii.card).toBe(22);
    expect(auroraRadii.tile).toBe(16);
    expect(auroraRadii.field).toBe(12);
    expect(auroraRadii.pill).toBe(999);
  });

  test('spacing reuses the legacy 4px grid unchanged', () => {
    expect(auroraSpacing).toEqual(spacing);
  });

  test('every shadow tier has an elevation (Android) and an offset', () => {
    for (const [name, sh] of Object.entries(auroraShadows)) {
      expect(`${name}.elevation`).toBeTruthy();
      expect(sh.elevation).toBeGreaterThan(0);
      expect(sh.shadowOffset).toBeDefined();
    }
  });
});

describe('Material Symbols inventory (token side)', () => {
  test('the glyph map carries the Stage A screen + tab inventory', () => {
    const REQUIRED = [
      'domain',
      'badge',
      'calendar_today',
      'calendar_month',
      'campaign',
      'forward_to_inbox',
      'notifications_active',
      'person_add',
      'person',
      'person_off',
      'call',
      'payments',
      'confirmation_number',
      'how_to_reg',
      'notes',
      'format_list_numbered',
      'task_alt',
      'close',
      'check_circle',
      'expand_less',
      'expand_more',
      'sensor_door',
      'schedule',
      'error',
      'refresh',
      'hourglass_top',
      'assignment',
      'groups',
      'shield_person',
    ];
    for (const name of REQUIRED) {
      expect(MATERIAL_SYMBOL_GLYPHMAP[name as keyof typeof MATERIAL_SYMBOL_GLYPHMAP]).toBeDefined();
    }
    expect(Object.keys(MATERIAL_SYMBOL_GLYPHMAP).length).toBeGreaterThanOrEqual(35);
  });
});
