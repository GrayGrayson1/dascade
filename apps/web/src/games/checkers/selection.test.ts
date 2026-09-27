import { describe, expect, it } from 'vitest';
import { fromFen, initialPosition, legalMoves, moveNotation } from '@dascade/game-core/checkers';
import { clickSquare, destinationsFor, movablePieces, targetsFor } from './selection.ts';

const movesOf = (fen?: string) => legalMoves(fen ? fromFen(fen) : initialPosition());

describe('checkers move input', () => {
  it('selects a movable piece and shows its landings', () => {
    const moves = movesOf();
    expect([...movablePieces(moves)].sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
    expect(clickSquare(moves, [], 11)).toEqual({ kind: 'select', path: [11] });
    expect(targetsFor(moves, [11])).toEqual([15, 16]);
    expect(clickSquare(moves, [], 1)).toEqual({ kind: 'none' }); // blocked piece
    expect(clickSquare(moves, [], 15)).toEqual({ kind: 'none' }); // empty square
  });

  it('completes a simple move on the landing click', () => {
    const r = clickSquare(movesOf(), [11], 15);
    expect(r.kind === 'move' && moveNotation(r.move)).toBe('11-15');
  });

  it('re-picks another piece or clears the selection', () => {
    const moves = movesOf();
    expect(clickSquare(moves, [11], 10)).toEqual({ kind: 'select', path: [10] });
    expect(clickSquare(moves, [11], 11)).toEqual({ kind: 'clear' });
    expect(clickSquare(moves, [11], 20)).toEqual({ kind: 'clear' });
  });

  it('auto-completes a forced multi-jump from its first landing', () => {
    const moves = movesOf('B:W10,19:B6');
    const r = clickSquare(moves, [6], 15);
    expect(r.kind === 'move' && moveNotation(r.move)).toBe('6x15x24');
    // …or straight from its final destination.
    const direct = clickSquare(moves, [6], 24);
    expect(direct.kind === 'move' && moveNotation(direct.move)).toBe('6x15x24');
  });

  it('asks for the branch when a multi-jump forks', () => {
    const moves = movesOf('B:W6,14,15:B1');
    expect(targetsFor(moves, [1])).toEqual([10]);
    expect(destinationsFor(moves, [1])).toEqual([17, 19]);
    expect(clickSquare(moves, [1], 10)).toEqual({ kind: 'select', path: [1, 10] });
    expect(targetsFor(moves, [1, 10])).toEqual([17, 19]);
    const r = clickSquare(moves, [1, 10], 19);
    expect(r.kind === 'move' && moveNotation(r.move)).toBe('1x10x19');
    // Clicking an end square directly also resolves the unambiguous branch.
    const direct = clickSquare(moves, [1], 17);
    expect(direct.kind === 'move' && moveNotation(direct.move)).toBe('1x10x17');
  });

  it('keeps the selection when two routes end on the same square', () => {
    const moves = movesOf('B:W9,10,17,18:B6');
    expect(clickSquare(moves, [6], 22)).toEqual({ kind: 'select', path: [6] });
    const r = clickSquare(moves, [6], 13);
    expect(r.kind === 'move' && moveNotation(r.move)).toBe('6x13x22');
  });

  it('only offers capturing pieces when a capture is mandatory', () => {
    const moves = movesOf('B:W18,32:B1,15');
    expect([...movablePieces(moves)]).toEqual([15]);
    expect(clickSquare(moves, [], 1)).toEqual({ kind: 'none' });
  });
});
