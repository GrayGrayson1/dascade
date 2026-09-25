/**
 * DASino roulette — European single-zero rules (37 pockets, 0–36).
 *
 * Every bet has a canonical string key so the client and server can agree on
 * it without trusting any client-computed data:
 *
 *   inside:  `<type>:<n1>-<n2>-…` with the numbers sorted ascending
 *            straight:17 · split:17-20 · street:13-14-15 · street:0-1-2 (trio)
 *            corner:17-18-20-21 · corner:0-1-2-3 (first four) · line:13-14-15-16-17-18
 *   outside: dozen:1|2|3 · column:1|2|3 · red · black · odd · even · low · high
 *
 * Payouts are "to 1" (a winning bet returns stake × (payout + 1)). Zero loses
 * every outside bet (no la partage / en prison). Each bet's expected return is
 * exactly 36/37 of the stake, i.e. a 1/37 ≈ 2.70% house edge.
 */
import type { Rng } from '@dascade/shared';

export const ROULETTE_POCKETS = 37;

/** Pocket order clockwise around a European wheel, starting at the zero. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = 'red' | 'black' | 'green';

export function isRouletteNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 36;
}

export function rouletteColor(n: number): RouletteColor {
  if (!isRouletteNumber(n)) throw new RangeError(`Not a roulette number: ${n}`);
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** Index of a number in WHEEL_ORDER (its pocket position). */
export function wheelIndex(n: number): number {
  const i = WHEEL_ORDER.indexOf(n);
  if (i < 0) throw new RangeError(`Not a roulette number: ${n}`);
  return i;
}

/** Table column 1–3 (1 = 1,4,7…34 · 3 = 3,6,9…36); null for zero. */
export function tableColumn(n: number): 1 | 2 | 3 | null {
  if (n === 0) return null;
  return (((n - 1) % 3) + 1) as 1 | 2 | 3;
}

/** Street index 0–11 (0 = 1-2-3 … 11 = 34-35-36); null for zero. */
export function tableStreet(n: number): number | null {
  if (n === 0) return null;
  return Math.floor((n - 1) / 3);
}

export type RouletteBetType =
  | 'straight'
  | 'split'
  | 'street'
  | 'corner'
  | 'line'
  | 'dozen'
  | 'column'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high';

export const INSIDE_BET_TYPES = ['straight', 'split', 'street', 'corner', 'line'] as const;
export type InsideBetType = (typeof INSIDE_BET_TYPES)[number];

/** Winnings per 1 staked ("to 1"). */
export const ROULETTE_PAYOUTS: Readonly<Record<RouletteBetType, number>> = {
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
};

export interface RouletteBetDef {
  key: string;
  type: RouletteBetType;
  /** Winning numbers, ascending. */
  numbers: readonly number[];
  /** Winnings per 1 staked. */
  payout: number;
  /** Human-friendly label, e.g. "Split 17/20". */
  label: string;
  /** Short label for chips/tooltips, e.g. "17/20". */
  short: string;
}

const ORDINAL = ['1st', '2nd', '3rd'] as const;

function insideKey(type: InsideBetType, numbers: readonly number[]): string {
  return `${type}:${[...numbers].sort((a, b) => a - b).join('-')}`;
}

/** Canonical key for a bet. Inside bets take their numbers (any order); dozen/column take 1–3. */
export function rouletteBetKey(type: RouletteBetType, arg?: readonly number[] | number): string {
  switch (type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'line':
      return insideKey(type, typeof arg === 'number' ? [arg] : (arg ?? []));
    case 'dozen':
    case 'column':
      return `${type}:${typeof arg === 'number' ? arg : (arg?.[0] ?? 0)}`;
    default:
      return type;
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function buildBets(): Map<string, RouletteBetDef> {
  const bets = new Map<string, RouletteBetDef>();
  const add = (type: RouletteBetType, numbers: number[], label: string, short: string, key?: string) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const k = key ?? insideKey(type as InsideBetType, sorted);
    bets.set(k, { key: k, type, numbers: Object.freeze(sorted), payout: ROULETTE_PAYOUTS[type], label, short });
  };

  // Straight up: every single number, zero included.
  for (let n = 0; n <= 36; n++) add('straight', [n], `Straight ${n}`, String(n));

  // Splits: two numbers sharing an edge on the layout.
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) add('split', [n, n + 1], `Split ${n}/${n + 1}`, `${n}/${n + 1}`); // same street, neighbouring columns
    if (n <= 33) add('split', [n, n + 3], `Split ${n}/${n + 3}`, `${n}/${n + 3}`); // neighbouring streets, same column
  }
  for (const n of [1, 2, 3]) add('split', [0, n], `Split 0/${n}`, `0/${n}`); // zero borders 1, 2 and 3

  // Streets: three numbers across, plus the two European "trio" streets touching zero.
  for (let s = 0; s < 12; s++) {
    const a = s * 3 + 1;
    add('street', [a, a + 1, a + 2], `Street ${a}–${a + 2}`, `${a}–${a + 2}`);
  }
  add('street', [0, 1, 2], 'Trio 0/1/2', '0/1/2');
  add('street', [0, 2, 3], 'Trio 0/2/3', '0/2/3');

  // Corners: four numbers meeting at a point, plus the "first four" 0-1-2-3.
  for (let n = 1; n <= 32; n++) {
    if (n % 3 === 0) continue;
    const nums = [n, n + 1, n + 3, n + 4];
    add('corner', nums, `Corner ${nums.join('/')}`, `${n}–${n + 4}`);
  }
  add('corner', [0, 1, 2, 3], 'First four 0–3', '0–3');

  // Six lines: two neighbouring streets.
  for (let s = 0; s < 11; s++) {
    const a = s * 3 + 1;
    add('line', range(a, a + 5), `Six line ${a}–${a + 5}`, `${a}–${a + 5}`);
  }

  // Outside bets.
  for (const d of [1, 2, 3] as const) {
    add('dozen', range((d - 1) * 12 + 1, d * 12), `${ORDINAL[d - 1]} dozen (${(d - 1) * 12 + 1}–${d * 12})`, `${ORDINAL[d - 1]} 12`, `dozen:${d}`);
    add(
      'column',
      range(1, 36).filter((n) => tableColumn(n) === d),
      `${ORDINAL[d - 1]} column`,
      '2 to 1',
      `column:${d}`,
    );
  }
  add('red', [...RED_NUMBERS], 'Red', 'Red', 'red');
  add('black', range(1, 36).filter((n) => !RED_NUMBERS.has(n)), 'Black', 'Black', 'black');
  add('odd', range(1, 36).filter((n) => n % 2 === 1), 'Odd', 'Odd', 'odd');
  add('even', range(1, 36).filter((n) => n % 2 === 0), 'Even', 'Even', 'even');
  add('low', range(1, 18), 'Low 1–18', '1–18', 'low');
  add('high', range(19, 36), 'High 19–36', '19–36', 'high');
  return bets;
}

