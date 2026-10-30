/**
 * DAS Tic-Tac-Toe rules for every variant (see TTT_VARIANT_INFO for the player-facing rules).
 *
 *  - A `TttPosition` is what decides which moves are legal; the client builds one from the public
 *    state for its hints. A `TttGame` adds the record: plies, Vanishing's mark ages, the position
 *    counts for repetition, and the result.
 *  - `playMove` validates a move against the position, applies it and decides the game. It never
 *    mutates its input: take-backs replay the plies from `newGame`.
 *  - Side 'first' plays X (Order in Order & Chaos, Odds in Numbers); Notakto: both play X.
 */
import { otherSide, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  TTT_MOVE_LIMIT,
  TTT_NUMBERS,
  TTT_NUMBER_TARGET,
  TTT_PIECES_PER_SIZE,
  TTT_REASONS,
  TTT_VANISH_KEEP,
  TTT_VARIANT_INFO,
  tttCellCount,
  type TttMark,
  type TttSize,
  type TttVariant,
} from '@dascade/shared/games/tictactoe';
import { META_LINES, linesOf } from './lines.ts';

export interface TttMove {
  cell: number;
  mark?: TttMark;
  num?: number;
  size?: TttSize;
  from?: number;
}

export interface TttPosition {
  variant: TttVariant;
  cells: readonly string[];
  turn: BoardSide;
  /** Ultimate: per small board '.', 'x', 'o', '='. Notakto: '.' live, '#' dead. '' otherwise. */
  boards: string;
  /** Ultimate: the small board the side to move must play in (-1 = any open board). */
  active: number;
  /** Nesting: pieces in hand [first small, medium, large, second small, medium, large]; [] otherwise. */
  hands: readonly number[];
}

export interface TttPly {
  side: BoardSide;
  /** The move as played: the landing cell (Gravity), the mark or number placed, the piece size. */
  move: Required<Pick<TttMove, 'cell'>> & TttMove;
  notation: string;
  /** Vanishing: the mark that faded (-1 = none). */
  removed: number;
  /** Ultimate / Notakto: the small board this move decided (-1 = none). */
  board: number;
}

export interface TttResult {
  /** null = draw. */
  winner: BoardSide | null;
  reason: string;
  /** The deciding line's cells (Ultimate: its three small boards); [] when not decided by a line. */
  line: number[];
}

export interface TttGame {
  position: TttPosition;
  /** Vanishing: each side's marks on the board, oldest first. */
  ages: Record<BoardSide, number[]>;
  plies: TttPly[];
  /** Vanishing and Nesting: how often each position occurred. */
  seen: Record<string, number>;
  result: TttResult | null;
}

export type PlayResult = { ok: true; game: TttGame; ply: TttPly } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** The mark a side places in the variants with fixed marks. */
export function markOf(variant: TttVariant, side: BoardSide): TttMark {
  if (variant === 'notakto') return 'x';
  return side === 'first' ? 'x' : 'o';
}

/** Nesting: the visible piece of a stack ('' = empty). */
export function topOf(stack: string): { owner: TttMark; size: TttSize } | null {
  if (stack.length < 2) return null;
  const owner = stack[stack.length - 2] as TttMark;
  const size = Number(stack[stack.length - 1]) as TttSize;
  return { owner, size };
}

/** What a cell shows: its mark / number, or Nesting's visible owner ('' = empty). */
export function visible(variant: TttVariant, token: string): string {
  if (variant === 'nesting') return topOf(token)?.owner ?? '';
  return token;
}

function handIndex(side: BoardSide, size: TttSize): number {
  return (side === 'first' ? 0 : 3) + size - 1;
}

const COLS = 'abcdefghijklmno';

/** Human name of a cell: "b2" (column letter, row counted from the bottom), "2·b3" on boards and layers. */
export function cellName(variant: TttVariant, cell: number): string {
  const v = TTT_VARIANT_INFO[variant];
  const per = v.cols * v.rows;
  if (variant === 'ultimate') {
    const b = Math.floor(cell / 9);
    const i = cell % 9;
    const col = (b % 3) * 3 + (i % 3);
    const row = Math.floor(b / 3) * 3 + Math.floor(i / 3);
    return `${COLS[col]}${9 - row}`;
  }
  const local = cell % per;
  const name = `${COLS[local % v.cols]}${v.rows - Math.floor(local / v.cols)}`;
  return v.count > 1 ? `${Math.floor(cell / per) + 1}·${name}` : name;
}

export function newPosition(variant: TttVariant): TttPosition {
  const v = TTT_VARIANT_INFO[variant];
  return {
    variant,
    cells: Array.from({ length: tttCellCount(variant) }, () => ''),
    turn: 'first',
    boards: variant === 'ultimate' || variant === 'notakto' ? '.'.repeat(v.count) : '',
    active: -1,
    hands: variant === 'nesting' ? Array<number>(6).fill(TTT_PIECES_PER_SIZE) : [],
  };
}

