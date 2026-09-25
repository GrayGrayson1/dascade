/**
 * Independent cross-check of the European roulette bet map.
 *
 * The layout below is written out by hand (it does not use the engine's
 * tableStreet/tableColumn helpers), and every legal inside bet is derived from
 * plain grid geometry. The engine's map must match it exactly, key for key.
 */
import { describe, expect, it } from 'vitest';
import { RED_NUMBERS, ROULETTE_BETS, WHEEL_ORDER, getRouletteBet, isValidRouletteBet, settleRouletteBet } from './roulette.ts';

/** The felt, as printed: top row 3…36, middle 2…35, bottom 1…34. Column index = street (0–11). */
const LAYOUT: readonly (readonly number[])[] = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];

function at(row: number, col: number): number | undefined {
  return LAYOUT[row]?.[col];
}

const sortKey = (type: string, nums: number[]) => `${type}:${[...nums].sort((a, b) => a - b).join('-')}`;

function geometricInsideBets(): Map<string, { payout: number; numbers: number[] }> {
  const out = new Map<string, { payout: number; numbers: number[] }>();
  const add = (type: string, payout: number, nums: number[]) => out.set(sortKey(type, nums), { payout, numbers: [...nums].sort((a, b) => a - b) });
  for (let n = 0; n <= 36; n++) add('straight', 35, [n]);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      const n = at(row, col)!;
      const right = at(row, col + 1);
      const below = at(row + 1, col);
      if (right !== undefined) add('split', 17, [n, right]);
      if (below !== undefined) add('split', 17, [n, below]);
      const diag = at(row + 1, col + 1);
      if (right !== undefined && below !== undefined && diag !== undefined) add('corner', 8, [n, right, below, diag]);
    }
  }
  // Zero touches the first street on the felt.
  for (const n of [1, 2, 3]) add('split', 17, [0, n]);
  for (let col = 0; col < 12; col++) {
    const street = [at(0, col)!, at(1, col)!, at(2, col)!];
    add('street', 11, street);
    if (col < 11) add('line', 5, [...street, at(0, col + 1)!, at(1, col + 1)!, at(2, col + 1)!]);
  }
  add('street', 11, [0, 1, 2]); // trio
  add('street', 11, [0, 2, 3]); // trio
  add('corner', 8, [0, 1, 2, 3]); // first four
  return out;
}

function* combinations(pool: number[], k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < pool.length; i++) yield* combinations(pool, k, i + 1, [...acc, pool[i]!]);
}

const NUMBERS = Array.from({ length: 37 }, (_, i) => i);

describe('roulette bet map vs. independent layout geometry', () => {
  const expected = geometricInsideBets();

  it('has exactly the geometric inside bets, with the right numbers and payouts', () => {
    const engineInside = [...ROULETTE_BETS.values()].filter((d) => ['straight', 'split', 'street', 'corner', 'line'].includes(d.type));
    expect(new Set(engineInside.map((d) => d.key))).toEqual(new Set(expected.keys()));
    for (const def of engineInside) {
      const want = expected.get(def.key)!;
      expect(def.numbers, def.key).toEqual(want.numbers);
      expect(def.payout, def.key).toBe(want.payout);
    }
  });

  it('accepts a 2-, 3- or 4-number key only when it is a real split, street/trio or corner (every subset of 0–36)', () => {
    for (const k of [2, 3, 4] as const) {
      const type = k === 2 ? 'split' : k === 3 ? 'street' : 'corner';
      let accepted = 0;
      for (const combo of combinations(NUMBERS, k)) {
        const key = sortKey(type, combo);
        const legal = expected.has(key);
        expect(isValidRouletteBet(key), key).toBe(legal);
        if (legal) accepted++;
      }
      expect(accepted).toBe(k === 2 ? 60 : k === 3 ? 14 : 23);
      // No other bet type accepts these number sets either.
      for (const other of ['straight', 'split', 'street', 'corner', 'line'].filter((t) => t !== type)) {
        for (const combo of combinations(NUMBERS.slice(0, 10), k)) expect(isValidRouletteBet(sortKey(other, combo))).toBe(false);
      }
    }
  });

  it('accepts only the 11 six lines built from two neighbouring streets', () => {
    const lines = [...ROULETTE_BETS.values()].filter((d) => d.type === 'line');
    expect(lines).toHaveLength(11);
    const colOf = (n: number) => LAYOUT.map((row) => row.indexOf(n)).find((c) => c >= 0);
    for (const def of lines) {
      const cols = new Set(def.numbers.map(colOf));
      const [a, b] = [...cols].map(Number).sort((x, y) => x - y);
      expect(cols.size, def.key).toBe(2);
      expect(b! - a!, def.key).toBe(1);
    }
    // Some plausible-looking but illegal six-number sets.
    for (const key of ['line:1-2-3-7-8-9', 'line:0-1-2-3-4-5', 'line:2-3-4-5-6-7', 'line:1-4-7-10-13-16', 'line:34-35-36-1-2-3']) {
      expect(isValidRouletteBet(key), key).toBe(false);
    }
  });

  it('defines outside bets from first principles', () => {
    const numbersOf = (key: string) => getRouletteBet(key)!.numbers;
    const oneTo36 = NUMBERS.slice(1);
    expect(numbersOf('dozen:1')).toEqual(oneTo36.filter((n) => n <= 12));
    expect(numbersOf('dozen:2')).toEqual(oneTo36.filter((n) => n > 12 && n <= 24));
    expect(numbersOf('dozen:3')).toEqual(oneTo36.filter((n) => n > 24));
    expect(numbersOf('column:1')).toEqual([...LAYOUT[2]!]);
    expect(numbersOf('column:2')).toEqual([...LAYOUT[1]!]);
    expect(numbersOf('column:3')).toEqual([...LAYOUT[0]!]);
    expect(numbersOf('low')).toEqual(oneTo36.filter((n) => n <= 18));
    expect(numbersOf('high')).toEqual(oneTo36.filter((n) => n >= 19));
    expect(numbersOf('odd')).toEqual(oneTo36.filter((n) => n % 2 === 1));
    expect(numbersOf('even')).toEqual(oneTo36.filter((n) => n % 2 === 0));
    // Classic colour rule: in 1–10 and 19–28 odd numbers are red; in 11–18 and 29–36 even numbers are red.
    const red = oneTo36.filter((n) => ((n <= 10 || (n >= 19 && n <= 28)) ? n % 2 === 1 : n % 2 === 0));
    expect(numbersOf('red')).toEqual(red);
    expect([...RED_NUMBERS].sort((a, b) => a - b)).toEqual(red);
    expect(numbersOf('black')).toEqual(oneTo36.filter((n) => !red.includes(n)));
    for (const key of ['dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3']) expect(getRouletteBet(key)!.payout).toBe(2);
    for (const key of ['red', 'black', 'odd', 'even', 'low', 'high']) {
      expect(getRouletteBet(key)!.payout).toBe(1);
      expect(settleRouletteBet(key, 10, 0)).toMatchObject({ won: false, returned: 0 }); // zero loses (no la partage)
    }
  });

  it('pays stake + winnings on every winning pocket and nothing otherwise', () => {
    for (const def of ROULETTE_BETS.values()) {
      for (const n of NUMBERS) {
        const r = settleRouletteBet(def.key, 7, n);
        expect(r.returned, `${def.key} on ${n}`).toBe(def.numbers.includes(n) ? 7 * (def.payout + 1) : 0);
      }
    }
  });

  it('uses the standard European wheel sequence', () => {
    expect(WHEEL_ORDER.join(',')).toBe('0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26');
  });
});
