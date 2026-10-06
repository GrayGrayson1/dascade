import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '@dascade/ui';
import { celebrationProblems } from './celebration.ts';
import { loadThemeSkin } from './registry.ts';
import { wheelSkinProblems } from './wheelSkin.ts';

describe("skins' optional extras (celebration, sounds, wheel)", () => {
  it('every built-in skin’s celebration, sounds and wheel hooks are well formed', async () => {
    for (const t of BUILT_IN_THEMES) {
      const skin = await loadThemeSkin(t.id);
      if (skin.celebration) expect(celebrationProblems(skin.celebration), t.id).toEqual([]);
      for (const [name, voice] of Object.entries(skin.sounds ?? {})) expect(typeof voice, `${t.id} sounds.${name}`).toBe('function');
      if (skin.wheel) expect(wheelSkinProblems(skin.wheel), t.id).toEqual([]);
    }
  }, 120_000);

  it('Delta Neon defines none: the default theme keeps its own claw art, confetti and sounds', async () => {
    const skin = await loadThemeSkin('delta-neon');
    expect(skin.claw).toBeUndefined();
    expect(skin.celebration).toBeUndefined();
    expect(skin.sounds).toBeUndefined();
    expect(skin.wheel).toBeUndefined();
  }, 60_000);

  it('Halloween Night brings its confetti sprites and its six voices', async () => {
    const skin = await loadThemeSkin('halloween-night');
    expect(skin.celebration?.sprites?.length).toBeGreaterThan(0);
    expect(Object.keys(skin.sounds ?? {}).sort()).toEqual(['bigwin', 'coin', 'ding', 'join', 'pop', 'win']);
  }, 60_000);

  it('Halloween Night dresses the Wheel of DAStiny: decor plus launch, peg and landing voices', async () => {
    const skin = await loadThemeSkin('halloween-night');
    expect(typeof skin.wheel?.Decor).toBe('function');
    expect(Object.keys(skin.wheel?.voices ?? {}).sort()).toEqual(['launch', 'reveal', 'tick']);
  }, 60_000);

  it('wheelSkinProblems flags unusable hooks', () => {
    expect(wheelSkinProblems({})).toEqual([]);
    expect(wheelSkinProblems({ Decor: 'nope', voices: { tick: 3, boom: () => {} } } as never)).toEqual([
      'Decor must be a component',
      'voice "tick" must be a function',
      'unknown voice "boom"',
    ]);
  });
});
