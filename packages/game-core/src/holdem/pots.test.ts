import { describe, expect, it } from 'vitest';
import { buildPots, clockwiseFromButton, payouts, settlePots, splitPot, totalOf, type Contribution } from './pots.ts';

const c = (seat: number, amount: number, folded = false): Contribution => ({ seat, amount, folded });

describe('buildPots', () => {
  it('single pot when everyone put in the same', () => {
    expect(buildPots([c(0, 100), c(1, 100), c(2, 100)])).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it('one short all-in makes a main pot and a side pot', () => {
    expect(buildPots([c(0, 50), c(1, 200), c(2, 200)])).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('multiple all-ins at different levels make several side pots', () => {
    const pots = buildPots([c(0, 100), c(1, 300), c(2, 700), c(3, 1000)]);
    expect(pots).toEqual([
      { amount: 400, eligible: [0, 1, 2, 3] },
      { amount: 600, eligible: [1, 2, 3] },
      { amount: 800, eligible: [2, 3] },
      { amount: 300, eligible: [3] },
    ]);
    expect(totalOf(pots)).toBe(2100);
  });

  it('two players all-in for the same amount share one level', () => {
    expect(buildPots([c(0, 300), c(1, 300), c(2, 800), c(3, 800)])).toEqual([
      { amount: 1200, eligible: [0, 1, 2, 3] },
      { amount: 1000, eligible: [2, 3] },
    ]);
  });

  it('folded chips are dead money: counted in the pots, never eligible', () => {
    expect(buildPots([c(0, 100, true), c(1, 400), c(2, 400)])).toEqual([{ amount: 900, eligible: [1, 2] }]);
  });

  it('a folded contributor above an all-in level feeds both main and side pot', () => {
    // Seat 0 all-in 100; seat 1 bet 300 then folded; seats 2 and 3 went to 500.
    expect(buildPots([c(0, 100), c(1, 300, true), c(2, 500), c(3, 500)])).toEqual([
      { amount: 400, eligible: [0, 2, 3] },
      { amount: 1000, eligible: [2, 3] },
    ]);
  });

  it('a folded contributor below an all-in level only feeds the main pot', () => {
    expect(buildPots([c(0, 50, true), c(1, 200), c(2, 600), c(3, 600)])).toEqual([
      { amount: 650, eligible: [1, 2, 3] },
      { amount: 800, eligible: [2, 3] },
    ]);
  });

  it('dead money above every live level joins the last pot', () => {
    // A bettor left the table with 900 in; the two remaining players are all-in for 200.
    const pots = buildPots([c(0, 900, true), c(1, 200), c(2, 200)]);
    expect(pots).toEqual([{ amount: 1300, eligible: [1, 2] }]);
  });

  it('ignores zero contributions and rejects invalid ones', () => {
    expect(buildPots([c(0, 0), c(1, 100), c(2, 100)])).toEqual([{ amount: 200, eligible: [1, 2] }]);
    expect(() => buildPots([c(0, -5)])).toThrow();
    expect(() => buildPots([c(0, 1.5)])).toThrow();
  });

  it('always conserves every chip', () => {
    const contributions = [c(0, 37), c(1, 1210, true), c(2, 5000), c(3, 999), c(4, 5000), c(5, 13, true)];
    const total = contributions.reduce((s, x) => s + x.amount, 0);
    expect(totalOf(buildPots(contributions))).toBe(total);
  });
});

describe('splitPot and odd chips', () => {
  it('orders seats clockwise from the left of the button', () => {
    expect(clockwiseFromButton([0, 2, 5, 7], 5, 9)).toEqual([7, 0, 2, 5]);
    expect(clockwiseFromButton([1, 3], 3, 4)).toEqual([1, 3]);
  });

  it('even split', () => {
    expect(splitPot(600, [1, 4], 0, 6)).toEqual([
      { seat: 1, amount: 300 },
      { seat: 4, amount: 300 },
    ]);
  });

  it('odd chip goes to the first winner left of the button', () => {
    expect(splitPot(301, [1, 4], 0, 6)).toEqual([
      { seat: 1, amount: 151 },
      { seat: 4, amount: 150 },
    ]);
    // Button on seat 3: seat 4 is first clockwise.
    expect(splitPot(301, [1, 4], 3, 6)).toEqual([
      { seat: 4, amount: 151 },
      { seat: 1, amount: 150 },
    ]);
  });

  it('several odd chips go one each, clockwise', () => {
    expect(splitPot(302, [0, 2, 5], 4, 6)).toEqual([
      { seat: 5, amount: 101 },
      { seat: 0, amount: 101 },
      { seat: 2, amount: 100 },
    ]);
  });

  it('the button itself is the last to receive odd chips', () => {
    expect(splitPot(101, [2, 7], 7, 8)).toEqual([
      { seat: 2, amount: 51 },
      { seat: 7, amount: 50 },
    ]);
  });

  it('nobody to pay → empty', () => {
    expect(splitPot(100, [], 0, 6)).toEqual([]);
  });
});

describe('settlePots', () => {
  it('main pot and side pot can go to different players', () => {
    const pots = buildPots([c(0, 100), c(1, 500), c(2, 500)]);
    // Short stack has the best hand, seat 2 beats seat 1.
    const scores = new Map([
      [0, 900],
      [1, 100],
      [2, 500],
    ]);
    const awards = settlePots(pots, scores, 1, 3);
    expect(awards[0]).toMatchObject({ amount: 300, winners: [0] });
    expect(awards[1]).toMatchObject({ amount: 800, winners: [2] });
    expect(Object.fromEntries(payouts(awards))).toEqual({ 0: 300, 2: 800 });
  });

  it('a big stack that loses the main pot can still win a side pot', () => {
    const pots = buildPots([c(0, 100), c(1, 250), c(2, 600), c(3, 600)]);
    const scores = new Map([
      [0, 50],
      [1, 900],
      [2, 400],
      [3, 300],
    ]);
    const paid = payouts(settlePots(pots, scores, 0, 4));
    expect(Object.fromEntries(paid)).toEqual({ 1: 400 + 450, 2: 700 });
  });

  it('ties split each pot separately (with odd chips)', () => {
    // Seat 3 folded after putting in 82 (dead money). Main pot 244 is a three-way tie, side pot 101 a two-way tie.
    const pots = buildPots([c(0, 101), c(1, 101), c(2, 61), c(3, 82, true)]);
    expect(pots).toEqual([
      { amount: 244, eligible: [0, 1, 2] },
      { amount: 101, eligible: [0, 1] },
    ]);
    const scores = new Map([
      [0, 7],
      [1, 7],
      [2, 7],
    ]);
    const awards = settlePots(pots, scores, 2, 4);
    expect(awards[0]!.shares).toEqual([
      { seat: 0, amount: 82 },
      { seat: 1, amount: 81 },
      { seat: 2, amount: 81 },
    ]);
    expect(awards[1]!.shares).toEqual([
      { seat: 0, amount: 51 },
      { seat: 1, amount: 50 },
    ]);
  });

  it('folded contributors are never paid even with the best cards', () => {
    const pots = buildPots([c(0, 300, true), c(1, 300), c(2, 300)]);
    const scores = new Map([
      [1, 10],
      [2, 20],
    ]);
    const paid = payouts(settlePots(pots, scores, 0, 3));
    expect(Object.fromEntries(paid)).toEqual({ 2: 900 });
  });

  it('an orphaned pot (all its contenders left) goes to the best live hand', () => {
    const awards = settlePots([{ amount: 500, eligible: [4] }], new Map([[1, 3]]), 0, 6);
    expect(awards[0]!.winners).toEqual([1]);
  });

  it('pays out exactly what went in', () => {
    const contributions = [c(0, 777), c(1, 1234), c(2, 1234, true), c(3, 3001), c(4, 3001)];
    const pots = buildPots(contributions);
    const scores = new Map([
      [0, 5],
      [1, 5],
      [3, 2],
      [4, 5],
    ]);
    const paid = payouts(settlePots(pots, scores, 3, 5));
    const sum = [...paid.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(contributions.reduce((a, x) => a + x.amount, 0));
  });
});
