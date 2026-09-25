import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { WHEEL_LIMITS, WHEEL_PALETTE, WheelSettingsSchema, DEFAULT_WHEEL_SETTINGS, cleanWheelEmoji } from '@dascade/shared/games/wheel';
import {
  assignColors,
  colorBetween,
  colorDistance,
  displayLabel,
  normalizeSegments,
  paletteColor,
  probabilities,
  readableTextColor,
  relativeLuminance,
  sanitizeWeight,
  shade,
  totalWeight,
} from './index.ts';

const seg = (id: string, label: string, weight: unknown = 1, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  weight,
  color: '#ffb020',
  emoji: '',
  enabled: true,
  ...extra,
});

describe('sanitizeWeight', () => {
  it('accepts positive finite numbers and clamps to the maximum', () => {
    expect(sanitizeWeight(1)).toBe(1);
    expect(sanitizeWeight(0.25)).toBe(0.25);
    expect(sanitizeWeight(1e9)).toBe(WHEEL_LIMITS.weightMax);
  });
  it('turns zero, negative and invalid values into 0', () => {
    for (const bad of [0, -1, -0, NaN, Infinity, -Infinity, '3', null, undefined, {}, [], true]) {
      expect(sanitizeWeight(bad)).toBe(0);
    }
  });
});

describe('normalizeSegments', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeSegments(undefined)).toEqual([]);
    expect(normalizeSegments(null)).toEqual([]);
    expect(normalizeSegments('pizza')).toEqual([]);
    expect(normalizeSegments({ length: 3 })).toEqual([]);
  });

  it('drops disabled segments and zero / negative / NaN / non-numeric weights', () => {
    const active = normalizeSegments([
      seg('a', 'Keep'),
      seg('b', 'Disabled', 1, { enabled: false }),
      seg('c', 'Zero', 0),
      seg('d', 'Negative', -5),
      seg('e', 'NaN', NaN),
      seg('f', 'Infinite', Infinity),
      seg('g', 'String', '4'),
      seg('h', 'Also keep', 2.5),
      null,
      42,
      'junk',
    ]);
    expect(active.map((s) => s.id)).toEqual(['a', 'h']);
    expect(active[1]!.weight).toBe(2.5);
  });

  it('clamps huge weights', () => {
    expect(normalizeSegments([seg('a', 'Big', 5000)])[0]!.weight).toBe(WHEEL_LIMITS.weightMax);
  });

  it('cleans and bounds labels, even huge ones', () => {
    const huge = 'W'.repeat(10_000);
    const [a, b] = normalizeSegments([seg('a', huge), seg('b', '  hello\u0000‮world\n  again  ')]);
    expect(Array.from(a!.label).length).toBe(WHEEL_LIMITS.label);
    expect(b!.label).toBe('helloworld again');
  });

  it('keeps icon-only segments but drops segments with neither label nor icon', () => {
    const active = normalizeSegments([seg('a', '', 1, { emoji: '🍕' }), seg('b', '   '), seg('c', '​')]);
    expect(active.map((s) => s.id)).toEqual(['a']);
    expect(displayLabel(active[0]!)).toBe('🍕');
  });

  it('keeps duplicate labels as distinct segments', () => {
    const active = normalizeSegments([seg('a', 'Pizza'), seg('b', 'Pizza'), seg('c', 'pizza')]);
    expect(active).toHaveLength(3);
    expect(new Set(active.map((s) => s.id)).size).toBe(3);
  });

  it('repairs invalid and duplicate ids', () => {
    const active = normalizeSegments([seg('dup', 'A'), seg('dup', 'B'), seg('dup', 'C'), seg('bad id!', 'D'), { label: 'E', weight: 1 }]);
    const ids = active.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids.slice(0, 3)).toEqual(['dup', 'dup~2', 'dup~3']);
    expect(ids[3]).toBe('seg-3');
  });

  it('falls back to palette colors for invalid colors and lowercases valid ones', () => {
    const [a, b, c] = normalizeSegments([seg('a', 'A', 1, { color: 'red' }), seg('b', 'B', 1, { color: '#ABCDEF' }), seg('c', 'C', 1, { color: 123 })]);
    expect(a!.color).toBe(paletteColor(0));
    expect(b!.color).toBe('#abcdef');
    expect(c!.color).toBe(paletteColor(2));
  });

  it('caps the active wheel at the segment limit', () => {
    const many = Array.from({ length: 260 }, (_, i) => seg(`s${i}`, `Option ${i}`));
    expect(normalizeSegments(many)).toHaveLength(WHEEL_LIMITS.segments);
  });

  it('handles a single segment and exactly 200 segments', () => {
    expect(normalizeSegments([seg('only', 'Only one')])).toHaveLength(1);
    const two00 = Array.from({ length: 200 }, (_, i) => seg(`s${i}`, `Option ${i}`, (i % 7) + 1));
    const active = normalizeSegments(two00);
    expect(active).toHaveLength(200);
    expect(totalWeight(active)).toBe(two00.reduce((sum, s) => sum + (s.weight as number), 0));
  });
});

