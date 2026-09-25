/**
 * Scoring. Guessers earn more the faster they guess (plus a small podium bonus for the
 * first three). The artist earns a share of every correct guess, normalised by how many
 * players could guess, plus a bonus when everybody got it.
 */

export const GUESS_MIN_POINTS = 50;
export const GUESS_SPEED_POINTS = 250;
export const RANK_BONUS = [50, 30, 15] as const;
/** Fraction of the average guesser score the artist earns when everyone guesses. */
export const ARTIST_SHARE = 0.8;
export const ARTIST_ALL_GUESSED_BONUS = 50;

const round5 = (n: number) => Math.round(n / 5) * 5;

/** Points for a correct guess `elapsedMs` into a `drawMs` turn as the `rank`-th correct guesser (1-based). */
export function guessPoints(elapsedMs: number, drawMs: number, rank: number): number {
  const remaining = drawMs > 0 ? Math.min(1, Math.max(0, 1 - elapsedMs / drawMs)) : 0;
  const bonus = rank >= 1 ? (RANK_BONUS[rank - 1] ?? 0) : 0;
  return round5(GUESS_MIN_POINTS + GUESS_SPEED_POINTS * remaining) + bonus;
}

/** The artist's cut of one correct guess worth `points`, given `eligible` players who could guess. */
export function artistShare(points: number, eligible: number): number {
  if (points <= 0) return 0;
  return Math.max(5, round5((points * ARTIST_SHARE) / Math.max(1, eligible)));
}

export interface StandingInput {
  id: string;
  score: number;
  joinOrder: number;
}

/** Final placements: higher score first, ties share a placement (1, 2, 2, 4). */
export function rankStandings<T extends StandingInput>(players: readonly T[]): Array<T & { placement: number }> {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  let placement = 0;
  let prevScore: number | null = null;
  return sorted.map((p, i) => {
    if (prevScore === null || p.score !== prevScore) placement = i + 1;
    prevScore = p.score;
    return { ...p, placement };
  });
}
