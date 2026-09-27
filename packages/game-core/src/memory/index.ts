/**
 * Memory Matrix — pure rules (server-driven game; the room owns timing and judging).
 *
 * Two pattern kinds, chosen per round by the variant setting:
 *  - SEQUENCE: tiles light up one after another; repeat them in the same order.
 *  - FLASH: several tiles light up at once; tap every one of them (any order).
 * ('mixed' alternates: odd rounds sequence, even rounds flash.)
 * Rounds grow in length and speed; the grid grows from 3×3 to 4×4 to 5×5.
 *
 * Scoring (per player, per round): +10 per correct tap; clearing the round adds 100 × round
 * plus a speed bonus of up to 50 × round for the time left. A wrong tap or running out of
 * time fails the round (costs a life, or knocks you out in sudden-death).
 */
import type { Rng } from '@dascade/shared';

export type PatternKind = 'sequence' | 'flash';
export type MemoryVariant = 'sequence' | 'flash' | 'mixed';

export interface RoundSpec {
  round: number;
  kind: PatternKind;
  /** Grid side (3, 4 or 5). */
  size: number;
  /** Tiles in the pattern. */
  count: number;
  /** Sequence: how long each tile stays lit; flash: how long the whole set stays lit (ms). */
  stepMs: number;
  /** Sequence: dark gap between tiles (ms); 0 for flash. */
  gapMs: number;
  /** Total playback time (ms). */
  showMs: number;
  /** Time allowed to enter the answer (ms). */
  inputMs: number;
}

export const TAP_POINTS = 10;
export const MAX_ROUNDS = 40;

export function kindFor(variant: MemoryVariant, round: number): PatternKind {
  if (variant === 'mixed') return round % 2 === 0 ? 'flash' : 'sequence';
  return variant;
}

export function roundSpec(variant: MemoryVariant, round: number): RoundSpec {
  const r = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(round)));
  const kind = kindFor(variant, r);
  if (kind === 'sequence') {
    const size = r <= 5 ? 3 : r <= 11 ? 4 : 5;
    const count = Math.min(14, 2 + r);
    const stepMs = Math.max(280, 650 - 22 * (r - 1));
    const gapMs = Math.max(90, 170 - 6 * (r - 1));
    return { round: r, kind, size, count, stepMs, gapMs, showMs: count * stepMs + (count - 1) * gapMs, inputMs: Math.min(16_000, 2_500 + 650 * count) };
  }
  const size = r <= 3 ? 3 : r <= 9 ? 4 : 5;
  const count = Math.max(3, Math.min(size * size - 3, 2 + Math.ceil(r * 0.6)));
  const stepMs = Math.max(650, 1500 - 55 * (r - 1));
  return { round: r, kind, size, count, stepMs, gapMs: 0, showMs: stepMs, inputMs: Math.min(15_000, 2_500 + 700 * count) };
}

/** Generate a pattern for a spec: sequences never repeat a tile back-to-back; flashes are distinct tiles. */
export function generatePattern(spec: RoundSpec, rng: Rng): number[] {
  const cells = spec.size * spec.size;
  if (spec.kind === 'flash') {
    const pool = Array.from({ length: cells }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
    }
    return pool.slice(0, spec.count).sort((a, b) => a - b);
  }
  const out: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    let tile = rng.int(cells);
    if (out.length > 0 && tile === out[out.length - 1]) tile = (tile + 1 + rng.int(cells - 1)) % cells;
    out.push(tile);
  }
  return out;
}

export type TapResult =
  | { ok: true; progress: number; done: boolean; points: number }
  | { ok: false; progress: number; reason: 'wrong' | 'repeat' | 'range' | 'closed' };

/** Judges one player's answer for one round. */
export class RoundJudge {
  progress = 0;
  closed = false;
  failed = false;
  points = 0;
  readonly found = new Set<number>();

  constructor(
    readonly spec: RoundSpec,
    readonly pattern: readonly number[],
  ) {}

  get done(): boolean {
    return this.progress >= this.pattern.length;
  }

  /** `elapsedMs` since the input window opened (speed bonus). */
  tap(tile: number, elapsedMs: number): TapResult {
    if (this.closed) return { ok: false, progress: this.progress, reason: 'closed' };
    if (!Number.isInteger(tile) || tile < 0 || tile >= this.spec.size * this.spec.size) return { ok: false, progress: this.progress, reason: 'range' };
    let ok: boolean;
    if (this.spec.kind === 'sequence') ok = this.pattern[this.progress] === tile;
    else {
      if (this.found.has(tile)) return { ok: false, progress: this.progress, reason: 'repeat' };
      ok = this.pattern.includes(tile);
    }
    if (!ok) {
      this.closed = true;
      this.failed = true;
      return { ok: false, progress: this.progress, reason: 'wrong' };
    }
    this.found.add(tile);
    this.progress++;
    let points = TAP_POINTS;
    if (this.done) {
      this.closed = true;
      points += roundClearPoints(this.spec, elapsedMs);
    }
    this.points += points;
    return { ok: true, progress: this.progress, done: this.done, points };
  }

  /** Time ran out. Returns true when this failed the round. */
  timeout(): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.failed = true;
    return true;
  }
}

export function roundClearPoints(spec: RoundSpec, elapsedMs: number): number {
  const left = Math.max(0, Math.min(1, 1 - elapsedMs / spec.inputMs));
  return 100 * spec.round + Math.floor(50 * spec.round * left);
}
