import { describe, expect, it } from 'vitest';
import { newGame, replay, type TttGame } from '@dascade/game-core/tictactoe';
import type { TttVariant } from '@dascade/shared/games/tictactoe';
import {
  boardLines,
  clickableCells,
  defaultSize,
  linesWithin,
  moveAt,
  navCell,
  navPos,
  navStep,
  ownsTop,
  positionOf,
  previewCells,
  targetCells,
  variantOf,
  type PublicBoard,
} from './position.ts';

function publicOf(game: TttGame, fading: number[] = [-1, -1]): PublicBoard {
  const p = game.position;
  return { variant: p.variant, cells: [...p.cells], turn: p.turn, boards: p.boards, active: p.active, hands: [...p.hands], fading };
}

const pos = (variant: TttVariant, moves: Parameters<typeof replay>[1] = []) => positionOf(publicOf(replay(variant, moves)))!;

describe('positionOf', () => {
  it('builds the engine position from the public state', () => {
    const p = positionOf(publicOf(newGame('ultimate')));
    expect(p?.cells).toHaveLength(81);
    expect(p?.boards).toBe('.........');
  });
  it('waits for the board of the variant', () => {
    expect(
      positionOf({ variant: 'gomoku', cells: Array(9).fill(''), turn: 'first', boards: '', active: -1, hands: [], fading: [] }),
    ).toBeNull();
  });
  it('falls back to Classic for an unknown variant', () => {
    expect(variantOf({ variant: 'nope' })).toBe('classic');
    expect(variantOf(null)).toBe('classic');
  });
});

describe('targets and clicks', () => {
  it('Classic: every empty square', () => {
    const p = pos('classic', [{ cell: 4 }]);
    expect([...targetCells(p, {})].sort()).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(moveAt(p, {}, 4)).toBeNull();
    expect(moveAt(p, {}, 0)).toEqual({ cell: 0 });
  });
  it('Ultimate: only the board you were sent to', () => {
    const p = pos('ultimate', [{ cell: 4 }]);
    expect([...targetCells(p, {})]).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44]);
    expect(moveAt(p, {}, 0)).toBeNull();
  });
  it('Gravity: a click anywhere in a column drops to its bottom', () => {
    const p = pos('gravity');
    expect(clickableCells(p, {}).size).toBe(42);
    expect(targetCells(p, {}).size).toBe(7);
    expect(moveAt(p, {}, 3)).toEqual({ cell: 38 });
  });
  it('Wild: the picked mark goes on the square', () => {
    const p = pos('wild');
    expect(moveAt(p, { mark: 'o' }, 2)).toEqual({ cell: 2, mark: 'o' });
  });
  it('Numbers: needs a number of your own', () => {
    const p = pos('numbers');
    expect(targetCells(p, {}).size).toBe(0);
    expect(moveAt(p, { num: 2 }, 0)).toBeNull();
    expect(moveAt(p, { num: 5 }, 0)).toEqual({ cell: 0, num: 5 });
  });
  it('Nesting: a hand piece, then a board piece', () => {
    const p = pos('nesting', [
      { cell: 4, size: 1 },
      { cell: 0, size: 3 },
    ]);
    expect(defaultSize(p, 'first')).toBe(3);
    expect(ownsTop(p, 'first', 4)).toBe(true);
    expect(ownsTop(p, 'first', 0)).toBe(false);
    // A small piece can't cover O's large one; a large one can cover nothing larger.
    expect(moveAt(p, { size: 1 }, 0)).toBeNull();
    expect(moveAt(p, { size: 3 }, 0)).toBeNull();
    expect(moveAt(p, { size: 3 }, 1)).toEqual({ cell: 1, size: 3 });
    expect(moveAt(p, { from: 4 }, 8)).toEqual({ cell: 8, from: 4, size: 1 });
  });
});

describe('previewCells', () => {
  it('shows the mark before the server confirms it', () => {
    const p = pos('classic');
    expect(previewCells(p, [], { cell: 0 })?.[0]).toBe('x');
    expect(previewCells(p, [], { cell: 9 })).toBeNull();
  });
  it('Vanishing: the oldest mark fades in the preview too', () => {
    const game = replay('vanishing', [{ cell: 0 }, { cell: 3 }, { cell: 1 }, { cell: 4 }, { cell: 8 }, { cell: 6 }]);
    const p = positionOf(publicOf(game))!;
    const cells = previewCells(p, [0, 3], { cell: 2 });
    expect(cells?.[0]).toBe('');
    expect(cells?.[2]).toBe('x');
  });
});

describe('lines to strike', () => {
  it('finds the line through a won game', () => {
    const game = replay('classic', [{ cell: 0 }, { cell: 3 }, { cell: 1 }, { cell: 4 }, { cell: 2 }]);
    expect(linesWithin('classic', game.result!.line)).toEqual([[0, 1, 2]]);
  });
  it('Ultimate: the line that won each small board', () => {
    const game = replay('ultimate', [
      { cell: 0 },
      { cell: 1 },
      { cell: 9 },
      { cell: 2 },
      { cell: 18 },
      { cell: 4 },
      { cell: 36 },
      { cell: 3 },
      { cell: 27 },
      { cell: 5 },
    ]);
    expect(game.position.boards[0]).toBe('o');
    expect(boardLines('ultimate', game.position.cells, game.position.boards)).toEqual([[3, 4, 5]]);
  });
});

describe('keyboard navigation', () => {
  it('Ultimate moves across the 9×9 view', () => {
    expect(navPos('ultimate', 8)).toEqual({ g: 0, x: 2, y: 2 });
    expect(navStep('ultimate', 2, 'ArrowRight')).toBe(9);
    expect(navStep('ultimate', 6, 'ArrowDown')).toBe(27);
    for (let c = 0; c < 81; c++) expect(navCell('ultimate', navPos('ultimate', c))).toBe(c);
  });
  it('Notakto and the cube step from board to board at the edge', () => {
    expect(navStep('notakto', 2, 'ArrowRight')).toBe(9);
    expect(navStep('notakto', 9, 'ArrowLeft')).toBe(2);
    expect(navStep('cube', 3, 'ArrowRight')).toBe(16);
  });
  it('stays on the board', () => {
    expect(navStep('classic', 0, 'ArrowUp')).toBe(0);
    expect(navStep('classic', 0, 'ArrowLeft')).toBe(0);
    expect(navStep('classic', 4, 'Tab')).toBe(4);
  });
});
