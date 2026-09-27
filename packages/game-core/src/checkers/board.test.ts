import { describe, expect, it } from 'vitest';
import {
  INITIAL_BOARD,
  JUMP,
  STEP,
  cellAt,
  crownRow,
  directionsFor,
  fromFen,
  initialPosition,
  isAdjacent,
  isCrownSquare,
  isKing,
  isMan,
  isSquare,
  isValidBoard,
  jumpedSquare,
  makeBoard,
  material,
  opponent,
  pieceColor,
  positionKey,
  rcToSquare,
  squareToRC,
  toFen,
} from './index.ts';

describe('board geometry', () => {
  it('numbers the 32 dark squares in standard order (1 top-left … 32 bottom-right)', () => {
    expect(squareToRC(1)).toEqual({ row: 0, col: 1 });
    expect(squareToRC(4)).toEqual({ row: 0, col: 7 });
    expect(squareToRC(5)).toEqual({ row: 1, col: 0 });
    expect(squareToRC(8)).toEqual({ row: 1, col: 6 });
    expect(squareToRC(15)).toEqual({ row: 3, col: 4 });
    expect(squareToRC(29)).toEqual({ row: 7, col: 0 });
    expect(squareToRC(32)).toEqual({ row: 7, col: 6 });
  });

  it('round-trips every square and only uses dark squares', () => {
    const seen = new Set<string>();
    for (let sq = 1; sq <= 32; sq++) {
      const { row, col } = squareToRC(sq);
      expect((row + col) % 2).toBe(1);
      expect(rcToSquare(row, col)).toBe(sq);
      seen.add(`${row},${col}`);
    }
    expect(seen.size).toBe(32);
  });

  it('returns 0 for light squares and off-board coordinates', () => {
    expect(rcToSquare(0, 0)).toBe(0);
    expect(rcToSquare(7, 7)).toBe(0);
    expect(rcToSquare(-1, 1)).toBe(0);
    expect(rcToSquare(8, 1)).toBe(0);
    expect(rcToSquare(2, 8)).toBe(0);
    expect(rcToSquare(1.5, 2)).toBe(0);
  });

  it('rejects non-squares', () => {
    for (const bad of [0, 33, -1, 1.5, NaN, '5', null]) expect(isSquare(bad)).toBe(false);
    expect(() => squareToRC(0)).toThrow(RangeError);
    expect(() => squareToRC(33)).toThrow(RangeError);
  });

  it('precomputes diagonal neighbours and jump landings', () => {
    // Directions: up-left, up-right, down-left, down-right.
    expect(STEP[11]).toEqual([7, 8, 15, 16]);
    expect(JUMP[11]).toEqual([2, 4, 18, 20]);
    expect(STEP[5]).toEqual([0, 1, 0, 9]);
    expect(JUMP[5]).toEqual([0, 0, 0, 14]);
    expect(STEP[4]).toEqual([0, 0, 8, 0]);
    expect(STEP[29]).toEqual([0, 25, 0, 0]);
    expect(JUMP[32]).toEqual([23, 0, 0, 0]);
    // Symmetry: if b is a's neighbour in a direction, a is b's neighbour in the opposite one.
    for (let sq = 1; sq <= 32; sq++) {
      for (let dir = 0; dir < 4; dir++) {
        const n = STEP[sq]![dir]!;
        if (n) expect(STEP[n]![3 - dir]).toBe(sq);
        const j = JUMP[sq]![dir]!;
        if (j) {
          expect(n).toBeGreaterThan(0);
          expect(JUMP[j]![3 - dir]).toBe(sq);
        }
      }
    }
  });

  it('identifies jumped squares and adjacency', () => {
    expect(jumpedSquare(15, 22)).toBe(18);
    expect(jumpedSquare(22, 15)).toBe(18);
    expect(jumpedSquare(11, 18)).toBe(15);
    expect(jumpedSquare(11, 15)).toBe(0);
    expect(jumpedSquare(1, 32)).toBe(0);
    expect(jumpedSquare(0, 9)).toBe(0);
    expect(isAdjacent(11, 15)).toBe(true);
    expect(isAdjacent(11, 16)).toBe(true);
    expect(isAdjacent(11, 12)).toBe(false);
    expect(isAdjacent(11, 18)).toBe(false);
    expect(isAdjacent(99, 1)).toBe(false);
  });

  it('knows crowning rows and piece directions', () => {
    expect(crownRow('dark')).toBe(7);
    expect(crownRow('light')).toBe(0);
    for (const sq of [29, 30, 31, 32]) expect(isCrownSquare(sq, 'dark')).toBe(true);
    for (const sq of [1, 2, 3, 4]) expect(isCrownSquare(sq, 'light')).toBe(true);
    expect(isCrownSquare(28, 'dark')).toBe(false);
    expect(isCrownSquare(5, 'light')).toBe(false);
    expect(directionsFor('d')).toEqual([2, 3]);
    expect(directionsFor('l')).toEqual([0, 1]);
    expect(directionsFor('D')).toEqual([0, 1, 2, 3]);
    expect(directionsFor('L')).toEqual([0, 1, 2, 3]);
    expect(directionsFor('.')).toEqual([]);
  });

  it('classifies pieces', () => {
    expect(pieceColor('d')).toBe('dark');
    expect(pieceColor('D')).toBe('dark');
    expect(pieceColor('l')).toBe('light');
    expect(pieceColor('L')).toBe('light');
    expect(pieceColor('.')).toBeNull();
    expect(pieceColor(undefined)).toBeNull();
    expect(isKing('D') && isKing('L')).toBe(true);
    expect(isKing('d') || isKing('.')).toBe(false);
    expect(isMan('d') && isMan('l')).toBe(true);
    expect(isMan('D')).toBe(false);
    expect(opponent('dark')).toBe('light');
    expect(opponent('light')).toBe('dark');
  });
});

