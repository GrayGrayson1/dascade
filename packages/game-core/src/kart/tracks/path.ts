/**
 * Turtle paths for authoring tracks with exact corner radii: a list of straights and constant-
 * radius arcs becomes control points for the centripetal spline. Heights ramp linearly per piece.
 * `closeLoop` spreads a small closing error along the lap so the ring meets itself exactly.
 */
import type { ControlPoint } from '../trackdef.ts';
import { dcos, dsin, PI } from '../math.ts';

export type PathPiece =
  /** A straight of `len` u, ending at height `z` (default: unchanged). */
  | { straight: number; z?: number; hw?: number }
  /** An arc of `deg` degrees (+ = left) at radius `r`, ending at height `z`. */
  | { arc: number; r: number; z?: number; hw?: number };

export interface PathResult {
  points: ControlPoint[];
  /** End pose before closing (for authoring). */
  end: { x: number; y: number; heading: number; gap: number };
  length: number;
  /** Distance along the path at the start of each piece (+ the total at the end). */
  marks: number[];
  /** Position `t` (0..1) through piece `index` (after closing), for placing branch points. */
  at(index: number, t: number): { x: number; y: number; z: number };
}

/** Lap fraction at `t` (0..1) through piece `index` of a turtle path (for placing features). */
export function pieceFrac(path: PathResult, index: number, t = 0.5): number {
  const a = path.marks[index]!;
  const b = path.marks[index + 1]!;
  return ((((a + (b - a) * t) / path.length) % 1) + 1) % 1;
}

/**
 * Walk the pieces from (x0, y0) facing `heading0` (degrees). Straights get a point every ~45 u;
 * arcs every ≤ 22° (and ≤ 14 u), so the spline reproduces the radius closely.
 */
export function turtle(
  pieces: readonly PathPiece[],
  opts: { x0?: number; y0?: number; heading0?: number; z0?: number; closeLoop?: boolean } = {},
): PathResult {
  let x = opts.x0 ?? 0;
  let y = opts.y0 ?? 0;
  let h = ((opts.heading0 ?? 0) * PI) / 180;
  let z = opts.z0 ?? 0;
  const pts: Array<[number, number, number, number | undefined, number]> = [[x, y, z, undefined, 0]];
  let dist = 0;
  const marks: number[] = [];
  for (const p of pieces) {
    marks.push(dist);
    const z1 = p.z ?? z;
    if ('straight' in p) {
      const n = Math.max(1, Math.ceil(p.straight / 45));
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        pts.push([x + dcos(h) * p.straight * f, y + dsin(h) * p.straight * f, z + (z1 - z) * f, p.hw, dist + p.straight * f]);
      }
      x += dcos(h) * p.straight;
      y += dsin(h) * p.straight;
      dist += p.straight;
    } else {
      const a = (p.arc * PI) / 180;
      const len = Math.abs(a) * p.r;
      const n = Math.max(2, Math.ceil(Math.max(Math.abs(p.arc) / 22, len / 14)));
      const side = a >= 0 ? 1 : -1;
      // Centre of the turn: to the left (+) or right (−) of the heading.
      const cx = x - dsin(h) * p.r * side;
      const cy = y + dcos(h) * p.r * side;
      const a0 = h - (side * PI) / 2;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const ang = a0 + a * f;
        pts.push([cx + dcos(ang) * p.r, cy + dsin(ang) * p.r, z + (z1 - z) * f, p.hw, dist + len * f]);
      }
      const ang = a0 + a;
      x = cx + dcos(ang) * p.r;
      y = cy + dsin(ang) * p.r;
      h += a;
      dist += len;
    }
    z = z1;
  }
  marks.push(dist);
  const x0 = pts[0]![0];
  const y0 = pts[0]![1];
  const gx = x - x0;
  const gy = y - y0;
  const gap = Math.sqrt(gx * gx + gy * gy);
  const end = { x, y, heading: ((((h * 180) / PI) % 360) + 360) % 360, gap };
  if (opts.closeLoop !== false) {
    // Drop the final point (it duplicates the start) and spread the error by distance.
    pts.pop();
    for (const p of pts) {
      const f = p[4] / dist;
      p[0] -= gx * f;
      p[1] -= gy * f;
    }
  }
  const points: ControlPoint[] = pts.map(([px, py, pz, hw]) =>
    hw === undefined ? [round(px), round(py), round(pz)] : [round(px), round(py), round(pz), hw],
  );
  const at = (index: number, t: number) => {
    const d = marks[index]! + (marks[index + 1]! - marks[index]!) * t;
    let k = 1;
    while (k < pts.length - 1 && pts[k]![4] < d) k++;
    const a = pts[k - 1]!;
    const b = pts[k]!;
    const w = b[4] > a[4] ? Math.min(1, Math.max(0, (d - a[4]) / (b[4] - a[4]))) : 0;
    return { x: round(a[0] + (b[0] - a[0]) * w), y: round(a[1] + (b[1] - a[1]) * w), z: round(a[2] + (b[2] - a[2]) * w) };
  };
  return { points, end, length: dist, marks, at };
}

const round = (v: number) => Math.round(v * 100) / 100;
