import { describe, expect, it } from 'vitest';
import { DEFAULT_WHEEL_PALETTE, paletteKey, wheelPalette } from './palette.ts';

describe('wheelPalette', () => {
  it('uses the exact original hardware colours when the theme has no materials (Delta Neon)', () => {
    expect(wheelPalette({})).toEqual(DEFAULT_WHEEL_PALETTE);
    expect(DEFAULT_WHEEL_PALETTE.lip).toEqual(['#fff0c2', '#ffc94d', '#e38b00', '#8f4a00', '#4d2600']);
    expect(DEFAULT_WHEEL_PALETTE.bulbOn).toBe('#ffc451');
    expect(DEFAULT_WHEEL_PALETTE.bulbOff).toBe('#ffb020');
    expect(paletteKey(wheelPalette({}))).toBe(paletteKey(DEFAULT_WHEEL_PALETTE));
  });

  it('builds the rim, pegs and bulbs from metal / stage / stageLight / led', () => {
    const p = wheelPalette({ metal: '#8d99a8', metalHighlight: '#E6EDF5', stage: '#07090e', stageLight: '#2fd6c8', led: '#ff4f8b' });
    expect(p.lip[0]).toBe('#e6edf5');
    expect(p.lip[2]).toBe('#8d99a8');
    expect(p.innerLip[1]).toBe('#8d99a8');
    expect(p.peg).toEqual(['#e6edf5', '#8d99a8', expect.stringMatching(/^#[0-9a-f]{6}$/)]);
    expect(p.channel[2]).toBe('#07090e');
    expect(p.pinstripe).toBe('rgba(47, 214, 200, 0.55)');
    expect(p.bulbOn).toBe('#ff4f8b');
    expect(p.bulbOff).toBe('#ff4f8b');
    expect(p.lipEdge).toBe('rgba(230, 237, 245, 0.6)');
    // Everything is a drawable colour.
    for (const v of Object.values(p).flat()) expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\()/);
  });

  it('falls back per part when only some materials are present', () => {
    const p = wheelPalette({ led: '#2fdc4a' });
    expect(p.bulbOn).toBe('#2fdc4a');
    expect(p.lip).toEqual(DEFAULT_WHEEL_PALETTE.lip);
    expect(p.channel).toEqual(DEFAULT_WHEEL_PALETTE.channel);
    // Metal without a highlight derives one instead of dropping back to gold.
    const m = wheelPalette({ metal: '#a8a8a3' });
    expect(m.lip[2]).toBe('#a8a8a3');
    expect(m.lip[0]).not.toBe(DEFAULT_WHEEL_PALETTE.lip[0]);
  });

  it('ignores non-hex values it cannot shade', () => {
    const p = wheelPalette({ metal: 'rgba(1, 2, 3, 0.5)', stage: 'nonsense' });
    expect(p.lip).toEqual(DEFAULT_WHEEL_PALETTE.lip);
    expect(p.channel).toEqual(DEFAULT_WHEEL_PALETTE.channel);
  });
});
