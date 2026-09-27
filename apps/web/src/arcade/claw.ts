/**
 * The floor claw machine's geometry (pure; unit tested): its art box, and where each plush of the
 * shared pile (clawPhysics.ts / clawInventory.ts) sits in the flat floor art. The close-up draws the
 * same pile in 3/4 perspective; the floor art is a front view, so depth only lifts a toy a little
 * and draws it behind the ones in front.
 */
import { BOX, GANTRY, type ToyKind } from './clawPhysics.ts';

/** The claw machine's art box (ClawMachine.tsx viewBox) — shared with the floor layout without the art. */
export const CLAW_ART = { w: 152, h: 250, floor: 242 } as const;

/** The glass case's interior in art units (x span, the floor line). */
export const FLOOR_GLASS = { x0: 24, x1: 138, floorY: 146 } as const;

/** Floor-art plushies are drawn a little larger than a pixel a unit (they read from across the room). */
export const FLOOR_PLUSH_SCALE = 1.35;

/** The parked claw's x in the floor art (over the chute, like the close-up's). */
export const FLOOR_HOME_X = FLOOR_GLASS.x0 + (GANTRY.homeX / BOX.w) * (FLOOR_GLASS.x1 - FLOOR_GLASS.x0);

export interface FloorToy {
  kind: ToyKind;
  color: number;
  x: number;
  z: number;
  y: number;
}

/** Where a pile toy's bottom-centre lands in the floor art. */
export function floorPlacement(t: { x: number; y: number; z: number }): { x: number; y: number } {
  const x = FLOOR_GLASS.x0 + (Math.min(BOX.w, Math.max(0, t.x)) / BOX.w) * (FLOOR_GLASS.x1 - FLOOR_GLASS.x0);
  const y = FLOOR_GLASS.floorY - Math.min(BOX.d, Math.max(0, t.z)) * 0.42 - Math.max(0, t.y) * 1.2;
  return { x, y: Math.max(62, y) };
}

/** Back to front (then bottom to top): the draw order of the floor art's pile. */
export function floorOrder<T extends { y: number; z: number }>(toys: readonly T[]): T[] {
  return [...toys].sort((a, b) => b.z - a.z || a.y - b.y);
}
