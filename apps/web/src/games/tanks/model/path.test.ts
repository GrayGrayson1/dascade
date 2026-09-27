import { describe, expect, it } from 'vitest';
import { SHOT_SAMPLE_MS } from '@dascade/shared/games/tanks';
import { createTerrain, resolveShot, restHeight } from '@dascade/game-core/tanks';
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

  it('follows a real server path to its impact', () => {
    const terrain = createTerrain(1600, 900, 200);
    const tank = { id: 'a', team: -1, x: 200, y: restHeight(terrain, 200), hp: 100, alive: true };
    const s = resolveShot({ terrain, tanks: [tank], wind: 3 }, { shooterId: 'a', angle: 50, power: 60, weapon: 'shell' }, { teams: false, friendlyFire: true });
    const p = s.projectiles[0]!;
    const total = p.t1 - p.t0;
    const boom = s.events.find((e) => e.k === 'boom')!;
    const end = pathAt(p.pts, total, total);
    expect(boom.k === 'boom' && Math.abs(end.x - boom.x)).toBeLessThan(0.2);
    // Heading points down at impact.
    expect(pathAt(p.pts, total - 1, total).dy).toBeLessThan(0);
    // Monotonic in x for a rightward shot.
    let prev = -Infinity;
    for (let t = 0; t <= total; t += 7) {
      const q = pathAt(p.pts, t, total);
      expect(q.x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = q.x;
    }
  });
});
