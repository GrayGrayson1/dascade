/**
 * @dascade/game-core/detmath — deterministic trigonometry for simulations and geometry
 * that the server AND the clients compute (CLAUDE.md: shared simulations use only
 * `+ - * /`, `Math.sqrt`, `floor/round/abs/min/max`).
 *
 * `Math.sin/cos/atan2/hypot/pow/exp` are not required to be correctly rounded, so V8
 * (server), JavaScriptCore and SpiderMonkey may disagree in the last bit — enough for a
 * client replaying the shared simulation to drift from the server. Everything here is
 * built from IEEE-754 basic operations and `Math.sqrt` (all correctly rounded, hence
 * bit-identical on every engine) plus `Math.round/floor/abs` (exact), with constants
 * written as literals or correctly rounded quotients (identical everywhere).
 *
 * Accuracy vs Math.* (see detmath.test.ts): |error| ≤ 2.2e-16 for sin/cos on |x| ≤ 64π and
 * ≤ 8.9e-16 rad for atan2 — far below the float32 quantization of simulation state.
 *
 * Same approach as putt/math.ts (Taylor polynomial) and tanks/trig.ts (table of
 * polynomial values); this module adds atan2 and a Cody–Waite argument reduction.
 */

export const PI = 3.141592653589793;
export const HALF_PI = 1.5707963267948966;
export const TAU = 6.283185307179586;

/** π/2 split for Cody–Waite reduction (fdlibm): HI has 33 significant bits, so k·HI is exact for |k| < 2^20. */
const PIO2_HI = 1.5707963267341256; // 0x3FF921FB_54400000
const PIO2_LO = 6.077100506506192e-11; // 0x3DD0B461_1A626331
const INV_PIO2 = 0.6366197723675814; // 2/π

// Taylor coefficients (exact integer factorials, so each quotient is the correctly rounded value).
const S1 = -1 / 6;
const S2 = 1 / 120;
const S3 = -1 / 5040;
const S4 = 1 / 362880;
const S5 = -1 / 39916800;
const S6 = 1 / 6227020800;
const S7 = -1 / 1307674368000;
const S8 = 1 / 355687428096000;

const C1 = -1 / 2;
const C2 = 1 / 24;
const C3 = -1 / 720;
const C4 = 1 / 40320;
const C5 = -1 / 3628800;
const C6 = 1 / 479001600;
const C7 = -1 / 87178291200;
const C8 = 1 / 20922789888000;
const C9 = -1 / 6402373705728000;

/** sin(r) for |r| ≤ ~π/4: Taylor to r^17 (truncation < 1e-19). */
function sinPoly(r: number): number {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * (S6 + z * (S7 + z * S8)))))));
}

/** cos(r) for |r| ≤ ~π/4: Taylor to r^18 (truncation < 1e-20). */
function cosPoly(r: number): number {
  const z = r * r;
  return 1 + z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * (C6 + z * (C7 + z * (C8 + z * C9))))))));
}

/**
 * Deterministic sin(x) for finite x (NaN for ±Infinity/NaN). Reduces x = k·π/2 + r with
 * |r| ≲ π/4 and quadrant q = k mod 4, then evaluates the matching polynomial. Accuracy
 * degrades past |x| ≈ 2^20 (never reached by game angles) but results stay deterministic.
 */
export function dsin(x: number): number {
  const k = Math.round(x * INV_PIO2);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  const q = k - 4 * Math.floor(k / 4);
  return q === 0 ? sinPoly(r) : q === 1 ? cosPoly(r) : q === 2 ? -sinPoly(r) : -cosPoly(r);
}

/** Deterministic cos(x); same reduction and guarantees as `dsin`. */
export function dcos(x: number): number {
  const k = Math.round(x * INV_PIO2);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  const q = k - 4 * Math.floor(k / 4);
  return q === 0 ? cosPoly(r) : q === 1 ? -sinPoly(r) : q === 2 ? -cosPoly(r) : sinPoly(r);
}

// atan Taylor coefficients (−1)^k / (2k+1).
const A1 = -1 / 3;
const A2 = 1 / 5;
const A3 = -1 / 7;
const A4 = 1 / 9;
const A5 = -1 / 11;
const A6 = 1 / 13;
const A7 = -1 / 15;
const A8 = 1 / 17;
const A9 = -1 / 19;
const A10 = 1 / 21;
const A11 = -1 / 23;

/** atan(t) for t in [0, 1]. */
function atanUnit(t: number): number {
  // Two half-angle steps, atan(t) = 2·atan(t / (1 + √(1 + t²))), leave u ≤ tan(π/16) ≈ 0.199.
  let u = t / (1 + Math.sqrt(1 + t * t));
  u = u / (1 + Math.sqrt(1 + u * u));
  const z = u * u;
  // Taylor to u^23: truncation < u^25/25 < 2e-19.
  const p = A1 + z * (A2 + z * (A3 + z * (A4 + z * (A5 + z * (A6 + z * (A7 + z * (A8 + z * (A9 + z * (A10 + z * A11)))))))));
  return 4 * (u + u * z * p);
}

/** True for negative numbers and −0. */
function negative(v: number): boolean {
  return v < 0 || (v === 0 && 1 / v < 0);
}

/**
 * Deterministic atan2(y, x) in [−π, π], matching Math.atan2's quadrant and signed-zero
 * conventions for finite inputs (atan2(±0, +0) = ±0, atan2(±0, −0) = ±π).
 */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number;
  if (ay === 0 && ax === 0) a = 0;
  else if (ay <= ax) a = atanUnit(ay / ax);
  else a = HALF_PI - atanUnit(ax / ay);
  if (negative(x)) a = PI - a;
  return negative(y) ? -a : a;
}

/** √(x² + y²) with only `* +` and `Math.sqrt` (Math.hypot is not correctly rounded everywhere). */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
