/**
 * Legal move generation for the draughts variants on any board size, driven by DraughtsRules.
 *
 * Shared by every variant:
 *  - Men move one square diagonally forward. Captures are mandatory: when any capture exists,
 *    only captures are legal, filtered by the variant's capture rule (./rules.ts).
 *  - A capture sequence is one move and must be completed: it ends only when the piece can't
 *    capture any further. A flying king that may land on several squares behind a captured piece
 *    must pick one from which it can keep capturing, when there is one.
 *  - Turkish strike: jumped pieces stay on the board until the move ends — they can't be jumped
 *    twice, and nothing can land on or pass over them. The moving piece's origin square is empty
 *    for the whole sequence.
 *  - Captures that take the same pieces from the same start to the same end square with the same
 *    result (a flying king choosing different landings on the way) are one move: only the first is
 *    listed.
 *
 * Moves use the same shape as the American engine ({ path, captures, crowned }).
 */
import { EMPTY, isKing, opponent, pieceColor, type CellChar, type Color, type Position } from '../board.ts';
import { findMove, moveTo, type CheckersMove } from '../moves.ts';
import { ALL_DIRECTIONS, FORWARD, geometryFor, isCrownSquareOf, isSquareOf, type BoardGeometry } from './geometry.ts';
import type { DraughtsRules } from './rules.ts';

/** A capture sequence with the facts the priority rules need. */
interface Sequence extends CheckersMove {
  /** The capturing piece was a king when the move started. */
  byKing: boolean;
  /** Indices (into `captures`) of the kings taken, in order. */
  kingsAt: number[];
}

function captureDirections(rules: DraughtsRules, color: Color, king: boolean): readonly number[] {
  return king || rules.menCaptureBackward ? ALL_DIRECTIONS : FORWARD[color];
}

/** Every complete capture sequence for the piece on `from` (before the variant's priority filter). */
function sequencesFrom(rules: DraughtsRules, geo: BoardGeometry, board: string, from: number): Sequence[] {
  const piece = board[from - 1] as CellChar;
  const color = pieceColor(piece);
  if (!color) return [];
  const enemy = opponent(color);
  const cells = board.split('') as CellChar[];
  cells[from - 1] = EMPTY;
  const startKing = isKing(piece);
  const out: Sequence[] = [];

  interface Leg {
    over: number;
    lands: number[];
  }

  const legsFrom = (at: number, king: boolean, taken: readonly number[]): Leg[] => {
    const legs: Leg[] = [];
    for (const dir of captureDirections(rules, color, king)) {
      const ray = geo.rays[at]![dir]!;
      let i = 0;
      if (king && rules.flyingKings) while (i < ray.length && cells[ray[i]! - 1] === EMPTY) i++;
      const over = ray[i];
      if (over === undefined) continue;
      const victim = cells[over - 1];
      if (pieceColor(victim) !== enemy || taken.includes(over)) continue;
      if (!king && !rules.menCaptureKings && isKing(victim)) continue;
      const lands: number[] = [];
      for (let j = i + 1; j < ray.length && cells[ray[j]! - 1] === EMPTY; j++) {
        lands.push(ray[j]!);
        if (!(king && rules.flyingKings)) break;
      }
      if (lands.length > 0) legs.push({ over, lands });
    }
    return legs;
  };

  /** Extends a partial sequence; returns the complete sequences found from here. */
  const extend = (at: number, king: boolean, promoted: boolean, path: number[], taken: number[], kingsAt: number[]): Sequence[] => {
    const legs = legsFrom(at, king, taken);
    if (legs.length === 0) {
      if (taken.length === 0) return [];
      const crowned = !startKing && (promoted || isCrownSquareOf(geo, at, color));
      return [{ path, captures: taken, crowned, byKing: startKing, kingsAt }];
    }
    const found: Sequence[] = [];
    for (const leg of legs) {
      const nextTaken = [...taken, leg.over];
      const nextKings = isKing(cells[leg.over - 1]) ? [...kingsAt, taken.length] : kingsAt;
      const branches: Sequence[][] = [];
      for (const land of leg.lands) {
        const nextPath = [...path, land];
        const crowning = !king && isCrownSquareOf(geo, land, color);
        if (crowning && rules.promotion === 'stop') {
          branches.push([{ path: nextPath, captures: nextTaken, crowned: true, byKing: startKing, kingsAt: nextKings }]);
        } else if (crowning && rules.promotion === 'king') {
          branches.push(extend(land, true, true, nextPath, nextTaken, nextKings));
        } else {
          branches.push(extend(land, king, promoted, nextPath, nextTaken, nextKings));
        }
      }
      // A king must land where it can keep capturing, when any landing allows it.
      const continues = (b: Sequence[]) => b.some((s) => s.captures.length > nextTaken.length);
      const keep = branches.some(continues) ? branches.filter(continues) : branches;
      for (const b of keep) found.push(...b);
    }
    return found;
  };

  out.push(...extend(from, startKing, false, [from], [], []));
  return out;
}

