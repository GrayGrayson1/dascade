/**
 * DAS Reversi rules for every variant (see REVERSI_VARIANT_INFO for the player-facing rules).
 *
 *  - A `ReversiPosition` decides which moves are legal: the board string, the side to move and, in
 *    Original, the discs each side has left. The client builds one from the public state for its
 *    hints and its optimistic preview.
 *  - `playMove` validates a placement, flips the trapped discs, then settles the turn: the opponent
 *    moves next if they can; otherwise their turn is skipped (a 'pass' ply) when the mover can go
 *    again; otherwise the game is over and the disc count decides. It never mutates its input.
 *  - `fromPlies` rebuilds a game from its plies (take-backs, records); passes are explicit there.
 *  - The random setups (Blockers' squares, Random Start's opening) take an injected `Rng`.
 *
 * Side 'first' is Black ('b'), 'second' White ('w'). Cells are numbered row by row from the
 * top-left; '#' marks a square out of play (Octagon's corners, Blockers).
 */
import type { Rng } from '@dascade/shared';
import { otherSide, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  REVERSI_BLOCKERS,
  REVERSI_CELL,
  REVERSI_RANDOM_PLIES,
  REVERSI_REASONS,
  REVERSI_VARIANT_INFO,
  type ReversiVariant,
} from '@dascade/shared/games/reversi';

export type Disc = 'b' | 'w';

const EMPTY = REVERSI_CELL.empty;
const HOLE = REVERSI_CELL.hole;
const FILES = 'abcdefghijklmnopqrstuvwxyz';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export interface ReversiPosition {
  variant: ReversiVariant;
  /** size² characters: '.' empty, 'b' / 'w' discs, '#' out of play. */
  board: string;
  turn: BoardSide;
  /** Original: discs left to place [first, second]; null = as many as the board takes. */
  supply: readonly [number, number] | null;
}

export interface ReversiPly {
  side: BoardSide;
  /** Where the disc went (-1 = a skipped turn). */
  cell: number;
  /** Discs that flipped. */
  flips: number[];
  notation: string;
}

export interface ReversiResult {
  /** null = draw. */
  winner: BoardSide | null;
  reason: string;
  /** Disc counts [first, second]. */
  score: [number, number];
}

export interface ReversiGame {
  variant: ReversiVariant;
  /** The first position (Blockers / Random Start: the drawn setup). */
  start: ReversiPosition;
  position: ReversiPosition;
  plies: ReversiPly[];
  result: ReversiResult | null;
}

/** Why a placement was refused. */
export type ReversiRefusal = 'over' | 'off_board' | 'occupied' | 'hole' | 'centre' | 'no_flip' | 'no_discs';

export type PlayResult =
  | {
      ok: true;
      game: ReversiGame;
      /** The placement. */
      ply: ReversiPly;
      /** The side whose turn was skipped right after it (null = none). */
      passed: BoardSide | null;
    }
  | { ok: false; reason: ReversiRefusal };

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function discOf(side: BoardSide): Disc {
  return side === 'first' ? 'b' : 'w';
}

export function sideOfDisc(token: string | undefined): BoardSide | null {
  return token === 'b' ? 'first' : token === 'w' ? 'second' : null;
}

export function sizeOf(variant: ReversiVariant): number {
  return REVERSI_VARIANT_INFO[variant].size;
}

/** "d3": column letter, then the row counted from the top. */
export function cellName(size: number, cell: number): string {
  return `${FILES[cell % size]}${Math.floor(cell / size) + 1}`;
}

/** The cell of a name like "d3" (-1 if it isn't on a board of that size). */
export function cellIndex(size: number, name: string): number {
  const m = /^([a-z])(\d{1,2})$/.exec(name.trim().toLowerCase());
  if (!m) return -1;
  const col = FILES.indexOf(m[1]!);
  const row = Number(m[2]) - 1;
  return col < size && row >= 0 && row < size ? row * size + col : -1;
}

