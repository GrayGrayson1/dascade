/**
 * DAS Tic-Tac-Toe client helpers: the engine position built from the public state (for hints and
 * the optimistic preview), what the local selection (mark, number, piece) lets you click, the lines
 * to strike through, and keyboard navigation over every board layout. Pure, unit tested.
 */
import type { BoardSide } from '@dascade/shared/games/boardroom';
import {
  TTT_VARIANT_INFO,
  isTttVariant,
  type TicTacToePublicState,
  type TttMark,
  type TttSize,
  type TttVariant,
} from '@dascade/shared/games/tictactoe';
import {
  dropCell,
  legalMoves,
  linesOf,
  markOf,
  playMove,
  topOf,
  type TttGame,
  type TttMove,
  type TttPly,
  type TttPosition,
} from '@dascade/game-core/tictactoe';

export type PublicBoard = Pick<TicTacToePublicState, 'variant' | 'cells' | 'turn' | 'boards' | 'active' | 'hands' | 'fading'>;

/** What the player has picked before clicking a square. */
export interface Selection {
  /** Wild, Order & Chaos. */
  mark?: TttMark;
  /** Numbers. */
  num?: number;
  /** Nesting: a piece from the hand… */
  size?: TttSize;
  /** …or one of your pieces on the board. */
  from?: number;
  /** Nesting: the hand size was picked by the player (not the default), so it may cover your own piece. */
  explicit?: boolean;
}

export function variantOf(state: { variant?: string } | null | undefined): TttVariant {
  return isTttVariant(state?.variant) ? state.variant : 'classic';
}

export function cellCount(variant: TttVariant): number {
  const v = TTT_VARIANT_INFO[variant];
  return v.cols * v.rows * v.count;
}

/** The engine position of the public state (null until the board for the variant has arrived). */
export function positionOf(state: PublicBoard): TttPosition | null {
  const variant = variantOf(state);
  if (!state.cells || state.cells.length !== cellCount(variant)) return null;
  return {
    variant,
    cells: [...state.cells],
    turn: state.turn === 'second' ? 'second' : 'first',
    boards: state.boards ?? '',
    active: state.active ?? -1,
    hands: [...(state.hands ?? [])],
  };
}

/**
 * An engine game for previews. Vanishing only needs to know which mark fades: the public state
 * names it, and the other marks' order doesn't matter for one move.
 */
export function gameOf(position: TttPosition, fading: readonly number[] = []): TttGame {
  const ages: Record<BoardSide, number[]> = { first: [], second: [] };
  if (position.variant === 'vanishing') {
    for (const side of ['first', 'second'] as const) {
      const mark = markOf('vanishing', side);
      const oldest = fading[side === 'first' ? 0 : 1] ?? -1;
      const rest = position.cells.flatMap((c, i) => (c === mark && i !== oldest ? [i] : []));
      ages[side] = oldest >= 0 ? [oldest, ...rest] : rest;
    }
  }
  return { position, ages, plies: [], seen: {}, result: null };
}

/** Cells after `move` (the optimistic preview); null if the move isn't legal. */
export function previewCells(position: TttPosition, fading: readonly number[], move: TttMove): string[] | null {
  const played = playMove(gameOf(position, fading), move);
  return played.ok ? [...played.game.position.cells] : null;
}

/** Which extra choice the variant needs before a square is clicked. */
export function choiceOf(variant: TttVariant): 'mark' | 'num' | 'piece' | null {
  if (variant === 'wild' || variant === 'orderchaos') return 'mark';
  if (variant === 'numbers') return 'num';
  if (variant === 'nesting') return 'piece';
  return null;
}

/** The legal moves that match the selection. */
export function movesFor(position: TttPosition, sel: Selection): TttPly['move'][] {
  const all = legalMoves(position);
  switch (choiceOf(position.variant)) {
    case 'mark':
      return all.filter((m) => m.mark === (sel.mark ?? 'x'));
    case 'num':
      return sel.num === undefined ? [] : all.filter((m) => m.num === sel.num);
    case 'piece':
      if (sel.from !== undefined) return all.filter((m) => m.from === sel.from);
      return sel.size === undefined ? [] : all.filter((m) => m.from === undefined && m.size === sel.size);
    default:
      return all;
  }
}

/** Cells where the selection lands (Gravity: the landing squares). */
export function targetCells(position: TttPosition, sel: Selection): Set<number> {
  return new Set(movesFor(position, sel).map((m) => m.cell));
}

