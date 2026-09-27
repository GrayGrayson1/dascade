import { describe, expect, it } from 'vitest';
import { alpha, paletteKey, reelPalette, shade, wheelPalette } from './palette.ts';

// The original DASino art (what Delta Neon, which defines no materials, must keep drawing).
const ORIGINAL_WHEEL = {
  rim: ['#1d0f36', '#140a26', '#07040f'],
  track: ['#0a0614', '#1a1030'],
  apron: '#110922',
  goldRing: '#e3b341',
  goldRingSoft: 'rgba(227,179,65,0.55)',
  goldBright: '#ffd23f',
  neon: '#c084fc',
  outerRing: 'rgba(255,210,63,0.35)',
  cone: ['#8b5cf6', '#4c1d95', '#1e0b3d'],
  turret: ['#fff1a8', '#ffd23f', '#b7791f'],
  dome: ['#fff6cf', '#ffd23f', '#9a6512'],
  capInset: '#2e1065',
  bulbLit: '#fff4c2',
  bulbA: 'rgba(192,132,252,0.55)',
  bulbB: 'rgba(255,210,63,0.45)',
};

describe('dasino palettes', () => {
  it('without theme materials the wheel keeps its exact original colours', () => {
    expect(wheelPalette({})).toEqual(ORIGINAL_WHEEL);
  });

  it('without theme materials the reels keep their exact original colours', () => {
    expect(reelPalette({})).toEqual({ body: ['#07040f', '#1c1036', '#27164a'], separator: 'rgba(192,132,252,0.10)' });
  });

  it('uses theme materials when present', () => {
    const p = wheelPalette({ rail: '#5a2e16', railHighlight: '#8a4a26', metal: '#b8923f', metalHighlight: '#f6e6b8', led: '#5fd07a' });
    expect(p.rim[0]).toBe('#8a4a26');
    expect(p.rim[1]).toBe('#5a2e16');
    expect(p.track[1]).toBe('#5a2e16');
    expect(p.goldRing).toBe('#b8923f');
    expect(p.goldBright).toBe('#f6e6b8');
    expect(p.neon).toBe('#5fd07a');
    expect(p.turret).toEqual(['#f6e6b8', '#b8923f', shade('#b8923f', -0.35)]);
    expect(p.bulbA).toBe('rgba(95, 208, 122, 0.55)');
    // Nothing falls back to the violet original when the theme supplies a material.
    expect(JSON.stringify(p)).not.toMatch(/#c084fc|#8b5cf6|#4c1d95/);

    const r = reelPalette({ screen: '#000000', screenGlow: '#22d3ee' });
    expect(r.body[0]).toBe('#000000');
    expect(r.body[2]).toBe(shade('#000000', 0.14));
    expect(r.separator).toBe('rgba(34, 211, 238, 0.12)');
  });

  it('a partial material set only replaces what it defines', () => {
    const p = wheelPalette({ metal: '#aaaaaa' });
    expect(p.goldRing).toBe('#aaaaaa');
    expect(p.rim).toEqual(ORIGINAL_WHEEL.rim);
    expect(p.neon).toBe('#c084fc');
  });

  it('shade / alpha helpers', () => {
    expect(shade('#808080', -0.5)).toBe('rgb(64, 64, 64)');
    expect(shade('#000000', 1)).toBe('rgb(255, 255, 255)');
    expect(shade('not-a-colour', 0.5)).toBe('not-a-colour');
    expect(alpha('#ff0000', 0.25)).toBe('rgba(255, 0, 0, 0.25)');
    expect(paletteKey(wheelPalette({}))).toBe(paletteKey(wheelPalette({})));
    expect(paletteKey(wheelPalette({}))).not.toBe(paletteKey(wheelPalette({ led: '#ffffff' })));
  });
});
