import { describe, expect, it } from 'vitest';
import { THEMES, TEAM_TINT, WEAPON_TINT } from './themes.ts';
import { TANKS_MATERIAL_KEYS, materialsSignature, themedPalette, voidColor } from './themeAdapter.ts';

const ALIEN = { sky: '#050a1a', skyHorizon: '#3b1d6e', ground: '#2e7d6b', groundDeep: '#0f2b2a', groundEdge: '#7cffcb' };
const hex = /^#[0-9a-f]{6}$/;

function lum(css: string): number {
  const v = parseInt(css.slice(1), 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
}

describe('tanks theme adapter', () => {
  it('returns the battle palette untouched when the theme defines no materials (Delta Neon)', () => {
    for (const base of Object.values(THEMES)) {
      const snapshot = structuredClone(base);
      const out = themedPalette(base, {});
      expect(out).toBe(base);
      expect(out).toEqual(snapshot);
    }
    expect(voidColor(THEMES.dusk, false)).toBe('#05040b');
  });

  it('ignores unrelated or unparseable materials', () => {
    expect(themedPalette(THEMES.night, { felt: '#00ff00', asphalt: '#222222' })).toBe(THEMES.night);
    expect(themedPalette(THEMES.night, { sky: 'not-a-colour' })).toBe(THEMES.night);
  });

  it('uses the materials for sky, horizon and terrain', () => {
    const base = THEMES.dusk;
    const out = themedPalette(base, ALIEN);
    expect(out).not.toBe(base);
    // Strongly material-led (a hint of the battle theme is blended back in).
    const close = (a: string, b: string) => Math.abs(lum(a) - lum(b)) < 40;
    expect(close(out.sky[0], ALIEN.sky)).toBe(true);
    expect(close(out.sky[2], ALIEN.skyHorizon)).toBe(true);
    expect(close(out.topsoil, ALIEN.ground)).toBe(true);
    expect(close(out.rock, ALIEN.groundDeep)).toBe(true);
    expect(close(out.rim, ALIEN.groundEdge)).toBe(true);
    for (const key of ['far', 'farRim', 'mid', 'haze', 'cloud', 'rim', 'rimGlow', 'topsoil', 'soil', 'rock', 'deep', 'strata', 'scorch'] as const) {
      expect(out[key]).toMatch(hex);
      expect(out[key]).not.toBe(base[key]);
    }
    expect(voidColor(out, true)).toMatch(hex);
  });

  it('falls back per key: a partial material set keeps the battle colours for missing roles', () => {
    const out = themedPalette(THEMES.ember, { ground: '#446688' });
    expect(out.rim).toBe(THEMES.ember.rim);
    expect(out.rock).toBe(THEMES.ember.rock);
    expect(out.sky[0]).toBe(THEMES.ember.sky[0]);
    expect(out.sky[2]).toBe(THEMES.ember.sky[2]);
    expect(out.topsoil).not.toBe(THEMES.ember.topsoil);
  });

  it('keeps meaning colours (sun, lights, ore, motes) and never touches team / weapon tints', () => {
    const teams = [...TEAM_TINT];
    const weapons = { ...WEAPON_TINT };
    for (const base of Object.values(THEMES)) {
      const out = themedPalette(base, ALIEN);
      expect(out.sun).toEqual(base.sun);
      expect(out.midLights).toEqual(base.midLights);
      expect(out.ore).toEqual(base.ore);
      expect(out.motes).toBe(base.motes);
      expect(out.moteKind).toBe(base.moteKind);
    }
    expect([...TEAM_TINT]).toEqual(teams);
    expect(WEAPON_TINT).toEqual(weapons);
  });

  it('battlefields stay distinct inside one theme, and the rim reads against the sky', () => {
    const skies = new Set(Object.values(THEMES).map((b) => themedPalette(b, ALIEN).sky[1]));
    expect(skies.size).toBe(Object.keys(THEMES).length);
    const out = themedPalette(THEMES.night, ALIEN);
    expect(Math.abs(lum(out.rim) - lum(out.sky[2]))).toBeGreaterThan(60);
  });

  it('boosts the star field for starry themes and signs materials for change detection', () => {
    expect(themedPalette(THEMES.dusk, ALIEN, { ambient: 'stars' }).stars).toBeGreaterThanOrEqual(160);
    expect(themedPalette(THEMES.dusk, ALIEN, { ambient: 'rain' }).weather).toBe('rain');
    expect(themedPalette(THEMES.dusk, ALIEN).weather).toBeUndefined();
    expect(themedPalette(THEMES.dusk, {}, { ambient: 'rain' })).toBe(THEMES.dusk);
    expect(materialsSignature({})).toBe(TANKS_MATERIAL_KEYS.map(() => '').join('|'));
    expect(materialsSignature(ALIEN)).not.toBe(materialsSignature({ ...ALIEN, ground: '#000000' }));
    expect(materialsSignature(ALIEN, { ambient: 'rain' })).not.toBe(materialsSignature(ALIEN, { ambient: 'stars' }));
  });
});
