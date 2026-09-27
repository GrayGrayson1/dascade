/**
 * Block Drop touch drag (pure; used by BlocksPlay): the finger's travel sets a target column
 * relative to where the piece was when the drag picked it up, and each tick moves the piece one
 * column toward it — measured against the piece's real column, so fast swipes never lose columns.
 */
import { CODE, type BlocksSim } from '@dascade/game-core/blocks';

/** Touch drag: steer the falling piece toward the column under the finger. */
export interface DragSteer {
  active: boolean;
  /** Columns the finger has travelled since the drag began. */
  want: number;
  /** The piece being steered (null until the drag picks one up), its column and `want` when picked up. */
  piece: object | null;
  origin: number;
  base: number;
  /** Column/target of the last push that didn't move the piece (wall or stack): wait for a new target. */
  blocked: string;
  soft: boolean;
}

export const idleDrag = (): DragSteer => ({ active: false, want: 0, piece: null, origin: 0, base: 0, blocked: '', soft: false });

/**
 * One move per tick toward the drag target, measured against the piece's real column — fast swipes
 * never lose columns, and a piece that locks mid-drag hands the rest of the gesture to the next one
 * (only further finger travel moves it).
 */
export function steerCodes(d: DragSteer, sim: Pick<BlocksSim, 'piece'> | null): number[] {
  const piece = sim?.piece;
  if (!d.active || !piece) return [];
  if (piece !== d.piece) {
    // The drag's first piece follows the whole gesture (the finger may already have moved before
    // the next tick); a piece that spawns mid-drag only follows travel from here on.
    d.base = d.piece === null ? 0 : d.want;
    d.piece = piece;
    d.origin = piece.x;
    d.blocked = '';
  }
  const target = d.origin + d.want - d.base;
  if (piece.x === target) return [];
  const key = `${piece.x}:${target}`;
  if (d.blocked === key) return [];
  d.blocked = key;
  return piece.x < target ? [CODE.rightDown, CODE.rightUp] : [CODE.leftDown, CODE.leftUp];
}
