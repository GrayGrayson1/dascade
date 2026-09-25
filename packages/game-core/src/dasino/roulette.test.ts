import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  RED_NUMBERS,
  ROULETTE_BETS,
  ROULETTE_PAYOUTS,
  WHEEL_ORDER,
  getRouletteBet,
  insideBetsForNumber,
  isValidRouletteBet,
  rouletteBetKey,
  rouletteColor,
  rouletteNumberInfo,
  settleRouletteBet,
  settleRouletteBets,
  spinRoulette,
  tableColumn,
  tableStreet,
  wheelIndex,
  type RouletteBetType,
} from './roulette.ts';

const ALL_NUMBERS = Array.from({ length: 37 }, (_, i) => i);
const EXPECTED_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const EXPECTED_BLACK = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

/** Layout coordinates: x = street (0–11), y = column (0–2). */
function cell(n: number): { x: number; y: number } {
  return { x: tableStreet(n)!, y: tableColumn(n)! - 1 };
}

describe('roulette wheel', () => {
  it('uses the European single-zero pocket order', () => {
    expect(WHEEL_ORDER).toEqual([
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3,
      26,
    ]);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(ALL_NUMBERS);
  });

  it('alternates red and black around the wheel after the zero', () => {
    for (let i = 1; i < WHEEL_ORDER.length - 1; i++) {
      expect(rouletteColor(WHEEL_ORDER[i]!)).not.toBe(rouletteColor(WHEEL_ORDER[i + 1]!));
    }
    expect(rouletteColor(WHEEL_ORDER[1]!)).toBe('red');
    expect(rouletteColor(WHEEL_ORDER[36]!)).toBe('black');
  });

  it('gives every number its correct colour', () => {
    expect([...RED_NUMBERS].sort((a, b) => a - b)).toEqual(EXPECTED_RED);
    expect(rouletteColor(0)).toBe('green');
    for (const n of EXPECTED_RED) expect(rouletteColor(n), `number ${n}`).toBe('red');
    for (const n of EXPECTED_BLACK) expect(rouletteColor(n), `number ${n}`).toBe('black');
    expect(EXPECTED_RED.length + EXPECTED_BLACK.length + 1).toBe(37);
  });

  it('rejects non-numbers', () => {
    expect(() => rouletteColor(37)).toThrow();
    expect(() => rouletteColor(-1)).toThrow();
    expect(() => rouletteColor(1.5)).toThrow();
    expect(() => wheelIndex(40)).toThrow();
  });

  it('maps numbers to wheel positions', () => {
    expect(wheelIndex(0)).toBe(0);
    expect(wheelIndex(32)).toBe(1);
    expect(wheelIndex(26)).toBe(36);
    for (const n of ALL_NUMBERS) expect(WHEEL_ORDER[wheelIndex(n)]).toBe(n);
  });

  it('describes each number (colour, parity, half, dozen, column)', () => {
    expect(rouletteNumberInfo(0)).toEqual({ number: 0, color: 'green', parity: null, half: null, dozen: null, column: null });
    expect(rouletteNumberInfo(17)).toEqual({ number: 17, color: 'black', parity: 'odd', half: 'low', dozen: 2, column: 2 });
    expect(rouletteNumberInfo(36)).toEqual({ number: 36, color: 'red', parity: 'even', half: 'high', dozen: 3, column: 3 });
    expect(rouletteNumberInfo(19)).toMatchObject({ half: 'high', dozen: 2, column: 1, color: 'red' });
  });

  it('spins uniformly over 0–36 with the injected RNG', () => {
    const rng = createSeededRng('roulette');
    const counts = new Array(37).fill(0);
    const spins = 74_000;
    for (let i = 0; i < spins; i++) {
      const n = spinRoulette(rng);
      expect(Number.isInteger(n) && n >= 0 && n <= 36).toBe(true);
      counts[n]++;
    }
    const expected = spins / 37;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // 36 degrees of freedom: p = 0.001 critical value ≈ 67.99.
    expect(chi2).toBeLessThan(68);
  });

  it('is deterministic for a given seed', () => {
    const a = createSeededRng(7);
    const b = createSeededRng(7);
    for (let i = 0; i < 20; i++) expect(spinRoulette(a)).toBe(spinRoulette(b));
  });
});

