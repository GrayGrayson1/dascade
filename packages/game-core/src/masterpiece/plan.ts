/**
 * Round planning: which voting style a round uses, who answers which prompt, and how the written
 * answers become showdowns (including the "nobody answered" cases).
 */
import { MP_LIMITS, type MpVoteKind, type MpVotingMode } from '@dascade/shared/games/masterpiece';
import { shuffleInPlace, type Rng } from '@dascade/shared';

/**
 * The voting style of a round.
 *  - favourite / matchups: always that style.
 *  - ranked: needs MP_LIMITS.rankedMinAnswers writers, otherwise favourite.
 *  - showtime rotates by group size: ≤ 4 writers: head-to-head, favourite, …;
 *    5–10: head-to-head, favourite, top three, …; 11+: favourite, top three, … (head-to-head
 *    rounds with a big crowd would take too long).
 */
export function roundKind(mode: MpVotingMode, round: number, writers: number): MpVoteKind {
  const rankedOk = writers >= MP_LIMITS.rankedMinAnswers;
  switch (mode) {
    case 'favourite':
      return 'favourite';
    case 'matchups':
      return 'matchup';
    case 'ranked':
      return rankedOk ? 'ranked' : 'favourite';
    case 'showtime': {
      const cycle: MpVoteKind[] = writers <= 4 ? ['matchup', 'favourite'] : writers <= 10 ? ['matchup', 'favourite', 'ranked'] : ['favourite', 'ranked'];
      return cycle[(Math.max(1, round) - 1) % cycle.length]!;
    }
  }
}

export interface RoundPlan {
  kind: MpVoteKind;
  /** Author groups: each group answers one shared prompt. */
  groups: string[][];
  /** Prompts every writer answers this round. */
  perWriter: number;
}

/** Splits `n` items into `parts` sizes that differ by at most one (largest first). */
export function balancedSizes(n: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(n / parts);
  const extra = n % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Assigns writers to prompts. Writers are shuffled with the rng first, so neither join order nor
 * seat position predicts who shares a prompt.
 *  - Head-to-head, ≤ MP_LIMITS.matchupDoubleMax writers: a random cycle — writer i shares one prompt
 *    with writer i+1 and another with writer i−1 (every writer answers 2; all pairs distinct for n ≥ 3).
 *  - Head-to-head, bigger groups: random pairs (one trio when the count is odd); one prompt each.
 *  - Favourite / ranked: galleries of at most MP_LIMITS.galleryMax writers sharing a prompt.
 */
export function planRound(writerIds: readonly string[], kind: MpVoteKind, rng: Rng): RoundPlan {
  const ids = shuffleInPlace([...new Set(writerIds)], rng);
  const n = ids.length;
  if (n === 0) return { kind, groups: [], perWriter: 0 };
  if (kind === 'matchup') {
    if (n < 3) return { kind, groups: [ids], perWriter: 1 };
    if (n <= MP_LIMITS.matchupDoubleMax) {
      return { kind, groups: ids.map((id, i) => [id, ids[(i + 1) % n]!]), perWriter: 2 };
    }
    const groups: string[][] = [];
    for (let i = 0; i + 1 < n; i += 2) groups.push([ids[i]!, ids[i + 1]!]);
    if (n % 2 === 1) groups[groups.length - 1]!.push(ids[n - 1]!);
    return { kind, groups, perWriter: 1 };
  }
  const sizes = balancedSizes(n, Math.ceil(n / MP_LIMITS.galleryMax));
  const groups: string[][] = [];
  let at = 0;
  for (const size of sizes) {
    groups.push(ids.slice(at, at + size));
    at += size;
  }
  return { kind, groups, perWriter: 1 };
}

export interface WrittenEntry {
  authorId: string;
  /** null = never answered. */
  text: string | null;
}

export type ShowdownFormat = MpVoteKind | 'walkover' | 'empty';

export interface ResolvedShowdown {
  format: ShowdownFormat;
  /** Entries shown (blanks only appear in head-to-head walkovers, for the comedic reveal). */
  entries: WrittenEntry[];
}

/**
 * Turns a group's written answers into a showdown:
 *  - nobody answered → 'empty' (skipped);
 *  - one answer → 'walkover' (shown, scored without a vote);
 *  - head-to-head: blanks are dropped from a trio; two or more answers → a vote;
 *  - ranked galleries with fewer than MP_LIMITS.rankedMinAnswers answers → favourite.
 */
export function resolveShowdown(kind: MpVoteKind, entries: readonly WrittenEntry[]): ResolvedShowdown {
  const real = entries.filter((e) => e.text !== null && e.text.length > 0);
  if (real.length === 0) return { format: 'empty', entries: [] };
  if (real.length === 1) {
    return { format: 'walkover', entries: kind === 'matchup' ? entries.map((e) => ({ ...e })) : real.map((e) => ({ ...e })) };
  }
  if (kind === 'ranked' && real.length < MP_LIMITS.rankedMinAnswers) return { format: 'favourite', entries: real.map((e) => ({ ...e })) };
  return { format: kind, entries: real.map((e) => ({ ...e })) };
}
