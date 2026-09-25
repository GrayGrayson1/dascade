import { describe, expect, it } from 'vitest';
import { ROULETTE_BETS } from '@dascade/game-core/dasino';
import { ALL_SPOTS, BOARD, numberCell } from './boardLayout.ts';

describe('DASino roulette felt layout', () => {
  it('offers exactly one hit area for every legal European bet', () => {
    const keys = ALL_SPOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(ROULETTE_BETS.keys()));
  });

  it('puts each line/corner hit area where the covered numbers meet', () => {
    for (const s of BOARD.inside) {
      const cells = s.def.numbers.map(numberCell);
      const outerEdge = (s.def.type === 'street' && !s.def.numbers.includes(0)) || s.def.type === 'line' || s.key === 'corner:0-1-2-3';
      if (outerEdge) {
        // Streets, six lines and first four sit on the outer line of the felt, as on a real table.
        expect(s.anchor.y, s.key).toBe(3);
        const xs = cells.filter((c) => c.w === 1 && c.h === 1).map((c) => c.x);
        expect(s.anchor.x, s.key).toBeGreaterThanOrEqual(Math.min(...xs, 1));
        expect(s.anchor.x, s.key).toBeLessThanOrEqual(Math.max(...xs) + 1);
        continue;
      }
      // The chip anchor must touch every covered cell (on an edge or a corner of it).
      for (const [i, c] of cells.entries()) {
        const touches = s.anchor.x >= c.x - 1e-9 && s.anchor.x <= c.x + c.w + 1e-9 && s.anchor.y >= c.y - 1e-9 && s.anchor.y <= c.y + c.h + 1e-9;
        expect(touches, `${s.key} vs ${s.def.numbers[i]}`).toBe(true);
      }
    }
  });
});
