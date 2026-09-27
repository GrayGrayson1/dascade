import { describe, expect, it } from 'vitest';
import { TRACK_DEFS } from '@dascade/game-core/circuit';
import { DEFAULT_WORLD, circuitWorldPalette, contrast, separate } from './themeAdapter.ts';

const tracks = Object.values(TRACK_DEFS);
const theme = tracks[0]!.theme;
/** A full "night track" material set (subset of a theme's materials). */
const FIXTURE_MATERIALS = {
  sky: '#0a0816', skyHorizon: '#2e2856', ground: '#3d2f5c', groundDeep: '#231e42', groundEdge: '#a78bfa',
  asphalt: '#2b2b33', asphaltLine: '#f8f6ff', curbA: '#ff5a5f', curbB: '#f8f6ff', offroad: '#1f3d2b',
  grass: '#2f9e44', grassDeep: '#237a34', water: '#0b3a5c', metal: '#9d95c4',
};

describe('circuitWorldPalette', () => {
  it('without materials returns exactly the game’s own constants (Delta Neon)', () => {
    for (const def of tracks) {
      const p = circuitWorldPalette(def.theme, {});
      expect(p.themed).toBe(false);
      expect(p.sig).toBe('');
      expect(p.track).toBe(def.theme);
      expect(p.curbAlt).toBe(def.theme.neonB);
      const { themed: _t, sig: _s, track: _k, curbAlt: _c, ...world } = p;
      expect(world).toEqual({ ...DEFAULT_WORLD });
    }
    expect(DEFAULT_WORLD.roadEdge).toBe('#e6ebff');
    expect(DEFAULT_WORLD.roofTones).toEqual(['#2a2f47', '#342f4c', '#243a46', '#3b2d40', '#2c3a33', '#3e3833']);
    expect(DEFAULT_WORLD.background).toBe('#070814');
    expect(DEFAULT_WORLD.steel).toBe(0x3a4262);
  });

  it('is stable (same object) for the default palette and defaults with no argument', () => {
    expect(circuitWorldPalette(theme)).toBe(circuitWorldPalette(theme, {}));
  });

  it('uses theme materials for asphalt, paint, curbs and run-off', () => {
    const p = circuitWorldPalette(theme, { asphalt: '#303030', asphaltLine: '#fafafa', curbA: '#d01010', curbB: '#f0f0f0', offroad: '#224422', ground: '#403020', groundDeep: '#201810' });
    expect(p.themed).toBe(true);
    expect(p.sig).not.toBe('');
    expect(p.track.road).toBe('#303030');
    expect(p.track.runoff).toBe('#224422');
    expect(p.track.curb).toBe('#d01010');
    expect(p.curbAlt).toBe('#f0f0f0');
    expect(p.roadEdge).toBe('#fafafa');
    expect(p.sidewalk).toBe('#403020');
    expect(p.block).toBe('#201810');
  });

  it('keeps the track identity neon and never mutates the track theme', () => {
    const before = { ...theme };
    const p = circuitWorldPalette(theme, FIXTURE_MATERIALS);
    expect(p.track.neonA).toBe(theme.neonA);
    expect(p.track.neonB).toBe(theme.neonB);
    expect(theme).toEqual(before);
  });

  it('accepts rgb()/rgba() materials (alpha dropped)', () => {
    const p = circuitWorldPalette(theme, { asphalt: 'rgba(48, 48, 48, 0.5)' });
    expect(p.track.road).toBe('#303030');
  });

  it('a partial material set falls back per key', () => {
    const p = circuitWorldPalette(theme, { offroad: '#112211' });
    expect(p.track.runoff).toBe('#112211');
    expect(p.track.road).toBe(theme.road);
    expect(p.track.curb).toBe(theme.curb);
  });

  it('keeps paint and curbs readable against colliding asphalt', () => {
    const p = circuitWorldPalette(theme, { asphalt: '#808080', asphaltLine: '#828282', curbA: '#808080', curbB: '#808080' });
    expect(contrast(p.roadEdge, p.track.road)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.track.curb, p.track.road)).toBeGreaterThanOrEqual(1.8);
    expect(contrast(p.curbAlt, p.track.curb)).toBeGreaterThanOrEqual(1.6);
  });

  it('different materials give different signatures; same materials the same one', () => {
    const a = circuitWorldPalette(theme, FIXTURE_MATERIALS);
    const b = circuitWorldPalette(theme, { ...FIXTURE_MATERIALS, asphalt: '#101010' });
    expect(a.sig).toBe(circuitWorldPalette(theme, { ...FIXTURE_MATERIALS }).sig);
    expect(a.sig).not.toBe(b.sig);
  });
});

describe('separate', () => {
  it('leaves already-distinct colours alone and pushes collisions apart', () => {
    expect(separate('#ffffff', '#000000', 3)).toBe('#ffffff');
    expect(contrast(separate('#202020', '#202020', 3), '#202020')).toBeGreaterThanOrEqual(3);
    expect(contrast(separate('#e0e0e0', '#e0e0e0', 3), '#e0e0e0')).toBeGreaterThanOrEqual(3);
  });
});
