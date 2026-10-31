import { describe, expect, it } from 'vitest';
import { cellIndex, newGame, playMove } from '@dascade/game-core/reversi';
import { FLIP_START_MS, FLIP_STEP_MS, cellOf, flipDelays, lineSteps, positionOf, squareIdOf, variantOf } from './position.ts';

describe('reversi client — position', () => {
  it('builds the engine position from the public state, once the board fits the variant', () => {
    const board = newGame('classic').position.board;
    expect(positionOf({ variant: 'classic', board, turn: 'second', supply: [] })).toEqual({
      variant: 'classic',
      board,
      turn: 'second',
      supply: null,
    });
    expect(positionOf({ variant: 'grand', board, turn: 'first', supply: [] })).toBeNull();
    expect(positionOf({ variant: 'original', board: '.'.repeat(64), turn: 'first', supply: [31, 32] })?.supply).toEqual([31, 32]);
    expect(variantOf({ variant: 'nope' })).toBe('classic');
    expect(variantOf(null)).toBe('classic');
  });

  it('maps kit squares (ranks from the bottom) to cells (rows from the top) and back', () => {
    expect(squareIdOf(8, 0, 7)).toBe('0'); // a1, top-left
    expect(squareIdOf(8, 7, 0)).toBe('63'); // h8, bottom-right
    expect(squareIdOf(6, 2, 3)).toBe(String(cellIndex(6, 'c3')));
    for (const size of [6, 8, 10])
      for (let file = 0; file < size; file++)
        for (let rank = 0; rank < size; rank++) {
          const cell = cellOf(size, squareIdOf(size, file, rank));
          expect(cell % size).toBe(file);
          expect(Math.floor(cell / size)).toBe(size - 1 - rank);
        }
    expect(cellOf(8, '64')).toBe(-1);
    expect(cellOf(8, 'x')).toBe(-1);
    expect(cellOf(8, null)).toBe(-1);
  });

  it('staggers flips outward from the placed disc', () => {
    const d3 = cellIndex(8, 'd3');
    expect(lineSteps(8, d3, cellIndex(8, 'd6'), false)).toBe(3);
    expect(lineSteps(8, d3, cellIndex(8, 'g6'), false)).toBe(3);
    expect(lineSteps(8, cellIndex(8, 'a4'), cellIndex(8, 'h4'), true)).toBe(1);
    expect(lineSteps(8, cellIndex(8, 'a4'), cellIndex(8, 'h4'), false)).toBe(7);
    const played = playMove(newGame('classic'), d3);
    if (!played.ok) throw new Error(played.reason);
    const delays = flipDelays('classic', d3, played.ply.flips);
    expect([...delays]).toEqual([[cellIndex(8, 'd4'), FLIP_START_MS]]);
    const far = flipDelays('classic', d3, [cellIndex(8, 'd4'), cellIndex(8, 'd5'), cellIndex(8, 'd6')]);
    expect([...far.values()]).toEqual([FLIP_START_MS, FLIP_START_MS + FLIP_STEP_MS, FLIP_START_MS + 2 * FLIP_STEP_MS]);
    expect(flipDelays('classic', -1, [1]).size).toBe(0);
  });
});
