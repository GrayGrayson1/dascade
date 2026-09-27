/**
 * Best-of-N series scoring (one tournament match = one series of games).
 *
 * - A win is 1 point, a draw ½ each. The series stops as soon as the leader can't be caught.
 * - Sides alternate every game; `firstId` is the participant with the `first` side in game 1.
 * - Level after N regular games: drawn match when draws are allowed (round robin / Swiss),
 *   otherwise decider games (elimination): SERIES_DECIDER_GAMES sudden-death games; for games with
 *   sides the last decider is Armageddon (a draw wins for the `second` side). A side-less series
 *   still level after every decider needs a drawing of lots (the caller owns the RNG).
 */
import { SERIES_DECIDER_GAMES } from '@dascade/shared';
import type { EngineGame } from './types.ts';

export interface SeriesSpec {
  a: string;
  b: string;
  bestOf: number;
  /** Level series go to deciders instead of ending drawn. */
  requireWinner: boolean;
  /** The game has sides (colours) — enables Armageddon. */
  sides: boolean;
  /** `first` side in game 1 (required when sides). */
  firstId: string | null;
}

export type DeciderKind = '' | 'sudden_death' | 'armageddon';

export interface SeriesNextGame {
  n: number;
  decider: DeciderKind;
  /** Participant with the `first` side (null without sides). */
  firstId: string | null;
}

export interface SeriesState {
  points: Record<string, number>;
  /** Game points from the regular (non-decider) games only. */
  regularPoints: Record<string, number>;
  decided: boolean;
  /** Winner when decided (null = drawn match, or lots pending). */
  winner: string | null;
  /** Decided but needs a drawing of lots (side-less game level after every decider). */
  needsLots: boolean;
  /** Short human note for the result ('Armageddon', 'Decider'…). */
  note: string;
  /** The next game to play (null when decided). */
  next: SeriesNextGame | null;
}

export function firstForGame(spec: SeriesSpec, n: number): string | null {
  if (!spec.sides || !spec.firstId) return null;
  const other = spec.firstId === spec.a ? spec.b : spec.a;
  return n % 2 === 1 ? spec.firstId : other;
}

export function deciderFor(spec: SeriesSpec, n: number): DeciderKind {
  if (n <= spec.bestOf) return '';
  const k = n - spec.bestOf;
  return spec.sides && k === SERIES_DECIDER_GAMES ? 'armageddon' : 'sudden_death';
}

/** Evaluate a series from its games (in order). Games beyond what the series allows are ignored. */
export function seriesState(spec: SeriesSpec, games: readonly Pick<EngineGame, 'winnerId' | 'firstId' | 'n'>[]): SeriesState {
  const points: Record<string, number> = { [spec.a]: 0, [spec.b]: 0 };
  const regular: Record<string, number> = { [spec.a]: 0, [spec.b]: 0 };
  const add = (bucket: Record<string, number>, g: Pick<EngineGame, 'winnerId'>): void => {
    if (g.winnerId === spec.a || g.winnerId === spec.b) bucket[g.winnerId] = (bucket[g.winnerId] ?? 0) + 1;
    else {
      bucket[spec.a] = (bucket[spec.a] ?? 0) + 0.5;
      bucket[spec.b] = (bucket[spec.b] ?? 0) + 0.5;
    }
  };
  const decided = (winner: string | null, note = '', needsLots = false): SeriesState => ({
    points,
    regularPoints: regular,
    decided: true,
    winner,
    needsLots,
    note,
    next: null,
  });
  const nextGame = (n: number): SeriesState => ({
    points,
    regularPoints: regular,
    decided: false,
    winner: null,
    needsLots: false,
    note: '',
    next: { n, decider: deciderFor(spec, n), firstId: firstForGame(spec, n) },
  });

  let n = 0;
  for (const g of games) {
    n++;
    add(points, g);
    if (n <= spec.bestOf) {
      add(regular, g);
      const pa = regular[spec.a]!;
      const pb = regular[spec.b]!;
      const remaining = spec.bestOf - n;
      if (Math.abs(pa - pb) > remaining) return decided(pa > pb ? spec.a : spec.b);
      if (remaining === 0 && pa === pb && !spec.requireWinner) return decided(null);
      continue;
    }
    // Decider games (elimination only).
    if (g.winnerId === spec.a || g.winnerId === spec.b) return decided(g.winnerId, 'Decider');
    const kind = deciderFor(spec, n);
    if (kind === 'armageddon') {
      const first = g.firstId ?? firstForGame(spec, n);
      const second = first === spec.a ? spec.b : spec.a;
      return decided(second, 'Armageddon');
    }
    if (n - spec.bestOf >= SERIES_DECIDER_GAMES) return decided(null, 'Decided by lot', true);
  }
  return nextGame(n + 1);
}
