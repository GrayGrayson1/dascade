/**
 * Deterministic roulette animation. Given the server's spin data (start time,
 * duration, winning number, cosmetic seed) every client computes the exact same
 * wheel and ball positions for any server time, so the ball always lands in the
 * pocket the server already chose — including for late joiners mid-spin.
 *
 * Angles are degrees, 0 = 12 o'clock, clockwise positive.
 */
import { WHEEL_ORDER, wheelIndex } from '@dascade/game-core/dasino';

export const POCKET_DEG = 360 / WHEEL_ORDER.length;
/** The wheel head turns slowly counter-clockwise forever (degrees per ms). */
const WHEEL_DEG_PER_MS = -0.014;

export interface SpinInfo {
  startAt: number;
  durationMs: number;
  result: number;
  seed: number;
}

export interface BallState {
  visible: boolean;
  /** World angle of the ball. */
  angle: number;
  /** 0 = pocket ring, 1 = outer ball track. */
  lift: number;
  /** Ball is in a pocket (settled). */
  settled: boolean;
  /** Relative pocket index under the ball (for tick sounds while it bounces). */
  pocketTick: number;
}

export function wheelAngle(serverTime: number): number {
  return mod(serverTime * WHEEL_DEG_PER_MS, 360);
}

/** Pocket centre relative to the wheel head. */
export function pocketAngle(n: number): number {
  return wheelIndex(n) * POCKET_DEG;
}

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
const easeInOutSine = (u: number) => -(Math.cos(Math.PI * u) - 1) / 2;

/** Progress of the spin (0–1). */
export function spinProgress(spin: SpinInfo, now: number): number {
  if (spin.durationMs <= 0) return 1;
  return clamp((now - spin.startAt) / spin.durationMs, 0, 1);
}

/**
 * Ball position during/after a spin. The ball's angle RELATIVE to the wheel
 * head eases toward the result pocket, so it lands exactly there at the end.
 */
export function ballState(spin: SpinInfo, now: number): BallState {
  const u = spinProgress(spin, now);
  const target = pocketAngle(spin.result);
  const laps = 6 + (spin.seed % 3);
  const extra = (spin.seed >> 2) % 360;
  // Ball travels clockwise relative to the (counter-clockwise) wheel.
  const travel = laps * 360 + extra;
  const rel = target - travel * (1 - easeOutCubic(u));
  const wobble = u > 0.72 && u < 1 ? Math.sin(u * 90) * (1 - u) * 6 : 0;
  const angle = wheelAngle(now) + rel + wobble;

  // Radius: rides the outer track, spirals in, bounces over the frets, settles.
  let lift: number;
  if (u < 0.5) lift = 1;
  else if (u < 0.74) lift = 1 - easeInOutSine((u - 0.5) / 0.24);
  else if (u < 1) {
    const v = (u - 0.74) / 0.26;
    lift = Math.abs(Math.sin(v * Math.PI * 3.5)) * 0.35 * (1 - v) ** 2;
  } else lift = 0;

  return {
    visible: true,
    angle,
    lift,
    settled: u >= 1,
    pocketTick: Math.floor((rel - target) / POCKET_DEG),
  };
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n));
}
