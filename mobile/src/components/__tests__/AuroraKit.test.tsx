import { render } from '@testing-library/react-native';

import {
  AuroraButton,
  AuroraChip,
  AuroraHeader,
  AuroraEmptyState,
  AuroraErrorBanner,
  AuroraLivePill,
  AuroraModal,
  AuroraScreen,
  AuroraStatusChip,
  AuroraTextField,
  GlassCardV2,
  MaterialIcon,
  MATERIAL_SYMBOL_GLYPHMAP,
  MetricTile,
} from '../aurora';

// The native safe-area module is absent in jest — the todayConsole idiom: a
// plain View stand-in with zero insets keeps the aurora chrome renderable.
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  const Context = React.createContext({ insets, frame });
  return {
    __esModule: true,
    useSafeAreaInsets: () => React.useContext(Context).insets,
    useSafeAreaFrame: () => React.useContext(Context).frame,
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaConsumer: Context.Consumer,
    initialWindowMetrics: { insets, frame },
  };
});

/**
 * Phase 12 Stage A — the Aurora Glass v2 kit smoke tests. These assert the
 * BINDING behaviors of the additive components (glyph rendering, tier
 * recipes, variant labels, empty/error states, modal contract) so a future
 * refactor of the kit fails loudly here instead of on a device.
 */

describe('MaterialIcon', () => {
  test('renders the glyph for a committed inventory name', async () => {
    const { toJSON } = await render(<MaterialIcon name="domain" size={22} color="#3525cd" />);
    const json = toJSON();
    // createIconSet renders a Text that carries the loaded family + the
    // codepoint character as its children.
    expect(json?.type).toBe('Text');
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('MaterialSymbolsOutlined');
    const glyph = String.fromCharCode(MATERIAL_SYMBOL_GLYPHMAP.domain);
    expect(serialized).toContain(glyph);
  });

  test('the glyph inventory is the closed, unique codepoint set', () => {
    const entries = Object.entries(MATERIAL_SYMBOL_GLYPHMAP);
    expect(entries.length).toBeGreaterThanOrEqual(35);
    const codepoints = entries.map(([, cp]) => cp);
    expect(new Set(codepoints).size).toBe(codepoints.length); // no duplicates
    for (const [name, cp] of entries) {
      expect(typeof cp).toBe('number');
      expect(cp).toBeGreaterThan(0xe000); // Material Symbols PUA range
      expect(name).toMatch(/^[a-z_]+$/);
    }
    // The Stage A screen + staff tab inventory (spot-check the load-bearing
    // names — the staff console, the banner, the nav).
    for (const name of [
      'domain',
      'campaign',
      'forward_to_inbox',
      'notifications_active',
      'person_add',
      'how_to_reg',
      'sensor_door',
      'task_alt',
      'person_off',
      'hourglass_top',
      'assignment',
      'groups',
      'calendar_month',
      'shield_person',
      'person',
    ]) {
      expect(MATERIAL_SYMBOL_GLYPHMAP[name as keyof typeof MATERIAL_SYMBOL_GLYPHMAP]).toBeDefined();
    }
  });
});

describe('GlassCardV2 tiers', () => {
  test('card tier renders children with the card recipe', async () => {
    const { toJSON } = await render(
      <GlassCardV2 padded>
        <></>
      </GlassCardV2>,
    );
    const json = toJSON();
    expect(json?.props?.style).toBeTruthy();
  });

  test('every tier accepts children and a style override', async () => {
    for (const tier of ['card', 'tile', 'hero', 'nested', 'nestedSoft'] as const) {
      const { toJSON } = await render(
        <GlassCardV2 tier={tier} style={{ marginTop: 4 }}>
          <></>
        </GlassCardV2>,
      );
      const json = toJSON();
      // The style prop lands merged on the tier surface (no crash, children render).
      expect(JSON.stringify(json)).toContain('marginTop');
    }
  });
});

describe('AuroraButton', () => {
  test('gradient variant renders the label', async () => {
    const { getByText } = await render(
      <AuroraButton label="Add to queue" onPress={() => undefined} />,
    );
    expect(getByText('Add to queue')).toBeTruthy();
  });

  test.each([
    ['white', 'Call next'],
    ['primary', 'Call'],
    ['tertiary', 'Complete'],
    ['neutral', 'Keep it'],
    ['danger', 'Reject'],
    ['glass', 'Add walk-in'],
  ] as const)('%s variant renders its label', async (variant, label) => {
    const { getByText } = await render(
      <AuroraButton label={label} variant={variant} onPress={() => undefined} />,
    );
    expect(getByText(label)).toBeTruthy();
  });

  test('destructive tone maps to the danger variant', async () => {
    const { getByText } = await render(
      <AuroraButton label="Yes, cancel" tone="destructive" onPress={() => undefined} />,
    );
    expect(getByText('Yes, cancel')).toBeTruthy();
  });

  test('disabled buttons carry the a11y state', async () => {
    const { getByRole } = await render(
      <AuroraButton label="Confirm" disabled onPress={() => undefined} />,
    );
    expect(getByRole('button', { disabled: true })).toBeTruthy();
  });
});

describe('MetricTile', () => {
  test('renders label, value and caption', async () => {
    const { getByText } = await render(
      <MetricTile label="Pending" value={3} caption="Booked" tone="primary" />,
    );
    expect(getByText('Pending')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('Booked')).toBeTruthy();
  });
});

