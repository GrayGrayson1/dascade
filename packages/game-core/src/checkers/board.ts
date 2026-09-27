/**
 * DAS Checkers — board geometry, pieces, positions and notation.
 *
 * Standard American/English checkers (8×8, 32 playable dark squares), numbered the
 * standard way 1–32 as seen in a diagram with Dark at the top and Light at the bottom:
 *
 * ```
 *   row 0   .  1  .  2  .  3  .  4        Dark starts on 1–12 and moves "down"
 *   row 1   5  .  6  .  7  .  8  .        (towards higher numbers); crowned on 29–32.
 *   row 2   .  9  . 10  . 11  . 12
 *   row 3  13  . 14  . 15  . 16  .
 *   row 4   . 17  . 18  . 19  . 20
 *   row 5  21  . 22  . 23  . 24  .
 *   row 6   . 25  . 26  . 27  . 28        Light starts on 21–32 and moves "up";
 *   row 7  29  . 30  . 31  . 32  .        crowned on 1–4.
 * ```
 *
 * A board is a 32-character string (index = square − 1): `.` empty, `d` dark man,
 * `D` dark king, `l` light man, `L` light king. Strings are cheap to copy, compare,
 * hash (repetition detection) and synchronise.
 */

export type Color = 'dark' | 'light';
export type PieceChar = 'd' | 'D' | 'l' | 'L';
export type CellChar = PieceChar | '.';

/** A checkers position: the board plus the side to move. */
export interface Position {
  /** 32 characters, index = square − 1. */
  board: string;
  turn: Color;
}

export const SQUARE_COUNT = 32;
export const EMPTY: CellChar = '.';
/** 12 dark men on 1–12, 8 empty squares, 12 light men on 21–32. */
export const INITIAL_BOARD = 'd'.repeat(12) + '.'.repeat(8) + 'l'.repeat(12);

export function initialPosition(): Position {
  return { board: INITIAL_BOARD, turn: 'dark' };
}

export function opponent(color: Color): Color {
  return color === 'dark' ? 'light' : 'dark';
}

export function isSquare(sq: unknown): sq is number {
  return typeof sq === 'number' && Number.isInteger(sq) && sq >= 1 && sq <= SQUARE_COUNT;
}

export function pieceColor(cell: CellChar | string | undefined): Color | null {
  if (cell === 'd' || cell === 'D') return 'dark';
  if (cell === 'l' || cell === 'L') return 'light';
  return null;
}

export function isKing(cell: CellChar | string | undefined): boolean {
  return cell === 'D' || cell === 'L';
}

export function isMan(cell: CellChar | string | undefined): boolean {
  return cell === 'd' || cell === 'l';
}

export function manOf(color: Color): PieceChar {
  return color === 'dark' ? 'd' : 'l';
}

export function kingOf(color: Color): PieceChar {
  return color === 'dark' ? 'D' : 'L';
}

/** Row (0 = Dark's back rank at the top) and column (0 = left, diagram orientation) of a square. */
export function squareToRC(sq: number): { row: number; col: number } {
  if (!isSquare(sq)) throw new RangeError(`Not a playable square: ${String(sq)}`);
  const row = Math.floor((sq - 1) / 4);
  const idx = (sq - 1) % 4;
  return { row, col: idx * 2 + (row % 2 === 0 ? 1 : 0) };
}

/** Square number for a row/column, or 0 for light (unplayable) or off-board squares. */
export function rcToSquare(row: number, col: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 7 || col < 0 || col > 7) return 0;
  if ((row + col) % 2 === 0) return 0;
  return row * 4 + Math.floor(col / 2) + 1;
}

/** The row on which a man of this colour is crowned. */
export function crownRow(color: Color): number {
  return color === 'dark' ? 7 : 0;
}

export function isCrownSquare(sq: number, color: Color): boolean {
  return squareToRC(sq).row === crownRow(color);
}

/**
 * Diagonal directions: 0 = up-left, 1 = up-right (towards row 0, Light's forward),
 * 2 = down-left, 3 = down-right (towards row 7, Dark's forward).
 */
export const DIRECTIONS: ReadonlyArray<{ dr: number; dc: number }> = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 1 },
];

/** Directions a piece may move/capture in (men forward only, kings all four). */
export function directionsFor(cell: CellChar | string): readonly number[] {
  switch (cell) {
    case 'd':
      return DARK_MAN_DIRS;
    case 'l':
      return LIGHT_MAN_DIRS;
    case 'D':
    case 'L':
      return ALL_DIRS;
    default:
      return NO_DIRS;
  }
}
const DARK_MAN_DIRS = [2, 3] as const;
const LIGHT_MAN_DIRS = [0, 1] as const;
const ALL_DIRS = [0, 1, 2, 3] as const;
const NO_DIRS = [] as const;

/** For each square (1-based index) and direction: the adjacent square and the jump landing (0 = none). */
export const STEP: ReadonlyArray<readonly number[]> = buildTable(1);
export const JUMP: ReadonlyArray<readonly number[]> = buildTable(2);

