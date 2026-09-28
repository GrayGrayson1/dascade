/**
 * Allocation-free math helpers for the kart engine (kart-local: nothing here depends on DASh
 * Circuit). Everything is shared by the server and client prediction, so it only uses
 * `+ - * /`, `Math.sqrt` and exact rounding: trigonometry comes from ../detmath (guarded by
 * determinism.test.ts).
 */
export { datan2, dcos, dhypot, dsin, PI, TAU, HALF_PI } from '../detmath/index.ts';

const TWO_PI = 6.283185307179586;
const ONE_PI = 3.141592653589793;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  if (a > -ONE_PI && a <= ONE_PI) return a;
  let r = a % TWO_PI;
  if (r <= -ONE_PI) r += TWO_PI;
  else if (r > ONE_PI) r -= TWO_PI;
  return r;
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

/** Positive modulo. */
export function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/** Shortest signed difference b − a on a loop of length `len`, in (−len/2, len/2]. */
export function loopDelta(a: number, b: number, len: number): number {
  let d = mod(b - a, len);
  if (d > len / 2) d -= len;
  return d;
}

/** Squared distance from point p to segment ab; the clamped parameter t is written to out[0]. */
export function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number, out: number[]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out[0] = t;
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

/** Segment/segment intersection parameters (proper crossings only), or null. */
export function segIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): [number, number] | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-12) return null;
  const qpx = cx - ax;
  const qpy = cy - ay;
  const t = (qpx * sY - qpy * sX) / denom;
  const u = (qpx * rY - qpy * rX) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

/**
 * Round to float32 (x, y are float32 on the wire). All quantizers also turn −0 into +0: the wire
 * can't carry the sign of zero, and −0 vs +0 changes atan2 results, so state must never hold −0.
 */
export function f32(v: number): number {
  return Math.fround(v) + 0;
}

/** Quantization steps of kart state (exactly the wire representation). */
export const Q_Z = 128;
export const Q_VEL = 256;
export const Q_ANG = 1024;
export const HEADING_STEPS = 65536;
export const HEADING_Q = 6.283185307179586 / HEADING_STEPS;

export function qz(v: number): number {
  const q = Math.round(v * Q_Z);
  return (q < -32768 ? -32768 : q > 32767 ? 32767 : q) / Q_Z + 0;
}

export function qvel(v: number): number {
  const q = Math.round(v * Q_VEL);
  return (q < -32767 ? -32767 : q > 32767 ? 32767 : q) / Q_VEL + 0;
}

export function qang(v: number): number {
  const q = Math.round(v * Q_ANG);
  return (q < -32767 ? -32767 : q > 32767 ? 32767 : q) / Q_ANG + 0;
}

/** Heading index in [-32768, 32767] for a heading in radians. */
export function headingIndex(h: number): number {
  let k = Math.round(h / HEADING_Q);
  k = ((k % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS;
  if (k >= 32768) k -= HEADING_STEPS;
  return k;
}

/** Quantize a heading to a multiple of TAU/65536 in [-π, π). */
export function qheading(h: number): number {
  return headingIndex(h) * HEADING_Q + 0;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
