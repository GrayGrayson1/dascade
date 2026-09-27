import { describe, expect, it } from 'vitest';
import { ART } from './palette.ts';
import { PUTT_DEFAULT_ART, PUTT_MATERIAL_KEYS, puttArt, puttMaterialsSignature } from './themeAdapter.ts';

const CD_ROM = { grass: '#2fae3a', grassDeep: '#1e7c2a', sand: '#e9d8a6', hazard: '#1c7ed6', wall: '#5c4033', wallTop: '#8b6b4f', sky: '#1d0f45', stage: '#1f0b35' };

const rgb = (css: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const n = /rgba?\(([^)]+)\)/.exec(css)![1]!.split(',').map((x) => parseFloat(x));
  return [n[0]!, n[1]!, n[2]!];
};
const dist = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
};

describe('putt theme adapter', () => {
  it('keeps today’s exact course art when the theme defines no materials (Delta Neon)', () => {
    expect(puttArt({})).toBe(PUTT_DEFAULT_ART);
    for (const [k, v] of Object.entries(ART)) expect(PUTT_DEFAULT_ART[k as keyof typeof ART]).toEqual(v);
    // The inline details the renderer used to hard-code, verbatim.
    expect(PUTT_DEFAULT_ART).toMatchObject({
      halo: 'rgba(163, 230, 53, 0.10)',
      halo2: 'rgba(34, 211, 238, 0.04)',
      turfShade: 'rgba(0, 18, 6, 0.85)',
      turfShadeTight: 'rgba(0, 18, 6, 0.55)',
      turfLip: 'rgba(214, 255, 170, 0.55)',
      collar: 'rgba(190, 255, 120, 0.22)',
      collarOut: 'rgba(190, 255, 120, 0)',
      cupWall: '#1b2a1e',
      lampPost: '#1b1b2e',
    });
  });

  it('ignores unrelated and unparseable materials', () => {
    expect(puttArt({ felt: '#0f5132', asphalt: '#222' })).toBe(PUTT_DEFAULT_ART);
    expect(puttArt({ grass: 'nope' })).toBe(PUTT_DEFAULT_ART);
  });

  it('paints turf, sand, water, walls and surroundings from the materials', () => {
    const a = puttArt(CD_ROM);
    expect(a.turfMid).toBe(CD_ROM.grass);
    expect(a.turfDark).toBe(CD_ROM.grassDeep);
    expect(a.waterMid).toBe(CD_ROM.hazard);
    expect(a.wallFace).toBe(CD_ROM.wall);
    expect(a.voidTop).toBe(CD_ROM.sky);
    expect(dist(a.sandLight, CD_ROM.sand)).toBeLessThan(30);
    for (const k of ['turfLight', 'plinth', 'plinthEdge', 'tee', 'teeEdge', 'sandDark', 'sandRim', 'waterDeep', 'waterLight', 'wallTop', 'wallFaceDark', 'wallGlow', 'voidBottom', 'halo', 'turfLip', 'collar', 'cupWall'] as const) {
      expect(a[k]).not.toBe(PUTT_DEFAULT_ART[k]);
    }
  });

  it('falls back per role when only some materials are present', () => {
    const a = puttArt({ sand: '#ddccaa' });
    expect(a.sandLight).not.toBe(ART.sandLight);
    expect(a.turfMid).toBe(ART.turfMid);
    expect(a.waterMid).toBe(ART.waterMid);
    expect(a.wallGlow).toBe(ART.wallGlow);
    expect(a.voidTop).toBe(ART.voidTop);
  });

  it('never themes meaning colours (cup, flag, ball, aim, hazards-in-play, cushions, portals)', () => {
    const a = puttArt(CD_ROM);
    for (const k of ['cupRim', 'cupHole', 'flag', 'flagPole', 'ball', 'ballShade', 'aim', 'aimPreview', 'bumper', 'bumperCore', 'blade', 'bladeTop', 'hub', 'bankGlow', 'kickerGlow', 'chevron', 'post', 'postTop'] as const) {
      expect(a[k]).toBe(ART[k]);
    }
    expect(a.portal).toEqual(ART.portal);
  });

  it('keeps plain cushions distinguishable from bank (yellow) and kicker (magenta) cushions', () => {
    for (const wallTop of ['#ffe14d', '#ff4fd8', '#d4af37', '#8b6b4f', '#f4f8ff']) {
      const a = puttArt({ ...CD_ROM, wallTop });
      expect(dist(a.wallGlow, ART.bankGlow)).toBeGreaterThanOrEqual(60);
      expect(dist(a.wallGlow, ART.kickerGlow)).toBeGreaterThanOrEqual(60);
    }
  });

  it('water stays readable against the turf and the ball stays visible on turf', () => {
    const a = puttArt(CD_ROM);
    expect(dist(a.waterMid, a.turfMid)).toBeGreaterThan(60);
    expect(dist(a.ball, a.turfMid)).toBeGreaterThan(150);
  });

  it('signs only the materials it reads', () => {
    expect(puttMaterialsSignature({})).toBe(PUTT_MATERIAL_KEYS.map(() => '').join('|'));
    expect(puttMaterialsSignature({ ...CD_ROM, felt: '#000000' })).toBe(puttMaterialsSignature(CD_ROM));
    expect(puttMaterialsSignature(CD_ROM)).not.toBe(puttMaterialsSignature({ ...CD_ROM, grass: '#000000' }));
  });
});