/** Every legal bet on the European layout, keyed by canonical key. */
export const ROULETTE_BETS: ReadonlyMap<string, RouletteBetDef> = buildBets();

/** Max characters of a canonical key (line bets are the longest). */
export const ROULETTE_KEY_MAX = 32;

export function getRouletteBet(key: string): RouletteBetDef | undefined {
  return ROULETTE_BETS.get(key);
}

export function isValidRouletteBet(key: string): boolean {
  return ROULETTE_BETS.has(key);
}

export function rouletteBetWins(def: RouletteBetDef, n: number): boolean {
  return def.numbers.includes(n);
}

/** Inside bets that cover a number (used by the touch bet-type picker). */
export function insideBetsForNumber(n: number, type?: InsideBetType): RouletteBetDef[] {
  const out: RouletteBetDef[] = [];
  for (const def of ROULETTE_BETS.values()) {
    if (!(INSIDE_BET_TYPES as readonly string[]).includes(def.type)) continue;
    if (type && def.type !== type) continue;
    if (def.numbers.includes(n)) out.push(def);
  }
  return out;
}

/** Uniform, unbiased spin (0–36). The server passes its crypto RNG. */
export function spinRoulette(rng: Rng): number {
  return rng.int(ROULETTE_POCKETS);
}

export interface RouletteNumberInfo {
  number: number;
  color: RouletteColor;
  parity: 'odd' | 'even' | null;
  half: 'low' | 'high' | null;
  dozen: 1 | 2 | 3 | null;
  column: 1 | 2 | 3 | null;
}

export function rouletteNumberInfo(n: number): RouletteNumberInfo {
  const color = rouletteColor(n);
  if (n === 0) return { number: 0, color, parity: null, half: null, dozen: null, column: null };
  return {
    number: n,
    color,
    parity: n % 2 === 0 ? 'even' : 'odd',
    half: n <= 18 ? 'low' : 'high',
    dozen: (Math.floor((n - 1) / 12) + 1) as 1 | 2 | 3,
    column: tableColumn(n),
  };
}

export interface RouletteStake {
  spot: string;
  amount: number;
}

export interface RouletteBetResult {
  spot: string;
  amount: number;
  won: boolean;
  /** Chips returned to the player: stake × (payout + 1) on a win, 0 on a loss. */
  returned: number;
}

export interface RouletteSettlement {
  number: number;
  results: RouletteBetResult[];
  staked: number;
  returned: number;
}

/** Settles one bet. Throws on an unknown spot or a non-positive/non-integer stake. */
export function settleRouletteBet(spot: string, amount: number, n: number): RouletteBetResult {
  const def = ROULETTE_BETS.get(spot);
  if (!def) throw new RangeError(`Unknown roulette bet: ${spot}`);
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Invalid stake: ${amount}`);
  if (!isRouletteNumber(n)) throw new RangeError(`Not a roulette number: ${n}`);
  const won = rouletteBetWins(def, n);
  return { spot, amount, won, returned: won ? amount * (def.payout + 1) : 0 };
}

export function settleRouletteBets(bets: readonly RouletteStake[], n: number): RouletteSettlement {
  const results = bets.map((b) => settleRouletteBet(b.spot, b.amount, n));
  return {
    number: n,
    results,
    staked: results.reduce((s, r) => s + r.amount, 0),
    returned: results.reduce((s, r) => s + r.returned, 0),
  };
}
