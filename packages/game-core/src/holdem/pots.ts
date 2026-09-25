/**
 * Pot accounting: build the main pot and side pots from each seat's total
 * contribution, split pots between tied winners (odd chips clockwise from the
 * button) and settle a showdown.
 */

export interface Contribution {
  seat: number;
  /** Total chips this seat put in during the hand. */
  amount: number;
  /** Folded (or left) seats contribute dead money but can't win. */
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Seats that may win this pot, ascending. */
  eligible: number[];
}

/**
 * Splits contributions into a main pot and side pots.
 * Each distinct all-in level of a live (non-folded) seat closes a pot; folded
 * chips are dead money that fill the pots up to the level they reached.
 */
export function buildPots(contributions: readonly Contribution[]): Pot[] {
  for (const c of contributions) {
    if (!Number.isInteger(c.amount) || c.amount < 0) throw new Error(`Invalid contribution ${c.amount} for seat ${c.seat}`);
  }
  const live = contributions.filter((c) => !c.folded && c.amount > 0);
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) amount += Math.min(c.amount, level) - Math.min(c.amount, prev);
    const eligible = live
      .filter((c) => c.amount >= level)
      .map((c) => c.seat)
      .sort((a, b) => a - b);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && sameSeats(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // Dead money above the highest live level (only possible when a big bettor left/folded out of turn).
  let dead = 0;
  for (const c of contributions) dead += Math.max(0, c.amount - prev);
  if (dead > 0) {
    const last = pots[pots.length - 1];
    if (last) last.amount += dead;
    else pots.push({ amount: dead, eligible: [] });
  }
  return pots;
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function totalOf(pots: readonly Pot[]): number {
  return pots.reduce((s, p) => s + p.amount, 0);
}

/** Seats ordered clockwise starting with the first seat left of the button. */
export function clockwiseFromButton(seats: readonly number[], button: number, tableSize: number): number[] {
  const dist = (s: number) => (((s - button - 1) % tableSize) + tableSize) % tableSize;
  return [...seats].sort((a, b) => dist(a) - dist(b));
}

export interface Share {
  seat: number;
  amount: number;
}

/**
 * Splits `amount` evenly between `winners`. Odd chips go one at a time to the
 * winners closest to the left of the button (clockwise).
 */
export function splitPot(amount: number, winners: readonly number[], button: number, tableSize: number): Share[] {
  if (winners.length === 0) return [];
  const ordered = clockwiseFromButton(winners, button, tableSize);
  const base = Math.floor(amount / ordered.length);
  let odd = amount - base * ordered.length;
  return ordered.map((seat) => {
    const extra = odd > 0 ? 1 : 0;
    odd -= extra;
    return { seat, amount: base + extra };
  });
}

export interface PotAward {
  potIndex: number;
  amount: number;
  eligible: number[];
  winners: number[];
  shares: Share[];
}

/**
 * Awards each pot to the best hand(s) among its eligible seats.
 * `scores` maps seat → comparable hand score (higher wins); only live seats appear.
 * A pot whose eligible seats all vanished (every contender folded/left) goes to the best remaining live hand.
 */
export function settlePots(pots: readonly Pot[], scores: ReadonlyMap<number, number>, button: number, tableSize: number): PotAward[] {
  return pots.map((pot, potIndex) => {
    let contenders = pot.eligible.filter((s) => scores.has(s));
    if (contenders.length === 0) contenders = [...scores.keys()];
    let best = -Infinity;
    for (const s of contenders) best = Math.max(best, scores.get(s)!);
    const winners = contenders.filter((s) => scores.get(s) === best).sort((a, b) => a - b);
    return { potIndex, amount: pot.amount, eligible: [...pot.eligible], winners, shares: splitPot(pot.amount, winners, button, tableSize) };
  });
}

/** Sums pot awards per seat. */
export function payouts(awards: readonly PotAward[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of awards) for (const s of a.shares) out.set(s.seat, (out.get(s.seat) ?? 0) + s.amount);
  return out;
}