function buildTable(distance: number): number[][] {
  const table: number[][] = [[0, 0, 0, 0]];
  for (let sq = 1; sq <= SQUARE_COUNT; sq++) {
    const { row, col } = squareToRC(sq);
    table.push(DIRECTIONS.map(({ dr, dc }) => rcToSquare(row + dr * distance, col + dc * distance)));
  }
  return table;
}

/** Square jumped over when moving from `from` to `to` two diagonals away (0 if not a jump shape). */
export function jumpedSquare(from: number, to: number): number {
  if (!isSquare(from) || !isSquare(to)) return 0;
  for (let dir = 0; dir < 4; dir++) {
    if (JUMP[from]![dir] === to) return STEP[from]![dir]!;
  }
  return 0;
}

/** True when `to` is diagonally adjacent to `from`. */
export function isAdjacent(from: number, to: number): boolean {
  if (!isSquare(from) || !isSquare(to)) return false;
  return STEP[from]!.includes(to);
}

export function cellAt(board: string, sq: number): CellChar {
  return (board[sq - 1] ?? EMPTY) as CellChar;
}

export interface Material {
  men: number;
  kings: number;
  total: number;
}

export function material(board: string, color: Color): Material {
  const man = manOf(color);
  const king = kingOf(color);
  let men = 0;
  let kings = 0;
  for (const ch of board) {
    if (ch === man) men++;
    else if (ch === king) kings++;
  }
  return { men, kings, total: men + kings };
}

/** Validates a board string: 32 cells of `.dDlL`, at most 12 pieces a side, no men on their crowning row. */
export function isValidBoard(board: unknown): board is string {
  if (typeof board !== 'string' || board.length !== SQUARE_COUNT) return false;
  if (!/^[.dDlL]{32}$/.test(board)) return false;
  if (material(board, 'dark').total > 12 || material(board, 'light').total > 12) return false;
  for (let sq = 1; sq <= SQUARE_COUNT; sq++) {
    const cell = cellAt(board, sq);
    if (cell === 'd' && isCrownSquare(sq, 'dark')) return false;
    if (cell === 'l' && isCrownSquare(sq, 'light')) return false;
  }
  return true;
}

/** Builds a board from piece lists (handy for tests, puzzles and dev fixtures). */
export function makeBoard(pieces: Partial<Record<PieceChar, readonly number[]>>): string {
  const cells: CellChar[] = Array.from({ length: SQUARE_COUNT }, () => EMPTY);
  for (const [piece, squares] of Object.entries(pieces) as Array<[PieceChar, readonly number[]]>) {
    for (const sq of squares) {
      if (!isSquare(sq)) throw new RangeError(`Not a playable square: ${String(sq)}`);
      if (cells[sq - 1] !== EMPTY) throw new Error(`Square ${sq} is occupied twice`);
      cells[sq - 1] = piece;
    }
  }
  return cells.join('');
}

/** Stable key for repetition detection (same board + same side to move). */
export function positionKey(pos: Position): string {
  return `${pos.turn === 'dark' ? 'B' : 'W'}:${pos.board}`;
}

// ---------------------------------------------------------------------------
// PDN FEN ("B:W21,22,K30:B1,2,K3") — Black = Dark, White = Light.
// ---------------------------------------------------------------------------

export function toFen(pos: Position): string {
  const list = (color: Color) => {
    const out: string[] = [];
    for (let sq = 1; sq <= SQUARE_COUNT; sq++) {
      const cell = cellAt(pos.board, sq);
      if (pieceColor(cell) === color) out.push(isKing(cell) ? `K${sq}` : String(sq));
    }
    return out.join(',');
  };
  return `${pos.turn === 'dark' ? 'B' : 'W'}:W${list('light')}:B${list('dark')}`;
}

export function fromFen(fen: string): Position {
  const parts = fen.trim().replace(/\.$/, '').split(':');
  const side = parts[0]?.trim().toUpperCase();
  if ((side !== 'B' && side !== 'W') || parts.length !== 3) throw new Error(`Invalid FEN: ${fen}`);
  const cells: CellChar[] = Array.from({ length: SQUARE_COUNT }, () => EMPTY);
  for (const part of parts.slice(1)) {
    const colorCode = part.trim()[0]?.toUpperCase();
    if (colorCode !== 'B' && colorCode !== 'W') throw new Error(`Invalid FEN: ${fen}`);
    const color: Color = colorCode === 'B' ? 'dark' : 'light';
    const body = part.trim().slice(1);
    if (!body) continue;
    for (const raw of body.split(',')) {
      const token = raw.trim().toUpperCase();
      const king = token.startsWith('K');
      const sq = Number(king ? token.slice(1) : token);
      if (!isSquare(sq) || cells[sq - 1] !== EMPTY) throw new Error(`Invalid FEN square "${raw}": ${fen}`);
      cells[sq - 1] = king ? kingOf(color) : manOf(color);
    }
  }
  const board = cells.join('');
  if (!isValidBoard(board)) throw new Error(`Invalid FEN position: ${fen}`);
  return { board, turn: side === 'B' ? 'dark' : 'light' };
}
