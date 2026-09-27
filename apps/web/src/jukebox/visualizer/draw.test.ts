import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFECTS, type ThemeEffects } from '@dascade/ui';
import { DRAW, VISUALIZER_STYLES, drawVisualizer, idleBands, type VisFrame, type VisPalette } from './draw.ts';

/** A 2D context stand-in that records calls (every method is a no-op; gradients are objects). */
function fakeCtx() {
  const calls: string[] = [];
  const gradient = { addColorStop: (o: number) => calls.push(`stop:${o >= 0 && o <= 1}`) };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      return (...args: unknown[]) => {
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) calls.push(`NONFINITE:${key}`);
        calls.push(key);
      };
    },
    set(t, key: string, v) {
      t[key] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const P: VisPalette = {
  accent: '#22d3ee',
  accent2: '#ff4fd8',
  text: '#f8f6ff',
  muted: '#9d95c4',
  line: '#beb0ff',
  surface: '#110e22',
  background: '#05040b',
  success: '#2de38f',
  warning: '#ffd23f',
  danger: '#ff5a5f',
  info: '#22d3ee',
  gridAlpha: 0.06,
  glow: 1,
};

function frame(level: number, still = false): VisFrame {
  const bands = new Float32Array(48).map((_, i) => Math.min(1, level * (0.4 + (i % 7) / 10)));
  const wave = new Float32Array(128).map((_, i) => Math.sin(i / 6) * level);
  return { bands, peaks: bands.slice(), wave, level, levelL: level, levelR: level * 0.8, t: 12.5, playing: level > 0, still, dpr: 2 };
}

describe('visualizer styles', () => {
  it('implements every ThemeEffects.visualizer value', () => {
    const union: Array<ThemeEffects['visualizer']> = [
      'neon-bars',
      'pixel-bars',
      'lcd',
      'spectrum',
      'bubbles',
      'reels',
      'hologram',
      'oscilloscope',
      'blocks',
      'vu-meter',
      'glass-wave',
    ];
    expect([...VISUALIZER_STYLES].sort()).toEqual([...union].sort());
    for (const s of union) expect(typeof DRAW[s]).toBe('function');
    expect(VISUALIZER_STYLES).toContain(DEFAULT_EFFECTS.visualizer);
  });

  for (const style of VISUALIZER_STYLES) {
    it(`${style}: draws loud, silent, still and tiny frames with finite geometry`, () => {
      for (const [w, h, f] of [
        [800, 144, frame(0.9)],
        [800, 144, frame(0)],
        [800, 144, frame(0.5, true)],
        [8, 4, frame(1)],
        [1, 1, frame(0.2)],
      ] as const) {
        const { ctx, calls } = fakeCtx();
        drawVisualizer(style, ctx, w, h, f, P);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.filter((c) => c.startsWith('NONFINITE'))).toEqual([]);
        expect(calls).not.toContain('stop:false');
      }
    });
  }

  it('handles fx off (no glow) and rgba palette colours', () => {
    const { ctx, calls } = fakeCtx();
    drawVisualizer('neon-bars', ctx, 400, 100, frame(0.7), { ...P, glow: 0, accent: 'rgba(34, 211, 238, 0.8)' });
    expect(calls).toContain('fill');
  });

  it('idle contour stays low and positive', () => {
    const b = idleBands(new Float32Array(48));
    for (const v of b) {
      expect(v).toBeGreaterThanOrEqual(0.04);
      expect(v).toBeLessThan(0.3);
    }
  });
});
