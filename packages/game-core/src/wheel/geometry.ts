/**
 * Wheel geometry. Conventions (shared by server, clients and tests):
 *  - Angles are degrees measured CLOCKWISE from 12 o'clock.
 *  - Arcs live in wheel-local space and tile [0, 360) in segment order.
 *  - The wheel rotation R is clockwise; a local angle a appears on screen at a + R.
 *  - The pointer is fixed at 12 o'clock, so it points at local angle (-R) mod 360.
 * Only +, -, *, / are used, so every JS engine computes identical arcs.
 */
import type { WheelSliceMode } from '@dascade/shared/games/wheel';
import { sanitizeWeight } from './segments.ts';

export interface Arc {
  id: string;
  /** Inclusive start angle (degrees). */
  start: number;
  /** Exclusive end angle (degrees). The last arc ends at exactly 360. */
  end: number;
  /** Angular size (degrees). */
  size: number;
  /** Center angle (degrees). */
  mid: number;
}

/** Positive modulo into [0, m). Non-finite input maps to 0. */
export function mod(value: number, m: number): number {
  if (!Number.isFinite(value)) return 0;
  const r = value % m;
  const out = r < 0 ? r + m : r;
  // `+ 0` folds -0 into 0.
  return out >= m ? 0 : out + 0;
}

export function normalizeRotation(rotation: number): number {
  return mod(rotation, 360);
}

/**
 * Computes slice arcs. 'equal' gives every slice 360/n degrees; 'weighted' makes the
 * slice size proportional to the weight (falls back to equal when weights are unusable).
 */
export function computeArcs(segments: readonly { id: string; weight: number }[], mode: WheelSliceMode): Arc[] {
  const n = segments.length;
  if (n === 0) return [];
  const weights = segments.map((s) => (mode === 'weighted' ? sanitizeWeight(s.weight) : 1));
  let total = 0;
  for (const w of weights) total += w;
  const useEqual = !(total > 0);
  const arcs: Arc[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const start = useEqual ? (i * 360) / n : (acc * 360) / total;
    acc += useEqual ? 1 : (weights[i] as number);
    const end = i === n - 1 ? 360 : useEqual ? ((i + 1) * 360) / n : (acc * 360) / total;
    arcs.push({ id: (segments[i] as { id: string }).id, start, end, size: end - start, mid: start + (end - start) / 2 });
  }
  return arcs;
}

/** Resting rotation before the first spin: slice 0 centered under the pointer. */
export function initialRotation(arcs: readonly Arc[]): number {
  return arcs.length ? mod(-(arcs[0] as Arc).mid, 360) : 0;
}

/** Index of the arc containing a local angle (binary search). -1 for an empty wheel. */
export function arcIndexAt(arcs: readonly Arc[], angle: number): number {
  if (arcs.length === 0) return -1;
  const a = mod(angle, 360);
  let lo = 0;
  let hi = arcs.length - 1;
  while (lo < hi) {
    const midIdx = (lo + hi + 1) >> 1;
    if ((arcs[midIdx] as Arc).start <= a) lo = midIdx;
    else hi = midIdx - 1;
  }
  // Skip zero-size arcs that share a start with the next arc.
  while (lo < arcs.length - 1 && (arcs[lo] as Arc).end <= a) lo++;
  return lo;
}

/** Local angle under the pointer for a given wheel rotation. */
export function pointerAngle(rotation: number): number {
  return mod(-rotation, 360);
}

/** Index of the segment under the pointer. */
export function segmentAtPointer(arcs: readonly Arc[], rotation: number): number {
  return arcIndexAt(arcs, pointerAngle(rotation));
}

/** Boundary (peg) angles in local space: the start of every arc. */
export function pegAngles(arcs: readonly Arc[]): number[] {
  if (arcs.length < 2) return arcs.length === 1 ? [0] : [];
  return arcs.map((a) => a.start);
}

/**
 * How many pegs passed under the pointer while the rotation moved from `prev` to `next`
 * (clockwise, prev ≤ next). A peg at local angle b is under the pointer when R ≡ -b (mod 360).
 */
export function pegCrossings(pegs: readonly number[], prev: number, next: number): number {
  if (!(next > prev) || !Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  let count = 0;
  for (const b of pegs) count += Math.floor((next + b) / 360) - Math.floor((prev + b) / 360);
  return count;
}

/**
 * Signed distance (degrees) from the pointer to the nearest peg that is still
 * approaching it: in (-∞, 0]. Used by clients to push the flapper as a peg nears.
 */
export function nearestApproachingPeg(pegs: readonly number[], rotation: number): number {
  let best = -Infinity;
  for (const b of pegs) {
    const screen = mod(b + rotation, 360); // clockwise from 12 o'clock
    const d = screen === 0 ? 0 : screen - 360; // pegs move clockwise toward 360
    if (d > best) best = d;
  }
  return best;
}
