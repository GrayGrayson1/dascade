/**
 * Winner selection, spin planning and the shared easing curve.
 *
 * The SERVER calls `planSpin` with its crypto RNG. Clients only ever evaluate
 * `rotationAt` on the published plan, so every screen follows the same f(t)
 * and lands on the same slice.
 */
import type { Rng } from '@dascade/shared';
import type { WheelSliceMode } from '@dascade/shared/games/wheel';
import { computeArcs, mod, normalizeRotation, type Arc } from './geometry.ts';
import { sanitizeWeight, type ActiveSegment } from './segments.ts';

/** Fraction of the winner arc kept clear on each side so the pointer never lands on a boundary. */
export const LANDING_MARGIN = 0.18;

/**
 * Weighted draw: returns an index with probability weight_i / Σweights.
 * Indices whose weight is invalid or ≤ 0 are never chosen. `eligible` restricts the draw.
 */
export function weightedIndex(weights: readonly number[], rng: Rng, eligible?: readonly number[]): number {
  const indices = eligible ?? weights.map((_, i) => i);
  let total = 0;
  for (const i of indices) total += sanitizeWeight(weights[i]);
  if (!(total > 0)) throw new RangeError('weightedIndex: no positive weights to draw from');
  const r = rng.next() * total;
  let acc = 0;
  let lastPositive = -1;
  for (const i of indices) {
    const w = sanitizeWeight(weights[i]);
    if (w <= 0) continue;
    acc += w;
    lastPositive = i;
    if (r < acc) return i;
  }
  // Floating point residue (r ≈ total): fall back to the last positive weight.
  return lastPositive;
}

export interface EligibilityOptions {
  /** Segment id of the previous winner (for "prevent immediate repeat"). */
  previousWinnerId?: string | null;
  preventRepeat?: boolean;
}

/** Indices that may win this spin. Never empty for a non-empty wheel. */
export function eligibleIndices(segments: readonly ActiveSegment[], opts: EligibilityOptions = {}): number[] {
  const all: number[] = [];
  for (let i = 0; i < segments.length; i++) if (sanitizeWeight((segments[i] as ActiveSegment).weight) > 0) all.push(i);
  if (!opts.preventRepeat || !opts.previousWinnerId || all.length < 2) return all;
  const filtered = all.filter((i) => (segments[i] as ActiveSegment).id !== opts.previousWinnerId);
  return filtered.length > 0 ? filtered : all;
}

export function pickWinner(segments: readonly ActiveSegment[], rng: Rng, opts: EligibilityOptions = {}): number {
  if (segments.length === 0) throw new RangeError('pickWinner: the wheel is empty');
  return weightedIndex(
    segments.map((s) => s.weight),
    rng,
    eligibleIndices(segments, opts),
  );
}

/** Extra full turns for a spin of this length (feels right from 2 s to 12 s). */
export function spinTurns(durationMs: number, rng: Rng): number {
  const seconds = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0) / 1000;
  const base = Math.min(10, Math.max(2, Math.round(seconds * 0.8)));
  return base + rng.int(2);
}

/** A local angle strictly inside the arc, at least LANDING_MARGIN × size from both edges. */
export function landingAngle(arc: Arc, rng: Rng): number {
  const margin = arc.size * LANDING_MARGIN;
  return arc.start + margin + rng.next() * (arc.size - 2 * margin);
}

export interface SpinPlanInput extends EligibilityOptions {
  segments: readonly ActiveSegment[];
  sliceMode: WheelSliceMode;
  rng: Rng;
  /** Current resting rotation (any value; normalized to [0, 360)). */
  fromRotation: number;
  durationMs: number;
}

export interface SpinPlan {
  winnerIndex: number;
  winnerId: string;
  /** Local angle the pointer will rest on (inside the winner arc). */
  landingAngle: number;
  fromRotation: number;
  toRotation: number;
  turns: number;
}

/** Decides a spin: winner, where inside its slice the pointer stops, and the final rotation. */
export function planSpin(input: SpinPlanInput): SpinPlan {
  const { segments, sliceMode, rng } = input;
  const winnerIndex = pickWinner(segments, rng, input);
  const arcs = computeArcs(segments, sliceMode);
  const arc = arcs[winnerIndex] as Arc;
  const target = landingAngle(arc, rng);
  const from = normalizeRotation(input.fromRotation);
  const turns = spinTurns(input.durationMs, rng);
  // Pointer rests on `target` when rotation ≡ -target (mod 360).
  const delta = mod(-target - from, 360);
  return {
    winnerIndex,
    winnerId: (segments[winnerIndex] as ActiveSegment).id,
    landingAngle: target,
    fromRotation: from,
    toRotation: from + turns * 360 + delta,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Easing: a short linear-velocity wind-up, then a long polynomial deceleration.
// Velocity is continuous at the junction, so the motion reads as a real wheel
// being flung and slowly losing speed as the pegs drag on the flapper.
// ---------------------------------------------------------------------------

/** Fraction of the spin spent accelerating. */
export const SPIN_ACCEL = 0.08;
/** Deceleration exponent (higher = longer, more dramatic crawl at the end). */
export const SPIN_DECAY = 2.6;

const AREA_ACCEL = SPIN_ACCEL / 2;
const AREA_DECEL = (1 - SPIN_ACCEL) / (SPIN_DECAY + 1);
const AREA_TOTAL = AREA_ACCEL + AREA_DECEL;

/** Normalized progress p(u) for u in [0, 1]: monotonic, p(0) = 0, p(1) = 1. */
export function spinEase(u: number): number {
  if (!(u > 0)) return 0;
  if (u >= 1) return 1;
  if (u <= SPIN_ACCEL) return (u * u) / (2 * SPIN_ACCEL) / AREA_TOTAL;
  const w = (u - SPIN_ACCEL) / (1 - SPIN_ACCEL);
  const decel = ((1 - SPIN_ACCEL) / (SPIN_DECAY + 1)) * (1 - Math.pow(1 - w, SPIN_DECAY + 1));
  return Math.min(1, (AREA_ACCEL + decel) / AREA_TOTAL);
}

/** Normalized velocity dp/du (peaks at 1 / AREA_TOTAL at the end of the wind-up). */
export function spinVelocity(u: number): number {
  if (!(u > 0) || u >= 1) return 0;
  if (u <= SPIN_ACCEL) return u / SPIN_ACCEL / AREA_TOTAL;
  const w = (u - SPIN_ACCEL) / (1 - SPIN_ACCEL);
  return Math.pow(1 - w, SPIN_DECAY) / AREA_TOTAL;
}

/** Peak normalized velocity, for scaling effects (0..1 after dividing). */
export const SPIN_PEAK_VELOCITY = 1 / AREA_TOTAL;

export interface SpinTiming {
  startAt: number;
  durationMs: number;
  fromRotation: number;
  toRotation: number;
}

/** Spin progress u in [0, 1] at a (server) time. */
export function spinProgressAt(spin: SpinTiming, now: number): number {
  if (!(spin.durationMs > 0)) return now >= spin.startAt ? 1 : 0;
  return Math.max(0, Math.min(1, (now - spin.startAt) / spin.durationMs));
}

/** Wheel rotation at a (server) time. Identical on every client for the same plan. */
export function rotationAt(spin: SpinTiming, now: number): number {
  const u = spinProgressAt(spin, now);
  if (u >= 1) return spin.toRotation;
  return spin.fromRotation + (spin.toRotation - spin.fromRotation) * spinEase(u);
}