describe('positions', () => {
  it('starts with 12 dark men on 1–12, light men on 21–32 and Dark to move', () => {
    const pos = initialPosition();
    expect(pos.turn).toBe('dark');
    expect(pos.board).toBe(INITIAL_BOARD);
    for (let sq = 1; sq <= 12; sq++) expect(cellAt(pos.board, sq)).toBe('d');
    for (let sq = 13; sq <= 20; sq++) expect(cellAt(pos.board, sq)).toBe('.');
    for (let sq = 21; sq <= 32; sq++) expect(cellAt(pos.board, sq)).toBe('l');
    expect(material(pos.board, 'dark')).toEqual({ men: 12, kings: 0, total: 12 });
    expect(material(pos.board, 'light')).toEqual({ men: 12, kings: 0, total: 12 });
  });

  it('builds boards from piece lists and rejects double occupancy', () => {
    const board = makeBoard({ d: [1, 2], D: [18], l: [30], L: [3] });
    expect(cellAt(board, 1)).toBe('d');
    expect(cellAt(board, 18)).toBe('D');
    expect(cellAt(board, 30)).toBe('l');
    expect(cellAt(board, 3)).toBe('L');
    expect(material(board, 'dark')).toEqual({ men: 2, kings: 1, total: 3 });
    expect(() => makeBoard({ d: [1], l: [1] })).toThrow();
    expect(() => makeBoard({ d: [33] })).toThrow(RangeError);
  });

  it('validates boards', () => {
    expect(isValidBoard(INITIAL_BOARD)).toBe(true);
    expect(isValidBoard(makeBoard({}))).toBe(true);
    expect(isValidBoard(INITIAL_BOARD.slice(1))).toBe(false);
    expect(isValidBoard(`x${INITIAL_BOARD.slice(1)}`)).toBe(false);
    expect(isValidBoard(42)).toBe(false);
    // A dark man can never stand on Dark's crowning row (29–32), nor a light man on 1–4.
    expect(isValidBoard(makeBoard({ d: [30] }))).toBe(false);
    expect(isValidBoard(makeBoard({ l: [2] }))).toBe(false);
    expect(isValidBoard(makeBoard({ D: [30], L: [2] }))).toBe(true);
    // More than 12 pieces a side is impossible.
    expect(isValidBoard(makeBoard({ d: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }))).toBe(false);
  });

  it('keys positions by board and side to move', () => {
    const a = positionKey({ board: INITIAL_BOARD, turn: 'dark' });
    const b = positionKey({ board: INITIAL_BOARD, turn: 'light' });
    expect(a).not.toBe(b);
    expect(a).toBe(positionKey(initialPosition()));
  });

  it('reads and writes PDN FEN', () => {
    expect(toFen(initialPosition())).toBe('B:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,11,12');
    const pos = fromFen('W:W18,24,K10:B12,16,K22');
    expect(pos.turn).toBe('light');
    expect(cellAt(pos.board, 18)).toBe('l');
    expect(cellAt(pos.board, 10)).toBe('L');
    expect(cellAt(pos.board, 16)).toBe('d');
    expect(cellAt(pos.board, 22)).toBe('D');
    expect(fromFen(toFen(pos))).toEqual(pos);
    expect(fromFen('B:W:B1.')).toEqual({ board: makeBoard({ d: [1] }), turn: 'dark' });
  });

  it('rejects malformed FEN', () => {
    expect(() => fromFen('X:W1:B2')).toThrow();
    expect(() => fromFen('B:W1')).toThrow();
    expect(() => fromFen('B:W40:B2')).toThrow();
    expect(() => fromFen('B:W1:B1')).toThrow();
    expect(() => fromFen('B:W2:B30')).toThrow(); // dark man on its crowning row
    expect(() => fromFen('B:Q1:B2')).toThrow();
  });
});
