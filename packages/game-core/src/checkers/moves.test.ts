import { describe, expect, it } from 'vitest';
import {
  applyMove,
  captureSequencesFrom,
  cellAt,
  findMove,
  fromFen,
  hasCapture,
  initialPosition,
  isCapture,
  legalMoves,
  makeBoard,
  material,
  movableSquares,
  moveFrom,
  moveNotation,
  moveTo,
  movesWithPrefix,
  nextSquares,
  resolveMove,
  type CheckersMove,
  type Color,
  type PieceChar,
  type Position,
} from './index.ts';

const pos = (pieces: Partial<Record<PieceChar, number[]>>, turn: Color = 'dark'): Position => ({ board: makeBoard(pieces), turn });
const notations = (p: Position) => legalMoves(p).map(moveNotation).sort();

describe('opening moves', () => {
  it('gives Dark exactly the 7 standard opening moves', () => {
    expect(notations(initialPosition())).toEqual(['10-14', '10-15', '11-15', '11-16', '12-16', '9-13', '9-14']);
  });

  it('gives Light 7 replies after 11-15', () => {
    const after = applyMove(initialPosition(), findMove(legalMoves(initialPosition()), [11, 15])!);
    expect(after.turn).toBe('light');
    expect(notations(after)).toEqual(['21-17', '22-17', '22-18', '23-18', '23-19', '24-19', '24-20']);
  });

  it('forces 15x22 after 11-15 22-18', () => {
    let p = initialPosition();
    p = applyMove(p, resolveMove(legalMoves(p), [11, 15])!);
    p = applyMove(p, resolveMove(legalMoves(p), [22, 18])!);
    expect(notations(p)).toEqual(['15x22']);
    expect(hasCapture(p)).toBe(true);
    p = applyMove(p, legalMoves(p)[0]!);
    expect(cellAt(p.board, 18)).toBe('.');
    expect(cellAt(p.board, 15)).toBe('.');
    expect(cellAt(p.board, 22)).toBe('d');
    // Light must recapture: 25x18 or 26x17 are both captures of the man on 22.
    expect(notations(p)).toEqual(['25x18', '26x17']);
  });
});

describe('simple moves', () => {
  it('moves men one square diagonally forward only', () => {
    expect(notations(pos({ d: [14] }))).toEqual(['14-17', '14-18']);
    expect(notations(pos({ l: [14] }, 'light'))).toEqual(['14-10', '14-9']);
  });

  it('rejects illegal diagonals: backwards, sideways, too far, onto pieces', () => {
    const p = pos({ d: [14], l: [31] });
    const moves = legalMoves(p);
    for (const path of [
      [14, 9], // backwards
      [14, 10], // backwards
      [14, 15], // sideways
      [14, 18 + 4], // two rows
      [14, 23], // not a diagonal neighbour
      [14, 14],
      [13, 17], // no piece there
      [31, 27], // opponent's piece
    ]) {
      expect(resolveMove(moves, path)).toBeNull();
    }
    const blocked = pos({ d: [14], D: [17, 18] });
    expect(legalMoves(blocked).some((m) => moveFrom(m) === 14)).toBe(false);
  });

  it('respects board edges', () => {
    expect(notations(pos({ d: [5] }))).toEqual(['5-9']);
    expect(notations(pos({ d: [12] }))).toEqual(['12-16']);
    expect(notations(pos({ l: [21] }, 'light'))).toEqual(['21-17']);
    expect(notations(pos({ l: [28] }, 'light'))).toEqual(['28-24']);
  });

  it('moves kings one square in all four directions (no flying kings)', () => {
    expect(notations(pos({ D: [18] }))).toEqual(['18-14', '18-15', '18-22', '18-23']);
    expect(notations(pos({ L: [18] }, 'light'))).toEqual(['18-14', '18-15', '18-22', '18-23']);
    // Corner king has one move; a long empty diagonal does not allow sliding.
    expect(notations(pos({ D: [29] }))).toEqual(['29-25']);
    expect(resolveMove(legalMoves(pos({ D: [29] })), [29, 22])).toBeNull();
    expect(resolveMove(legalMoves(pos({ D: [29] })), [29, 4])).toBeNull();
  });

  it('only moves the side to move', () => {
    const p = pos({ d: [14], l: [23] }, 'light');
    expect(legalMoves(p).every((m) => cellAt(p.board, moveFrom(m)) === 'l')).toBe(true);
  });
});

