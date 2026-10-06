import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS } from '../../games/wheel/presets.ts';
import { REACTIONS, reactionFor } from './wheelReactions.ts';

describe('Halloween Night wheel reactions', () => {
  it('reads the slice emoji first (variation selectors and ZWJ sequences included)', () => {
    expect(reactionFor({ label: 'Pizza', emoji: '🎃' })).toBe('jackpot');
    expect(reactionFor({ label: 'Candy', emoji: '👻' })).toBe('ghost');
    expect(reactionFor({ label: '', emoji: '🐈‍⬛' })).toBe('cat');
    expect(reactionFor({ label: '', emoji: '☠️' })).toBe('skeleton');
    expect(reactionFor({ label: '', emoji: '🧙‍♀️' })).toBe('brew');
    expect(reactionFor({ label: '', emoji: '🧛' })).toBe('bats');
  });

  it('then words in the label, most specific first', () => {
    expect(reactionFor({ label: 'Trick: shrink everyone', emoji: '' })).toBe('shrink');
    expect(reactionFor({ label: 'Trick or treat', emoji: '' })).toBe('boo');
    expect(reactionFor({ label: 'Treat: raid the candy bowl', emoji: '' })).toBe('candy');
    expect(reactionFor({ label: 'Howl like a werewolf', emoji: '' })).toBe('monster');
    expect(reactionFor({ label: "Say 'Good evening' like a vampire", emoji: '' })).toBe('bats');
    expect(reactionFor({ label: 'Tell a ghost story', emoji: '' })).toBe('ghost');
    expect(reactionFor({ label: 'Pumpkin Jackpot', emoji: '' })).toBe('jackpot');
    expect(reactionFor({ label: 'Do your best witch cackle', emoji: '' })).toBe('brew');
  });

  it('leaves everything else to the plain celebration (whole words only)', () => {
    expect(reactionFor({ label: 'Pizza', emoji: '🍕' })).toBeNull();
    expect(reactionFor({ label: '', emoji: '' })).toBeNull();
    expect(reactionFor({ label: 'Scattered showers', emoji: '' })).toBeNull();
    expect(reactionFor({ label: 'Boolean logic', emoji: '' })).toBeNull();
  });

  it('gives every Trick or Treat slice its own show', () => {
    const preset = BUILTIN_PRESETS.find((p) => p.id === 'builtin:trick-or-treat')!;
    const kinds = preset.build({ playerNames: [] }).segments.map(reactionFor);
    expect(kinds).toEqual(['candy', 'brew', 'shrink', 'ghost', 'boo', 'cat', 'jackpot', 'skeleton', 'monster']);
  });

  it('captions every reaction’s sound, and every show is short', () => {
    for (const [kind, info] of Object.entries(REACTIONS)) {
      expect(info.caption, kind).toMatch(/^\[.+\]$/);
      expect(info.ms, kind).toBeGreaterThanOrEqual(1500);
      expect(info.ms, kind).toBeLessThanOrEqual(4000);
    }
  });
});
