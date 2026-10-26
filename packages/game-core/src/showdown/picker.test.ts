import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { drawPick, inPool, pickPool, type PickSeat } from './picker.ts';

const seat = (id: string, over: Partial<PickSeat> = {}): PickSeat => ({
  id,
  participant: true,
  connected: true,
  hidden: false,
  skip: false,
  done: false,
  hot: false,
  ...over,
});

describe('picker pool', () => {
  it('holds only connected participants who are not hidden, skipping, done or in the hot seat', () => {
    const seats = [
      seat('ok'),
      seat('presenter', { participant: false }),
      seat('away', { connected: false }),
      seat('hidden', { hidden: true }),
      seat('skip', { skip: true }),
      seat('done', { done: true }),
      seat('hot', { hot: true }),
      seat('rerolled', { excluded: true }),
      seat('ok2'),
    ];
    expect(pickPool(seats)).toEqual(['ok', 'ok2']);
    expect(inPool(seat('x'))).toBe(true);
  });

  it('draws nobody from an empty pool', () => {
    expect(drawPick([], createSeededRng(1))).toBeNull();
  });

  it('a picked participant is out until the round resets (done), unless returned with No answer', () => {
    const seats = [seat('a'), seat('b')];
    seats[0] = { ...seats[0]!, done: true };
    expect(pickPool(seats)).toEqual(['b']);
    // No answer = not done: back in the pool.
    seats[0] = { ...seats[0]!, done: false };
    expect(pickPool(seats)).toEqual(['a', 'b']);
  });

  it('is uniform over 10,000 draws from a fixed pool (within tolerance)', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rng = createSeededRng('dasoween-uniformity');
    const counts = new Map<string, number>(pool.map((p) => [p, 0]));
    const draws = 10_000;
    for (let i = 0; i < draws; i++) {
      const winner = drawPick(pool, rng)!;
      counts.set(winner, (counts.get(winner) ?? 0) + 1);
    }
    const expected = draws / pool.length;
    // Chi-square with 7 degrees of freedom: 24.32 is the p = 0.001 critical value.
    let chi = 0;
    for (const n of counts.values()) chi += ((n - expected) * (n - expected)) / expected;
    expect(chi).toBeLessThan(24.32);
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.08);
  });
});