export function newGame(variant: TttVariant): TttGame {
  const position = newPosition(variant);
  const game: TttGame = { position, ages: { first: [], second: [] }, plies: [], seen: {}, result: null };
  if (tracksRepetition(variant)) game.seen[positionKey(game)] = 1;
  return game;
}

function tracksRepetition(variant: TttVariant): boolean {
  return variant === 'vanishing' || variant === 'nesting';
}

function positionKey(game: Pick<TttGame, 'position' | 'ages'>): string {
  const p = game.position;
  const extra = p.variant === 'vanishing' ? `${game.ages.first.join('.')}/${game.ages.second.join('.')}` : p.hands.join('');
  return `${p.cells.join(',')}|${p.turn}|${extra}`;
}

export function repetitionCount(game: TttGame): number {
  return tracksRepetition(game.position.variant) ? (game.seen[positionKey(game)] ?? 1) : 1;
}

/** Numbers already on the board. */
function usedNumbers(cells: readonly string[]): Set<number> {
  const used = new Set<number>();
  for (const c of cells) if (c) used.add(Number(c));
  return used;
}

/** Numbers: the numbers the side may still place. */
export function numbersLeft(position: TttPosition, side: BoardSide = position.turn): number[] {
  const used = usedNumbers(position.cells);
  return TTT_NUMBERS[side].filter((n) => !used.has(n));
}

/** Gravity: the lowest empty cell of the cell's column (-1 = the column is full). */
export function dropCell(position: TttPosition, cell: number): number {
  const v = TTT_VARIANT_INFO[position.variant];
  const col = cell % v.cols;
  for (let r = v.rows - 1; r >= 0; r--) {
    const c = r * v.cols + col;
    if (!position.cells[c]) return c;
  }
  return -1;
}

/** Ultimate / Notakto: whether a small board can still be played. */
function boardOpen(position: TttPosition, board: number): boolean {
  return position.boards[board] === '.';
}

// ---------------------------------------------------------------------------
// Legal moves
// ---------------------------------------------------------------------------

/**
 * The move as it will be played, or null if it isn't legal in the position. Normalizes what the
 * client may leave out or approximate: Gravity's landing cell, the fixed mark of the side, the
 * piece size of a Nesting move.
 */
export function resolveMove(position: TttPosition, move: TttMove): TttPly['move'] | null {
  const { variant, cells, turn } = position;
  const total = cells.length;
  const cell = move.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= total) return null;

  switch (variant) {
    case 'gravity': {
      const landing = dropCell(position, cell);
      return landing < 0 ? null : { cell: landing, mark: markOf(variant, turn) };
    }
    case 'wild':
    case 'orderchaos': {
      if (cells[cell] || (move.mark !== 'x' && move.mark !== 'o')) return null;
      return { cell, mark: move.mark };
    }
    case 'numbers': {
      if (cells[cell] || move.num === undefined || !numbersLeft(position).includes(move.num)) return null;
      return { cell, num: move.num };
    }
    case 'ultimate': {
      const board = Math.floor(cell / 9);
      if (cells[cell] || !boardOpen(position, board) || (position.active >= 0 && position.active !== board)) return null;
      return { cell, mark: markOf(variant, turn) };
    }
    case 'notakto': {
      if (cells[cell] || !boardOpen(position, Math.floor(cell / 9))) return null;
      return { cell, mark: 'x' };
    }
    case 'nesting':
      return resolveNesting(position, move);
    default: {
      if (cells[cell]) return null;
      return { cell, mark: markOf(variant, turn) };
    }
  }
}

function resolveNesting(position: TttPosition, move: TttMove): TttPly['move'] | null {
  const { cells, turn, hands } = position;
  const own = markOf('nesting', turn);
  const target = topOf(cells[move.cell] ?? '');
  if (move.from !== undefined) {
    if (move.from === move.cell || move.from < 0 || move.from >= cells.length) return null;
    const piece = topOf(cells[move.from] ?? '');
    if (!piece || piece.owner !== own) return null;
    if (move.size !== undefined && move.size !== piece.size) return null;
    if (target && target.size >= piece.size) return null;
    return { cell: move.cell, from: move.from, size: piece.size };
  }
  const size = move.size;
  if (size !== 1 && size !== 2 && size !== 3) return null;
  if ((hands[handIndex(turn, size)] ?? 0) <= 0) return null;
  if (target && target.size >= size) return null;
  return { cell: move.cell, size };
}