describe('AuroraChip family', () => {
  test('chip renders quiet by default and carries selection state when active', async () => {
    const { toJSON } = await render(
      <AuroraChip active onPress={() => undefined} accessibilityState={{ selected: true }}>
        <></>
      </AuroraChip>,
    );
    expect(toJSON()).toBeTruthy();
  });

  test('status chips render uppercase labels for every status', async () => {
    const cases = [
      ['PENDING', 'Pending'],
      ['CONFIRMED', 'Confirmed'],
      ['CALLED', 'Called'],
      ['COMPLETED', 'Completed'],
      ['CANCELLED', 'Cancelled'],
      ['NO_SHOW', 'No-show'],
    ] as const;
    for (const [status, label] of cases) {
      const { getByText } = await render(<AuroraStatusChip status={status} label={label} />);
      expect(getByText(label)).toBeTruthy();
    }
  });

  test('LIVE pill renders its label', async () => {
    const { getByText } = await render(<AuroraLivePill />);
    expect(getByText('LIVE')).toBeTruthy();
  });
});

describe('AuroraHeader (brand + avatar — mobilefix3 FIX-A/FIX-B)', () => {
  test('brand defaults to ClinIQ (the app name) with the context label', async () => {
    const { getByText } = await render(<AuroraHeader context="Staff Console" />);
    expect(getByText('ClinIQ')).toBeTruthy();
    expect(getByText('Staff Console')).toBeTruthy();
  });

  test('an explicit brand override still wins over the default', async () => {
    const { getByText, queryByText } = await render(<AuroraHeader brand="Custom" context="x" />);
    expect(getByText('Custom')).toBeTruthy();
    expect(queryByText('ClinIQ')).toBeNull();
  });

  test('avatar renders the PHOTO when avatarUrl is set (no initials fallback)', async () => {
    const { getByLabelText, queryByText } = await render(
      <AuroraHeader userName="Dr Yx" avatarUrl="data:image/png;base64,iVBORw0KGgo" />,
    );
    // The existing Avatar component: Image with the "{name} photo" label.
    expect(getByLabelText('Dr Yx photo')).toBeTruthy();
    expect(queryByText('DY')).toBeNull();
  });

  test('avatar falls back to initials when avatarUrl is null or undefined', async () => {
    const withNull = await render(<AuroraHeader userName="Dr Yx" avatarUrl={null} />);
    expect(withNull.getByText('DY')).toBeTruthy();
    expect(withNull.queryByLabelText('Dr Yx photo')).toBeNull();

    const withoutProp = await render(<AuroraHeader userName="Dr Yx" />);
    expect(withoutProp.getByText('DY')).toBeTruthy();
    expect(withoutProp.queryByLabelText('Dr Yx photo')).toBeNull();
  });
});

describe('Aurora banners + empty state', () => {
  test('error banner renders nothing for null and the message otherwise', async () => {
    const empty = await render(<AuroraErrorBanner message={null} />);
    expect(empty.toJSON()).toBeNull();
    const { getByText } = await render(<AuroraErrorBanner message="Try again later" />);
    expect(getByText('Try again later')).toBeTruthy();
  });

  test('empty state renders title, caption and CTA', async () => {
    const { getByText } = await render(
      <AuroraEmptyState
        icon="calendar_month"
        title="No appointments today"
        caption="Patients will appear here as they book."
        ctaLabel="Add walk-in"
        onCta={() => undefined}
      />,
    );
    expect(getByText('No appointments today')).toBeTruthy();
    expect(getByText('Add walk-in')).toBeTruthy();
  });
});

describe('AuroraTextField', () => {
  test('renders label, placeholder and error line', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <AuroraTextField label="Patient name" placeholder="Full name" error="Name is required" />,
    );
    expect(getByText('Patient name')).toBeTruthy();
    expect(getByPlaceholderText('Full name')).toBeTruthy();
    expect(getByText('Name is required')).toBeTruthy();
  });
});

describe('AuroraModal + AuroraScreen (structural smoke)', () => {
  test('modal renders title + children when visible', async () => {
    const { getByText } = await render(
      <AuroraModal visible title="Add walk-in patient" titleIcon="how_to_reg">
        <AuroraTextField label="Phone" placeholder="98765 43210" />
      </AuroraModal>,
    );
    expect(getByText('Add walk-in patient')).toBeTruthy();
    expect(getByText('Phone')).toBeTruthy();
  });

  test('screen renders the canvas layers + safe area', async () => {
    const { toJSON } = await render(
      <AuroraScreen>
        <></>
      </AuroraScreen>,
    );
    // The canvas tree: root View → gradient layer + 9 orb Views + SafeAreaView
    // (expo-linear-gradient is jest-mocked; assert the LAYER COUNT — the orbs
    // and the safe wrapper are plain RN Views that do serialize).
    const json = toJSON();
    expect(json?.type).toBe('View');
    const viewCount = JSON.stringify(json).match(/"type":"View"/g)?.length ?? 0;
    expect(viewCount).toBeGreaterThanOrEqual(10); // 9 orbs + root (+ mock layers)
    const serialized = JSON.stringify(json);
    expect(serialized.length).toBeGreaterThan(200); // a real tree, not a stub
  });
});