describe('mandatory captures', () => {
  it('allows only captures when any capture exists', () => {
    // Dark man on 15 can take 18; the man on 1 could move but may not.
    const p = pos({ d: [1, 15], l: [18, 32] });
    expect(notations(p)).toEqual(['15x22']);
  });

  it('lets the player choose between capturing pieces', () => {
    const p = pos({ d: [14, 11], l: [18, 15 + 1] });
    // 14x23 (over 18), 11x20 (over 16)
    expect(notations(p)).toEqual(['11x20', '14x23']);
  });

  it('does not require the longest capture', () => {
    // 6x15x24 (double) vs 11x20 (single): both legal.
    const p = pos({ d: [6, 11], l: [10, 16, 19] });
    expect(notations(p)).toEqual(['11x20', '6x15x24']);
    // …and a branching piece may take the shorter branch.
    const branch = pos({ d: [15], l: [18, 19, 26] });
    // 15x22x31 (over 18 then 26) or 15x24 (over 19)
    expect(notations(branch)).toEqual(['15x22x31', '15x24']);
  });

  it('never captures own pieces, off the board, or into an occupied square', () => {
    expect(hasCapture(pos({ d: [15, 18] }))).toBe(false);
    expect(hasCapture(pos({ d: [5], l: [9] }))).toBe(true);
    expect(notations(pos({ d: [5], l: [9] }))).toEqual(['5x14']);
    // 12 is on the right edge: the jump from 8 over 12 would land off the board.
    expect(hasCapture(pos({ d: [8], l: [12] }))).toBe(false);
    // Landing square occupied (by either colour) blocks the jump.
    expect(hasCapture(pos({ d: [15, 22], l: [18] }))).toBe(false);
    expect(notations(pos({ d: [15, 22], l: [18] }))).not.toContain('15x22');
    expect(notations(pos({ d: [15], l: [18, 22] }))).toEqual(['15-19']);
  });

  it('men never capture backwards; kings do', () => {
    // Light man on 11 behind the dark man on 15 cannot be taken by that man.
    expect(hasCapture(pos({ d: [15], l: [11] }))).toBe(false);
    expect(notations(pos({ D: [15], l: [11] }))).toEqual(['15x8']);
    expect(notations(pos({ l: [18], d: [22] }, 'light'))).toEqual(['18-14', '18-15']);
    expect(notations(pos({ L: [18], d: [22] }, 'light'))).toEqual(['18x25']);
  });

  it('reports whether a capture is available', () => {
    expect(hasCapture(initialPosition())).toBe(false);
    const p = pos({ d: [15], l: [18] });
    expect(hasCapture(p)).toBe(true);
    expect(legalMoves(p).every(isCapture)).toBe(true);
  });
});

describe('multi-jumps', () => {
  it('must be completed with the same piece', () => {
    const p = pos({ d: [6], l: [10, 19] });
    expect(notations(p)).toEqual(['6x15x24']);
    const [move] = legalMoves(p);
    expect(move!.captures).toEqual([10, 19]);
    // Stopping half-way is illegal.
    expect(resolveMove(legalMoves(p), [6, 15])).toBeNull();
  });

  it('branches into every capture sequence', () => {
    // From 1: over 6 to 10, then over 14 to 17 or over 15 to 19.
    const p = pos({ d: [1], l: [6, 14, 15] });
    expect(notations(p)).toEqual(['1x10x17', '1x10x19']);
    expect(nextSquares(legalMoves(p), [1])).toEqual([10]);
    expect(nextSquares(legalMoves(p), [1, 10])).toEqual([17, 19]);
  });

  it('lets kings capture in every direction within one chain', () => {
    // King on 10: down-right over 15, down-left over 23, up-left over 22, up-right over 14 — back to 10.
    const p = pos({ D: [10], l: [14, 15, 22, 23] });
    const moves = legalMoves(p);
    expect(moves.map(moveNotation).sort()).toEqual(['10x17x26x19x10', '10x19x26x17x10']);
    for (const m of moves) expect([...m.captures].sort((a, b) => a - b)).toEqual([14, 15, 22, 23]);
    // The origin square counts as empty during the chain.
    const after = applyMove(p, moves[0]!);
    expect(cellAt(after.board, 10)).toBe('D');
    expect(material(after.board, 'light').total).toBe(0);
  });

  it('never jumps the same piece twice', () => {
    // King on 10 takes 15 landing on 19; jumping back over 15 to 10 is not allowed.
    const p = pos({ D: [10], l: [15] });
    expect(notations(p)).toEqual(['10x19']);
  });

  it('captures with kings forward and backward in one chain', () => {
    // Dark king on 27: up-left over 23 to 18, then down-left over 22 to 25.
    const p = pos({ D: [27], l: [23, 22] });
    expect(notations(p)).toEqual(['27x18x25']);
  });
});