describe('probabilities', () => {
  it('sums to 1 and follows the weights', () => {
    const p = probabilities([{ weight: 1 }, { weight: 3 }]);
    expect(p).toEqual([0.25, 0.75]);
  });
  it('treats invalid weights as zero and never divides by zero', () => {
    expect(probabilities([{ weight: 0 }, { weight: NaN }])).toEqual([0, 0]);
    expect(probabilities([{ weight: -1 }, { weight: 2 }])).toEqual([0, 1]);
    expect(probabilities([])).toEqual([]);
  });
});

describe('colors', () => {
  it('assignColors never puts the same color on neighbouring slices (including the wrap)', () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = createSeededRng(`colors-${seed}`);
      for (const n of [2, 3, 5, 15, 16, 17, 32, 33, 60, 200]) {
        const colors = assignColors(n, rng);
        expect(colors).toHaveLength(n);
        for (let i = 0; i < n; i++) expect(colors[i]).not.toBe(colors[(i + 1) % n]);
        for (const c of colors) expect(WHEEL_PALETTE).toContain(c);
      }
    }
  });

  it('assignColors is deterministic for a seed and handles tiny inputs', () => {
    expect(assignColors(8, createSeededRng('x'))).toEqual(assignColors(8, createSeededRng('x')));
    expect(assignColors(0, createSeededRng('x'))).toEqual([]);
    expect(assignColors(1, createSeededRng('x'))).toHaveLength(1);
    expect(assignColors(3, createSeededRng('x'), [])).toEqual([]);
  });

  it('colorDistance separates similar and different colors', () => {
    expect(colorDistance('#22d3ee', '#22d3ee')).toBe(0);
    expect(colorDistance('#22d3ee', '#38bdf8')).toBeLessThan(colorDistance('#22d3ee', '#ffb020'));
    expect(colorDistance('bad', '#ffffff')).toBe(0);
  });

  it('colorBetween picks something clearly different from blue neighbours', () => {
    const rng = createSeededRng('blue');
    for (let i = 0; i < 100; i++) {
      const c = colorBetween('#22d3ee', '#60a5fa', rng);
      expect(['#22d3ee', '#60a5fa', '#38bdf8', '#818cf8']).not.toContain(c);
    }
    expect(WHEEL_PALETTE).toContain(colorBetween(undefined, undefined, rng));
  });

  it('colorBetween avoids both neighbours', () => {
    const rng = createSeededRng('between');
    for (let i = 0; i < 200; i++) {
      const c = colorBetween('#ffb020', '#ff4f81', rng);
      expect(c).not.toBe('#ffb020');
      expect(c).not.toBe('#ff4f81');
    }
  });

  it('picks readable text colors', () => {
    expect(readableTextColor('#ffd23f')).toBe('#140a00');
    expect(readableTextColor('#ffffff')).toBe('#140a00');
    expect(readableTextColor('#1e1b4b')).toBe('#ffffff');
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(relativeLuminance('nope')).toBe(0);
  });

  it('shades toward white and black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('bad', 0.5)).toBe('bad');
  });
});

