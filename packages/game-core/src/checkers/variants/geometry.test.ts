import { describe, expect, it } from 'vitest';
import { CHECKERS_VARIANTS, CHECKERS_VARIANT_INFO } from '@dascade/shared/games/checkers';
import { JUMP, STEP, rcToSquare, squareToRC, INITIAL_BOARD } from '../board.ts';
import { crownRowOf, geometryFor, isCrownSquareOf, rcSquare, squareRC, startingBoard } from './geometry.ts';
import { rulesFor } from './rules.ts';

describe('board geometry', () => {
  it('matches the American engine on 8×8', () => {
    const geo = geometryFor(8);
    expect(geo.squares).toBe(32);
    for (let sq = 1; sq <= 32; sq++) {
      expect(squareRC(geo, sq)).toEqual(squareToRC(sq));
      for (let dir = 0; dir < 4; dir++) {
        expect(geo.rays[sq]![dir]![0] ?? 0).toBe(STEP[sq]![dir]);
        expect(geo.rays[sq]![dir]![1] ?? 0).toBe(JUMP[sq]![dir]);
      }
    }
    for (let r = -1; r <= 8; r++) for (let c = -1; c <= 8; c++) expect(rcSquare(geo, r, c)).toBe(rcToSquare(r, c));
    expect(startingBoard(geo, 3)).toBe(INITIAL_BOARD);
  });

  it('numbers 10×10 the PDN way (square 1 top, 46 bottom-left, long diagonal 46–5)', () => {
    const geo = geometryFor(10);
    expect(geo.squares).toBe(50);
    expect(squareRC(geo, 1)).toEqual({ row: 0, col: 1 });
    expect(squareRC(geo, 5)).toEqual({ row: 0, col: 9 });
    expect(squareRC(geo, 6)).toEqual({ row: 1, col: 0 });
    expect(squareRC(geo, 46)).toEqual({ row: 9, col: 0 });
    expect(squareRC(geo, 50)).toEqual({ row: 9, col: 8 });
    expect(rcSquare(geo, 0, 0)).toBe(0); // top-left is light
    expect([46, ...geo.rays[46]![1]!]).toEqual([46, 41, 37, 32, 28, 23, 19, 14, 10, 5]);
  });

  it('numbers 12×12 1–72', () => {
    const geo = geometryFor(12);
    expect(geo.squares).toBe(72);
    expect(squareRC(geo, 1)).toEqual({ row: 0, col: 1 });
    expect(squareRC(geo, 67)).toEqual({ row: 11, col: 0 });
    expect(squareRC(geo, 72)).toEqual({ row: 11, col: 10 });
    expect(geo.rays[67]![1]).toHaveLength(11);
  });

  it('round-trips every square and knows the crowning rows', () => {
    for (const size of [8, 10, 12]) {
      const geo = geometryFor(size);
      for (let sq = 1; sq <= geo.squares; sq++) {
        const { row, col } = squareRC(geo, sq);
        expect(rcSquare(geo, row, col)).toBe(sq);
      }
      expect(crownRowOf(geo, 'dark')).toBe(size - 1);
      expect(isCrownSquareOf(geo, 1, 'light')).toBe(true);
      expect(isCrownSquareOf(geo, geo.squares, 'dark')).toBe(true);
    }
  });

  it('sets up every variant with its men on the dark squares nearest each player', () => {
    for (const variant of CHECKERS_VARIANTS) {
      const info = CHECKERS_VARIANT_INFO[variant];
      const rules = rulesFor(variant);
      expect(rules.size).toBe(info.size);
      const board = startingBoard(geometryFor(rules.size), rules.rows);
      expect(board).toHaveLength((info.size * info.size) / 2);
      expect([...board].filter((c) => c === 'd')).toHaveLength(info.pieces);
      expect([...board].filter((c) => c === 'l')).toHaveLength(info.pieces);
      expect(board.slice(0, info.pieces)).toBe('d'.repeat(info.pieces));
    }
  });

  it('rejects odd or tiny board sizes', () => {
    expect(() => geometryFor(9)).toThrow(RangeError);
    expect(() => squareRC(geometryFor(10), 51)).toThrow(RangeError);
  });
});
