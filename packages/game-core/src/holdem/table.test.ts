import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { blindSeats, blindsForLevel, moveButton, nextSeat, niceRound } from './table.ts';

describe('nextSeat', () => {
  it('moves clockwise and wraps', () => {
    expect(nextSeat(2, [0, 3, 7], 9)).toBe(3);
    expect(nextSeat(7, [0, 3, 7], 9)).toBe(0);
    expect(nextSeat(8, [0, 3, 7], 9)).toBe(0);
    expect(nextSeat(3, [3], 9)).toBe(3);
    expect(nextSeat(0, [], 9)).toBe(-1);
  });
});

describe('dealer button', () => {
  it('is drawn at random the first time', () => {
    const rng = createSeededRng('button');
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(moveButton(-1, [1, 4, 6], 8, rng));
    expect([...seen].sort()).toEqual([1, 4, 6]);
  });

  it('moves one dealt seat clockwise, skipping empty and sitting-out seats', () => {
    const rng = createSeededRng(1);
    // Seats 2 and 3 are empty / sitting out: they are not in the dealt list.
    expect(moveButton(1, [0, 1, 4, 5], 6, rng)).toBe(4);
    expect(moveButton(5, [0, 1, 4, 5], 6, rng)).toBe(0);
  });

  it('moves past a seat whose player left (the previous button seat may now be empty)', () => {
    expect(moveButton(3, [0, 5], 6, createSeededRng(2))).toBe(5);
  });

  it('returns -1 with nobody to deal', () => {
    expect(moveButton(3, [], 6, createSeededRng(3))).toBe(-1);
  });
});

describe('blind positions', () => {
  it('heads-up: button is the small blind', () => {
    expect(blindSeats(4, [1, 4], 6)).toEqual({ sb: 4, bb: 1 });
  });
  it('three or more: the two seats left of the button', () => {
    expect(blindSeats(0, [0, 2, 5], 6)).toEqual({ sb: 2, bb: 5 });
    expect(blindSeats(5, [0, 2, 5], 6)).toEqual({ sb: 0, bb: 2 });
  });
  it('needs two players', () => {
    expect(() => blindSeats(0, [0], 6)).toThrow();
  });
});

describe('blind levels', () => {
  it('level 0 is the base structure', () => {
    expect(blindsForLevel(50, 100, 0, 50)).toEqual({ smallBlind: 50, bigBlind: 100 });
  });
  it('grows by the percentage each level with friendly rounding', () => {
    expect(blindsForLevel(50, 100, 1, 50)).toEqual({ smallBlind: 75, bigBlind: 150 });
    expect(blindsForLevel(50, 100, 2, 50)).toEqual({ smallBlind: 120, bigBlind: 230 });
    expect(blindsForLevel(50, 100, 1, 100)).toEqual({ smallBlind: 100, bigBlind: 200 });
  });
  it('always increases and never lets the small blind exceed the big blind', () => {
    let prev = 2;
    for (let level = 1; level < 40; level++) {
      const { smallBlind, bigBlind } = blindsForLevel(1, 2, level, 10);
      expect(bigBlind).toBeGreaterThanOrEqual(prev);
      expect(smallBlind).toBeLessThanOrEqual(bigBlind);
      expect(smallBlind).toBeGreaterThanOrEqual(1);
      prev = bigBlind;
    }
  });
  it('caps runaway blinds', () => {
    expect(blindsForLevel(50_000, 100_000, 60, 200).bigBlind).toBe(10_000_000);
  });
  it('niceRound keeps two significant figures', () => {
    expect(niceRound(7.4)).toBe(7);
    expect(niceRound(225)).toBe(230);
    expect(niceRound(3375)).toBe(3400);
    expect(niceRound(0.2)).toBe(1);
  });
});
