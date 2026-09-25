/**
 * Table-level helpers: dealer button movement, blind positions and blind levels.
 */
import type { Rng } from '@dascade/shared';

/** Next seat clockwise after `from` that is in `seats` (wraps). -1 when `seats` is empty. */
export function nextSeat(from: number, seats: readonly number[], tableSize: number): number {
  if (seats.length === 0) return -1;
  for (let step = 1; step <= tableSize; step++) {
    const s = (((from + step) % tableSize) + tableSize) % tableSize;
    if (seats.includes(s)) return s;
  }
  return -1;
}

/**
 * Moves the dealer button to the next seat that will be dealt in (empty and
 * sitting-out seats are skipped). The very first button is drawn at random.
 */
export function moveButton(previous: number, dealtSeats: readonly number[], tableSize: number, rng: Rng): number {
  if (dealtSeats.length === 0) return -1;
  if (previous < 0) return dealtSeats[rng.int(dealtSeats.length)]!;
  return nextSeat(previous, dealtSeats, tableSize);
}

export interface BlindSeats {
  sb: number;
  bb: number;
}

/** Heads-up: the button posts the small blind. Otherwise the two seats left of the button post. */
export function blindSeats(button: number, dealtSeats: readonly number[], tableSize: number): BlindSeats {
  if (dealtSeats.length < 2) throw new Error('Need at least two players for blinds');
  if (dealtSeats.length === 2) {
    return { sb: button, bb: nextSeat(button, dealtSeats, tableSize) };
  }
  const sb = nextSeat(button, dealtSeats, tableSize);
  return { sb, bb: nextSeat(sb, dealtSeats, tableSize) };
}

/** Rounds up to two significant figures (keeps blinds readable: 150, 230, 3,400). */
export function niceRound(n: number): number {
  if (n < 10) return Math.max(1, Math.round(n));
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

export const MAX_BIG_BLIND = 10_000_000;

/** Blinds for a level: base blinds grown by `pct`% per level, rounded to friendly numbers. */
export function blindsForLevel(baseSb: number, baseBb: number, level: number, pct: number): { smallBlind: number; bigBlind: number } {
  if (level <= 0) return { smallBlind: baseSb, bigBlind: baseBb };
  const factor = Math.pow(1 + pct / 100, level);
  const bigBlind = Math.min(MAX_BIG_BLIND, Math.max(baseBb + 1, niceRound(baseBb * factor)));
  const ratio = baseSb / baseBb;
  const smallBlind = Math.min(bigBlind, Math.max(1, niceRound(bigBlind * ratio)));
  return { smallBlind, bigBlind };
}
