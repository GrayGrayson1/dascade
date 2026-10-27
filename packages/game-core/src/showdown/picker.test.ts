import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { drawPick, inDraw, pickPool, type PickRules, type PickSeat } from './picker.ts';

const seat = (id: string, over: Partial<PickSeat> = {}): PickSeat => ({
  id,
  participant: true,
  connected: true,
  hidden: false,
  skip: false,
  hot: false,
  ...over,
});

const fair: PickRules = { mode: 'fair', crewDraw: false, lastPicked: '' };
const random: PickRules = { mode: 'random', crewDraw: false, lastPicked: '' };

describe('picker pool', () => {
  it('holds only connected participants who are not hidden, skipping, excluded, rerolled or in the hot seat', () => {
    const seats = [
      seat('ok'),
      seat('presenter', { participant: false }),
      seat('away', { connected: false }),
      seat('hidden', { hidden: true }),
      seat('skip', { skip: true }),
      seat('excluded', { excluded: true }),
      seat('hot', { hot: true }),
      seat('rerolled', { rerolled: true }),
      seat('ok2'),
    ];
    for (const rules of [fair, random]) expect(pickPool(seats, rules)).toEqual(['ok', 'ok2']);
    expect(inDraw(seat('x'))).toBe(true);
  });

  it('draws nobody from an empty pool', () => {
    expect(drawPick([], createSeededRng(1))).toBeNull();
    expect(pickPool([], fair)).toEqual([]);
    expect(pickPool([seat('a', { excluded: true })], random)).toEqual([]);
  });

  it('the presenter (never a participant, never crew) is never in the draw, whatever the rules', () => {
    const presenter = seat('p', { participant: false, crew: false });
    for (const rules of [fair, random, { ...fair, crewDraw: true }, { ...random, crewDraw: true }]) {
      expect(pickPool([presenter, seat('a')], rules)).toEqual(['a']);
    }
  });

  it('crew are in the random draw only with crewDraw (by name is the room’s business)', () => {
    const seats = [seat('a'), seat('mo', { participant: false, crew: true })];
    expect(pickPool(seats, fair)).toEqual(['a']);
    expect(pickPool(seats, { ...fair, crewDraw: true })).toEqual(['a', 'mo']);
    expect(pickPool(seats, { ...random, crewDraw: true })).toEqual(['a', 'mo']);
    // Crew follow the same rules as guests once they're in: Skip me, excluded, away.
    expect(pickPool([seat('mo', { participant: false, crew: true, skip: true })], { ...fair, crewDraw: true })).toEqual([]);
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

describe('Fair mode (fewest turns first)', () => {
  it('draws only from the people with the fewest turns this show', () => {
    const seats = [seat('a', { turns: 1 }), seat('b'), seat('c', { turns: 2 }), seat('d', { turns: 0 })];
    expect(pickPool(seats, fair)).toEqual(['b', 'd']);
  });

  it('opens the next lap by itself once everyone in the draw is level', () => {
    const seats = [seat('a', { turns: 1 }), seat('b', { turns: 1 })];
    expect(pickPool(seats, fair)).toEqual(['a', 'b']);
  });

  it('counts the lowest only among people in the draw (a skipper with no turns doesn’t block the lap)', () => {
    const seats = [seat('a', { turns: 1 }), seat('b', { turns: 1 }), seat('shy', { skip: true }), seat('gone', { connected: false })];
    expect(pickPool(seats, fair)).toEqual(['a', 'b']);
  });

  it('a lap gives everyone exactly one turn before anyone gets a second', () => {
    const turns = new Map<string, number>(['a', 'b', 'c', 'd', 'e'].map((id) => [id, 0]));
    const rng = createSeededRng('fair-laps');
    for (let lap = 1; lap <= 3; lap++) {
      const drawn: string[] = [];
      for (let i = 0; i < turns.size; i++) {
        const pool = pickPool(
          [...turns].map(([id, n]) => seat(id, { turns: n })),
          fair,
        );
        const winner = drawPick(pool, rng)!;
        drawn.push(winner);
        turns.set(winner, turns.get(winner)! + 1);
      }
      expect(new Set(drawn).size).toBe(turns.size);
      expect([...turns.values()].every((n) => n === lap)).toBe(true);
    }
  });

  it('a newcomer (no turns yet) goes ahead of everyone who has had one', () => {
    expect(pickPool([seat('a', { turns: 2 }), seat('b', { turns: 2 }), seat('late')], fair)).toEqual(['late']);
  });
});

describe('True random', () => {
  it('a finished turn doesn’t take you out: everyone in the draw but the last pick', () => {
    const seats = [seat('a', { turns: 3 }), seat('b'), seat('c', { turns: 1 })];
    expect(pickPool(seats, { ...random, lastPicked: 'b' })).toEqual(['a', 'c']);
    expect(pickPool(seats, random)).toEqual(['a', 'b', 'c']);
  });

  it('never draws the same person twice in a row (unless they are the only one in the draw)', () => {
    const ids = ['a', 'b', 'c'];
    const rng = createSeededRng('no-repeats');
    let last = '';
    for (let i = 0; i < 500; i++) {
      const winner = drawPick(
        pickPool(
          ids.map((id) => seat(id)),
          { ...random, lastPicked: last },
        ),
        rng,
      )!;
      expect(winner).not.toBe(last);
      last = winner;
    }
    expect(pickPool([seat('solo')], { ...random, lastPicked: 'solo' })).toEqual(['solo']);
  });
});
