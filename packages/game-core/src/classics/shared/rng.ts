/**
 * Seeded randomness for simulations both sides run. `createSeededRng` (sfc32 over a string
 * hash) is pure 32-bit integer math, so the same seed yields the same stream in every JS
 * engine. Engines derive independent streams per purpose (`substream(seed, 'pieces')`) so
 * that, e.g., power-up drops never shift the level layout.
 */
import { createSeededRng, type Rng } from '@dascade/shared';

export type { Rng };

export function seeded(seed: string | number): Rng {
  return createSeededRng(seed);
}

/** Independent deterministic stream for one purpose of one run. */
export function substream(seed: string, purpose: string): Rng {
  return createSeededRng(`${seed}/${purpose}`);
}

/** Integer in [min, max] inclusive. */
export function rangeInt(rng: Rng, min: number, max: number): number {
  return min + rng.int(max - min + 1);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick from empty list');
  return items[rng.int(items.length)]!;
}

/** Fisher–Yates in place. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = items[i]!;
    items[i] = items[j]!;
    items[j] = t;
  }
  return items;
}

/** Chance roll with an integer percentage (avoids float comparisons drifting across tables). */
export function chance(rng: Rng, percent: number): boolean {
  return rng.int(100) < percent;
}
