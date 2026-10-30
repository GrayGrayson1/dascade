/**
 * Variant rules through the game API: Chess960 castling and X-FEN, each variant's own way to win,
 * reference perft counts (python-chess / lichess suites), and random games in every variant.
 */
import { describe, expect, it } from 'vitest';
import { CHESS_VARIANTS, type ChessVariant } from '@dascade/shared/games/chess';
import { createChessGame, type ChessGameApi, type DropPiece } from './index.ts';
import { VariantChessGame, moveInputFromUci } from './variantGame.ts';
import { chess960BackRank, chess960Fen, isLightSquare, parseFen, perft, rulesFor, variantStartFen } from './variantRules.ts';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function game(variant: ChessVariant, fen?: string): VariantChessGame {
  return new VariantChessGame(variant, fen);
}

/** Plays SAN moves (as the legal move list names them); throws on an unknown one. */
function playSans(g: ChessGameApi, sans: string[]): void {
  for (const san of sans) {
    const m = g.legalMoves().find((x) => x.san.replace(/[+#]$/, '') === san.replace(/[+#]$/, ''));
    if (!m) throw new Error(`no move ${san} in ${g.fen}`);
    expect(g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined })).not.toBeNull();
  }
}

const perftOf = (variant: ChessVariant, fen: string, depth: number) => {
  const rules = rulesFor(variant);
  return perft(rules, parseFen(rules, fen)!, depth);
};

describe('reference perft counts', () => {
  const cases: Array<[ChessVariant, string, number[]]> = [
    ['horde', variantStartFen('horde'), [8, 128, 1274, 23310]],
    ['racingkings', variantStartFen('racingkings'), [21, 421, 11264]],
    ['antichess', variantStartFen('antichess'), [20, 400, 8067, 153299]],
    ['atomic', variantStartFen('atomic'), [20, 400, 8902, 197326]],
    ['crazyhouse', variantStartFen('crazyhouse'), [20, 400, 8902]],
    ['crazyhouse', '2k5/8/8/8/8/8/8/4K3[QRBNPqrbnp] w - - 0 1', [301]],
    ['threecheck', variantStartFen('threecheck'), [20, 400, 8902]],
    ['kingofthehill', variantStartFen('kingofthehill'), [20, 400, 8902]],
    ['chess960', 'bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', [21, 528, 12189]],
    ['chess960', '2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', [21, 807, 18002]],
    ['chess960', 'b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9', [20, 479, 10471]],
    ['chess960', 'qbbnnrkr/2pp2pp/p7/1p2pp2/8/P3PP2/1PPP1KPP/QBBNNR1R w hf - 0 9', [22, 593, 13440]],
    ['chess960', '1nbbnrkr/p1p1ppp1/3p4/1p3P1p/3Pq2P/8/PPP1P1P1/QNBBNRKR w HFhf - 0 9', [28, 1120, 31058]],
  ];
  for (const [variant, fen, counts] of cases) {
    it(`${variant} ${fen.split(' ')[0]}`, () => {
      counts.forEach((n, i) => expect(perftOf(variant, fen, i + 1)).toBe(n));
    });
  }
});

describe('Chess960', () => {
  it('numbers the 960 starts like Scharnagl (518 = the standard array)', () => {
    expect(chess960BackRank(518)).toBe('RNBQKBNR');
    expect(chess960BackRank(0)).toBe('BBQNNRKR');
    const all = new Set<string>();
    for (let id = 0; id < 960; id++) {
      const rank = chess960BackRank(id);
      all.add(rank);
      const bishops = [...rank].flatMap((p, f) => (p === 'B' ? [f] : []));
      expect(isLightSquare(bishops[0]!)).not.toBe(isLightSquare(bishops[1]!));
      const rooks = [...rank].flatMap((p, f) => (p === 'R' ? [f] : []));
      const king = rank.indexOf('K');
      expect(rooks[0]! < king && king < rooks[1]!).toBe(true);
      const g = game('chess960', chess960Fen(id));
      expect(g.legalMoves().length).toBeGreaterThan(15);
    }
    expect(all.size).toBe(960);
  });

  it('castles king-side when king and rook already stand on f1/g1', () => {
    const g = game('chess960', '1r2k2r/8/8/8/8/8/8/1R3KR1 w GBhb - 0 1');
    const castle = g.legalMoves('f1').find((m) => m.castle === 'k');
    expect(castle).toMatchObject({ to: 'g1', san: 'O-O' });
    const rec = g.move({ from: 'f1', to: 'g1' })!;
    expect(rec).toMatchObject({ san: 'O-O', castle: 'k', uci: 'f1g1', to: 'g1', rook: ['g1', 'f1'] });
    expect(g.piece('g1')).toEqual({ type: 'k', color: 'w' });
    expect(g.piece('f1')).toEqual({ type: 'r', color: 'w' });
    expect(g.fen.split(' ')[2]).toBe('kq');
  });

  it('castles queen-side with the king next to its rook', () => {
    const g = game('chess960', '4k3/8/8/8/8/8/8/RK6 w A - 0 1');
    expect(g.move({ from: 'b1', to: 'a1' })?.san).toBe('O-O-O');
    expect(g.piece('c1')?.type).toBe('k');
    expect(g.piece('d1')?.type).toBe('r');
    // b1→c1 alone would be a king step, so the landing square doesn't mean castling here.
    const h = game('chess960', '4k3/8/8/8/8/8/8/RK6 w A - 0 1');
    expect(h.move({ from: 'b1', to: 'c1' })?.san).toBe('Kc1');
  });

  it('can’t castle through an attacked square or out of check', () => {
    expect(
      game('chess960', '5r1k/8/8/8/8/8/8/4K2R w K - 0 1')
        .legalMoves('e1')
        .some((m) => m.castle),
    ).toBe(false);
    expect(
      game('chess960', '4r2k/8/8/8/8/8/8/4K2R w K - 0 1')
        .legalMoves('e1')
        .some((m) => m.castle),
    ).toBe(false);
    expect(
      game('chess960', '7k/8/8/8/8/8/8/4K2R w K - 0 1')
        .legalMoves('e1')
        .some((m) => m.castle),
    ).toBe(true);
  });

  it('writes X-FEN castling (file letters only for an inner rook) and reads Shredder-FEN', () => {
    expect(game('chess960', '4k3/8/8/8/8/8/8/1K1R3R w D - 0 1').fen.split(' ')[2]).toBe('D');
    expect(game('chess960', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1').fen.split(' ')[2]).toBe('KQkq');
  });

  it('accepts the king two squares sideways when the start is the standard array', () => {
    const g = game('chess960');
    playSans(g, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    expect(g.move({ from: 'e1', to: 'g1' })?.san).toBe('O-O');
  });
});

describe('King of the Hill', () => {
  it('wins when the king reaches the centre', () => {
    const g = game('kingofthehill', '4k3/8/8/8/8/4K3/8/8 w - - 0 1');
    expect(g.move({ from: 'e3', to: 'e4' })?.san).toBe('Ke4#');
    expect(g.status()).toEqual({ winner: 'w', reason: 'hill' });
  });
  it('the king still can’t step into check', () => {
    const g = game('kingofthehill', '4k3/8/8/8/r7/4K3/8/8 w - - 0 1');
    expect(g.isLegal({ from: 'e3', to: 'e4' })).toBe(false);
  });
  it('a lone king can still win on time', () => {
    expect(game('kingofthehill', '4k3/8/8/8/8/4K3/8/7q w - - 0 1').canMate('w')).toBe(true);
  });
});

describe('Three-Check', () => {
  it('counts checks and wins on the third', () => {
    const g = game('threecheck');
    playSans(g, ['e4', 'f6', 'Qh5+']);
    expect(g.checksGiven('w')).toBe(1);
    expect(g.fen.split(' ')[4]).toBe('2+3');
    const h = game('threecheck', '4k3/8/8/8/8/8/8/R3K3 w - - 1+3 0 1');
    expect(h.checksGiven('w')).toBe(2);
    expect(h.move({ from: 'a1', to: 'a8' })?.san).toBe('Ra8#');
    expect(h.status()).toEqual({ winner: 'w', reason: 'three_checks' });
  });
  it('reads the older "+checks given" suffix', () => {
    expect(game('threecheck', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1 +2+1').checksGiven('b')).toBe(1);
  });
  it('kings alone can’t give check: insufficient material', () => {
    expect(game('threecheck', '4k3/8/8/8/8/8/8/4K3 w - - 3+3 0 1').status()).toEqual({ winner: null, reason: 'insufficient' });
  });
});

describe('Racing Kings', () => {
  it('no move may give check', () => {
    const g = game('racingkings');
    for (const m of g.legalMoves()) {
      const h = game('racingkings');
      h.move(m);
      expect(h.inCheck()).toBe(false);
    }
    expect(game('racingkings', '8/8/8/k7/8/8/8/1R5K w - - 0 1').isLegal({ from: 'b1', to: 'a1' })).toBe(false);
    expect(game('racingkings', '8/8/8/k7/8/8/8/1R5K w - - 0 1').isLegal({ from: 'b1', to: 'b2' })).toBe(true);
  });
  it('White wins when Black can’t follow', () => {
    const g = game('racingkings', '8/5K2/8/8/8/8/1k6/8 w - - 0 1');
    g.move({ from: 'f7', to: 'f8' });
    expect(g.status()).toEqual({ winner: 'w', reason: 'race' });
  });
  it('Black gets one last move and can draw', () => {
    const g = game('racingkings', '8/k4K2/8/8/8/8/8/8 w - - 0 1');
    g.move({ from: 'f7', to: 'f8' });
    expect(g.status()).toBeNull();
    g.move({ from: 'a7', to: 'b8' });
    expect(g.status()).toEqual({ winner: null, reason: 'race' });
  });
  it('Black reaching the goal first wins', () => {
    const g = game('racingkings', '8/k7/8/8/8/8/8/7K b - - 0 1');
    expect(g.move({ from: 'a7', to: 'a8' })?.san).toBe('Ka8#');
    expect(g.status()).toEqual({ winner: 'b', reason: 'race' });
  });
});

describe('Antichess', () => {
  it('captures are compulsory', () => {
    const g = game('antichess');
    playSans(g, ['e3', 'b5']);
    expect(g.mustCapture()).toBe(true);
    expect(g.legalMoves().map((m) => m.san)).toEqual(['Bxb5']);
  });
  it('pawns promote to a king too; the king is an ordinary piece', () => {
    const g = game('antichess', '8/P7/8/8/8/8/8/7k w - - 0 1');
    expect(g.promotionChoices()).toContain('k');
    expect(g.move({ from: 'a7', to: 'a8', promotion: 'k' })?.san).toBe('a8=K');
    expect(g.inCheck()).toBe(false);
    const h = game('antichess', '8/8/8/8/8/8/8/R6k w - - 0 1');
    expect(h.legalMoves().map((m) => m.san)).toEqual(['Rxh1#']);
  });
  it('losing every piece wins', () => {
    const g = game('antichess', '8/8/8/8/8/8/1p6/R7 b - - 0 1');
    g.move({ from: 'b2', to: 'a1', promotion: 'q' });
    expect(g.status()).toEqual({ winner: 'w', reason: 'no_pieces' });
  });
  it('having no legal move wins', () => {
    expect(game('antichess', '8/8/8/8/8/p7/P7/8 w - - 0 1').status()).toEqual({ winner: 'w', reason: 'no_moves' });
  });
});

describe('Atomic', () => {
  it('a capture explodes the neighbours except pawns', () => {
    const g = game('atomic', '4k3/8/5b2/3pn3/8/5N2/8/4K3 w - - 0 1');
    const rec = g.move({ from: 'f3', to: 'e5' })!;
    expect(rec.exploded?.sort()).toEqual(['e5', 'f6']);
    expect(g.piece('e5')).toBeNull();
    expect(g.piece('f6')).toBeNull();
    expect(g.piece('d5')?.type).toBe('p');
  });
  it('kings can’t capture, and you can’t blow up your own king', () => {
    expect(game('atomic', '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1').isLegal({ from: 'e1', to: 'd2' })).toBe(false);
    expect(game('atomic', '4k3/8/8/8/8/8/2Rp4/4K3 w - - 0 1').isLegal({ from: 'c2', to: 'd2' })).toBe(false);
  });
  it('blowing up the enemy king wins', () => {
    const g = game('atomic', '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1');
    expect(g.move({ from: 'd1', to: 'd7' })?.san).toBe('Qxd7#');
    expect(g.status()).toEqual({ winner: 'w', reason: 'explosion' });
  });
  it('touching kings can’t be checked', () => {
    const g = game('atomic', '3r4/8/8/8/8/8/2kK4/8 w - - 0 1');
    expect(g.inCheck()).toBe(false);
    expect(game('atomic', '3r4/8/8/8/8/8/k2K4/8 w - - 0 1').inCheck()).toBe(true);
  });
});

describe('Horde', () => {
  it('first-rank pawns may step twice (without an en-passant square)', () => {
    const g = game('horde', '4k3/8/8/8/8/8/8/P7 w - - 0 1');
    expect(g.legalTargets('a1').sort()).toEqual(['a2', 'a3']);
    g.move({ from: 'a1', to: 'a3' });
    expect(g.fen.split(' ')[3]).toBe('-');
  });
  it('Black wins by capturing every white piece', () => {
    const g = game('horde', '4k3/8/8/8/8/8/8/r6P b - - 0 1');
    g.move({ from: 'a1', to: 'h1' });
    expect(g.status()).toEqual({ winner: 'b', reason: 'horde_captured' });
  });
  it('White has no king and is never in check', () => {
    const g = game('horde');
    expect(g.kingSquare('w')).toBeNull();
    expect(g.inCheck()).toBe(false);
  });
});

describe('Crazyhouse', () => {
  it('captured pieces go to the pocket and can be dropped', () => {
    const g = game('crazyhouse');
    playSans(g, ['e4', 'd5', 'exd5']);
    expect(g.pocket('w').p).toBe(1);
    expect(g.fen.split(' ')[0].endsWith('[P]')).toBe(true);
    playSans(g, ['Qxd5']);
    expect(g.pocket('b').p).toBe(1);
    expect(g.dropTargets('p')).not.toContain('a1');
    expect(g.dropTargets('p')).not.toContain('h8');
    const rec = g.move({ to: 'e4', drop: 'p' })!;
    expect(rec).toMatchObject({ san: 'P@e4', uci: 'P@e4', drop: 'p', to: 'e4' });
    expect(g.pocket('w').p).toBe(0);
  });
  it('a captured promoted piece goes back as a pawn', () => {
    const g = game('crazyhouse', 'q3k3/8/8/8/8/8/8/Q~3K3[] b - - 0 1');
    g.move({ from: 'a8', to: 'a1' });
    expect(g.pocket('b')).toMatchObject({ p: 1, q: 0 });
  });
  it('drops must be legal: no pawn drops on the edge ranks, no leaving the king in check', () => {
    const g = game('crazyhouse', '4k3/8/8/8/8/8/8/r3K3[N] w - - 0 1');
    // White is in check from a1: a knight drop can't block a rook on the same rank next to the king…
    expect(g.dropTargets('n').sort()).toEqual(['b1', 'c1', 'd1']);
    expect(g.isLegal({ to: 'e4', drop: 'n' })).toBe(false);
  });
  it('a lone king can still win on time', () => {
    expect(game('crazyhouse').canMate('w')).toBe(true);
  });
});

describe('input', () => {
  it('reads UCI moves, drops included', () => {
    expect(moveInputFromUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(moveInputFromUci('N@f3')).toEqual({ to: 'f3', drop: 'n' });
    expect(moveInputFromUci('zz')).toBeNull();
  });
  it('refuses a drop with an origin, a promotion piece on a normal move, or a missing one', () => {
    const g = game('crazyhouse', '4k3/P7/8/8/8/8/8/4K3[N] w - - 0 1');
    expect(g.isLegal({ from: 'e1', to: 'e2', drop: 'n' })).toBe(false);
    expect(g.isLegal({ from: 'e1', to: 'e2', promotion: 'q' })).toBe(false);
    expect(g.isLegal({ from: 'a7', to: 'a8' })).toBe(false);
    expect(g.isLegal({ from: 'a7', to: 'a8', promotion: 'k' })).toBe(false);
    expect(g.isLegal({ from: 'a7', to: 'a8', promotion: 'n' })).toBe(true);
  });
  it('the factory keeps Standard on chess.js', () => {
    expect(createChessGame('standard').variant).toBe('standard');
    expect(createChessGame('standard').constructor.name).toBe('ChessGame');
    expect(createChessGame('atomic')).toBeInstanceOf(VariantChessGame);
  });
});

describe('random games in every variant', () => {
  for (const variant of CHESS_VARIANTS.filter((v) => v !== 'standard')) {
    it(`${variant}: always ends legally`, () => {
      const rnd = lcg(variant.length * 7919);
      let finished = 0;
      for (let n = 0; n < 40; n++) {
        const g = game(variant, variant === 'chess960' ? chess960Fen(Math.floor(rnd() * 960)) : undefined);
        for (let ply = 0; ply < 500 && !g.status(); ply++) {
          const moves = g.legalMoves();
          const drops = (['p', 'n', 'b', 'r', 'q'] as DropPiece[]).flatMap((d) => g.dropTargets(d).map((to) => ({ to, drop: d })));
          const total = moves.length + drops.length;
          expect(total).toBeGreaterThan(0);
          const sans = moves.map((m) => m.san);
          expect(new Set(sans).size).toBe(sans.length);
          const i = Math.floor(rnd() * total);
          const fenBefore = g.fen;
          const pick = i < moves.length ? moves[i]! : drops[i - moves.length]!;
          const rec = 'drop' in pick ? g.move(pick) : g.move({ from: pick.from, to: pick.to, promotion: pick.promotion || undefined });
          expect(rec).not.toBeNull();
          // FENs round-trip, and the record's UCI replays the same move.
          expect(game(variant, g.fen).fen).toBe(g.fen);
          const replay = game(variant, fenBefore);
          expect(replay.move(moveInputFromUci(rec!.uci)!)?.fenAfter).toBe(rec!.fenAfter);
        }
        if (g.status()) finished++;
        // Undo walks all the way back.
        while (g.undo());
        expect(g.ply).toBe(0);
        expect(g.fen).toBe(g.startFen);
      }
      expect(finished).toBeGreaterThan(0);
    }, 120_000);
  }
});
