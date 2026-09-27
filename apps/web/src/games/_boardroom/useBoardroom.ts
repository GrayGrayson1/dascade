/** DAS Boardroom kit — derived view of the kit state for the local viewer. */
import { useCallback } from 'react';
import {
  boardMsg,
  otherSide,
  type BoardRoomView,
  type BoardSeatView,
  type BoardSide,
  type OfferAction,
} from '@dascade/shared/games/boardroom';
import type { TournamentMatchInfo } from '@dascade/shared';
import { useGame, type GameContext } from '../../net/hooks.ts';

export interface Boardroom<S extends BoardRoomView, Settings> {
  game: GameContext<S, Settings>;
  state: S;
  /** The viewer's side in this game (null for spectators). */
  mySide: BoardSide | null;
  /** The side shown at the bottom of the board (mySide, or 'first' for spectators — unless flipped). */
  bottomSide: BoardSide;
  seat: (side: BoardSide) => BoardSeatView | undefined;
  /** PLAYING and not finished. */
  live: boolean;
  myTurn: boolean;
  isPlayer: boolean;
  tournament: TournamentMatchInfo | null;
  /** Send a kit offer action: offer('draw', 'accept'). */
  offer: (kind: 'draw' | 'undo' | 'rematch', action: OfferAction) => void;
  resign: () => void;
}

export function parseTournament(json: string | undefined): TournamentMatchInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as TournamentMatchInfo;
  } catch {
    return null;
  }
}

/** `flipped` = the viewer toggled the board orientation. */
export function useBoardroom<S extends BoardRoomView, Settings = Record<string, unknown>>(flipped = false): Boardroom<S, Settings> | null {
  const game = useGame<S, Settings>();
  const gameId = game?.state.gameId ?? '';
  const send = game?.send;
  const offer = useCallback(
    (kind: 'draw' | 'undo' | 'rematch', action: OfferAction) => send?.(boardMsg(gameId, kind), { action }),
    [send, gameId],
  );
  const resign = useCallback(() => send?.(boardMsg(gameId, 'resign'), {}), [send, gameId]);
  if (!game) return null;
  const state = game.state;
  const seats = state.seats ?? [];
  const mySeat = game.playerId ? seats.find((s) => s.playerId === game.playerId) : undefined;
  const mySide = (mySeat?.side as BoardSide | undefined) ?? null;
  const base: BoardSide = mySide ?? 'first';
  const live = state.phase === 'PLAYING' && !state.result?.over;
  return {
    game,
    state,
    mySide,
    bottomSide: flipped ? otherSide(base) : base,
    seat: (side) => seats.find((s) => s.side === side),
    live,
    myTurn: live && mySide !== null && state.turn === mySide,
    isPlayer: mySide !== null,
    tournament: parseTournament(state.tournamentJson),
    offer,
    resign,
  };
}
