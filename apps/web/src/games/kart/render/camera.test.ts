import { describe, expect, it } from 'vitest';
import { LANDSCAPE, PORTRAIT, SQUARE, WIDE, framingForAspect } from './camera.ts';
import { qualityForDevice } from './quality.ts';

describe('chase framing by aspect', () => {
  it('portrait is higher, further back and pitched further down than landscape', () => {
    expect(framingForAspect(390 / 844)).toEqual(PORTRAIT);
    expect(PORTRAIT.height).toBeGreaterThan(LANDSCAPE.height * 2);
    expect(PORTRAIT.dist).toBeGreaterThan(LANDSCAPE.dist * 1.5);
    // downward pitch: (height - lookH) / distance to the look point
    const pitch = (f: typeof LANDSCAPE) => (f.height - f.lookH) / (f.dist + f.ahead);
    expect(pitch(PORTRAIT)).toBeGreaterThan(pitch(LANDSCAPE) * 2);
  });
  it('landscape / wide / square pick their presets and near-square blends continuously', () => {
    expect(framingForAspect(16 / 9)).toEqual(LANDSCAPE);
    expect(framingForAspect(844 / 390)).toEqual(WIDE);
    expect(framingForAspect(4 / 3)).toEqual(SQUARE);
    const a = framingForAspect(0.8);
    const b = framingForAspect(1.249);
    expect(a.dist).toBeCloseTo(PORTRAIT.dist, 1);
    expect(b.dist).toBeCloseTo(SQUARE.dist, 1);
    const mid = framingForAspect(1.0);
    expect(mid.dist).toBeLessThan(PORTRAIT.dist);
    expect(mid.dist).toBeGreaterThan(SQUARE.dist);
  });
});

describe('starting quality', () => {
  it('capable phones start on medium, weak devices on low, desktops on high', () => {
    expect(qualityForDevice({ coarse: true })).toBe('medium'); // iPhone: reports nothing
    expect(qualityForDevice({ coarse: true, memoryGb: 8, cores: 8 })).toBe('medium');
    expect(qualityForDevice({ coarse: true, memoryGb: 3, cores: 8 })).toBe('low');
    expect(qualityForDevice({ coarse: true, memoryGb: 8, cores: 4 })).toBe('low');
    expect(qualityForDevice({ coarse: false, memoryGb: 8, cores: 8 })).toBe('high');
    expect(qualityForDevice({ coarse: false })).toBe('high');
    expect(qualityForDevice({ coarse: false, memoryGb: 2 })).toBe('low');
    expect(qualityForDevice({ coarse: false, memoryGb: 3 })).toBe('medium');
  });
});
