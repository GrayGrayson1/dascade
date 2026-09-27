/**
 * DASCADE player stats — a platform outcome listener that keeps useful per-game numbers for every
 * identifiable player (verified account or browser guest id): games, wins/losses/draws, podiums,
 * best score, tournament games and game-specific extras.
 *
 * In memory per process, plus the database when Supabase is configured (statsPersistence.ts).
 * Games feed it by calling BaseGameRoom.reportOutcome(); extras come from
 * `outcome.details.playerStats[playerId]` (see packages/shared/src/stats.ts for the rules).
 */
import type { GameId, GameOutcome } from '@dascade/shared';
import { mergeStatExtras, type GameStatLine } from '@dascade/shared/stats';
import type { OutcomeContext } from './hub.ts';
import { ratingIdentity } from './ratings.ts';
import { statsPersistence } from './statsPersistence.ts';

const store = new Map<string, GameStatLine>();

const key = (identity: string, gameId: GameId) => `${gameId}|${identity}`;

export function emptyStatLine(gameId: GameId): GameStatLine {
  return {
    gameId,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    podiums: 0,
    bestScore: null,
    lowerIsBetter: false,
    totalScore: 0,
    scoredGames: 0,
    tournamentGames: 0,
    lastPlayedAt: 0,
    extras: {},
  };
}

export function getStatLine(identity: string, gameId: GameId): GameStatLine | null {
  return store.get(key(identity, gameId)) ?? null;
}

/** Every stat line for one identity, most recently played first. */
export function statsForIdentity(identity: string): GameStatLine[] {
  const out: GameStatLine[] = [];
  const suffix = `|${identity}`;
  for (const [k, line] of store) if (k.endsWith(suffix)) out.push(line);
  return out.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/** Fill in lines loaded from the database. Never overwrites a line this process already holds. */
export function hydrateStatLine(identity: string, line: GameStatLine): void {
  if (!store.has(key(identity, line.gameId))) store.set(key(identity, line.gameId), line);
}

/** Per-player extras from `details.playerStats`, ignoring anything malformed. */
function extrasFor(outcome: GameOutcome, playerId: string): Record<string, number> {
  const all = outcome.details?.playerStats;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
  const mine = (all as Record<string, unknown>)[playerId];
  if (!mine || typeof mine !== 'object' || Array.isArray(mine)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mine as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

/**
 * Pure: the next stat line for one player after one reported game.
 * `place` is the 0-based index of the player's placement group.
 */
export function applyGameToLine(
  prev: GameStatLine,
  outcome: GameOutcome,
  playerId: string,
  place: number,
  field: number,
  tournament: boolean,
  endedAt: number,
): GameStatLine {
  const next: GameStatLine = { ...prev, extras: { ...prev.extras } };
  next.games += 1;
  const groups = outcome.placements.length;
  if (field >= 2) {
    if (groups === 1) next.draws += 1;
    else if (place === 0) {
      // Shared first place in a multi-player game is still a win for each; in a head-to-head it can't happen.
      next.wins += 1;
    } else next.losses += 1;
    if (field >= 3 && place < 3) next.podiums += 1;
  }
  const score = outcome.scores?.[playerId];
  if (typeof score === 'number' && Number.isFinite(score)) {
    const lower = Boolean(outcome.lowerIsBetter);
    next.lowerIsBetter = lower;
    next.bestScore = next.bestScore === null ? score : lower ? Math.min(next.bestScore, score) : Math.max(next.bestScore, score);
    next.totalScore += score;
    next.scoredGames += 1;
  }
  if (tournament) next.tournamentGames += 1;
  next.lastPlayedAt = Math.max(prev.lastPlayedAt, endedAt);
  next.extras = mergeStatExtras(prev.extras, extrasFor(outcome, playerId));
  return next;
}

/** Outcome listener body: updates every identifiable seated player's line for this game. */
export function recordOutcomeStats(outcome: GameOutcome, ctx: OutcomeContext): void {
  const field = outcome.placements.reduce((n, g) => n + g.length, 0);
  const seen = new Set<string>();
  outcome.placements.forEach((group, place) => {
    for (const playerId of group) {
      const player = ctx.players.get(playerId);
      if (!player || player.spectator) continue;
      const identity = ratingIdentity(player);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      const prev = getStatLine(identity, ctx.gameId) ?? emptyStatLine(ctx.gameId);
      const next = applyGameToLine(prev, outcome, playerId, place, field, ctx.tournament !== null, ctx.endedAt);
      store.set(key(identity, ctx.gameId), next);
      statsPersistence.saveStats(identity, next);
    }
  });
}

/** Tests only. */
export function resetStats(): void {
  store.clear();
}
