/**
 * DASCADE rating — an internal Elo-style rating for head-to-head games.
 * It is NOT an official rating of any federation (FIDE, USCF, ...).
 * New players are provisional for their first PROVISIONAL_GAMES games and move faster.
 */

export interface Rating {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export const DEFAULT_RATING = 1200;
export const PROVISIONAL_GAMES = 10;
export const RATING_FLOOR = 100;

export function newRating(): Rating {
  return { rating: DEFAULT_RATING, games: 0, wins: 0, losses: 0, draws: 0 };
}

export function isProvisional(r: Pick<Rating, 'games'>): boolean {
  return r.games < PROVISIONAL_GAMES;
}

/** K-factor: fast while provisional, slower for established and strong players. */
export function kFactor(r: Pick<Rating, 'games' | 'rating'>): number {
  if (isProvisional(r)) return 40;
  return r.rating >= 2100 ? 16 : 24;
}

/** Expected score of A against B (0..1). */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Update both ratings after one game. `scoreA` is 1 (A won), 0.5 (draw) or 0 (A lost).
 * Returns new objects; inputs are not mutated. Ratings are rounded to whole points.
 */
export function updateElo(a: Rating, b: Rating, scoreA: 0 | 0.5 | 1): [Rating, Rating] {
  const expA = expectedScore(a.rating, b.rating);
  const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
  const nextA = Math.max(RATING_FLOOR, Math.round(a.rating + kFactor(a) * (scoreA - expA)));
  const nextB = Math.max(RATING_FLOOR, Math.round(b.rating + kFactor(b) * (scoreB - (1 - expA))));
  return [tally(a, nextA, scoreA), tally(b, nextB, scoreB)];
}

function tally(r: Rating, rating: number, score: 0 | 0.5 | 1): Rating {
  return {
    rating,
    games: r.games + 1,
    wins: r.wins + (score === 1 ? 1 : 0),
    losses: r.losses + (score === 0 ? 1 : 0),
    draws: r.draws + (score === 0.5 ? 1 : 0),
  };
}
