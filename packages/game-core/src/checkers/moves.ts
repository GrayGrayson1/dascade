/**
 * DAS Checkers — legal move generation and application (American/English rules).
 *
 * - Men move one square diagonally forward; kings one square in any diagonal direction
 *   (no flying kings).
 * - Captures are mandatory: when any capture exists, only captures are legal. The player
 *   may choose any capture sequence — taking the maximum is NOT required.
 * - A capture continues with the same piece while further jumps are available (a multi-jump
 *   is one move and must be completed). Men capture forward only.
 * - A man reaching the far row is crowned and the move ends there, even if the new king
 *   could keep jumping.
 * - A piece is never jumped twice in one move; the moving piece's origin square is empty
 *   during the chain (so a king may loop back through it). Captured pieces are removed when
 *   the move completes (by square parity they can never be landing squares anyway).
 */
import {
  EMPTY,
  JUMP,
  STEP,
  cellAt,
  directionsFor,
  isCrownSquare,
  isMan,
  isSquare,
  kingOf,
  opponent,
  pieceColor,
  type CellChar,
  type Color,
  type Position,
} from './board.ts';

export interface CheckersMove {
  /** Squares visited in order: [from, to] for a step, [from, landing1, landing2, …] for jumps. */
  path: number[];
  /** Captured squares in jump order (empty for a simple move). */
  captures: number[];
  /** A man was crowned by this move. */
  crowned: boolean;
}

export function moveFrom(move: CheckersMove): number {
  return move.path[0]!;
}

export function moveTo(move: CheckersMove): number {
  return move.path[move.path.length - 1]!;
}

export function isCapture(move: CheckersMove): boolean {
  return move.captures.length > 0;
}

/** Standard numeric notation: "11-15" for a move, "15x22" / "15x22x29" for (multi-)jumps. */
export function moveNotation(move: CheckersMove): string {
  return move.captures.length > 0 ? move.path.join('x') : `${move.path[0]}-${move.path[1]}`;
}

/** All simple (non-capturing) moves for a colour. */
function simpleMoves(board: string, color: Color): CheckersMove[] {
  const out: CheckersMove[] = [];
  for (let sq = 1; sq <= 32; sq++) {
    const cell = cellAt(board, sq);
    if (pieceColor(cell) !== color) continue;
    for (const dir of directionsFor(cell)) {
      const to = STEP[sq]![dir]!;
      if (to && cellAt(board, to) === EMPTY) {
        out.push({ path: [sq, to], captures: [], crowned: isMan(cell) && isCrownSquare(to, color) });
      }
    }
  }
  return out;
}

/** Every complete capture sequence available to the piece on `from`. */
export function captureSequencesFrom(board: string, from: number): CheckersMove[] {
  const piece = cellAt(board, from);
  const color = pieceColor(piece);
  if (!color) return [];
  const cells = board.split('') as CellChar[];
  cells[from - 1] = EMPTY; // the mover leaves its origin square for the whole chain
  const out: CheckersMove[] = [];
  extendJumps(cells, piece, color, from, [from], [], out);
  return out;
}

function extendJumps(cells: CellChar[], piece: CellChar, color: Color, at: number, path: number[], captures: number[], out: CheckersMove[]): void {
  let extended = false;
  for (const dir of directionsFor(piece)) {
    const over = STEP[at]![dir]!;
    const land = JUMP[at]![dir]!;
    if (!over || !land) continue;
    if (pieceColor(cells[over - 1]) !== opponent(color)) continue;
    if (captures.includes(over)) continue; // never jump the same piece twice
    if (cells[land - 1] !== EMPTY) continue;
    extended = true;
    const nextPath = [...path, land];
    const nextCaptures = [...captures, over];
    if (isMan(piece) && isCrownSquare(land, color)) {
      // Crowning ends the move, even mid-chain.
      out.push({ path: nextPath, captures: nextCaptures, crowned: true });
      continue;
    }
    extendJumps(cells, piece, color, land, nextPath, nextCaptures, out);
  }
  if (!extended && captures.length > 0) out.push({ path, captures, crowned: false });
}

