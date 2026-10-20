/**
 * The record carousel's geometry (RecordCarousel.tsx), kept pure for tests. The shelf is a ring: the
 * sleeve in the middle faces you, its neighbours turn away to either side, smaller and dimmer, and
 * anything further round the ring is out of sight until you turn to it.
 */

/** A sleeve's place relative to the middle one, going the short way round the ring (−1 = just left). */
export function slotOffset(i: number, at: number, n: number): number {
  if (n <= 0) return 0;
  const d = (((i - at) % n) + n) % n;
  return d > n / 2 ? d - n : d;
}

export interface SlotLook {
  /** Sideways shift, in sleeve widths. */
  x: number;
  /** Turn about the vertical axis (deg); sleeves face the middle. */
  turn: number;
  scale: number;
  /** Brightness (1 = as drawn). */
  dim: number;
  z: number;
  /** Out of sight (and out of reach of the pointer). */
  far: boolean;
}

const LOOKS: readonly SlotLook[] = [
  { x: 0, turn: 0, scale: 1, dim: 1, z: 10, far: false },
  { x: 0.66, turn: 38, scale: 0.78, dim: 0.72, z: 9, far: false },
  { x: 1.08, turn: 50, scale: 0.6, dim: 0.5, z: 8, far: false },
  { x: 1.3, turn: 60, scale: 0.5, dim: 0.4, z: 7, far: true },
];

export function slotLook(offset: number): SlotLook {
  const base = LOOKS[Math.min(LOOKS.length - 1, Math.abs(offset))]!;
  if (offset === 0) return { ...base };
  const side = Math.sign(offset);
  return { ...base, x: side * base.x, turn: -side * base.turn };
}

/** How many sleeves a swipe of `dx` px turns the ring by (a short flick still turns it one). */
export function swipeSteps(dx: number, sleevePx: number, n: number): number {
  if (Math.abs(dx) < 32 || sleevePx <= 0) return 0;
  const steps = Math.max(1, Math.round(Math.abs(dx) / (sleevePx * LOOKS[1]!.x)));
  return -Math.sign(dx) * Math.min(steps, Math.max(1, n - 1));
}