describe('crowning', () => {
  it('crowns a man that reaches the far row', () => {
    const p = pos({ d: [26] });
    const moves = legalMoves(p);
    expect(moves.map(moveNotation).sort()).toEqual(['26-30', '26-31']);
    expect(moves.every((m) => m.crowned)).toBe(true);
    expect(cellAt(applyMove(p, moves[0]!).board, moveTo(moves[0]!))).toBe('D');
    const light = pos({ l: [7] }, 'light');
    const lm = legalMoves(light);
    expect(lm.every((m) => m.crowned)).toBe(true);
    expect(cellAt(applyMove(light, lm[0]!).board, moveTo(lm[0]!))).toBe('L');
  });

  it('crowns on a capture landing', () => {
    const p = pos({ d: [22], l: [26] });
    const [m] = legalMoves(p);
    expect(moveNotation(m!)).toBe('22x31');
    expect(m!.crowned).toBe(true);
  });

  it('ends the move when a man is crowned mid-chain', () => {
    // 22x31 crowns; as a king it could continue 31x24 over 27, but the move ends on crowning.
    const p = pos({ d: [22], l: [26, 27] });
    expect(notations(p)).toEqual(['22x31']);
    expect(resolveMove(legalMoves(p), [22, 31, 24])).toBeNull();
    const after = applyMove(p, legalMoves(p)[0]!);
    expect(cellAt(after.board, 31)).toBe('D');
    expect(cellAt(after.board, 27)).toBe('l');
    expect(after.turn).toBe('light');
  });

  it('never re-crowns a king', () => {
    const p = pos({ D: [26] });
    expect(legalMoves(p).every((m) => !m.crowned)).toBe(true);
    const k = pos({ D: [30] });
    expect(legalMoves(k).every((m) => !m.crowned)).toBe(true);
  });

  it('continues a king chain across the far row (only men stop there)', () => {
    // Dark king on 22 jumps over 26 to 31 (on the far row) and continues over 27 to 24.
    const p = pos({ D: [22], l: [26, 27] });
    expect(notations(p)).toEqual(['22x31x24']);
  });
});

describe('applyMove', () => {
  it('moves the piece, removes every captured piece and passes the turn', () => {
    const p = pos({ d: [6], l: [10, 19, 32] });
    const m = legalMoves(p)[0]!;
    const after = applyMove(p, m);
    expect(after.turn).toBe('light');
    expect(cellAt(after.board, 6)).toBe('.');
    expect(cellAt(after.board, 10)).toBe('.');
    expect(cellAt(after.board, 19)).toBe('.');
    expect(cellAt(after.board, 24)).toBe('d');
    expect(cellAt(after.board, 32)).toBe('l');
    // Input is not mutated.
    expect(cellAt(p.board, 6)).toBe('d');
  });

  it('throws if there is no piece on the origin', () => {
    const fake: CheckersMove = { path: [13, 17], captures: [], crowned: false };
    expect(() => applyMove(initialPosition(), fake)).toThrow();
  });
});

describe('move lookup helpers', () => {
  const p = fromFen('B:W9,10,17,18:B6');

  it('lists movable pieces and paths by prefix', () => {
    const moves = legalMoves(p);
    // Two routes from 6 to 22: via 13 (over 9, 17) and via 15 (over 10, 18).
    expect(moves.map(moveNotation).sort()).toEqual(['6x13x22', '6x15x22']);
    expect(movableSquares(moves)).toEqual([6]);
    expect(movesWithPrefix(moves, [6])).toHaveLength(2);
    expect(movesWithPrefix(moves, [6, 13])).toHaveLength(1);
    expect(movesWithPrefix(moves, [6, 13, 22, 99])).toHaveLength(0);
    expect(nextSquares(moves, [6])).toEqual([13, 15]);
    expect(nextSquares(moves, [6, 13, 22])).toEqual([]);
  });

  it('resolves exact paths, unique from→to shortcuts, and refuses ambiguity', () => {
    const moves = legalMoves(p);
    expect(moveNotation(resolveMove(moves, [6, 13, 22])!)).toBe('6x13x22');
    expect(moveNotation(resolveMove(moves, [6, 15, 22])!)).toBe('6x15x22');
    expect(resolveMove(moves, [6, 22])).toBeNull(); // two routes
    const single = legalMoves(pos({ d: [6], l: [10, 19] }));
    expect(moveNotation(resolveMove(single, [6, 24])!)).toBe('6x15x24');
  });

  it('rejects malformed paths', () => {
    const moves = legalMoves(initialPosition());
    expect(resolveMove(moves, [])).toBeNull();
    expect(resolveMove(moves, [11])).toBeNull();
    expect(resolveMove(moves, [11, 0])).toBeNull();
    expect(resolveMove(moves, [11, 15.5])).toBeNull();
    expect(resolveMove(moves, [11, 15, 19])).toBeNull();
  });

  it('lists capture sequences from an empty square as none', () => {
    expect(captureSequencesFrom(initialPosition().board, 16)).toEqual([]);
  });
});

describe('perft (move-generation node counts from the start position)', () => {
  function perft(p: Position, depth: number): number {
    if (depth === 0) return 1;
    const moves = legalMoves(p);
    if (depth === 1) return moves.length;
    let n = 0;
    for (const m of moves) n += perft(applyMove(p, m), depth - 1);
    return n;
  }

  it('matches the published English-draughts perft numbers', () => {
    const start = initialPosition();
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => perft(start, d))).toEqual([7, 49, 302, 1469, 7361, 36768, 179740]);
  });
});
