/**
 * Move-input state machine for the checkers board (pure, unit-testable).
 *
 * The player builds a path square by square: pick a piece → pick a landing → (for a branching
 * multi-jump) pick the next landing… As soon as the partial path identifies exactly one legal
 * move, that move is complete (forced continuations are auto-completed). Clicking a final
 * destination further down the chain also works when it is unambiguous. The server re-validates
 * every submitted path; this only drives hints and input.
 */
import { moveFrom, moveTo, movesWithPrefix, nextSquares, type CheckersMove } from '@dascade/game-core/checkers';

export type SelectionResult =
  | { kind: 'select'; path: number[] }
  | { kind: 'move'; move: CheckersMove }
  | { kind: 'clear' }
  | { kind: 'none' };

/** Pieces that can move this turn. */
export function movablePieces(moves: readonly CheckersMove[]): Set<number> {
  return new Set(moves.map(moveFrom));
}

/** Squares highlighted as the next click for the current partial path. */
export function targetsFor(moves: readonly CheckersMove[], path: readonly number[]): number[] {
  return path.length === 0 ? [] : nextSquares(moves, path);
}

/** Final destinations reachable from the current partial path (for "ends here" rings). */
export function destinationsFor(moves: readonly CheckersMove[], path: readonly number[]): number[] {
  if (path.length === 0) return [];
  return [...new Set(movesWithPrefix(moves, path).map(moveTo))].sort((a, b) => a - b);
}

/** Resolves a click on `square` given the current partial `path`. */
export function clickSquare(moves: readonly CheckersMove[], path: readonly number[], square: number): SelectionResult {
  const movable = movablePieces(moves);
  if (path.length > 0) {
    // Continue the chain through a next landing.
    if (targetsFor(moves, path).includes(square)) {
      const nextPath = [...path, square];
      const remaining = movesWithPrefix(moves, nextPath);
      if (remaining.length === 1) return { kind: 'move', move: remaining[0]! };
      return { kind: 'select', path: nextPath };
    }
    // Jump straight to an unambiguous final destination further down the chain.
    const ending = movesWithPrefix(moves, path).filter((m) => moveTo(m) === square);
    if (ending.length === 1) return { kind: 'move', move: ending[0]! };
    if (ending.length > 1) return { kind: 'select', path: [...path] };
    // Re-pick: another movable piece (only before the chain has started).
    if (path.length === 1 && movable.has(square) && square !== path[0]) return { kind: 'select', path: [square] };
    // Clicking the selected piece again (or anything else) cancels.
    return { kind: 'clear' };
  }
  if (movable.has(square)) {
    const own = movesWithPrefix(moves, [square]);
    // A piece with a single legal move still just gets selected (moving on one click is surprising).
    return own.length > 0 ? { kind: 'select', path: [square] } : { kind: 'none' };
  }
  return { kind: 'none' };
}
