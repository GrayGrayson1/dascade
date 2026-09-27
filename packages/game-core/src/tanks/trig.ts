/**
 * Deterministic trigonometry for integer degrees.
 *
 * `Math.sin/cos` may differ in the last bit between JS engines (V8, JavaScriptCore,
 * SpiderMonkey), which would let a replayed shot drift. The direction table below is
 * built once from a fixed Taylor polynomial using only `+ - * /` — IEEE-754 guarantees
 * those are bit-identical everywhere — so every engine computes exactly the same
 * launch vectors.
 */

const PI = 3.141592653589793;

/** sin(x) for |x| ≤ π/4 (Taylor to x^19; error far below double epsilon). */
function sinSmall(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 9; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

/** cos(x) for |x| ≤ π/4. */
function cosSmall(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 9; n++) {
    term = (-term * x2) / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}

const COS = new Float64Array(360);
const SIN = new Float64Array(360);

(function build() {
  // First octant exactly, the rest by symmetry (so e.g. sin(90°) is exactly 1 and cos(90°) exactly 0).
  for (let d = 0; d <= 45; d++) {
    const r = (d * PI) / 180;
    SIN[d] = sinSmall(r);
    COS[d] = cosSmall(r);
  }
  for (let d = 46; d <= 90; d++) {
    SIN[d] = COS[90 - d]!;
    COS[d] = SIN[90 - d]!;
  }
  for (let d = 91; d < 180; d++) {
    SIN[d] = SIN[180 - d]!;
    COS[d] = -COS[180 - d]!;
  }
  for (let d = 180; d < 360; d++) {
    SIN[d] = -SIN[d - 180]!;
    COS[d] = -COS[d - 180]!;
  }
  COS[90] = 0;
  COS[270] = 0;
  SIN[180] = 0;
  SIN[0] = 0;
})();

function norm(deg: number): number {
  const d = Math.round(deg) % 360;
  return d < 0 ? d + 360 : d;
}

/** cos of an integer number of degrees (non-integers are rounded). */
export function dcos(deg: number): number {
  return COS[norm(deg)]!;
}

/** sin of an integer number of degrees (non-integers are rounded). */
export function dsin(deg: number): number {
  return SIN[norm(deg)]!;
}