/** Lexicographic comparison of two index lists (shorter = smaller when equal so far). */
function compareIndices(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

function keepBest<T>(list: T[], score: (x: T) => number): T[] {
  let best = -Infinity;
  for (const x of list) best = Math.max(best, score(x));
  return list.filter((x) => score(x) === best);
}

/** The variant's capture priority: which of the complete sequences may be played. */
function applyCaptureRule(rules: DraughtsRules, seqs: Sequence[]): Sequence[] {
  switch (rules.capture) {
    case 'free':
      return seqs;
    case 'max':
      return keepBest(seqs, (s) => s.captures.length);
    case 'spanish':
      return keepBest(
        keepBest(seqs, (s) => s.captures.length),
        (s) => s.kingsAt.length,
      );
    case 'czech':
      return seqs.some((s) => s.byKing) ? seqs.filter((s) => s.byKing) : seqs;
    case 'italian': {
      let best = keepBest(seqs, (s) => s.captures.length);
      if (best.some((s) => s.byKing)) best = best.filter((s) => s.byKing);
      best = keepBest(best, (s) => s.kingsAt.length);
      if (best.length < 2 || best[0]!.kingsAt.length === 0) return best;
      // Then: the sequence that meets a king earliest.
      const first = best.reduce((a, b) => (compareIndices(b.kingsAt, a.kingsAt) < 0 ? b : a));
      return best.filter((s) => compareIndices(s.kingsAt, first.kingsAt) === 0);
    }
  }
}

/** Drops captures that repeat an earlier one's start, end and captured pieces (different landings only). */
function dedupe(moves: CheckersMove[]): CheckersMove[] {
  const seen = new Set<string>();
  return moves.filter((m) => {
    const key = `${m.path[0]}>${moveTo(m)}:${[...m.captures].sort((a, b) => a - b).join(',')}:${m.crowned ? 'K' : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const strip = (s: Sequence): CheckersMove => ({ path: s.path, captures: s.captures, crowned: s.crowned });

/** Every legal capture for the side to move (empty when it has none). */
export function variantCaptures(rules: DraughtsRules, pos: Position): CheckersMove[] {
  const geo = geometryFor(rules.size);
  const all: Sequence[] = [];
  for (let sq = 1; sq <= geo.squares; sq++) {
    if (pieceColor(pos.board[sq - 1]) === pos.turn) all.push(...sequencesFrom(rules, geo, pos.board, sq));
  }
  if (all.length === 0) return [];
  const chosen = applyCaptureRule(rules, all).map(strip);
  return rules.flyingKings ? dedupe(chosen) : chosen;
}

/** Non-capturing moves for the side to move. */
function quietMoves(rules: DraughtsRules, pos: Position): CheckersMove[] {
  const geo = geometryFor(rules.size);
  const out: CheckersMove[] = [];
  for (let sq = 1; sq <= geo.squares; sq++) {
    const cell = pos.board[sq - 1];
    if (pieceColor(cell) !== pos.turn) continue;
    const king = isKing(cell);
    for (const dir of king ? ALL_DIRECTIONS : FORWARD[pos.turn]) {
      for (const to of geo.rays[sq]![dir]!) {
        if (pos.board[to - 1] !== EMPTY) break;
        out.push({ path: [sq, to], captures: [], crowned: !king && isCrownSquareOf(geo, to, pos.turn) });
        if (!(king && rules.flyingKings)) break;
      }
    }
  }
  return out;
}

/** Every legal move for the side to move. */
export function variantLegalMoves(rules: DraughtsRules, pos: Position): CheckersMove[] {
  const captures = variantCaptures(rules, pos);
  return captures.length > 0 ? captures : quietMoves(rules, pos);
}

/** True when the side to move must capture. */
export function variantHasCapture(rules: DraughtsRules, pos: Position): boolean {
  const geo = geometryFor(rules.size);
  for (let sq = 1; sq <= geo.squares; sq++) {
    if (pieceColor(pos.board[sq - 1]) === pos.turn && sequencesFrom(rules, geo, pos.board, sq).length > 0) return true;
  }
  return false;
}

/** Applies a legal move (not re-validated) and passes the turn. */
export function variantApplyMove(pos: Position, move: CheckersMove): Position {
  const cells = pos.board.split('') as CellChar[];
  const from = move.path[0]!;
  const piece = cells[from - 1]!;
  const color = pieceColor(piece);
  if (!color) throw new Error(`No piece on square ${from}`);
  cells[from - 1] = EMPTY;
  for (const sq of move.captures) cells[sq - 1] = EMPTY;
  cells[moveTo(move) - 1] = move.crowned ? (color === 'dark' ? 'D' : 'L') : piece;
  return { board: cells.join(''), turn: opponent(pos.turn) };
}

/**
 * Resolves a requested path to a unique legal move: the exact path, or the only legal move from
 * `path[0]` that passes through the given squares in order and ends on the last one.
 */
export function resolveVariantMove(geo: BoardGeometry, moves: readonly CheckersMove[], path: readonly number[]): CheckersMove | null {
  if (path.length < 2 || !path.every((sq) => isSquareOf(geo, sq))) return null;
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
