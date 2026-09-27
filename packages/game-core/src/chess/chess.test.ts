import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  ChessGame,
  START_FEN,
  buildPgn,
  hasMatingMaterial,
  materialBalance,
  pgnClock,
  pgnDate,
  pgnResultFor,
  positionKey,
  premoveTargets,
  sansFromPgn,
  squareShade,
  type ChessSquare,
} from './index.ts';

/** Plays SAN-ish moves given as "e2e4" / "e7e8q" strings; fails the test on an illegal one. */
function play(game: ChessGame, ...uci: string[]): void {
  for (const m of uci) {
    const rec = game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.slice(4) || undefined });
    if (!rec) throw new Error(`illegal in test: ${m} @ ${game.fen}`);
  }
}

describe('ChessGame — movement and legality', () => {
  it('starts from the standard position with 20 legal moves for White', () => {
    const g = new ChessGame();
    expect(g.fen).toBe(START_FEN);
    expect(g.turn).toBe('w');
    expect(g.legalMoves()).toHaveLength(20);
    expect(g.legalTargets('e2').sort()).toEqual(['e3', 'e4']);
    expect(g.legalTargets('g1').sort()).toEqual(['f3', 'h3']);
    expect(g.legalTargets('e1')).toEqual([]);
  });

  it('alternates turns and records full move data', () => {
    const g = new ChessGame();
    const rec = g.move({ from: 'e2', to: 'e4' })!;
    expect(rec).toMatchObject({
      san: 'e4',
      uci: 'e2e4',
      color: 'w',
      piece: 'p',
      captured: '',
      promotion: '',
      castle: '',
      enPassant: false,
    });
    expect(g.turn).toBe('b');
    expect(g.ply).toBe(1);
    play(g, 'd7d5');
    const cap = g.move({ from: 'e4', to: 'd5' })!;
    expect(cap.san).toBe('exd5');
    expect(cap.captured).toBe('p');
  });

  it('rejects illegal moves without changing the position (never throws)', () => {
    const g = new ChessGame();
    const before = g.fen;
    expect(g.move({ from: 'e2', to: 'e5' })).toBeNull();
    expect(g.move({ from: 'e7', to: 'e5' })).toBeNull(); // wrong side to move
    expect(g.move({ from: 'e4', to: 'e5' })).toBeNull(); // empty square
    expect(g.move({ from: 'z9', to: 'e4' })).toBeNull();
    expect(g.move({ from: 'e2', to: 'e4', promotion: 'x' })).toBeNull();
    expect(g.move({ from: '', to: '' })).toBeNull();
    expect(g.fen).toBe(before);
    expect(g.ply).toBe(0);
  });

  it('never allows a pinned piece to expose its king or the king to walk into check', () => {
    // White knight on e2 pinned by the rook on e8.
    const g = new ChessGame('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(g.legalTargets('e2')).toEqual([]);
    expect(g.move({ from: 'e2', to: 'c3' })).toBeNull();
    // King can't step onto the e-file.
    const k = new ChessGame('4r1k1/8/8/8/8/8/8/3K4 w - - 0 1');
    expect(k.legalTargets('d1')).not.toContain('e1');
    expect(k.legalTargets('d1')).not.toContain('e2');
  });

  it('forces a response to check', () => {
    const g = new ChessGame('4k3/8/8/8/8/8/3P1P2/r3K3 w - - 0 1');
    expect(g.inCheck()).toBe(true);
    expect(g.legalMoves().map((m) => `${m.from}${m.to}`)).toEqual(['e1e2']);
    expect(g.move({ from: 'd2', to: 'd3' })).toBeNull();
  });
});

describe('ChessGame — special moves', () => {
  it('castles both ways and moves the rook', () => {
    const g = new ChessGame('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    const ks = g.move({ from: 'e1', to: 'g1' })!;
    expect(ks.san).toBe('O-O');
    expect(ks.castle).toBe('k');
    expect(g.piece('f1')).toEqual({ type: 'r', color: 'w' });
    const qs = g.move({ from: 'e8', to: 'c8' })!;
    expect(qs.san).toBe('O-O-O');
    expect(qs.castle).toBe('q');
    expect(g.piece('d8')).toEqual({ type: 'r', color: 'b' });
  });

  it('forbids castling out of, through or into check, and after the king or rook moved', () => {
    // Through check: f1 attacked by the bishop on c4.
    expect(new ChessGame('4k3/8/8/8/2b5/8/8/4K2R w K - 0 1').isLegal({ from: 'e1', to: 'g1' })).toBe(false);
    // Out of check.
    expect(new ChessGame('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1').isLegal({ from: 'e1', to: 'g1' })).toBe(false);
    // Into check: g1 attacked by the rook on g8.
    expect(new ChessGame('4k1r1/8/8/8/8/8/8/4K2R w K - 0 1').isLegal({ from: 'e1', to: 'g1' })).toBe(false);
    // Queenside with b1 attacked is still legal (the king doesn't cross b1).
    expect(new ChessGame('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1').isLegal({ from: 'e1', to: 'c1' })).toBe(true);
    // King moved and came back: no rights.
    const g = new ChessGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    play(g, 'e1f1', 'e8d8', 'f1e1', 'd8e8');
    expect(g.isLegal({ from: 'e1', to: 'g1' })).toBe(false);
    expect(g.isLegal({ from: 'e1', to: 'c1' })).toBe(false);
    // Rook moved: only the other side keeps its right.
    const r = new ChessGame('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    play(r, 'h1h2', 'e8d8', 'h2h1', 'd8e8');
    expect(r.isLegal({ from: 'e1', to: 'g1' })).toBe(false);
    expect(r.isLegal({ from: 'e1', to: 'c1' })).toBe(true);
  });

  it('allows en passant only immediately after the double step', () => {
    const g = new ChessGame();
    play(g, 'e2e4', 'a7a6', 'e4e5', 'd7d5');
    expect(g.legalTargets('e5')).toContain('d6');
    const ep = g.move({ from: 'e5', to: 'd6' })!;
    expect(ep.enPassant).toBe(true);
    expect(ep.captured).toBe('p');
    expect(g.piece('d5')).toBeNull();

    const late = new ChessGame();
    play(late, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6');
    expect(late.isLegal({ from: 'e5', to: 'd6' })).toBe(false);
  });

  it('requires a promotion piece for promotions (and only for promotions), including under-promotion', () => {
    const g = new ChessGame('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    expect(g.move({ from: 'a7', to: 'a8' })).toBeNull();
    const knight = g.move({ from: 'a7', to: 'a8', promotion: 'n' })!;
    expect(knight.san).toBe('a8=N');
    expect(knight.promotion).toBe('n');
    expect(g.piece('a8')).toEqual({ type: 'n', color: 'w' });

    const q = new ChessGame('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(q.move({ from: 'a7', to: 'a8', promotion: 'Q' })!.san).toBe('a8=Q');
    expect(q.move({ from: 'h7', to: 'h8', promotion: 'q' })).toBeNull();
    const k = new ChessGame('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(k.move({ from: 'a7', to: 'a8', promotion: 'k' })).toBeNull();
    expect(new ChessGame().move({ from: 'e2', to: 'e4', promotion: 'q' })).toBeNull();
  });

  it('promotes with capture', () => {
    const g = new ChessGame('1r5k/P7/8/8/8/8/8/K7 w - - 0 1');
    const rec = g.move({ from: 'a7', to: 'b8', promotion: 'q' })!;
    expect(rec.san).toBe('axb8=Q+');
    expect(rec.captured).toBe('r');
    expect(rec.check).toBe(true);
  });
});

describe('ChessGame — game endings', () => {
  it("detects checkmate (fool's mate)", () => {
    const g = new ChessGame();
    play(g, 'f2f3', 'e7e5', 'g2g4');
    expect(g.status()).toBeNull();
    const mate = g.move({ from: 'd8', to: 'h4' })!;
    expect(mate.san).toBe('Qh4#');
    expect(mate.mate).toBe(true);
    expect(g.status()).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(g.legalMoves()).toHaveLength(0);
    expect(g.kingSquare('w')).toBe('e1');
  });

  it('detects stalemate (and a near-stalemate that is not)', () => {
    expect(new ChessGame('k7/8/1Q6/8/8/8/8/7K b - - 0 1').status()).toEqual({ winner: null, reason: 'stalemate' });
    const g = new ChessGame('k7/8/2Q5/8/8/8/8/7K w - - 0 1');
    expect(g.status()).toBeNull();
    play(g, 'c6b6');
    expect(g.status()).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('detects dead positions (insufficient material)', () => {
    expect(new ChessGame('8/8/8/4k3/8/8/8/4K3 w - - 0 1').status()).toEqual({ winner: null, reason: 'insufficient' });
    expect(new ChessGame('8/8/8/4k3/8/8/8/4KB2 w - - 0 1').status()?.reason).toBe('insufficient');
    expect(new ChessGame('8/8/8/4k3/8/8/8/4KN2 w - - 0 1').status()?.reason).toBe('insufficient');
    // Same-coloured bishops on both sides.
    expect(new ChessGame('8/8/2b5/4k3/8/8/8/4KB2 w - - 0 1').status()?.reason).toBe('insufficient');
    // Bishop + knight can mate: game goes on.
    expect(new ChessGame('8/8/8/4k3/8/8/8/4KBN1 w - - 0 1').status()).toBeNull();
    // A capture that leaves K v K ends the game.
    const g = new ChessGame('8/8/8/4k3/4n3/8/8/4K3 w - - 0 1');
    expect(g.status()?.reason).toBe('insufficient');
    const h = new ChessGame('8/8/8/4k3/8/3q4/4K3/8 w - - 0 1');
    play(h, 'e2d3');
    expect(h.status()).toEqual({ winner: null, reason: 'insufficient' });
  });

  it('ends automatically on threefold repetition (not on the second occurrence)', () => {
    const g = new ChessGame();
    play(g, 'g1f3', 'g8f6', 'f3g1', 'f6g8');
    expect(g.repetitionCount()).toBe(2);
    expect(g.status()).toBeNull();
    play(g, 'g1f3', 'g8f6', 'f3g1');
    expect(g.status()).toBeNull();
    play(g, 'f6g8');
    expect(g.repetitionCount()).toBe(3);
    expect(g.status()).toEqual({ winner: null, reason: 'repetition' });
  });

  it('treats positions with different castling rights as different', () => {
    const g = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    // King shuffles lose castling rights: the start position (with rights) is never repeated.
    play(g, 'e1f1', 'e8f8', 'f1e1', 'f8e8', 'e1f1', 'e8f8', 'f1e1', 'f8e8');
    expect(g.repetitionCount()).toBe(2); // KQkq-less position occurred twice
    expect(g.status()).toBeNull();
  });

  it('ends on the fifty-move rule — unless the 100th half-move is checkmate', () => {
    const g = new ChessGame('8/8/8/4k3/8/8/1R6/K6R w - - 99 80');
    play(g, 'h1h2');
    expect(g.halfmoveClock()).toBe(100);
    expect(g.status()).toEqual({ winner: null, reason: 'fifty_moves' });

    const mate = new ChessGame('7k/8/6K1/8/8/8/8/R7 w - - 99 80');
    play(mate, 'a1a8');
    expect(mate.status()).toEqual({ winner: 'w', reason: 'checkmate' });

    // A pawn move resets the counter.
    const reset = new ChessGame('8/8/8/4k3/8/8/P7/K6R w - - 98 80');
    play(reset, 'a2a3');
    expect(reset.halfmoveClock()).toBe(0);
  });

  it('undo restores position, history and repetition counts', () => {
    const g = new ChessGame();
    play(g, 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8');
    expect(g.status()?.reason).toBe('repetition');
    expect(g.undo()?.san).toBe('Ng8');
    expect(g.status()).toBeNull();
    expect(g.repetitionCount()).toBe(2);
    while (g.undo());
    expect(g.fen).toBe(START_FEN);
    expect(g.ply).toBe(0);
    expect(g.repetitionCount()).toBe(1);
    expect(g.undo()).toBeNull();
  });
});

describe('mating material (timeouts)', () => {
  const pieces = (fen: string) => {
    const g = new ChessGame(fen);
    const out: Array<{ square: ChessSquare; type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k'; color: 'w' | 'b' }> = [];
    for (const f of 'abcdefgh')
      for (let r = 1; r <= 8; r++) {
        const sq = `${f}${r}` as ChessSquare;
        const p = g.piece(sq);
        if (p) out.push({ square: sq, ...p });
      }
    return out;
  };

  it('lone king never mates; pawns, rooks and queens always can', () => {
    expect(new ChessGame('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1').canMate('b')).toBe(false);
    expect(new ChessGame('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1').canMate('w')).toBe(true);
    expect(new ChessGame('4k3/8/8/8/8/8/P7/4K3 w - - 0 1').canMate('w')).toBe(true);
    expect(new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').canMate('w')).toBe(true);
  });

  it('single minor pieces depend on what the opponent has', () => {
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/N3K3 w - - 0 1'), 'w')).toBe(false); // K+N v K
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/B3K3 w - - 0 1'), 'w')).toBe(false); // K+B v K
    expect(hasMatingMaterial(pieces('4k3/p7/8/8/8/8/8/N3K3 w - - 0 1'), 'w')).toBe(true); // K+N v K+P
    expect(hasMatingMaterial(pieces('4k2r/8/8/8/8/8/8/N3K3 w - - 0 1'), 'w')).toBe(true); // K+N v K+R
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/N2qK3 w - - 0 1'), 'w')).toBe(false); // K+N v K+Q
    expect(hasMatingMaterial(pieces('4k1n1/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(true); // K+B v K+N
    expect(hasMatingMaterial(pieces('4kr2/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(false); // K+B v K+R
  });

  it('bishops: same colour vs opposite colour', () => {
    // c1 is dark, f1 is light.
    expect(squareShade('c1')).toBe('dark');
    expect(squareShade('f1')).toBe('light');
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'), 'w')).toBe(true); // bishop pair
    expect(squareShade('c8')).toBe('light');
    expect(hasMatingMaterial(pieces('3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(false); // d8 dark + c1 dark
    expect(hasMatingMaterial(pieces('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w')).toBe(true); // c8 light vs c1 dark
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/1NB1K3 w - - 0 1'), 'w')).toBe(true); // B+N
    expect(hasMatingMaterial(pieces('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1'), 'w')).toBe(true); // two knights (helpmate)
  });
});

describe('premove targets', () => {
  it('knights jump regardless of the board', () => {
    expect(premoveTargets(START_FEN, 'g1').sort()).toEqual(['e2', 'f3', 'h3']);
  });

  it('pawns may push one or two from the start rank and capture diagonally', () => {
    expect(premoveTargets(START_FEN, 'e2').sort()).toEqual(['d3', 'e3', 'e4', 'f3']);
    expect(premoveTargets(START_FEN, 'e7').sort()).toEqual(['d6', 'e5', 'e6', 'f6']);
    expect(premoveTargets(START_FEN, 'a2').sort()).toEqual(['a3', 'a4', 'b3']);
  });

  it('sliders pass through pieces (the board will have changed)', () => {
    const t = premoveTargets(START_FEN, 'c1');
    expect(t).toContain('h6');
    expect(t).toContain('a3');
    expect(t).toHaveLength(7);
    expect(premoveTargets(START_FEN, 'd1')).toHaveLength(21);
  });

  it('the king may premove castling while it has the right', () => {
    expect(premoveTargets(START_FEN, 'e1').sort()).toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
    expect(premoveTargets('4k3/8/8/8/8/8/8/4K2R w - - 0 1', 'e1')).not.toContain('g1');
  });

  it('empty and invalid squares have none', () => {
    expect(premoveTargets(START_FEN, 'e4')).toEqual([]);
    expect(premoveTargets(START_FEN, 'q9')).toEqual([]);
    expect(premoveTargets('not a fen', 'e2')).toEqual([]);
  });
});

describe('material balance', () => {
  it('is even at the start and tracks captures and promotions', () => {
    expect(materialBalance(START_FEN)).toEqual({ w: {}, b: {}, score: 0 });
    const g = new ChessGame();
    play(g, 'e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'c3b5', 'a5b5', 'f1b5');
    const m = g.material();
    // White lost a pawn and a knight, Black a pawn and the queen.
    expect(m.w).toEqual({ q: 1 });
    expect(m.b).toEqual({ n: 1 });
    expect(m.score).toBe(9 - 3);
  });
});

describe('PGN', () => {
  it('writes the seven tag roster first, extra tags after, escaped values and a result token', () => {
    const g = new ChessGame();
    play(g, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    const pgn = buildPgn({
      headers: [
        ['TimeControl', '300+2'],
        ['Event', 'DASCADE'],
        ['White', 'Ada "The Rook" \\ L'],
        ['Black', 'Grace'],
        ['Date', pgnDate(Date.UTC(2026, 8, 26))],
        ['Termination', 'normal'],
      ],
      sans: g.history.map((m) => m.san),
      result: '0-1',
      clocksMs: [299_000, 300_500, 298_999, 299_000],
    });
    const lines = pgn.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      '[Event "DASCADE"]',
      '[Site "?"]',
      '[Date "2026.09.26"]',
      '[Round "-"]',
      '[White "Ada \\"The Rook\\" \\\\ L"]',
      '[Black "Grace"]',
      '[Result "0-1"]',
    ]);
    expect(lines).toContain('[TimeControl "300+2"]');
    expect(pgn.replace(/\n(?!\n|\[)/g, ' ')).toContain(
      '1. f3 {[%clk 0:04:59]} e5 {[%clk 0:05:00]} 2. g4 {[%clk 0:04:58]} Qh4# {[%clk 0:04:59]} 0-1',
    );
    // chess.js' PGN reader doesn't unescape tag values, so round-trip a plain-named copy.
    const plain = buildPgn({ headers: [['White', 'Ada']], sans: g.history.map((m) => m.san), result: '0-1', clocksMs: [1, 2, 3, 4] });
    expect(sansFromPgn(plain)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  });

  it('wraps movetext at 80 columns and round-trips a long game', () => {
    const rng = createSeededRng('pgn-wrap');
    const g = new ChessGame();
    for (let i = 0; i < 120 && !g.status(); i++) {
      const moves = g.legalMoves();
      const m = moves[rng.int(moves.length)]!;
      g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    }
    const pgn = buildPgn({ headers: [], sans: g.history.map((m) => m.san), result: '*' });
    const movetext = pgn.split('\n\n')[1]!.trim().split('\n');
    for (const line of movetext) expect(line.length).toBeLessThanOrEqual(80);
    expect(movetext.at(-1)!.endsWith('*')).toBe(true);
    expect(sansFromPgn(pgn)).toEqual(g.history.map((m) => m.san));
  });

  it('helpers', () => {
    expect(pgnClock(0)).toBe('0:00:00');
    expect(pgnClock(59_999)).toBe('0:00:59');
    expect(pgnClock(3_725_000)).toBe('1:02:05');
    expect(pgnResultFor('w')).toBe('1-0');
    expect(pgnResultFor('b')).toBe('0-1');
    expect(pgnResultFor('draw')).toBe('1/2-1/2');
    expect(pgnResultFor('')).toBe('*');
    expect(positionKey(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
});

describe('random playouts (seeded)', () => {
  it('always alternate turns, only play legal moves, end with a valid status, and undo back to the start', () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = createSeededRng(`playout-${seed}`);
      const g = new ChessGame();
      let expected: 'w' | 'b' = 'w';
      for (let i = 0; i < 400 && !g.status(); i++) {
        expect(g.turn).toBe(expected);
        const moves = g.legalMoves();
        expect(moves.length).toBeGreaterThan(0);
        const m = moves[rng.int(moves.length)]!;
        const rec = g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
        expect(rec).not.toBeNull();
        expect(rec!.color).toBe(expected);
        expected = expected === 'w' ? 'b' : 'w';
        // Neither king is ever capturable after a legal move by the side that just moved.
        expect(g.kingSquare('w')).not.toBeNull();
        expect(g.kingSquare('b')).not.toBeNull();
      }
      const end = g.status();
      if (end) {
        expect(['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty_moves']).toContain(end.reason);
        if (end.reason === 'checkmate') {
          expect(g.inCheck()).toBe(true);
          expect(end.winner).toBe(g.turn === 'w' ? 'b' : 'w');
        } else expect(end.winner).toBeNull();
      }
      const plies = g.ply;
      for (let i = 0; i < plies; i++) expect(g.undo()).not.toBeNull();
      expect(g.fen).toBe(START_FEN);
    }
  });
});
