import { describe, expect, it } from 'vitest';
import { DEFAULT_WHEEL_SETTINGS, WheelSettingsSchema, cleanWheelEmoji, cleanWheelLabel } from '@dascade/shared/games/wheel';
import { readableTextColor, relativeLuminance } from '@dascade/game-core/wheel';
import { BUILTIN_PRESETS, applyPreset, suggestedPresetId } from './presets.ts';

const contrast = (a: string, b: string) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const players = (n: number) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);

describe('built-in wheel presets', () => {
  it('have unique ids', () => {
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
  });

  for (const preset of BUILTIN_PRESETS) {
    it(`${preset.id} builds valid settings for any room size, and survives the server's cleaning unchanged`, () => {
      for (const count of [0, 1, 2, 250]) {
        const data = preset.build({ playerNames: players(count) });
        const next = applyPreset(DEFAULT_WHEEL_SETTINGS, data);
        expect(next, `${count} players`).not.toBeNull();
        expect(WheelSettingsSchema.safeParse(next).success).toBe(true);
        for (const s of data.segments) {
          expect(cleanWheelLabel(s.label)).toBe(s.label);
          expect(cleanWheelEmoji(s.emoji)).toBe(s.emoji);
        }
      }
    });
  }

  describe('Trick or Treat', () => {
    const preset = BUILTIN_PRESETS.find((p) => p.id === 'builtin:trick-or-treat')!;
    const { segments, sliceMode } = preset.build({ playerNames: [] });

    it('is a weighted wheel where the Pumpkin Jackpot is the rarest slice', () => {
      expect(sliceMode).toBe('weighted');
      const jackpot = segments.find((s) => s.label === 'Pumpkin Jackpot')!;
      expect(jackpot.weight).toBe(1);
      expect(jackpot.emoji).toBe('🎃');
      for (const s of segments) if (s !== jackpot) expect(s.weight).toBeGreaterThan(jackpot.weight);
    });

    it('keeps every label readable and no slice disappears into the dark chrome', () => {
      for (const s of segments) {
        expect(contrast(s.color, readableTextColor(s.color)), s.label).toBeGreaterThanOrEqual(4.5);
        expect(relativeLuminance(s.color), s.label).toBeGreaterThan(0.1);
      }
    });

    it('never puts two slices of the same colour side by side, all the way round', () => {
      segments.forEach((s, i) => expect(s.color, s.label).not.toBe(segments[(i + 1) % segments.length]!.color));
    });

    it('uses original names only', () => {
      for (const s of segments) expect(s.label).not.toMatch(/great pumpkin|pumpkin king/i);
    });
  });

  it('suggests Trick or Treat under Halloween Night and the Lunch spot everywhere else', () => {
    expect(suggestedPresetId('halloween-night')).toBe('builtin:trick-or-treat');
    expect(suggestedPresetId('delta-neon')).toBe(BUILTIN_PRESETS[0]!.id);
    expect(suggestedPresetId('no-such-theme')).toBe('builtin:lunch');
  });
});
