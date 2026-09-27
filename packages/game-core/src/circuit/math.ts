/**
 * Small, allocation-free math helpers shared by the circuit engine.
 *
 * The engine runs on the server and in client prediction, so it must be bit-identical
 * across JS engines: trigonometry and lengths come from the deterministic `detmath`
 * helpers below — never Math.sin/cos/atan2/hypot/pow (guarded by determinism.test.ts).
 */
export { datan2, dcos, dhypot, dsin } from '../detmath/index.ts';

export const TAU = Math.PI * 2;

/** Round to float32 so simulation state is exactly representable on the wire. */
export const f32 = Math.fround;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  if (a > -Math.PI && a <= Math.PI) return a;
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
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

/** Squared distance from point p to segment ab, with the clamped parameter t written to out[0]. */
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

/** Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). Returns [s, t]. */
export function closestSegSeg(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
): [number, number] {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-9;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) return [0, 0];
  if (a <= EPS) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  return [s, t];
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