/** Disc counts [first (Black), second (White)]. */
export function discCounts(board: string): [number, number] {
  let b = 0;
  let w = 0;
  for (const ch of board) {
    if (ch === 'b') b++;
    else if (ch === 'w') w++;
  }
  return [b, w];
}

/** The four centre squares (top-left, top-right, bottom-left, bottom-right). */
export function centreCells(size: number): [number, number, number, number] {
  const a = size / 2 - 1;
  const b = size / 2;
  return [a * size + a, a * size + b, b * size + a, b * size + b];
}

/** Original: the first four discs still go on the centre squares. */
export function inOpening(position: ReversiPosition): boolean {
  if (REVERSI_VARIANT_INFO[position.variant].start !== 'empty') return false;
  const [b, w] = discCounts(position.board);
  return b + w < 4;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Octagon: the three squares at each corner (the corner and its two edge neighbours). */
export function cornerHoles(size: number): number[] {
  const last = size - 1;
  const at = (r: number, c: number) => r * size + c;
  return [
    at(0, 0),
    at(0, 1),
    at(1, 0),
    at(0, last - 1),
    at(0, last),
    at(1, last),
    at(last - 1, 0),
    at(last, 0),
    at(last, 1),
    at(last - 1, last),
    at(last, last - 1),
    at(last, last),
  ].sort((x, y) => x - y);
}

/**
 * The variant's first board. `holes` adds squares out of play (Blockers' drawn squares); Random
 * Start's opening is played on top of it by `randomOpening`.
 */
export function startBoard(variant: ReversiVariant, holes: readonly number[] = []): string {
  const info = REVERSI_VARIANT_INFO[variant];
  const size = info.size;
  const cells: string[] = new Array<string>(size * size).fill(EMPTY);
  const out = info.holes === 'corners' ? cornerHoles(size) : holes;
  for (const h of out) if (h >= 0 && h < cells.length) cells[h] = HOLE;
  const [tl, tr, bl, br] = centreCells(size);
  if (info.start === 'diagonal' || info.start === 'random') {
    cells[tl] = 'w';
    cells[tr] = 'b';
    cells[bl] = 'b';
    cells[br] = 'w';
  } else if (info.start === 'parallel') {
    cells[tl] = 'w';
    cells[tr] = 'w';
    cells[bl] = 'b';
    cells[br] = 'b';
  }
  return cells.join('');
}

/**
 * Blockers: two random squares outside the centre 4×4 and their mirror images through the centre
 * (a half turn), so neither colour is favoured by where the blocks fall.
 */
export function randomBlockers(variant: ReversiVariant, rng: Rng): number[] {
  const size = sizeOf(variant);
  const lo = size / 2 - 2;
  const hi = size / 2 + 1;
  const mirror = (cell: number) => size * size - 1 - cell;
  let pool: number[] = [];
  for (let cell = 0; cell < size * size; cell++) {
    const r = Math.floor(cell / size);
    const c = cell % size;
    if (r >= lo && r <= hi && c >= lo && c <= hi) continue;
    pool.push(cell);
  }
  const out: number[] = [];
  for (let i = 0; i < REVERSI_BLOCKERS / 2 && pool.length > 0; i++) {
    const pick = pool[rng.int(pool.length)]!;
    out.push(pick, mirror(pick));
    pool = pool.filter((c) => c !== pick && c !== mirror(pick));
  }
  return out.sort((x, y) => x - y);
}

/** Random Start: the usual start with REVERSI_RANDOM_PLIES random legal moves played (Black to move). */
export function randomOpening(variant: ReversiVariant, rng: Rng): string {
  let position = startPosition(variant);
  for (let i = 0; i < REVERSI_RANDOM_PLIES; i++) {
    const moves = legalMoves(position);
    if (moves.length === 0) break;
    position = applyPlacement(position, moves[rng.int(moves.length)]!)!.position;
  }
  return position.board;
}

/** The drawn first board of the random variants (undefined for the others). */
export function randomSetup(variant: ReversiVariant, rng: Rng): string | undefined {
  const info = REVERSI_VARIANT_INFO[variant];
  if (info.holes === 'random') return startBoard(variant, randomBlockers(variant, rng));
  if (info.start === 'random') return randomOpening(variant, rng);
  return undefined;
}

/** The first position: the variant's start, or a given board (a drawn setup). Black moves first. */
export function startPosition(variant: ReversiVariant, board?: string): ReversiPosition {
  const info = REVERSI_VARIANT_INFO[variant];
  const b = board ?? startBoard(variant);
  if (b.length !== info.size * info.size) throw new Error(`reversi: a ${variant} board has ${info.size * info.size} squares`);
  let supply: [number, number] | null = null;
  if (info.supply > 0) {
    const [black, white] = discCounts(b);
    supply = [Math.max(0, info.supply - black), Math.max(0, info.supply - white)];
  }
  return { variant, board: b, turn: 'first', supply };
}

export function newGame(variant: ReversiVariant, board?: string): ReversiGame {
  const start = startPosition(variant, board);
  return { variant, start, position: start, plies: [], result: null };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/** Discs the side to move would flip by placing on `cell` ([] if it flips nothing or can't go there). */
export function flipsAt(position: ReversiPosition, cell: number): number[] {
  const { board, variant } = position;
  const info = REVERSI_VARIANT_INFO[variant];
  const size = info.size;
  if (cell < 0 || cell >= board.length || board[cell] !== EMPTY) return [];
  const me = discOf(position.turn);
  const them = discOf(otherSide(position.turn));
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const out = new Set<number>();
  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let r = r0;
    let c = c0;
    // A wrapped line meets itself again after `size` steps: never walk that far.
    for (let i = 0; i < size - 1; i++) {
      r += dr;
      c += dc;
      if (info.wrap) {
        r = (r + size) % size;
        c = (c + size) % size;
      } else if (r < 0 || c < 0 || r >= size || c >= size) break;
      const at = r * size + c;
      const token = board[at];
      if (token === them) {
        line.push(at);
        continue;
      }
      if (token === me) for (const x of line) out.add(x);
      break;
    }
  }
  return [...out].sort((x, y) => x - y);
}

function hasDiscs(position: ReversiPosition): boolean {
  return !position.supply || position.supply[position.turn === 'first' ? 0 : 1] > 0;
}

/** Cells the side to move may place on, in board order. */
export function legalMoves(position: ReversiPosition): number[] {
  if (!hasDiscs(position)) return [];
  if (inOpening(position)) {
    const size = sizeOf(position.variant);
    return centreCells(size)
      .filter((c) => position.board[c] === EMPTY)
      .sort((x, y) => x - y);
  }
  const out: number[] = [];
  for (let cell = 0; cell < position.board.length; cell++) {
    if (position.board[cell] === EMPTY && flipsAt(position, cell).length > 0) out.push(cell);
  }
  return out;
}

export function canMove(position: ReversiPosition): boolean {
  if (!hasDiscs(position)) return false;
  if (inOpening(position)) return true;
  for (let cell = 0; cell < position.board.length; cell++) {
    if (position.board[cell] === EMPTY && flipsAt(position, cell).length > 0) return true;
  }
  return false;
}

/** Why the side to move can't place on `cell` (null = it can). */
export function refusal(position: ReversiPosition, cell: number): ReversiRefusal | null {
  const { board } = position;
  if (!Number.isInteger(cell) || cell < 0 || cell >= board.length) return 'off_board';
  if (board[cell] === HOLE) return 'hole';
  if (board[cell] !== EMPTY) return 'occupied';
  if (!hasDiscs(position)) return 'no_discs';
  if (inOpening(position)) return centreCells(sizeOf(position.variant)).includes(cell) ? null : 'centre';
  return flipsAt(position, cell).length > 0 ? null : 'no_flip';
}

/** Place a disc for the side to move (no pass logic): the next position, opponent to move. Null if illegal. */
export function applyPlacement(position: ReversiPosition, cell: number): { position: ReversiPosition; flips: number[] } | null {
  if (refusal(position, cell) !== null) return null;
  const flips = inOpening(position) ? [] : flipsAt(position, cell);
  const me = discOf(position.turn);
  const cells = position.board.split('');
  cells[cell] = me;
  for (const f of flips) cells[f] = me;
  let supply = position.supply;
  if (supply) {
    const i = position.turn === 'first' ? 0 : 1;
    const next: [number, number] = [supply[0], supply[1]];
    next[i] = Math.max(0, next[i] - 1);
    supply = next;
  }
  return { position: { variant: position.variant, board: cells.join(''), turn: otherSide(position.turn), supply }, flips };
}

/** The final result once neither side can move: the disc count decides (Anti: the fewest wins). */
export function scoreResult(position: ReversiPosition): ReversiResult {
  const score = discCounts(position.board);
  if (score[0] === score[1]) return { winner: null, reason: REVERSI_REASONS.tie, score };
  const most: BoardSide = score[0] > score[1] ? 'first' : 'second';
  const winner = REVERSI_VARIANT_INFO[position.variant].goal === 'fewest' ? otherSide(most) : most;
  return { winner, reason: REVERSI_REASONS.discs, score };
}

/** Neither side can move. */
export function isFinal(position: ReversiPosition): boolean {
  return !canMove(position) && !canMove({ ...position, turn: otherSide(position.turn) });
}

/** The side to move can't, but the other side can: the turn must be skipped. */
export function mustPass(position: ReversiPosition): boolean {
  return !canMove(position) && canMove({ ...position, turn: otherSide(position.turn) });
}

function passPly(side: BoardSide): ReversiPly {
  return { side, cell: -1, flips: [], notation: 'pass' };
}

/** Place a disc and settle the turn (skip the opponent if they can't move; end the game if nobody can). */
export function playMove(game: ReversiGame, cell: number): PlayResult {
  if (game.result) return { ok: false, reason: 'over' };
  const position = game.position;
  const why = refusal(position, cell);
  if (why) return { ok: false, reason: why };
  const placed = applyPlacement(position, cell)!;
  const size = sizeOf(game.variant);
  const ply: ReversiPly = { side: position.turn, cell, flips: placed.flips, notation: cellName(size, cell) };
  const plies = [...game.plies, ply];
  let next = placed.position;
  let passed: BoardSide | null = null;
  let result: ReversiResult | null = null;
  if (!canMove(next)) {
    const back: ReversiPosition = { ...next, turn: position.turn };
    if (canMove(back)) {
      passed = next.turn;
      plies.push(passPly(next.turn));
      next = back;
    } else {
      result = scoreResult(next);
    }
  }
  return { ok: true, game: { variant: game.variant, start: game.start, position: next, plies, result }, ply, passed };
}

/**
 * Rebuild a game from its plies (cells, -1 = a skipped turn) played from `start`. Throws on an
 * illegal record. The result is set when neither side can move at the end; a record cut right
 * before a skipped turn leaves a position where `mustPass` is true.
 */
export function fromPlies(variant: ReversiVariant, cells: readonly number[], startBoard?: string): ReversiGame {
  const start = startPosition(variant, startBoard);
  const size = sizeOf(variant);
  let position = start;
  const plies: ReversiPly[] = [];
  for (const cell of cells) {
    if (isFinal(position)) throw new Error('reversi: move after the end of the game');
    if (cell === -1) {
      if (!mustPass(position)) throw new Error('reversi: a pass while a move is possible');
      plies.push(passPly(position.turn));
      position = { ...position, turn: otherSide(position.turn) };
      continue;
    }
    const placed = applyPlacement(position, cell);
    if (!placed) throw new Error(`reversi: illegal move ${cellName(size, cell)}`);
    plies.push({ side: position.turn, cell, flips: placed.flips, notation: cellName(size, cell) });
    position = placed.position;
  }
  return { variant, start, position, plies, result: isFinal(position) ? scoreResult(position) : null };
}
