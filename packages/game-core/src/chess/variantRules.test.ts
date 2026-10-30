/**
 * The variant move generator checked against chess.js (the oracle for Standard rules): perft on the
 * well-known positions, and move-by-move equality of legal moves, SAN, UCI and FEN along random games.
 */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { legalMoves, makeFen, moveUci, parseFen, perft, play, rulesFor, type VPosition } from './variantRules.ts';
import { VariantChessGame } from './variantGame.ts';

const STD = rulesFor('standard');

function pos(fen: string): VPosition {
  const p = parseFen(STD, fen);
  if (!p) throw new Error(`bad fen ${fen}`);
  return p;
}

/** Small deterministic PRNG for the random games (tests only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PERFT: Array<{ name: string; fen: string; counts: number[] }> = [
  { name: 'start', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', counts: [20, 400, 8902, 197281] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862] },
  { name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
  { name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467] },
  { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] },
  { name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890] },
];

describe('perft (standard rules)', () => {
  for (const { name, fen, counts } of PERFT) {
    it(name, () => {
      const p = pos(fen);
      counts.forEach((n, i) => expect(perft(STD, p, i + 1)).toBe(n));
    });
  }
});

describe('random games against chess.js', () => {
  it('agrees on every legal move, SAN, UCI and FEN', () => {
    const rnd = lcg(20261030);
    let positions = 0;
    for (let game = 0; game < 24; game++) {
      const oracle = new Chess();
      let p = pos(oracle.fen());
      for (let ply = 0; ply < 140; ply++) {
        const expected = oracle.moves({ verbose: true });
        const mine = legalMoves(STD, p);
        expect(mine.map((m) => moveUci(STD, p, m)).sort()).toEqual(expected.map((m) => m.lan).sort());
        const sans = new VariantChessGame('standard', makeFen(STD, p)).legalMoves().map((m) => m.san);
        expect(sans.sort()).toEqual(expected.map((m) => m.san).sort());
        positions++;
        if (expected.length === 0 || oracle.isGameOver()) break;
        const pick = expected[Math.floor(rnd() * expected.length)]!;
        oracle.move(pick.san);
        const move = mine.find((m) => moveUci(STD, p, m) === pick.lan)!;
        p = play(STD, p, move).pos;
        expect(makeFen(STD, p)).toBe(oracle.fen());
      }
    }
    expect(positions).toBeGreaterThan(1500);
  }, 120_000);

  it('perft(3) matches chess.js from positions along random games', () => {
    const rnd = lcg(42);
    for (let game = 0; game < 8; game++) {
      const oracle = new Chess();
      for (let ply = 0; ply < 40; ply++) {
        const moves = oracle.moves();
        if (!moves.length) break;
        oracle.move(moves[Math.floor(rnd() * moves.length)]!);
        if (ply % 10 === 9) expect(perft(STD, pos(oracle.fen()), 3)).toBe(oracle.perft(3));
      }
    }
  }, 120_000);
});
