/**
 * Allocation-free math helpers for the kart engine. Everything here is shared by the server and
 * client prediction, so it only uses `+ - * /`, `Math.sqrt` and exact rounding: trigonometry comes
 * from ../detmath (guarded by determinism.test.ts).
 */
export { datan2, dcos, dhypot, dsin, PI, TAU, HALF_PI } from '../detmath/index.ts';
export { clamp, lerp, mod, loopDelta, pointSegDist2, segIntersect, wrapAngle, lerpAngle } from '../circuit/math.ts';

/** Round to float32 (x, y are float32 on the wire). */
export const f32 = Math.fround;

/** Quantization steps of kart state (exactly the wire representation). */
export const Q_Z = 128;
export const Q_VEL = 256;
export const Q_ANG = 1024;
export const HEADING_STEPS = 65536;
export const HEADING_Q = 6.283185307179586 / HEADING_STEPS;

export function qz(v: number): number {
  const q = Math.round(v * Q_Z);
  return (q < -32768 ? -32768 : q > 32767 ? 32767 : q) / Q_Z;
}

export function qvel(v: number): number {
  const q = Math.round(v * Q_VEL);
  return (q < -32767 ? -32767 : q > 32767 ? 32767 : q) / Q_VEL;
}

export function qang(v: number): number {
  const q = Math.round(v * Q_ANG);
  return (q < -32767 ? -32767 : q > 32767 ? 32767 : q) / Q_ANG;
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
  return headingIndex(h) * HEADING_Q;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