/** Every legal move of the side to move (one per landing cell for Gravity). */
export function legalMoves(position: TttPosition): TttPly['move'][] {
  const { variant, cells } = position;
  const out: TttPly['move'][] = [];
  const push = (m: TttMove) => {
    const r = resolveMove(position, m);
    if (r) out.push(r);
  };
  if (variant === 'gravity') {
    const cols = TTT_VARIANT_INFO.gravity.cols;
    for (let c = 0; c < cols; c++) push({ cell: c });
    return out;
  }
  if (variant === 'nesting') {
    for (let cell = 0; cell < cells.length; cell++) {
      for (const size of [1, 2, 3] as const) push({ cell, size });
      for (let from = 0; from < cells.length; from++) if (from !== cell) push({ cell, from });
    }
    return out;
  }
  for (let cell = 0; cell < cells.length; cell++) {
    if (cells[cell]) continue;
    if (variant === 'wild' || variant === 'orderchaos') {
      push({ cell, mark: 'x' });
      push({ cell, mark: 'o' });
    } else if (variant === 'numbers') {
      for (const num of numbersLeft(position)) push({ cell, num });
    } else push({ cell });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applying a move
// ---------------------------------------------------------------------------

/** Cells of every line through `cell` whose cells all satisfy `ok` (union, in board order). */
function linesThrough(variant: TttVariant, cell: number, ok: (line: number[]) => boolean): number[] {
  const set = linesOf(variant);
  const hit = new Set<number>();
  for (const i of set.through[cell] ?? []) {
    const line = set.lines[i]!;
    if (ok(line)) for (const c of line) hit.add(c);
  }
  return [...hit].sort((a, b) => a - b);
}

function sameMark(cells: readonly string[], mark: string): (line: number[]) => boolean {
  return (line) => line.every((c) => cells[c] === mark);
}

function full(cells: readonly string[]): boolean {
  return cells.every((c) => c !== '');
}

function notation(variant: TttVariant, move: TttPly['move']): string {
  const at = cellName(variant, move.cell);
  if (variant === 'wild' || variant === 'orderchaos') return `${(move.mark ?? 'x').toUpperCase()}${at}`;
  if (variant === 'numbers') return `${move.num}${at}`;
  if (variant === 'nesting') {
    const size = 'SML'[(move.size ?? 1) - 1];
    return move.from !== undefined ? `${size}${cellName(variant, move.from)}-${at}` : `${size}${at}`;
  }
  return at;
}

/** Play a move for the side to move. */
export function playMove(game: TttGame, move: TttMove): PlayResult {
  if (game.result) return { ok: false, reason: 'over' };
  const position = game.position;
  const resolved = resolveMove(position, move);
  if (!resolved) return { ok: false, reason: 'illegal' };

  const { variant, turn } = position;
  const cells = [...position.cells];
  let boards = position.boards;
  let active = -1;
  const hands = [...position.hands];
  const ages: Record<BoardSide, number[]> = { first: [...game.ages.first], second: [...game.ages.second] };
  let removed = -1;
  let decided = -1;
  let result: TttResult | null = null;
  const mover = turn;
  const next = otherSide(turn);
  const cell = resolved.cell;

  switch (variant) {
    case 'numbers': {
      cells[cell] = String(resolved.num);
      const line = linesThrough(
        variant,
        cell,
        (l) => l.every((c) => cells[c] !== '') && l.reduce((s, c) => s + Number(cells[c]), 0) === TTT_NUMBER_TARGET,
      );
      if (line.length) result = { winner: mover, reason: TTT_REASONS.sum, line };
      break;
    }
    case 'wild': {
      cells[cell] = resolved.mark!;
      const line = linesThrough(variant, cell, sameMark(cells, resolved.mark!));
      if (line.length) result = { winner: mover, reason: TTT_REASONS.line, line };
      break;
    }
    case 'orderchaos': {
      cells[cell] = resolved.mark!;
      const line = linesThrough(variant, cell, sameMark(cells, resolved.mark!));
      if (line.length) result = { winner: 'first', reason: TTT_REASONS.line, line };
      else if (full(cells)) result = { winner: 'second', reason: TTT_REASONS.chaos, line: [] };
      break;
    }
    case 'misere': {
      cells[cell] = resolved.mark!;
      const line = linesThrough(variant, cell, sameMark(cells, resolved.mark!));
      if (line.length) result = { winner: next, reason: TTT_REASONS.misere, line };
      break;
    }
    case 'vanishing': {
      const mine = ages[mover];
      if (mine.length >= TTT_VANISH_KEEP) {
        removed = mine.shift()!;
        cells[removed] = '';
      }
      cells[cell] = resolved.mark!;
      mine.push(cell);
      const line = linesThrough(variant, cell, sameMark(cells, resolved.mark!));
      if (line.length) result = { winner: mover, reason: TTT_REASONS.line, line };
      break;
    }
    case 'ultimate': {
      cells[cell] = resolved.mark!;
      const board = Math.floor(cell / 9);
      const won = linesThrough(variant, cell, sameMark(cells, resolved.mark!)).length > 0;
      const boardFull = cells.slice(board * 9, board * 9 + 9).every((c) => c !== '');
      if (won || boardFull) {
        decided = board;
        boards = boards.slice(0, board) + (won ? resolved.mark! : '=') + boards.slice(board + 1);
      }
      if (won) {
        const meta = new Set<number>();
        for (const i of META_LINES.through[board] ?? []) {
          const line = META_LINES.lines[i]!;
          if (line.every((b) => boards[b] === resolved.mark)) for (const b of line) meta.add(b);
        }
        if (meta.size) result = { winner: mover, reason: TTT_REASONS.boards, line: [...meta].sort((a, b) => a - b) };
      }
      const target = cell % 9;
      active = boards[target] === '.' ? target : -1;
      break;
    }
    case 'notakto': {
      cells[cell] = 'x';
      const board = Math.floor(cell / 9);
      const line = linesThrough(variant, cell, sameMark(cells, 'x'));
      if (line.length) {
        decided = board;
        boards = boards.slice(0, board) + '#' + boards.slice(board + 1);
        if (!boards.includes('.')) result = { winner: next, reason: TTT_REASONS.lastBoard, line };
      }
      break;
    }
    case 'nesting': {
      const own = markOf(variant, mover);
      const size = resolved.size!;
      if (resolved.from !== undefined) cells[resolved.from] = cells[resolved.from]!.slice(0, -2);
      else hands[handIndex(mover, size)] = (hands[handIndex(mover, size)] ?? 0) - 1;
      cells[cell] = `${cells[cell] ?? ''}${own}${size}`;
      const shown = cells.map((c) => topOf(c)?.owner ?? '');
      const theirs = markOf(variant, next);
      const lineOf = (mark: TttMark) => {
        const hit = new Set<number>();
        for (const line of linesOf(variant).lines) if (line.every((c) => shown[c] === mark)) for (const c of line) hit.add(c);
        return [...hit].sort((a, b) => a - b);
      };
      const uncovered = lineOf(theirs);
      const made = uncovered.length ? [] : lineOf(own);
      if (uncovered.length) result = { winner: next, reason: TTT_REASONS.uncovered, line: uncovered };
      else if (made.length) result = { winner: mover, reason: TTT_REASONS.line, line: made };
      break;
    }
    default: {
      // classic, bigboard, gomoku, gravity, cube
      cells[cell] = resolved.mark!;
      const line = linesThrough(variant, cell, sameMark(cells, resolved.mark!));
      if (line.length) result = { winner: mover, reason: TTT_REASONS.line, line };
    }
  }

  const ply: TttPly = { side: mover, move: resolved, notation: notation(variant, resolved), removed, board: decided };
  const nextGame: TttGame = {
    position: { variant, cells, turn: next, boards, active, hands },
    ages,
    plies: [...game.plies, ply],
    seen: game.seen,
    result,
  };

  if (!result && tracksRepetition(variant)) {
    const key = positionKey(nextGame);
    nextGame.seen = { ...game.seen, [key]: (game.seen[key] ?? 0) + 1 };
    if (nextGame.seen[key]! >= 3) nextGame.result = { winner: null, reason: TTT_REASONS.repetition, line: [] };
    else if (nextGame.plies.length >= TTT_MOVE_LIMIT) nextGame.result = { winner: null, reason: TTT_REASONS.moveLimit, line: [] };
  }
  // No move left for the next side: a full board (Ultimate: every small board decided).
  if (!nextGame.result && legalMoves(nextGame.position).length === 0) {
    nextGame.result =
      variant === 'orderchaos'
        ? { winner: 'second', reason: TTT_REASONS.chaos, line: [] }
        : { winner: null, reason: TTT_REASONS.full, line: [] };
  }
  return { ok: true, game: nextGame, ply };
}

/** Replay a list of moves from the start (take-backs, tests). Throws on an illegal move. */
export function replay(variant: TttVariant, moves: readonly TttMove[]): TttGame {
  let game = newGame(variant);
  for (const move of moves) {
    const next = playMove(game, move);
    if (!next.ok) throw new Error(`illegal move ${JSON.stringify(move)} at ply ${game.plies.length}`);
    game = next.game;
  }
  return game;
}

/** Vanishing: for each side, the cell whose mark fades on that side's next move (-1 = none yet). */
export function fadingCells(game: TttGame): Record<BoardSide, number> {
  const pick = (side: BoardSide) => (game.ages[side].length >= TTT_VANISH_KEEP ? game.ages[side][0]! : -1);
  return { first: pick('first'), second: pick('second') };
}