describe('shared contract sanitation', () => {
  it('cleanWheelEmoji keeps ZWJ sequences, limits graphemes and strips bidi controls', () => {
    expect(cleanWheelEmoji('👩‍💻')).toBe('👩‍💻');
    expect(cleanWheelEmoji('🍕🌮🍣🍔')).toBe('🍕🌮');
    expect(cleanWheelEmoji('‮🍕\u0007')).toBe('🍕');
    expect(cleanWheelEmoji(42)).toBe('');
    expect(cleanWheelEmoji('🇺🇸')).toBe('🇺🇸');
  });

  it('cleanWheelEmoji caps stacked combining marks (zalgo) but keeps real emoji sequences', () => {
    const acute = String.fromCharCode(0x301);
    // One grapheme, 15 UTF-16 units: used to pass untouched and tower over the UI.
    expect(cleanWheelEmoji(`x${acute.repeat(14)}`)).toBe(`x${acute}${acute}`);
    expect(cleanWheelEmoji(`🍕${acute.repeat(10)}`)).toBe(`🍕${acute}${acute}`);
    // Keycap = digit + VS16 + U+20E3 (two marks), heart-on-fire uses VS16 + ZWJ.
    expect(cleanWheelEmoji('1️⃣')).toBe('1️⃣');
    expect(cleanWheelEmoji('❤️‍🔥')).toBe('❤️‍🔥');
    expect(cleanWheelEmoji('👍🏽')).toBe('👍🏽');
    // The schema applies it, and the transform is idempotent (updateSettings re-parses).
    const parsed = WheelSettingsSchema.parse({ ...DEFAULT_WHEEL_SETTINGS, segments: [seg('a', 'A', 1, { emoji: `x${acute.repeat(12)}` })] });
    expect(parsed.segments[0]!.emoji).toBe(`x${acute}${acute}`);
    expect(WheelSettingsSchema.parse(parsed).segments[0]!.emoji).toBe(parsed.segments[0]!.emoji);
  });

  it('the settings schema rejects non-finite numbers (msgpack can carry NaN / Infinity)', () => {
    const bad = (patch: Record<string, unknown>) => WheelSettingsSchema.safeParse({ ...DEFAULT_WHEEL_SETTINGS, ...patch }).success;
    expect(bad({ segments: [seg('a', 'A', Infinity)] })).toBe(false);
    expect(bad({ segments: [seg('a', 'A', -Infinity)] })).toBe(false);
    expect(bad({ spinDurationMs: Infinity })).toBe(false);
    expect(bad({ spinDurationMs: NaN })).toBe(false);
    expect(bad({ spinDurationMs: 2500.5 })).toBe(false);
  });

  it('the default settings satisfy the schema', () => {
    const parsed = WheelSettingsSchema.safeParse(DEFAULT_WHEEL_SETTINGS);
    expect(parsed.success).toBe(true);
    expect(normalizeSegments(DEFAULT_WHEEL_SETTINGS.segments)).toHaveLength(DEFAULT_WHEEL_SETTINGS.segments.length);
  });

  it('the settings schema rejects invalid values and cleans text', () => {
    const base = DEFAULT_WHEEL_SETTINGS;
    const bad = (patch: Record<string, unknown>) => WheelSettingsSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ segments: [seg('a', 'A', -1)] })).toBe(false);
    expect(bad({ segments: [seg('a', 'A', 1001)] })).toBe(false);
    expect(bad({ segments: [seg('a', 'A', NaN)] })).toBe(false);
    expect(bad({ segments: [seg('a', 'A', 1, { color: 'red' })] })).toBe(false);
    expect(bad({ segments: [seg('a', 'A'), seg('a', 'B')] })).toBe(false);
    expect(bad({ segments: Array.from({ length: 201 }, (_, i) => seg(`s${i}`, 'x')) })).toBe(false);
    expect(bad({ spinDurationMs: 1000 })).toBe(false);
    expect(bad({ spinDurationMs: 13_000 })).toBe(false);
    expect(bad({ sliceMode: 'random' })).toBe(false);
    const ok = WheelSettingsSchema.parse({ ...base, title: '  Big\u0000  question ', segments: [seg('a', '  Pizza‮ ', 0, { color: '#FFB020', emoji: '🍕🍕🍕' })] });
    expect(ok.title).toBe('Big question');
    expect(ok.segments[0]).toMatchObject({ label: 'Pizza', color: '#ffb020', emoji: '🍕🍕', weight: 0 });
  });
});
