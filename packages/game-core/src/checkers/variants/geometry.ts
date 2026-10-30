/**
 * Board geometry for the draughts variants: N×N boards (8, 10, 12) with the dark squares numbered
 * the standard (PDN) way. The top-left square is light; dark squares are numbered row by row from
 * the top, left to right, so on 10×10 square 1 is the second square of Dark's back row and square
 * 50 is the bottom-left corner. Dark starts at the top (low numbers) and moves down; Light starts
 * at the bottom and moves up. Same layout as the American engine (./board.ts) on 8×8.
 */
import type { Color } from '../board.ts';

export interface BoardGeometry {
  /** Squares along an edge. */
  size: number;
  /** Dark squares per row. */
  half: number;
  /** Playable (dark) squares: size² / 2. */
  squares: number;
  /**
   * For each square (1-based index; [0] unused) and direction 0–3 (see ../board.ts DIRECTIONS:
   * up-left, up-right, down-left, down-right): the squares along that diagonal, nearest first.
   */
  rays: ReadonlyArray<ReadonlyArray<readonly number[]>>;
}

const DIRS: ReadonlyArray<{ dr: number; dc: number }> = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 1 },
];

/** Directions a man moves in (towards the opponent): Dark down, Light up. */
export const FORWARD: Record<Color, readonly number[]> = { dark: [2, 3], light: [0, 1] };
export const ALL_DIRECTIONS: readonly number[] = [0, 1, 2, 3];

const cache = new Map<number, BoardGeometry>();

export function geometryFor(size: number): BoardGeometry {
  const hit = cache.get(size);
  if (hit) return hit;
  if (!Number.isInteger(size) || size < 4 || size % 2 !== 0) throw new RangeError(`Unsupported board size: ${size}`);
  const half = size / 2;
  const squares = size * half;
  const geo: BoardGeometry = { size, half, squares, rays: [] };
  const rays: number[][][] = [[[], [], [], []]];
  for (let sq = 1; sq <= squares; sq++) {
    const { row, col } = squareRC(geo, sq);
    rays.push(
      DIRS.map(({ dr, dc }) => {
        const out: number[] = [];
        for (let k = 1; ; k++) {
          const next = rcSquare(geo, row + dr * k, col + dc * k);
          if (!next) break;
          out.push(next);
        }
        return out;
      }),
    );
  }
  geo.rays = rays;
  cache.set(size, geo);
  return geo;
}

export function isSquareOf(geo: BoardGeometry, sq: unknown): sq is number {
  return typeof sq === 'number' && Number.isInteger(sq) && sq >= 1 && sq <= geo.squares;
}

/** Row (0 = Dark's back row at the top) and column (0 = left) of a square. */
export function squareRC(geo: Pick<BoardGeometry, 'half' | 'squares'>, sq: number): { row: number; col: number } {
  if (!Number.isInteger(sq) || sq < 1 || sq > geo.squares) throw new RangeError(`Not a playable square: ${String(sq)}`);
  const row = Math.floor((sq - 1) / geo.half);
  const idx = (sq - 1) % geo.half;
  return { row, col: idx * 2 + (row % 2 === 0 ? 1 : 0) };
}

/** Square number for a row/column, or 0 for light (unplayable) or off-board squares. */
export function rcSquare(geo: Pick<BoardGeometry, 'size' | 'half'>, row: number, col: number): number {
  const n = geo.size;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= n || col < 0 || col >= n) return 0;
  if ((row + col) % 2 === 0) return 0;
  return row * geo.half + Math.floor(col / 2) + 1;
}

/** The row on which a man of this colour is crowned. */
export function crownRowOf(geo: BoardGeometry, color: Color): number {
  return color === 'dark' ? geo.size - 1 : 0;
}

export function isCrownSquareOf(geo: BoardGeometry, sq: number, color: Color): boolean {
  return squareRC(geo, sq).row === crownRowOf(geo, color);
}

/** The starting board: `rows` rows of men each, Dark at the top. */
export function startingBoard(geo: BoardGeometry, rows: number): string {
  const men = rows * geo.half;
  return 'd'.repeat(men) + '.'.repeat(geo.squares - 2 * men) + 'l'.repeat(men);
}