function captureMoves(board: string, color: Color): CheckersMove[] {
  const out: CheckersMove[] = [];
  for (let sq = 1; sq <= 32; sq++) {
    if (pieceColor(cellAt(board, sq)) === color) out.push(...captureSequencesFrom(board, sq));
  }
  return out;
}

/** True when the side to move has at least one capture (and therefore must capture). */
export function hasCapture(pos: Position): boolean {
  for (let sq = 1; sq <= 32; sq++) {
    const cell = cellAt(pos.board, sq);
    if (pieceColor(cell) !== pos.turn) continue;
    for (const dir of directionsFor(cell)) {
      const over = STEP[sq]![dir]!;
      const land = JUMP[sq]![dir]!;
      if (over && land && pieceColor(cellAt(pos.board, over)) === opponent(pos.turn) && cellAt(pos.board, land) === EMPTY) return true;
    }
  }
  return false;
}

/** Every legal move for the side to move (captures only, when any capture exists). */
export function legalMoves(pos: Position): CheckersMove[] {
  const captures = captureMoves(pos.board, pos.turn);
  return captures.length > 0 ? captures : simpleMoves(pos.board, pos.turn);
}

/** Squares holding a piece that has at least one legal move. */
export function movableSquares(moves: readonly CheckersMove[]): number[] {
  return [...new Set(moves.map(moveFrom))].sort((a, b) => a - b);
}

/** Moves whose path starts with the given partial path (e.g. [from] or [from, firstLanding]). */
export function movesWithPrefix(moves: readonly CheckersMove[], prefix: readonly number[]): CheckersMove[] {
  return moves.filter((m) => prefix.length <= m.path.length && prefix.every((sq, i) => m.path[i] === sq));
}

/** The next squares a partial path can continue to (for step-by-step multi-jump input). */
export function nextSquares(moves: readonly CheckersMove[], prefix: readonly number[]): number[] {
  const out = new Set<number>();
  for (const m of movesWithPrefix(moves, prefix)) {
    const next = m.path[prefix.length];
    if (next !== undefined) out.add(next);
  }
  return [...out].sort((a, b) => a - b);
}

/** Finds the legal move with exactly this path, or null. */
export function findMove(moves: readonly CheckersMove[], path: readonly number[]): CheckersMove | null {
  return moves.find((m) => m.path.length === path.length && m.path.every((sq, i) => sq === path[i])) ?? null;
}

/**
 * Resolves a from→to request to a unique legal move: an exact path match, or the only legal
 * move from `path[0]` that passes through the given squares in order and ends on the last one.
 * Returns null when nothing (or more than one sequence) matches.
 */
export function resolveMove(moves: readonly CheckersMove[], path: readonly number[]): CheckersMove | null {
  if (path.length < 2 || !path.every(isSquare)) return null;
  const exact = findMove(moves, path);
  if (exact) return exact;
  const to = path[path.length - 1];
  const candidates = moves.filter((m) => {
    if (m.path[0] !== path[0] || moveTo(m) !== to) return false;
    let i = 1;
    for (const sq of m.path.slice(1)) if (sq === path[i]) i++;
    return i === path.length;
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Applies a legal move (not re-validated) and passes the turn. */
export function applyMove(pos: Position, move: CheckersMove): Position {
  const cells = pos.board.split('') as CellChar[];
  const from = moveFrom(move);
  const piece = cells[from - 1]!;
  const color = pieceColor(piece);
  if (!color) throw new Error(`No piece on square ${from}`);
  cells[from - 1] = EMPTY;
  for (const sq of move.captures) cells[sq - 1] = EMPTY;
  cells[moveTo(move) - 1] = move.crowned ? kingOf(color) : piece;
  return { board: cells.join(''), turn: opponent(pos.turn) };
}
