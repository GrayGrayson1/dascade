/**
 * Property tests: seeded random playouts must respect every rule invariant on every ply.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  FORTY_MOVE_PLIES,
  REPETITION_LIMIT,
  captureSequencesFrom,
  cellAt,
  fromFen,
  hasCapture,
  isAdjacent,
  isCrownSquare,
  isMan,
  isValidBoard,
  jumpedSquare,
  legalMoves,
  material,
  moveNotation,
  newGame,
  opponent,
  pieceColor,
  playMove,
  positionKey,
  squareToRC,
  toFen,
  type CheckersGame,
  type Position,
} from './index.ts';

function checkMoves(pos: Position): void {
  const moves = legalMoves(pos);
  const anyCapture = moves.some((m) => m.captures.length > 0);
  expect(anyCapture).toBe(hasCapture(pos));
  const seen = new Set<string>();
  for (const m of moves) {
    const note = moveNotation(m);
    expect(seen.has(note)).toBe(false); // no duplicate moves
    seen.add(note);
    const from = m.path[0]!;
    const piece = cellAt(pos.board, from);
    expect(pieceColor(piece)).toBe(pos.turn);
    // Mandatory capture: all or nothing.
    expect(m.captures.length > 0).toBe(anyCapture);
    if (m.captures.length === 0) {
      expect(m.path).toHaveLength(2);
      expect(isAdjacent(from, m.path[1]!)).toBe(true);
      expect(cellAt(pos.board, m.path[1]!)).toBe('.');
    } else {
      expect(m.path).toHaveLength(m.captures.length + 1);
      for (let i = 0; i < m.captures.length; i++) {
        const cap = m.captures[i]!;
        expect(jumpedSquare(m.path[i]!, m.path[i + 1]!)).toBe(cap);
        expect(pieceColor(cellAt(pos.board, cap))).toBe(opponent(pos.turn));
      }
      expect(new Set(m.captures).size).toBe(m.captures.length); // never jump a piece twice
    }
    // Men only ever move forward.
    if (isMan(piece)) {
      for (let i = 0; i + 1 < m.path.length; i++) {
        const dr = squareToRC(m.path[i + 1]!).row - squareToRC(m.path[i]!).row;
        expect(Math.sign(dr)).toBe(pos.turn === 'dark' ? 1 : -1);
      }
      // A man is crowned iff it ends on its far row, and crowning always ends the chain.
      const to = m.path[m.path.length - 1]!;
      expect(m.crowned).toBe(isCrownSquare(to, pos.turn));
      for (const mid of m.path.slice(1, -1)) expect(isCrownSquare(mid, pos.turn)).toBe(false);
    } else {
      expect(m.crowned).toBe(false);
    }
  }
}

function checkPly(before: CheckersGame, after: CheckersGame): void {
  const ply = after.plies[after.plies.length - 1]!;
  const mover = before.position.turn;
  expect(ply.color).toBe(mover);
  expect(after.position.turn).toBe(opponent(mover));
  expect(isValidBoard(after.position.board)).toBe(true);
  const mb = material(before.position.board, mover);
  const ma = material(after.position.board, mover);
  const ob = material(before.position.board, opponent(mover));
  const oa = material(after.position.board, opponent(mover));
  // The mover never loses material; the opponent loses exactly the captured pieces.
  expect(ma.total).toBe(mb.total);
  expect(oa.total).toBe(ob.total - ply.captures.length);
  expect(ma.kings).toBe(mb.kings + (ply.crowned ? 1 : 0));
  // A multi-jump that ended without crowning left no further capture for that piece.
  const to = ply.path[ply.path.length - 1]!;
  if (ply.captures.length > 0 && !ply.crowned) {
    expect(captureSequencesFrom(after.position.board, to)).toEqual([]);
  }
  // 40-move counter bookkeeping.
  const manMoved = isMan(cellAt(before.position.board, ply.path[0]!));
  expect(after.quietPlies).toBe(ply.captures.length > 0 || manMoved ? 0 : before.quietPlies + 1);
  // FEN round-trips.
  expect(fromFen(toFen(after.position))).toEqual(after.position);
}

/** Recomputes the repetition count of the current position from scratch. */
function recount(game: CheckersGame, start: Position): number {
  let pos = start;
  const keys = [positionKey(pos)];
  let g = newGame(start);
  for (const ply of game.plies) {
    const irreversible = ply.captures.length > 0 || isMan(cellAt(pos.board, ply.path[0]!));
    const r = playMove(g, ply.path);
    if (!r.ok) throw new Error('replay failed');
    g = r.game;
    pos = g.position;
    if (irreversible) keys.length = 0;
    keys.push(positionKey(pos));
  }
  const current = positionKey(game.position);
  return keys.filter((k) => k === current).length;
}

describe('random playouts', () => {
  it('respect every rule invariant for 300 seeded games and always terminate', () => {
    const reasons = new Map<string, number>();
    let totalPlies = 0;
    for (let seed = 0; seed < 300; seed++) {
      const rng = createSeededRng(`checkers-${seed}`);
      let game = newGame();
      const start = game.position;
      let plies = 0;
      while (!game.result) {
        checkMoves(game.position);
        const moves = legalMoves(game.position);
        const move = moves[rng.int(moves.length)]!;
        const r = playMove(game, move.path);
        expect(r.ok).toBe(true);
        if (!r.ok) break;
        checkPly(game, r.game);
        game = r.game;
        plies++;
        expect(plies).toBeLessThan(3000);
      }
      totalPlies += plies;
      const result = game.result!;
      reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
      switch (result.reason) {
        case 'no_pieces':
          expect(material(game.position.board, game.position.turn).total).toBe(0);
          expect(result.winner).toBe(opponent(game.position.turn));
          break;
        case 'no_moves':
          expect(legalMoves(game.position)).toHaveLength(0);
          expect(material(game.position.board, game.position.turn).total).toBeGreaterThan(0);
          expect(result.winner).toBe(opponent(game.position.turn));
          break;
        case 'repetition':
          expect(result.winner).toBeNull();
          expect(recount(game, start)).toBeGreaterThanOrEqual(REPETITION_LIMIT);
          break;
        case 'forty_moves':
          expect(result.winner).toBeNull();
          expect(game.quietPlies).toBe(FORTY_MOVE_PLIES);
          break;
        default:
          throw new Error(`unexpected reason ${result.reason}`);
      }
      // The engine's incremental repetition table always matches a from-scratch recount.
      expect(game.seen[positionKey(game.position)]).toBe(recount(game, start));
    }
    // Random games should exercise wins and at least one automatic draw rule.
    expect((reasons.get('no_pieces') ?? 0) + (reasons.get('no_moves') ?? 0)).toBeGreaterThan(100);
    expect(totalPlies).toBeGreaterThan(300 * 40);
  });
});