describe('roulette bets', () => {
  const byType = (type: RouletteBetType) => [...ROULETTE_BETS.values()].filter((b) => b.type === type);

  it('offers every standard European bet exactly once', () => {
    expect(byType('straight')).toHaveLength(37);
    expect(byType('split')).toHaveLength(60); // 24 across + 33 along + 0/1, 0/2, 0/3
    expect(byType('street')).toHaveLength(14); // 12 streets + trios 0/1/2 and 0/2/3
    expect(byType('corner')).toHaveLength(23); // 22 corners + first four
    expect(byType('line')).toHaveLength(11);
    expect(byType('dozen')).toHaveLength(3);
    expect(byType('column')).toHaveLength(3);
    for (const t of ['red', 'black', 'odd', 'even', 'low', 'high'] as const) expect(byType(t)).toHaveLength(1);
    expect(ROULETTE_BETS.size).toBe(157);
  });

  it('pays the standard odds', () => {
    expect(ROULETTE_PAYOUTS).toEqual({
      straight: 35,
      split: 17,
      street: 11,
      corner: 8,
      line: 5,
      dozen: 2,
      column: 2,
      red: 1,
      black: 1,
      odd: 1,
      even: 1,
      low: 1,
      high: 1,
    });
    for (const def of ROULETTE_BETS.values()) expect(def.payout).toBe(ROULETTE_PAYOUTS[def.type]);
  });

  it('covers the right amount of numbers for each bet type', () => {
    const sizes: Record<RouletteBetType, number> = {
      straight: 1,
      split: 2,
      street: 3,
      corner: 4,
      line: 6,
      dozen: 12,
      column: 12,
      red: 18,
      black: 18,
      odd: 18,
      even: 18,
      low: 18,
      high: 18,
    };
    for (const def of ROULETTE_BETS.values()) {
      expect(def.numbers.length, def.key).toBe(sizes[def.type]);
      expect([...def.numbers].sort((a, b) => a - b)).toEqual(def.numbers);
      expect(new Set(def.numbers).size).toBe(def.numbers.length);
    }
  });

  it('keeps every bet at exactly a 1/37 house edge (exhaustive over all 37 pockets)', () => {
    for (const def of ROULETTE_BETS.values()) {
      let returned = 0;
      for (const n of ALL_NUMBERS) returned += settleRouletteBet(def.key, 1, n).returned;
      // Staking 1 on each of the 37 equally likely outcomes returns exactly 36.
      expect(returned, def.key).toBe(36);
      expect(1 - returned / 37).toBeCloseTo(1 / 37, 12);
    }
  });

  it('only allows splits between numbers that share an edge', () => {
    for (const def of byType('split')) {
      const [a, b] = def.numbers as [number, number];
      if (a === 0) {
        expect([1, 2, 3]).toContain(b);
        continue;
      }
      const ca = cell(a);
      const cb = cell(b);
      expect(Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y), def.key).toBe(1);
    }
    for (const key of ['split:1-5', 'split:3-4', 'split:6-7', 'split:0-4', 'split:1-3', 'split:34-37', 'split:17-17', 'split:36-39']) {
      expect(isValidRouletteBet(key), key).toBe(false);
    }
    for (const key of ['split:0-1', 'split:0-2', 'split:0-3', 'split:1-2', 'split:2-3', 'split:1-4', 'split:33-36', 'split:35-36']) {
      expect(isValidRouletteBet(key), key).toBe(true);
    }
  });

  it('only allows streets, corners and six lines that exist on the layout', () => {
    for (const def of byType('street')) {
      if (def.numbers[0] === 0) continue;
      expect(def.numbers.map((n) => tableStreet(n))).toEqual([tableStreet(def.numbers[0]!), tableStreet(def.numbers[0]!), tableStreet(def.numbers[0]!)]);
    }
    for (const def of byType('corner')) {
      if (def.numbers[0] === 0) continue;
      const cells = def.numbers.map(cell);
      const xs = new Set(cells.map((c) => c.x));
      const ys = new Set(cells.map((c) => c.y));
      expect(xs.size, def.key).toBe(2);
      expect(ys.size, def.key).toBe(2);
      const [x1, x2] = [...xs].sort((a, b) => a - b);
      const [y1, y2] = [...ys].sort((a, b) => a - b);
      expect(x2! - x1!).toBe(1);
      expect(y2! - y1!).toBe(1);
    }
    for (const key of ['street:2-3-4', 'street:0-1-3', 'street:0-3-2-1', 'corner:3-4-6-7', 'corner:0-1-2', 'corner:33-34-36-37', 'line:2-3-4-5-6-7', 'line:34-35-36-37-38-39']) {
      expect(isValidRouletteBet(key), key).toBe(false);
    }
    expect(isValidRouletteBet('street:0-1-2')).toBe(true);
    expect(isValidRouletteBet('street:0-2-3')).toBe(true);
    expect(isValidRouletteBet('corner:0-1-2-3')).toBe(true);
    expect(isValidRouletteBet('corner:2-3-5-6')).toBe(true);
    expect(isValidRouletteBet('line:31-32-33-34-35-36')).toBe(true);
  });

  it('rejects malformed and unknown keys', () => {
    for (const key of ['', 'straight', 'straight:37', 'straight:-1', 'straight:07', 'dozen:0', 'dozen:4', 'column:4', 'green', 'RED', 'red:1', 'split:20-17', '__proto__', 'constructor']) {
      expect(isValidRouletteBet(key), key).toBe(false);
      expect(getRouletteBet(key)).toBeUndefined();
    }
  });

  it('builds canonical keys regardless of number order', () => {
    expect(rouletteBetKey('split', [20, 17])).toBe('split:17-20');
    expect(rouletteBetKey('corner', [21, 17, 20, 18])).toBe('corner:17-18-20-21');
    expect(rouletteBetKey('straight', 0)).toBe('straight:0');
    expect(rouletteBetKey('dozen', 2)).toBe('dozen:2');
    expect(rouletteBetKey('column', [3])).toBe('column:3');
    expect(rouletteBetKey('red')).toBe('red');
    for (const def of ROULETTE_BETS.values()) {
      if (def.type === 'dozen' || def.type === 'column') continue;
      const key = ['red', 'black', 'odd', 'even', 'low', 'high'].includes(def.type) ? rouletteBetKey(def.type) : rouletteBetKey(def.type, [...def.numbers].reverse());
      expect(key).toBe(def.key);
    }
  });

  it('settles each bet type with the right payout', () => {
    const cases: Array<[string, number, number]> = [
      // [spot, winning number, expected return on a 10 stake]
      ['straight:17', 17, 360],
      ['straight:0', 0, 360],
      ['split:17-20', 20, 180],
      ['split:0-2', 0, 180],
      ['street:16-17-18', 18, 120],
      ['street:0-2-3', 3, 120],
      ['corner:17-18-20-21', 21, 90],
      ['corner:0-1-2-3', 0, 90],
      ['line:13-14-15-16-17-18', 13, 60],
      ['dozen:2', 24, 30],
      ['column:3', 36, 30],
      ['red', 32, 20],
      ['black', 26, 20],
      ['odd', 35, 20],
      ['even', 2, 20],
      ['low', 18, 20],
      ['high', 19, 20],
    ];
    for (const [spot, n, expected] of cases) {
      expect(settleRouletteBet(spot, 10, n), spot).toEqual({ spot, amount: 10, won: true, returned: expected });
    }
    const losers: Array<[string, number]> = [
      ['straight:17', 18],
      ['split:17-20', 23],
      ['street:16-17-18', 19],
      ['corner:17-18-20-21', 19],
      ['line:13-14-15-16-17-18', 19],
      ['dozen:1', 13],
      ['column:1', 2],
      ['red', 2],
      ['black', 1],
      ['odd', 2],
      ['even', 1],
      ['low', 19],
      ['high', 18],
    ];
    for (const [spot, n] of losers) expect(settleRouletteBet(spot, 10, n).returned, spot).toBe(0);
  });

  it('loses every outside bet on zero (no la partage)', () => {
    for (const spot of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3']) {
      expect(settleRouletteBet(spot, 100, 0), spot).toMatchObject({ won: false, returned: 0 });
    }
  });

  it('settles a whole slip and totals stakes and returns', () => {
    const slip = [
      { spot: 'straight:7', amount: 5 },
      { spot: 'red', amount: 20 },
      { spot: 'split:7-8', amount: 10 },
      { spot: 'column:2', amount: 25 },
      { spot: 'dozen:1', amount: 15 },
    ];
    const s = settleRouletteBets(slip, 7);
    expect(s.staked).toBe(75);
    // 7 is red, odd, 1st dozen, 1st column: straight 5×36 + red 20×2 + split 10×18 + dozen 15×3.
    expect(s.returned).toBe(180 + 40 + 180 + 45);
    expect(s.results.map((r) => r.won)).toEqual([true, true, true, false, true]);
    expect(settleRouletteBets([], 7)).toEqual({ number: 7, results: [], staked: 0, returned: 0 });
  });

  it('refuses to settle invalid stakes or spots', () => {
    expect(() => settleRouletteBet('split:1-5', 10, 1)).toThrow();
    expect(() => settleRouletteBet('red', 0, 1)).toThrow();
    expect(() => settleRouletteBet('red', -5, 1)).toThrow();
    expect(() => settleRouletteBet('red', 2.5, 1)).toThrow();
    expect(() => settleRouletteBet('red', 10, 37)).toThrow();
  });

  it('lists the inside bets covering a number for the touch picker', () => {
    const keys = insideBetsForNumber(17).map((b) => b.key).sort();
    expect(keys).toEqual(
      [
        'straight:17',
        'split:14-17',
        'split:16-17',
        'split:17-18',
        'split:17-20',
        'street:16-17-18',
        'corner:13-14-16-17',
        'corner:14-15-17-18',
        'corner:16-17-19-20',
        'corner:17-18-20-21',
        'line:13-14-15-16-17-18',
        'line:16-17-18-19-20-21',
      ].sort(),
    );
    const zero = insideBetsForNumber(0).map((b) => b.key).sort();
    expect(zero).toEqual(['corner:0-1-2-3', 'split:0-1', 'split:0-2', 'split:0-3', 'straight:0', 'street:0-1-2', 'street:0-2-3'].sort());
    expect(insideBetsForNumber(2, 'split').map((b) => b.key).sort()).toEqual(['split:0-2', 'split:1-2', 'split:2-3', 'split:2-5']);
  });

  it('labels bets for humans', () => {
    expect(getRouletteBet('split:17-20')?.label).toBe('Split 17/20');
    expect(getRouletteBet('corner:0-1-2-3')?.label).toBe('First four 0–3');
    expect(getRouletteBet('street:0-1-2')?.label).toBe('Trio 0/1/2');
    expect(getRouletteBet('dozen:3')?.label).toBe('3rd dozen (25–36)');
    expect(getRouletteBet('column:1')?.label).toBe('1st column');
  });
});
