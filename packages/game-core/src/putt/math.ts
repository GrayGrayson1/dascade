/**
 * Deterministic math for DAS Putt.
 *
 * The simulation must produce bit-identical results in V8 (server), JavaScriptCore and
 * SpiderMonkey (client previews), so it only uses IEEE-754 basic operations (+ − × ÷),
 * Math.sqrt, Math.floor/round/abs/min/max — all correctly rounded / exact everywhere.
 * `Math.sin/cos/atan2/hypot/pow` are NOT (they may differ in the last bit between engines),
 * so trigonometry is a fixed polynomial evaluated with basic operations only.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

export interface Vec {
  x: number;
  y: number;
}

/** sin(x) for any finite x, deterministic across JS engines (|error| < 1e-11). */
export function dsin(x: number): number {
  // Reduce to [-π, π] then to [-π/2, π/2] using the symmetry sin(π − x) = sin(x).
  const k = Math.round(x / TAU);
  let r = x - k * TAU;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  // Taylor series to x^17 (Horner form); on [-π/2, π/2] the truncation error is < 1e-12.
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 *
                (-1 / 5040 +
                  r2 *
                    (1 / 362880 +
                      r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000 + r2 * (1 / 355687428096000)))))))))
  );
}

/** cos(x), deterministic across JS engines. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** Integer hundredths of a degree → radians. */
export function unitsToRad(units: number): number {
  return (units * PI) / 18000;
}

/** Unit direction for an intent angle in hundredths of a degree (0 = +x, 9000 = +y). */
export function angleDir(units: number): Vec {
  const r = unitsToRad(units);
  return { x: dcos(r), y: dsin(r) };
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Positive fractional part (x mod 1). */
export function frac(x: number): number {
  return x - Math.floor(x);
}

/** Crossing-number point-in-polygon (flat [x0,y0,x1,y1,…] ring, implicitly closed). */
export function pointInPoly(px: number, py: number, ring: readonly number[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i]!;
    const yi = ring[i + 1]!;
    const xj = ring[j]!;
    const yj = ring[j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Squared distance from p to segment ab. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

/** Signed area of a flat ring (positive = clockwise in screen space, y down). */
export function ringArea(ring: readonly number[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += ring[j]! * ring[i + 1]! - ring[i]! * ring[j + 1]!;
  return a / 2;
}

/** Axis-aligned bounds of a flat ring. */
export function ringBounds(ring: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i]!;
    const y = ring[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Round to a 1/64 grid: lies are exactly representable as float32 in the synchronized state. */
export function snap64(v: number): number {
  return Math.round(v * 64) / 64;
}
