/**
 * Process-wide platform hooks shared by every room: listeners for finished-game outcomes
 * (ratings, stats, tournament advancement). Game rooms don't import this — they call
 * BaseGameRoom.reportOutcome(), which validates the outcome and emits it here once per match.
 */
import type { GameId, GameOutcome, TournamentMatchInfo } from '@dascade/shared';
import { log } from '../lib/log.ts';

export interface OutcomePlayer {
  playerId: string;
  name: string;
  guestId?: string;
  userId?: string;
  spectator: boolean;
}

export interface OutcomeContext {
  gameId: GameId;
  roomCode: string;
  /** Counts towards DASCADE ratings (rated game AND rated match or tournament match). */
  rated: boolean;
  /** Everyone seated in the match (including players who dropped), keyed by room player id. */
  players: Map<string, OutcomePlayer>;
  tournament: TournamentMatchInfo | null;
  startedAt: number;
  endedAt: number;
}

export type OutcomeListener = (outcome: GameOutcome, ctx: OutcomeContext) => void;

const listeners = new Set<OutcomeListener>();

/** Subscribe to every reported outcome. Returns an unsubscribe function. */
export function onOutcome(listener: OutcomeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitOutcome(outcome: GameOutcome, ctx: OutcomeContext): void {
  for (const listener of listeners) {
    try {
      listener(outcome, ctx);
    } catch (err) {
      log.error('outcome listener failed', { game: ctx.gameId, room: ctx.roomCode, err: err as Error });
    }
  }
}
