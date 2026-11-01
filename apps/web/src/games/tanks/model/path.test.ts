import { describe, expect, it } from 'vitest';
import { SHOT_SAMPLE_MS } from '@dascade/shared/games/tanks';
import { pathAt } from './path.ts';

describe('pathAt (client playback of server shot paths)', () => {
  it('interpolates between regular samples and ends exactly on the impact point', () => {
    const pts = [0, 0, 10, 5, 20, 8, 27, 9];
    const total = 2 * SHOT_SAMPLE_MS + 10;
    expect(pathAt(pts, 0, total)).toMatchObject({ x: 0, y: 0 });
    expect(pathAt(pts, SHOT_SAMPLE_MS / 2, total)).toMatchObject({ x: 5, y: 2.5 });
    expect(pathAt(pts, SHOT_SAMPLE_MS, total)).toMatchObject({ x: 10, y: 5 });
    // Last segment runs from the last regular sample to the end point at `total`.
    const end = pathAt(pts, total, total);
    expect(end.x).toBeCloseTo(27);
    expect(end.y).toBeCloseTo(9);
    expect(pathAt(pts, total + 500, total).x).toBeCloseTo(27);
  });

  it('handles degenerate paths', () => {
    expect(pathAt([5, 6], 100, 100)).toMatchObject({ x: 5, y: 6 });
    expect(pathAt([1, 1, 1, 1], 0, 0)).toMatchObject({ x: 1, y: 1 });
  });

  it('follows a sampled ballistic arc to its impact', () => {
    // A shell sampled every SHOT_SAMPLE_MS like the server does, ending exactly where it lands.
    const g = 280;
    const vx = 300;
    const vy = 420;
    const pts: number[] = [];
    const dt = SHOT_SAMPLE_MS / 1000;
    let t = 0;
    for (; ; t += dt) {
      const y = vy * t - (g * t * t) / 2;
      if (t > 0 && y < 0) break;
      pts.push(vx * t, y);
    }
    const tLand = (2 * vy) / g;
    pts.push(vx * tLand, 0);
    const total = tLand * 1000;
    const end = pathAt(pts, total, total);
    expect(end.x).toBeCloseTo(vx * tLand, 6);
    expect(end.y).toBeCloseTo(0, 6);
    // Heading points down at impact.
    expect(pathAt(pts, total - 1, total).dy).toBeLessThan(0);
    // Monotonic in x for a rightward shot, and on the parabola (within a sample's chord error).
    let prev = -Infinity;
    for (let ms = 0; ms <= total; ms += 7) {
      const q = pathAt(pts, ms, total);
      expect(q.x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = q.x;
      const s = q.x / vx;
      expect(Math.abs(q.y - (vy * s - (g * s * s) / 2))).toBeLessThan(1);
    }
  });
});
