/**
 * Oracle: the rules-driven engine configured with American rules must produce exactly the original
 * American engine's moves — from the start (perft) and on every ply of many seeded random playouts.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { initialPosition, type Position } from '../board.ts';
import { applyMove, legalMoves } from '../moves.ts';
import { newGame, playMove } from '../game.ts';
import { variantApplyMove, variantHasCapture, variantLegalMoves } from './moves.ts';
import { checkersEngine } from './game.ts';
import { rulesFor } from './rules.ts';

const american = rulesFor('american');
const key = (m: { path: number[]; captures: number[]; crowned: boolean }) => `${m.path.join('-')}/${m.captures.join(',')}/${m.crowned}`;
const sorted = (moves: Array<{ path: number[]; captures: number[]; crowned: boolean }>) => moves.map(key).sort();

describe('American rules on the variants engine', () => {
  it('matches the published English-draughts perft numbers', () => {
    const perft = (p: Position, depth: number): number => {
      const moves = variantLegalMoves(american, p);
      if (depth === 1) return moves.length;
      let n = 0;
      for (const m of moves) n += perft(variantApplyMove(p, m), depth - 1);
      return n;
    };
    expect([1, 2, 3, 4, 5, 6].map((d) => perft(initialPosition(), d))).toEqual([7, 49, 302, 1469, 7361, 36768]);
  });

  it('generates exactly the original engine’s moves over 300 random games', () => {
    let plies = 0;
    let captures = 0;
    for (let g = 0; g < 300; g++) {
      const rng = createSeededRng(`oracle-${g}`);
      let game = newGame();
      while (!game.result && game.plies.length < 300) {
        const pos = game.position;
        const expected = legalMoves(pos);
        const actual = variantLegalMoves(american, pos);
        expect(sorted(actual)).toEqual(sorted(expected));
        expect(variantHasCapture(american, pos)).toBe(expected.some((m) => m.captures.length > 0));
        const move = expected[rng.int(expected.length)]!;
        expect(variantApplyMove(pos, move)).toEqual(applyMove(pos, move));
        if (move.captures.length) captures++;
        const next = playMove(game, move.path);
        if (!next.ok) throw new Error('illegal oracle move');
        game = next.game;
        plies++;
      }
    }
    expect(plies).toBeGreaterThan(10_000);
    expect(captures).toBeGreaterThan(1_000);
  });

  it('Giveaway moves exactly like American checkers', () => {
    const giveaway = rulesFor('giveaway');
    const rng = createSeededRng('giveaway-oracle');
    let game = newGame();
    for (let i = 0; i < 60 && !game.result; i++) {
      const expected = legalMoves(game.position);
      expect(sorted(variantLegalMoves(giveaway, game.position))).toEqual(sorted(expected));
      const next = playMove(game, expected[rng.int(expected.length)]!.path);
      if (!next.ok) throw new Error('illegal');
      game = next.game;
    }
  });

  it('checkersEngine("american") is the original engine', () => {
    const engine = checkersEngine('american');
    const game = engine.newGame();
    expect(game.position).toEqual(newGame().position);
    expect(game.variant).toBe('american');
    const played = engine.playMove(game, [11, 15]);
    expect(played.ok && played.game.position).toEqual(
      (playMove(newGame(), [11, 15]) as { ok: true; game: { position: Position } }).game.position,
    );
    expect(engine.legalMoves(initialPosition())).toEqual(legalMoves(initialPosition()));
  });
});
