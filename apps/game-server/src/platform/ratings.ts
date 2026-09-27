/**
 * DASCADE ratings store. In memory for the life of the server process; persisted through the
 * optional persistence layer (statsPersistence.ts) when Supabase is configured. Identity is the
 * verified account id when available, otherwise the client's local guest id (best effort, fine
 * for office play).
 *
 * The DASCADE rating is an internal Elo-style rating (see @dascade/game-core/rating) — it is not
 * a FIDE rating or the rating of any other federation.
 */
import type { GameId, GameOutcome } from '@dascade/shared';
import type { RatingLine } from '@dascade/shared/stats';
import { isProvisional, newRating, updateElo, type Rating } from '@dascade/game-core/rating';
import type { OutcomeContext } from './hub.ts';
import { statsPersistence } from './statsPersistence.ts';

const store = new Map<string, Rating>();

const key = (identity: string, gameId: GameId) => `${gameId}|${identity}`;

export function ratingIdentity(p: { userId?: string; guestId?: string }): string | null {
  if (p.userId) return `u:${p.userId}`;
  if (p.guestId) return `g:${p.guestId}`;
  return null;
}

export function getRating(identity: string | null, gameId: GameId): Rating {
  if (!identity) return newRating();
  return store.get(key(identity, gameId)) ?? newRating();
}

export function setRating(identity: string, gameId: GameId, rating: Rating): void {
  store.set(key(identity, gameId), rating);
  statsPersistence.saveRating(identity, gameId, rating);
}

/** Fill in ratings loaded from the database. Never overwrites a rating this process already holds (it is newer). */
export function hydrateRating(identity: string, gameId: GameId, rating: Rating): void {
  if (!store.has(key(identity, gameId))) store.set(key(identity, gameId), rating);
}

/** Every rating held for one identity (rated games only), best first. */
export function ratingsForIdentity(identity: string): RatingLine[] {
  const out: RatingLine[] = [];
  const suffix = `|${identity}`;
  for (const [k, r] of store) {
    if (!k.endsWith(suffix)) continue;
    const gameId = k.slice(0, k.length - suffix.length) as GameId;
    out.push({ gameId, rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, provisional: isProvisional(r) });
  }
  return out.sort((a, b) => b.games - a.games || b.rating - a.rating);
}

/**
 * Elo update for a rated head-to-head game with exactly two identifiable players.
 * `placements` of one group = draw; otherwise the first group won.
 */
export function applyRatedOutcome(outcome: GameOutcome, ctx: OutcomeContext): void {
  if (!ctx.rated) return;
  const ids = outcome.placements.flat();
  if (ids.length !== 2) return;
  const [aId, bId] = ids as [string, string];
  const a = ctx.players.get(aId);
  const b = ctx.players.get(bId);
  const ia = a ? ratingIdentity(a) : null;
  const ib = b ? ratingIdentity(b) : null;
  if (!ia || !ib || ia === ib) return;
  const draw = outcome.placements.length === 1;
  const [na, nb] = updateElo(getRating(ia, ctx.gameId), getRating(ib, ctx.gameId), draw ? 0.5 : 1);
  setRating(ia, ctx.gameId, na);
  setRating(ib, ctx.gameId, nb);
}

/** Tests only. */
export function resetRatings(): void {
  store.clear();
}
