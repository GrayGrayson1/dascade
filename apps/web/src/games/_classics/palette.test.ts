import { describe, expect, it } from 'vitest';
import { deepen, hasScreenMaterials, lighten, luminance, mix, screenColors, tint } from './palette.ts';
import { COURT_ART, courtArt } from '../paddle/palette.ts';
import { ARENA_ART, arenaArt } from '../snake/palette.ts';
import { SPACE_ART, spaceArt } from '../asteroids/palette.ts';
import { FIELD_ART, fieldArt } from '../bricks/palette.ts';
import { WELL_ART, wellArt } from '../blocks/palette.ts';

const THEMED = { screen: '#001a33', screenGlow: '#ff8800', bezel: '#b5651d' };
const LIGHT = { screen: '#f4f1e8', screenGlow: '#2266aa', bezel: '#888888' };

describe('classics palette helpers', () => {
  it('tint keeps the colour and sets alpha (hex and rgb inputs)', () => {
    expect(tint('#7cf5ff', 0.1)).toBe('rgba(124, 245, 255, 0.1)');
    expect(tint('rgb(1, 2, 3)', 0.5)).toBe('rgba(1, 2, 3, 0.5)');
    expect(tint('rgba(10, 20, 30, 0.4)', 0)).toBe('rgba(10, 20, 30, 0)');
  });
  it('mix / deepen / lighten', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#123456', '#abcdef', 0)).toBe('#123456');
    expect(mix('#123456', '#abcdef', 1)).toBe('#abcdef');
    expect(deepen('#ff0000', 1)).toBe('#000000');
    expect(lighten('#000000', 1)).toBe('#ffffff');
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
  });
  it('screenColors falls back to the game art and follows materials', () => {
    const fb = { top: '#111111', bottom: '#000000', glow: '#00ffff' };
    expect(screenColors({}, fb)).toEqual(fb);
    const s = screenColors(THEMED, fb);
    expect(s.top).toBe('#001a33');
    expect(s.glow).toBe('#ff8800');
    expect(luminance(s.bottom)).toBeLessThan(luminance(s.top));
    expect(hasScreenMaterials({})).toBe(false);
    expect(hasScreenMaterials({ felt: '#00ff00' })).toBe(false);
    expect(hasScreenMaterials(THEMED)).toBe(true);
  });
});

describe('per-game screen palettes', () => {
  it('Delta Neon (no materials) keeps every game on its exact original art', () => {
    expect(courtArt({})).toBe(COURT_ART);
    expect(arenaArt({})).toBe(ARENA_ART);
    expect(spaceArt({})).toBe(SPACE_ART);
    expect(fieldArt({})).toBe(FIELD_ART);
    expect(wellArt({})).toBe(WELL_ART);
    expect(COURT_ART).toEqual({ courtTop: '#07182a', courtBottom: '#030b15', grid: 'rgba(124, 245, 255, 0.045)', centre: 'rgba(214, 246, 255, 0.34)', glow: '#7cf5ff', line: '#d6f6ff', ink: '#f8f6ff' });
    expect(ARENA_ART).toMatchObject({ floorTop: '#04140c', floorBottom: '#020906', lattice: 'rgba(120, 255, 190, 0.10)', rim: 'rgba(45, 227, 143, 0.55)' });
    expect(SPACE_ART).toEqual({ spaceTop: '#0b0824', spaceBottom: '#04030d', nebulaA: '#6d28d9', nebulaB: '#0e7490', nebulaC: '#be185d' });
    expect(FIELD_ART).toEqual({ top: '#0d0a22', mid: '#07061a', bottom: '#0a0716', grid: 'rgba(160, 150, 255, 0.05)', ceiling: 'rgba(124, 245, 255, 0.12)' });
    expect(WELL_ART).toEqual({ top: '#0b0a1d', bottom: '#05040d', grid: 'rgba(160, 150, 255, 0.07)', pausedInk: 'rgba(124, 245, 255, 0.05)' });
  });
  it('a theme re-colours backgrounds from screen / screenGlow', () => {
    expect(courtArt(THEMED)).toMatchObject({ courtTop: '#001a33', glow: '#ff8800', ink: '#f8f6ff' });
    expect(courtArt(THEMED).grid).toMatch(/^rgba\(255, 136, 0,/);
    expect(arenaArt(THEMED)).toMatchObject({ floorTop: '#001a33', rim: 'rgba(255, 136, 0, 0.6)' });
    expect(spaceArt(THEMED)).toMatchObject({ spaceTop: '#001a33', nebulaA: '#ff8800' });
    expect(fieldArt(THEMED)).toMatchObject({ top: '#001a33', ceiling: 'rgba(255, 136, 0, 0.2)' });
    expect(wellArt(THEMED)).toMatchObject({ top: '#001a33', pausedInk: 'rgba(255, 136, 0, 0.07)' });
  });
  it('court text stays readable on a light screen', () => {
    expect(courtArt(LIGHT).ink).toBe('#07050f');
  });
  it('a glow-only theme keeps the original screen background', () => {
    expect(courtArt({ screenGlow: '#ff0000' }).courtTop).toBe(COURT_ART.courtTop);
    expect(fieldArt({ screenGlow: '#ff0000' }).top).toBe(FIELD_ART.top);
  });
});
