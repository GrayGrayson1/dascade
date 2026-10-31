/**
 * DAS Reversi client helpers: the engine position built from the public state (for move hints, the
 * hover preview and the optimistic move), the kit's square ids, and the flip stagger (discs turn
 * one after another, outward from the disc just placed). Pure, unit tested.
 */
import type { BoardSide } from '@dascade/shared/games/boardroom';
import { REVERSI_VARIANT_INFO, isReversiVariant, type ReversiPublicState, type ReversiVariant } from '@dascade/shared/games/reversi';
import type { ReversiPosition } from '@dascade/game-core/reversi';

export type PublicBoard = Pick<ReversiPublicState, 'variant' | 'board' | 'turn' | 'supply'>;

export function variantOf(state: { variant?: string } | null | undefined): ReversiVariant {
  return isReversiVariant(state?.variant) ? state.variant : 'classic';
}

/** The engine position of the public state (null until the variant's board has arrived). */
export function positionOf(state: PublicBoard): ReversiPosition | null {
  const variant = variantOf(state);
  const size = REVERSI_VARIANT_INFO[variant].size;
  if (!state.board || state.board.length !== size * size) return null;
  const supply = state.supply ?? [];
  return {
    variant,
    board: state.board,
    turn: (state.turn as BoardSide) === 'second' ? 'second' : 'first',
    supply: supply.length === 2 ? [supply[0]!, supply[1]!] : null,
  };
}

/** Kit square id of a cell: the kit counts ranks from the bottom, Reversi rows from the top. */
export function squareIdOf(size: number, file: number, rank: number): string {
  return String((size - 1 - rank) * size + file);
}

/** Cell of a kit square id (-1 if it isn't one). */
export function cellOf(size: number, id: string | null | undefined): number {
  const n = Number(id);
  return id && Number.isInteger(n) && n >= 0 && n < size * size ? n : -1;
}

/** Wait before the first disc turns (the placed disc lands first), then per step along a line. */
export const FLIP_START_MS = 90;
export const FLIP_STEP_MS = 70;

/** Steps between two cells along a straight or diagonal line (Wraparound: the short way round). */
export function lineSteps(size: number, from: number, to: number, wrap: boolean): number {
  let dr = Math.abs(Math.floor(from / size) - Math.floor(to / size));
  let dc = Math.abs((from % size) - (to % size));
  if (wrap) {
    dr = Math.min(dr, size - dr);
    dc = Math.min(dc, size - dc);
  }
  return Math.max(dr, dc);
}

/** Flip delay (ms) of each flipped disc: nearer discs turn first. */
export function flipDelays(variant: ReversiVariant, from: number, flips: readonly number[]): Map<number, number> {
  const { size, wrap } = REVERSI_VARIANT_INFO[variant];
  const out = new Map<number, number>();
  if (from < 0) return out;
  for (const cell of flips) out.set(cell, FLIP_START_MS + (Math.max(1, lineSteps(size, from, cell, wrap)) - 1) * FLIP_STEP_MS);
  return out;
}
