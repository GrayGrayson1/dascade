/**
 * Property tests: seeded random playouts in every variant must respect the shared invariants on
 * every ply and always end legally (or reach the ply cap with the game still running).
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { CHECKERS_VARIANTS, CHECKERS_VARIANT_INFO, type CheckersVariant } from '@dascade/shared/games/checkers';
import { isKing, isMan, material, opponent, pieceColor, type Position } from '../board.ts';
import type { CheckersMove } from '../moves.ts';
import { geometryFor, isCrownSquareOf, squareRC, type BoardGeometry } from './geometry.ts';
import { checkersEngine } from './game.ts';
import { rulesFor } from './rules.ts';

/** Squares strictly between two squares on one diagonal (null if they aren't on one). */
function between(geo: BoardGeometry, a: number, b: number): number[] | null {
  for (let dir = 0; dir < 4; dir++) {
    const ray = geo.rays[a]![dir]!;
    const i = ray.indexOf(b);
    if (i >= 0) return ray.slice(0, i);
  }
  return null;
}

function checkMove(variant: CheckersVariant, pos: Position, m: CheckersMove, anyCapture: boolean): void {
  const rules = rulesFor(variant);
  const geo = geometryFor(rules.size);
  const piece = pos.board[m.path[0]! - 1]!;
  expect(pieceColor(piece)).toBe(pos.turn);
  expect(m.captures.length > 0).toBe(anyCapture);
  if (m.captures.length === 0) {
    expect(m.path).toHaveLength(2);
    const gap = between(geo, m.path[0]!, m.path[1]!);
    expect(gap).not.toBeNull();
    expect(gap!.every((s) => pos.board[s - 1] === '.')).toBe(true);
    expect(pos.board[m.path[1]! - 1]).toBe('.');
    if (isMan(piece)) {
      expect(gap).toHaveLength(0);
      expect(squareRC(geo, m.path[1]!).row - squareRC(geo, m.path[0]!).row).toBe(pos.turn === 'dark' ? 1 : -1);
    } else if (!rules.flyingKings) expect(gap).toHaveLength(0);
    return;
  }
  expect(m.path).toHaveLength(m.captures.length + 1);
  expect(new Set(m.captures).size).toBe(m.captures.length);
  const origin = m.path[0]!;
  for (let i = 0; i < m.captures.length; i++) {
    const cap = m.captures[i]!;
    expect(pieceColor(pos.board[cap - 1])).toBe(opponent(pos.turn));
    const gap = between(geo, m.path[i]!, m.path[i + 1]!);
    expect(gap).not.toBeNull();
    // Exactly one piece is jumped per leg; everything else on the way is empty (or the origin).
    const occupied = gap!.filter((s) => s !== origin && pos.board[s - 1] !== '.');
    expect(occupied).toEqual([cap]);
    const land = m.path[i + 1]!;
    expect(land === origin || pos.board[land - 1] === '.').toBe(true);
  }
}

const GAMES: Record<number, number> = { 8: 40, 10: 12, 12: 6 };

describe.each(CHECKERS_VARIANTS.filter((v) => v !== 'american'))('%s random playouts', (variant) => {
  it('keep every invariant and end legally', () => {
    const engine = checkersEngine(variant);
    const rules = rulesFor(variant);
    const geo = geometryFor(rules.size);
    const info = CHECKERS_VARIANT_INFO[variant];
    let finished = 0;
    for (let g = 0; g < GAMES[info.size]!; g++) {
      const rng = createSeededRng(`${variant}-${g}`);
      let game = engine.newGame();
      while (!game.result && game.plies.length < 400) {
        const pos = game.position;
        const moves = engine.legalMoves(pos);
        expect(moves.length).toBeGreaterThan(0);
        const anyCapture = moves.some((m) => m.captures.length > 0);
        expect(engine.hasCapture(pos)).toBe(anyCapture);
        for (const m of moves) checkMove(variant, pos, m, anyCapture);
        if (rules.capture === 'max' || rules.capture === 'spanish' || rules.capture === 'italian') {
          expect(new Set(moves.map((m) => m.captures.length)).size).toBe(1);
        }
        const move = moves[rng.int(moves.length)]!;
        const before = material(pos.board, opponent(pos.turn)).total;
        const played = engine.playMove(game, move.path);
        if (!played.ok) throw new Error(`${variant}: listed move refused`);
        game = played.game;
        expect(material(game.position.board, opponent(pos.turn)).total).toBe(before - move.captures.length);
        // No man ever stands on its own crowning row once a move is over.
        for (let sq = 1; sq <= geo.squares; sq++) {
          const cell = game.position.board[sq - 1];
          if (isMan(cell)) expect(isCrownSquareOf(geo, sq, pieceColor(cell)!)).toBe(false);
        }
        if (rules.goal === 'breakthrough')
          expect([...game.position.board].some((c) => isKing(c))).toBe(game.result?.reason === 'breakthrough');
      }
      if (game.result) {
        finished++;
        if (game.result.winner === null) expect(['repetition', 'move_limit', 'endgame']).toContain(game.result.reason);
      }
    }
    expect(finished).toBeGreaterThan(0);
  }, 60_000);
});
