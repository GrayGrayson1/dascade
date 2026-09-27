/**
 * DAS Checkers — a full game record: move history, game-ending conditions and draw rules.
 *
 * Endings decided by the board (checked after every move, wins first):
 * - `no_pieces`  — the side to move has no pieces left: it loses.
 * - `no_moves`   — the side to move has pieces but no legal move (all blocked): it loses.
 * - `repetition` — the same position (board + side to move) occurs for the THIRD time: draw.
 * - `forty_moves` — 40 moves by EACH side (80 plies) in a row without a capture or a man
 *   moving (only kings shuffling): draw. This is an automatic version of the ACF/WCDF
 *   "40-move rule", so games can't stall in drawn king endings.
 * Endings decided by the room (players/clocks): resign, timeout, forfeit (left / never
 * came back), draw by agreement — see {@link endGame}.
 */
import { initialPosition, material, opponent, positionKey, type Color, type Position } from './board.ts';
import { applyMove, legalMoves, moveNotation, resolveMove, type CheckersMove } from './moves.ts';

/** Consecutive plies without a capture or a man move that end the game in a draw (40 moves per side). */
export const FORTY_MOVE_PLIES = 80;
/** A position occurring this many times (same side to move) is an automatic draw. */
export const REPETITION_LIMIT = 3;

export type CheckersWinReason = 'no_pieces' | 'no_moves' | 'resign' | 'timeout' | 'forfeit';
export type CheckersDrawReason = 'repetition' | 'forty_moves' | 'agreement';
export type CheckersEndReason = CheckersWinReason | CheckersDrawReason;

export interface CheckersResult {
  /** Winning colour, or null for a draw. */
  winner: Color | null;
  reason: CheckersEndReason;
}

export interface CheckersPly {
  /** Standard numeric notation ("11-15", "15x22x29"). */
  notation: string;
  color: Color;
  path: number[];
  captures: number[];
  crowned: boolean;
}

export interface CheckersGame {
  position: Position;
  /** Every ply played, in order. */
  plies: CheckersPly[];
  /** Consecutive plies without a capture or a man move (see FORTY_MOVE_PLIES). */
  quietPlies: number;
  /**
   * Occurrence count per position since the last irreversible move (capture or man move).
   * Positions before an irreversible move can never recur, so the table is reset then.
   */
  seen: Record<string, number>;
  result: CheckersResult | null;
}

export function newGame(start: Position = initialPosition()): CheckersGame {
  const game: CheckersGame = { position: { ...start }, plies: [], quietPlies: 0, seen: { [positionKey(start)]: 1 }, result: null };
  game.result = boardResult(game);
  return game;
}

export type PlayResult =
  | { ok: true; game: CheckersGame; move: CheckersMove; ply: CheckersPly }
  | { ok: false; error: 'game_over' | 'illegal_move' };

/**
 * Plays a move given as a path of squares (the full path, or from→to when that is unambiguous).
 * Returns a NEW game record; the input is never mutated.
 */
export function playMove(game: CheckersGame, path: readonly number[]): PlayResult {
  if (game.result) return { ok: false, error: 'game_over' };
  const move = resolveMove(legalMoves(game.position), path);
  if (!move) return { ok: false, error: 'illegal_move' };
  const mover = game.position.turn;
  const movedMan = game.position.board[move.path[0]! - 1] === (mover === 'dark' ? 'd' : 'l');
  const irreversible = move.captures.length > 0 || movedMan;
  const position = applyMove(game.position, move);
  const key = positionKey(position);
  const seen = irreversible ? { [key]: 1 } : { ...game.seen, [key]: (game.seen[key] ?? 0) + 1 };
  const ply: CheckersPly = {
    notation: moveNotation(move),
    color: mover,
    path: [...move.path],
    captures: [...move.captures],
    crowned: move.crowned,
  };
  const next: CheckersGame = {
    position,
    plies: [...game.plies, ply],
    quietPlies: irreversible ? 0 : game.quietPlies + 1,
    seen,
    result: null,
  };
  next.result = boardResult(next);
  return { ok: true, game: next, move, ply };
}

/** The result forced by the board (win by no pieces / no moves, or an automatic draw), or null. */
export function boardResult(game: CheckersGame): CheckersResult | null {
  const toMove = game.position.turn;
  if (material(game.position.board, toMove).total === 0) return { winner: opponent(toMove), reason: 'no_pieces' };
  if (legalMoves(game.position).length === 0) return { winner: opponent(toMove), reason: 'no_moves' };
  if ((game.seen[positionKey(game.position)] ?? 0) >= REPETITION_LIMIT) return { winner: null, reason: 'repetition' };
  if (game.quietPlies >= FORTY_MOVE_PLIES) return { winner: null, reason: 'forty_moves' };
  return null;
}

/** Ends a live game for a reason decided outside the board (resign, timeout, forfeit, agreement). */
export function endGame(game: CheckersGame, result: CheckersResult): CheckersGame {
  if (game.result) return game;
  return { ...game, result: { ...result } };
}

/** Pieces each side has captured so far (12 minus the opponent's remaining pieces, for a standard start). */
export function capturedCounts(game: CheckersGame): Record<Color, number> {
  let dark = 0;
  let light = 0;
  for (const ply of game.plies) {
    if (ply.color === 'dark') dark += ply.captures.length;
    else light += ply.captures.length;
  }
  return { dark, light };
}

/** Moves (full moves, one per side) remaining before the 40-move draw triggers. */
export function movesUntilFortyMoveDraw(game: CheckersGame): number {
  return Math.max(0, Math.ceil((FORTY_MOVE_PLIES - game.quietPlies) / 2));
}

/** How many times the current position has occurred (1 = first time). */
export function repetitionCount(game: CheckersGame): number {
  return game.seen[positionKey(game.position)] ?? 0;
}

export function describeResult(result: CheckersResult): string {
  const winner = result.winner === 'dark' ? 'Dark' : 'Light';
  const loser = result.winner === 'dark' ? 'Light' : 'Dark';
  switch (result.reason) {
    case 'no_pieces':
      return `${winner} wins — ${loser} has no pieces left.`;
    case 'no_moves':
      return `${winner} wins — ${loser} has no legal move.`;
    case 'resign':
      return `${winner} wins — ${loser} resigned.`;
    case 'timeout':
      return `${winner} wins on time.`;
    case 'forfeit':
      return `${winner} wins by forfeit.`;
    case 'repetition':
      return 'Draw by threefold repetition.';
    case 'forty_moves':
      return 'Draw — 40 moves each without a capture or a man move.';
    case 'agreement':
      return 'Draw by agreement.';
  }
}