/** Cells a click is accepted on: the targets, or (Gravity) any square of a column that isn't full. */
export function clickableCells(position: TttPosition, sel: Selection): Set<number> {
  if (position.variant !== 'gravity') return targetCells(position, sel);
  const out = new Set<number>();
  const v = TTT_VARIANT_INFO.gravity;
  for (let c = 0; c < v.cols; c++) {
    if (dropCell(position, c) < 0) continue;
    for (let r = 0; r < v.rows; r++) out.add(r * v.cols + c);
  }
  return out;
}

/** The move a click on `cell` makes with the selection, or null. */
export function moveAt(position: TttPosition, sel: Selection, cell: number): TttMove | null {
  const variant = position.variant;
  if (variant === 'gravity') {
    const landing = dropCell(position, cell);
    return landing < 0 ? null : { cell: landing };
  }
  const match = movesFor(position, sel).find((m) => m.cell === cell);
  if (!match) return null;
  return {
    cell,
    ...(match.mark && choiceOf(variant) === 'mark' ? { mark: match.mark } : {}),
    ...(match.num ? { num: match.num } : {}),
    ...(match.size ? { size: match.size } : {}),
    ...(match.from !== undefined ? { from: match.from } : {}),
  };
}

/** Nesting: the default hand piece — the largest one left. */
export function defaultSize(position: TttPosition, side: BoardSide): TttSize | undefined {
  const base = side === 'first' ? 0 : 3;
  for (const size of [3, 2, 1] as const) if ((position.hands[base + size - 1] ?? 0) > 0) return size;
  return undefined;
}

/** Nesting: whether `cell` shows one of the side's pieces. */
export function ownsTop(position: TttPosition, side: BoardSide, cell: number): boolean {
  return topOf(position.cells[cell] ?? '')?.owner === markOf('nesting', side);
}

/** Lines of the variant made entirely of `cells` (to strike a win through). */
export function linesWithin(variant: TttVariant, cells: Iterable<number>): number[][] {
  const set = new Set(cells);
  if (set.size === 0) return [];
  return linesOf(variant).lines.filter((line) => line.every((c) => set.has(c)));
}

/** Ultimate: the lines that won each small board; Notakto: the lines that killed each board. */
export function boardLines(variant: TttVariant, cells: readonly string[], boards: string): number[][] {
  if (variant !== 'ultimate' && variant !== 'notakto') return [];
  return linesOf(variant).lines.filter((line) => {
    const b = Math.floor(line[0]! / 9);
    const status = boards[b];
    if (variant === 'notakto') return status === '#' && line.every((c) => cells[c] === 'x');
    return (status === 'x' || status === 'o') && line.every((c) => cells[c] === status);
  });
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

interface NavPos {
  /** Board / layer (0 for single grids and Ultimate's 9×9 view). */
  g: number;
  x: number;
  y: number;
}

function navShape(variant: TttVariant): { groups: number; w: number; h: number } {
  const v = TTT_VARIANT_INFO[variant];
  if (variant === 'ultimate') return { groups: 1, w: 9, h: 9 };
  return { groups: v.count, w: v.cols, h: v.rows };
}

export function navPos(variant: TttVariant, cell: number): NavPos {
  if (variant === 'ultimate') {
    const b = Math.floor(cell / 9);
    const i = cell % 9;
    return { g: 0, x: (b % 3) * 3 + (i % 3), y: Math.floor(b / 3) * 3 + Math.floor(i / 3) };
  }
  const { w, h } = navShape(variant);
  const per = w * h;
  const local = cell % per;
  return { g: Math.floor(cell / per), x: local % w, y: Math.floor(local / w) };
}

export function navCell(variant: TttVariant, pos: NavPos): number {
  if (variant === 'ultimate') {
    const b = Math.floor(pos.y / 3) * 3 + Math.floor(pos.x / 3);
    return b * 9 + (pos.y % 3) * 3 + (pos.x % 3);
  }
  const { w, h } = navShape(variant);
  return pos.g * w * h + pos.y * w + pos.x;
}

/** The cell an arrow key moves to. Left/right past the edge of a board go to the next board. */
export function navStep(variant: TttVariant, cell: number, key: string): number {
  const { groups, w, h } = navShape(variant);
  const p = navPos(variant, cell);
  let { g, x, y } = p;
  if (key === 'ArrowLeft') {
    if (x > 0) x--;
    else if (g > 0) {
      g--;
      x = w - 1;
    }
  } else if (key === 'ArrowRight') {
    if (x < w - 1) x++;
    else if (g < groups - 1) {
      g++;
      x = 0;
    }
  } else if (key === 'ArrowUp') y = Math.max(0, y - 1);
  else if (key === 'ArrowDown') y = Math.min(h - 1, y + 1);
  else if (key === 'Home') x = 0;
  else if (key === 'End') x = w - 1;
  else return cell;
  return navCell(variant, { g, x, y });
}
