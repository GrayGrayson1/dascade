/**
 * Winning lines of the tic-tac-toe boards: every run of `k` cells across, down or diagonal on a
 * grid, and every straight line through a cube. Lines are cell lists; `through[cell]` indexes the
 * lines that pass a cell so a move only checks its own lines.
 */
import { TTT_VARIANT_INFO, tttCellCount, type TttVariant } from '@dascade/shared/games/tictactoe';

export interface LineSet {
  lines: number[][];
  /** Indices into `lines` of the lines through each cell. */
  through: number[][];
}

/** Runs of `k` cells on a `cols` × `rows` grid (row-major, 0 = top-left), offset by `base`. */
export function gridLines(cols: number, rows: number, k: number, base = 0): number[][] {
  const out: number[][] = [];
  const dirs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of dirs) {
        const er = r + (k - 1) * dr;
        const ec = c + (k - 1) * dc;
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        const line: number[] = [];
        for (let i = 0; i < k; i++) line.push(base + (r + i * dr) * cols + (c + i * dc));
        out.push(line);
      }
    }
  }
  return out;
}

/** Straight lines of `k` cells through an `n`×`n`×`n` cube (cell = layer × n² + row × n + column). */
export function cubeLines(n: number, k = n): number[][] {
  const out: number[][] = [];
  const dirs: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        // One direction of each opposite pair: the first non-zero component is positive.
        const first = dz !== 0 ? dz : dy !== 0 ? dy : dx;
        if (first > 0) dirs.push([dz, dy, dx]);
      }
    }
  }
  const inside = (v: number) => v >= 0 && v < n;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (const [dz, dy, dx] of dirs) {
          if (!inside(z + (k - 1) * dz) || !inside(y + (k - 1) * dy) || !inside(x + (k - 1) * dx)) continue;
          const line: number[] = [];
          for (let i = 0; i < k; i++) line.push((z + i * dz) * n * n + (y + i * dy) * n + (x + i * dx));
          out.push(line);
        }
      }
    }
  }
  return out;
}

export function indexLines(lines: number[][], cells: number): LineSet {
  const through: number[][] = Array.from({ length: cells }, () => []);
  lines.forEach((line, i) => {
    for (const cell of line) through[cell]!.push(i);
  });
  return { lines, through };
}

const cache = new Map<TttVariant, LineSet>();

/**
 * The cell lines of a variant. Ultimate and Notakto: the lines of each small board (cells
 * board × 9 + local). The cube: its 76 lines.
 */
export function linesOf(variant: TttVariant): LineSet {
  const hit = cache.get(variant);
  if (hit) return hit;
  const v = TTT_VARIANT_INFO[variant];
  let lines: number[][];
  if (v.layout === 'layers') lines = cubeLines(v.cols, v.inARow);
  else if (v.layout === 'boards') {
    lines = [];
    for (let b = 0; b < v.count; b++) lines.push(...gridLines(v.cols, v.rows, v.inARow, b * v.cols * v.rows));
  } else lines = gridLines(v.cols, v.rows, v.inARow);
  const set = indexLines(lines, tttCellCount(variant));
  cache.set(variant, set);
  return set;
}

/** Ultimate: lines of small boards (0–8) on the big board. */
export const META_LINES: LineSet = indexLines(gridLines(3, 3, 3), 9);
