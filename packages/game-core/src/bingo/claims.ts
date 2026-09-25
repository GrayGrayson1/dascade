/**
 * Claim validation. A claim is valid iff some mask of the round's pattern set is fully
 * covered by (called squares ∪ the free square) on the player's REAL card.
 * Client marks never matter: validity is derived from the server's call list only.
 */
import { FREE } from './board.ts';
import { maskToString, type Mask, type ResolvedPattern } from './patterns.ts';

/** Which squares of a card are covered by the calls so far (the free square always is). */
export function coverage(cells: readonly number[], called: ReadonlySet<number> | readonly number[]): boolean[] {
  const set: ReadonlySet<number> = called instanceof Set ? called : new Set(called as readonly number[]);
  return cells.map((v) => v === FREE || set.has(v));
}

export function maskCovered(mask: readonly boolean[], covered: readonly boolean[]): boolean {
  if (mask.length !== covered.length) return false;
  for (let i = 0; i < mask.length; i++) if (mask[i] && !covered[i]) return false;
  return true;
}

/** Squares of `mask` still missing. */
export function missingCount(mask: readonly boolean[], covered: readonly boolean[]): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && !covered[i]) n++;
  return n;
}

export interface ClaimMatch {
  patternIndex: number;
  maskIndex: number;
  patternName: string;
  mask: Mask;
  maskString: string;
}

/** The first satisfied (pattern, mask), in pattern order, or null. */
export function findMatch(cells: readonly number[], called: ReadonlySet<number> | readonly number[], patterns: readonly ResolvedPattern[]): ClaimMatch | null {
  const covered = coverage(cells, called);
  for (let p = 0; p < patterns.length; p++) {
    const pattern = patterns[p]!;
    for (let m = 0; m < pattern.masks.length; m++) {
      const mask = pattern.masks[m]!;
      if (maskCovered(mask, covered)) {
        return { patternIndex: p, maskIndex: m, patternName: pattern.name, mask, maskString: maskToString(mask) };
      }
    }
  }
  return null;
}

/** Fewest squares still needed to complete any pattern (0 = BINGO available). */
export function squaresToGo(cells: readonly number[], called: ReadonlySet<number> | readonly number[], patterns: readonly ResolvedPattern[]): number {
  const covered = coverage(cells, called);
  let best = Infinity;
  for (const pattern of patterns) {
    for (const mask of pattern.masks) {
      const miss = missingCount(mask, covered);
      if (miss < best) best = miss;
      if (best === 0) return 0;
    }
  }
  return Number.isFinite(best) ? best : cells.length;
}

export type ClaimVerdict = { valid: true; match: ClaimMatch } | { valid: false; reason: 'no_pattern' | 'no_patterns' | 'bad_card' };

/**
 * Server-side claim check. Deliberately takes no marks: only the authoritative call list counts.
 */
export function validateClaim(input: { cells: readonly number[]; calls: readonly number[]; patterns: readonly ResolvedPattern[]; size: number }): ClaimVerdict {
  if (input.cells.length !== input.size * input.size) return { valid: false, reason: 'bad_card' };
  if (input.patterns.length === 0 || input.patterns.every((p) => p.masks.length === 0)) return { valid: false, reason: 'no_patterns' };
  const match = findMatch(input.cells, new Set(input.calls), input.patterns);
  return match ? { valid: true, match } : { valid: false, reason: 'no_pattern' };
}

/** True when a mask is satisfied by the free square alone (a pattern nobody could lose). */
export function trivialMask(mask: readonly boolean[], freeIndex: number | null): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i] && i !== freeIndex) return false;
  return true;
}
