import { describe, expect, it } from 'vitest';
import { TTT_VARIANTS, tttCellCount } from '@dascade/shared/games/tictactoe';
import { META_LINES, cubeLines, gridLines, indexLines, linesOf } from './index.ts';

const sorted = (line: number[]) => [...line].sort((a, b) => a - b);
const has = (lines: number[][], line: number[]) => lines.some((l) => sorted(l).join() === sorted(line).join());

describe('gridLines', () => {
  it('finds the 8 lines of a 3×3 board', () => {
    const lines = gridLines(3, 3, 3);
    expect(lines).toHaveLength(8);
    for (const line of [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ])
      expect(has(lines, line)).toBe(true);
  });

  it('counts every run of k on bigger boards', () => {
    expect(gridLines(5, 5, 4)).toHaveLength(28); // 10 across, 10 down, 4 + 4 diagonals
    expect(gridLines(15, 15, 5)).toHaveLength(572); // 165 + 165 + 121 + 121
    expect(gridLines(7, 6, 4)).toHaveLength(69); // the familiar connect-four count
    expect(gridLines(6, 6, 5)).toHaveLength(32);
  });

  it('keeps every line straight and inside the board', () => {
    for (const [cols, rows, k] of [
      [3, 3, 3],
      [5, 5, 4],
      [7, 6, 4],
      [6, 6, 5],
      [15, 15, 5],
    ] as const) {
      for (const line of gridLines(cols, rows, k)) {
        expect(line).toHaveLength(k);
        const rc = line.map((c) => [Math.floor(c / cols), c % cols] as const);
        const dr = rc[1]![0] - rc[0]![0];
        const dc = rc[1]![1] - rc[0]![1];
        expect(Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && (dr !== 0 || dc !== 0)).toBe(true);
        rc.forEach(([r, c], i) => {
          expect(r).toBe(rc[0]![0] + i * dr);
          expect(c).toBe(rc[0]![1] + i * dc);
          expect(r >= 0 && r < rows && c >= 0 && c < cols).toBe(true);
        });
      }
    }
  });

  it('offsets cells by a base (small boards)', () => {
    expect(gridLines(3, 3, 3, 18)[0]).toEqual([18, 19, 20]);
  });
});

describe('cubeLines', () => {
  const lines = cubeLines(4);
  it('finds the 76 lines of a 4×4×4 cube', () => {
    expect(lines).toHaveLength(76);
    expect(new Set(lines.map((l) => sorted(l).join())).size).toBe(76);
  });
  it('includes straight-down verticals, layer lines and the four space diagonals', () => {
    expect(has(lines, [0, 16, 32, 48])).toBe(true); // straight down through the layers
    expect(has(lines, [5, 21, 37, 53])).toBe(true);
    expect(has(lines, [0, 1, 2, 3])).toBe(true); // a row in the top layer
    expect(has(lines, [48, 53, 58, 63])).toBe(true); // a diagonal in the bottom layer
    expect(has(lines, [0, 21, 42, 63])).toBe(true); // space diagonals
    expect(has(lines, [3, 22, 41, 60])).toBe(true);
    expect(has(lines, [12, 25, 38, 51])).toBe(true);
    expect(has(lines, [15, 26, 37, 48])).toBe(true);
    expect(has(lines, [0, 20, 40, 60])).toBe(true); // a diagonal down through a vertical slice
  });
  it('does not join cells that are not in a straight line', () => {
    expect(has(lines, [0, 1, 2, 4])).toBe(false);
    expect(has(lines, [3, 4, 5, 6])).toBe(false); // wraps a row edge
  });
});

describe('linesOf', () => {
  it('indexes the lines through each cell', () => {
    const set = linesOf('classic');
    expect(set.through[4]).toHaveLength(4); // centre
    expect(set.through[0]).toHaveLength(3); // corner
    expect(set.through[1]).toHaveLength(2); // edge
  });

  it('gives each variant lines inside its own board', () => {
    const counts: Partial<Record<(typeof TTT_VARIANTS)[number], number>> = {
      classic: 8,
      bigboard: 28,
      gomoku: 572,
      gravity: 69,
      orderchaos: 32,
      ultimate: 72,
      notakto: 24,
      cube: 76,
    };
    for (const variant of TTT_VARIANTS) {
      const set = linesOf(variant);
      const cells = tttCellCount(variant);
      expect(set.through).toHaveLength(cells);
      for (const line of set.lines) for (const c of line) expect(c >= 0 && c < cells).toBe(true);
      if (counts[variant] !== undefined) expect(set.lines).toHaveLength(counts[variant]!);
    }
  });

  it('keeps small-board lines inside their board (Ultimate, Notakto)', () => {
    for (const variant of ['ultimate', 'notakto'] as const) {
      for (const line of linesOf(variant).lines) {
        const boards = new Set(line.map((c) => Math.floor(c / 9)));
        expect(boards.size).toBe(1);
      }
    }
  });

  it('caches the line set per variant', () => {
    expect(linesOf('gomoku')).toBe(linesOf('gomoku'));
  });

  it('has the 8 lines of small boards on the big board', () => {
    expect(META_LINES.lines).toHaveLength(8);
    expect(META_LINES.through[4]).toHaveLength(4);
  });

  it('indexLines lists every line under each of its cells', () => {
    const set = indexLines(
      [
        [0, 1],
        [1, 2],
      ],
      3,
    );
    expect(set.through).toEqual([[0], [0, 1], [1]]);
  });
});
