/**
 * Track geometry. A track is pure data: a closed ring of control points is turned
 * into a centripetal Catmull-Rom spline, resampled into an evenly spaced polyline
 * with cumulative arc length, tangents, normals and curvature. Everything the
 * simulation needs (surface detection, walls, progress, gates, grid, bridges) is
 * derived from that polyline.
 */
import type { CircuitTrackId } from '@dascade/shared/games/circuit';
import { datan2, dhypot, mod, pointSegDist2, segIntersect, wrapAngle } from './math.ts';

export interface TrackTheme {
  /** Ambient ground colour between city blocks. */
  ground: string;
  /** Asphalt base. */
  road: string;
  /** Run-off / gravel colour. */
  runoff: string;
  /** Primary neon (edge glow). */
  neonA: string;
  /** Secondary neon (rumble strips, signage). */
  neonB: string;
  /** Rumble strip base colour. */
  curb: string;
  /** Barrier body colour. */
  barrier: string;
}

export interface TrackDef {
  id: CircuitTrackId;
  name: string;
  tagline: string;
  style: string;
  /** Closed ring of control points. points[0] is the start/finish line. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Half the drivable road width. */
  halfWidth: number;
  /** Rumble strip width inside the road edge. */
  rumble: number;
  /** Run-off area between the road edge and the barrier. */
  runoff: number;
  /** Number of checkpoint gates including the start/finish line (gate 0). */
  gates: number;
  /** Half-length of the elevated deck around each self-crossing. */
  bridgeHalfLength: number;
  theme: TrackTheme;
  /** Binomial smoothing passes applied to the sampled centerline (default 60). */
  smoothing?: number;
  /** Seed for deterministic scenery generation. */
  decorSeed: number;
  /** A strong lap time used for the medal/"par" indicator (ms). */
  parLapMs: number;
}

export interface GridSlot {
  x: number;
  y: number;
  heading: number;
  s: number;
}

export interface Bridge {
  /** Arc-length span of the elevated pass. */
  from: number;
  to: number;
  /** Crossing point. */
  x: number;
  y: number;
  /** s of the crossing on the elevated pass and on the lower pass. */
  sUpper: number;
  sLower: number;
}

export interface Track {
  def: TrackDef;
  /** Number of samples (the polyline is closed: segment i joins sample i and i+1 mod n). */
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  /** Unit tangent per sample (direction of travel). */
  tx: Float64Array;
  ty: Float64Array;
  /** Cumulative arc length at each sample. */
  s: Float64Array;
  /** Segment length (sample i → i+1). */
  segLen: Float64Array;
  /** Signed curvature per sample (1/px). */
  curvature: Float64Array;
  length: number;
  spacing: number;
  halfWidth: number;
  rumble: number;
  runoff: number;
  /** Distance from the centerline to the barrier face. */
  wall: number;
  /** Arc-length position of each gate; gates[0] = 0 is the start/finish line. */
  gates: number[];
  grid: GridSlot[];
  bridges: Bridge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface TrackProjection {
  /** Segment index (sample i → i+1). */
  seg: number;
  /** Arc length of the closest point in [0, length). */
  s: number;
  /** Signed lateral offset (positive = the normal (-ty, tx) side). */
  d: number;
  /** Closest centerline point. */
  cx: number;
  cy: number;
  /** Unit tangent at the closest point. */
  tx: number;
  ty: number;
}

export const GRID_SLOTS = 20;
const SAMPLE_SPACING = 8;
const DENSE_PER_SEGMENT = 32;
const SEARCH_WINDOW = 40;

/** Centripetal Catmull-Rom point between p1 and p2. */
function catmullRom(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  u: number,
): [number, number] {
  // Centripetal knot spacing |b − a|^α with α = 0.5, i.e. √|b − a| (no Math.pow: see math.ts).
  const tj = (ti: number, a: readonly [number, number], b: readonly [number, number]) =>
    ti + Math.sqrt(dhypot(b[0] - a[0], b[1] - a[1])) || ti + 1e-4;
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp2 = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number): [number, number] => {
    const w = tb - ta === 0 ? 0 : (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp2(p0, p1, t0, t1);
  const a2 = lerp2(p1, p2, t1, t2);
  const a3 = lerp2(p2, p3, t2, t3);
  const b1 = lerp2(a1, a2, t0, t2);
  const b2 = lerp2(a2, a3, t1, t3);
  return lerp2(b1, b2, t1, t2);
}

export function buildTrack(def: TrackDef): Track {
  const pts = def.points;
  const m = pts.length;
  if (m < 4) throw new Error(`Track ${def.id} needs at least 4 control points`);

  // 1. Dense spline samples.
  const dense: Array<[number, number]> = [];
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % m]!;
    const p3 = pts[(i + 2) % m]!;
    for (let k = 0; k < DENSE_PER_SEGMENT; k++) dense.push(catmullRom(p0, p1, p2, p3, k / DENSE_PER_SEGMENT));
  }
  const dn = dense.length;
  const dS = new Float64Array(dn + 1);
  for (let i = 0; i < dn; i++) {
    const a = dense[i]!;
    const b = dense[(i + 1) % dn]!;
    dS[i + 1] = dS[i]! + dhypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = dS[dn]!;

  // 2. Uniform resample by arc length, smooth out spline kinks, resample again.
  let ring = resample(dense, dS, length);
  ring = smoothRing(ring, def.smoothing ?? 60);
  const { xs, ys } = ring;
  const n = xs.length;
  let dense2Len = 0;
  for (let i = 0; i < n; i++) dense2Len += dhypot(xs[(i + 1) % n]! - xs[i]!, ys[(i + 1) % n]! - ys[i]!);
  const spacing = dense2Len / n;

  // 3. Per-sample tangents, segment lengths, arc length and curvature.
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const segLen = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nx = (i + 1) % n;
    const pv = (i - 1 + n) % n;
    const dx = xs[nx]! - xs[pv]!;
    const dy = ys[nx]! - ys[pv]!;
    const l = dhypot(dx, dy) || 1;
    tx[i] = dx / l;
    ty[i] = dy / l;
    segLen[i] = dhypot(xs[nx]! - xs[i]!, ys[nx]! - ys[i]!);
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    s[i] = acc;
    acc += segLen[i]!;
  }
  const realLength = acc;
  const curvature = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = datan2(ty[(i - 1 + n) % n]!, tx[(i - 1 + n) % n]!);
    const b = datan2(ty[(i + 1) % n]!, tx[(i + 1) % n]!);
    curvature[i] = wrapAngle(b - a) / (2 * spacing);
  }

  const wall = def.halfWidth + def.runoff;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]!);
    minY = Math.min(minY, ys[i]!);
    maxX = Math.max(maxX, xs[i]!);
    maxY = Math.max(maxY, ys[i]!);
  }

  const track: Track = {
    def,
    n,
    xs,
    ys,
    tx,
    ty,
    s,
    segLen,
    curvature,
    length: realLength,
    spacing,
    halfWidth: def.halfWidth,
    rumble: def.rumble,
    runoff: def.runoff,
    wall,
    gates: [],
    grid: [],
    bridges: [],
    bounds: { minX: minX - wall, minY: minY - wall, maxX: maxX + wall, maxY: maxY + wall },
  };

  for (let g = 0; g < Math.max(1, def.gates); g++) track.gates.push((g * realLength) / Math.max(1, def.gates));

  // 4. Starting grid: staggered two-wide behind the line.
  for (let k = 0; k < GRID_SLOTS; k++) {
    const row = Math.floor(k / 2);
    const side = k % 2 === 0 ? -1 : 1;
    const sPos = mod(-(96 + row * 66 + (k % 2) * 33), realLength);
    const p = pointAt(track, sPos);
    const off = side * def.halfWidth * 0.42;
    track.grid.push({ x: p.x - p.ty * off, y: p.y + p.tx * off, heading: datan2(p.ty, p.tx), s: sPos });
  }

  // 5. Self-crossings become bridges (the later pass is elevated).
  track.bridges = findBridges(track, def.bridgeHalfLength);
  return track;
}

function findBridges(track: Track, halfLength: number): Bridge[] {
  const { n, xs, ys, s, length } = track;
  const out: Bridge[] = [];
  const minGap = Math.ceil((track.wall * 4) / track.spacing);
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const ax = xs[i]!;
    const ay = ys[i]!;
    const bx = xs[i2]!;
    const by = ys[i2]!;
    for (let j = i + minGap; j < n; j++) {
      if (n - j + i < minGap) break;
      const j2 = (j + 1) % n;
      const cx = xs[j]!;
      const cy = ys[j]!;
      const dx = xs[j2]!;
      const dy = ys[j2]!;
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) continue;
      if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
      const hit = segIntersect(ax, ay, bx, by, cx, cy, dx, dy);
      if (!hit) continue;
      const sLower = s[i]! + hit[0] * track.segLen[i]!;
      const sUpper = s[j]! + hit[1] * track.segLen[j]!;
      out.push({
        from: mod(sUpper - halfLength, length),
        to: mod(sUpper + halfLength, length),
        x: ax + (bx - ax) * hit[0],
        y: ay + (by - ay) * hit[0],
        sUpper,
        sLower,
      });
    }
  }
  return out;
}

function resample(dense: Array<[number, number]>, dS: Float64Array, length: number): { xs: Float64Array; ys: Float64Array } {
  const dn = dense.length;
  const n = Math.max(16, Math.round(length / SAMPLE_SPACING));
  const spacing = length / n;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = k * spacing;
    while (j < dn - 1 && dS[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dn]!;
    const segL = dS[j + 1]! - dS[j]!;
    const w = segL > 0 ? (target - dS[j]!) / segL : 0;
    xs[k] = a[0] + (b[0] - a[0]) * w;
    ys[k] = a[1] + (b[1] - a[1]) * w;
  }
  return { xs, ys };
}

/** Binomial smoothing of a closed ring (keeps point 0 on the same arc position), then an even resample. */
function smoothRing(ring: { xs: Float64Array; ys: Float64Array }, iterations: number): { xs: Float64Array; ys: Float64Array } {
  const n = ring.xs.length;
  let xs = ring.xs;
  let ys = ring.ys;
  for (let it = 0; it < iterations; it++) {
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      nx[i] = (xs[a]! + 2 * xs[i]! + xs[b]!) / 4;
      ny[i] = (ys[a]! + 2 * ys[i]! + ys[b]!) / 4;
    }
    xs = nx;
    ys = ny;
  }
  const dense: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) dense.push([xs[i]!, ys[i]!]);
  const dS = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) dS[i + 1] = dS[i]! + dhypot(xs[(i + 1) % n]! - xs[i]!, ys[(i + 1) % n]! - ys[i]!);
  return resample(dense, dS, dS[n]!);
}

/** Interpolated centerline point + tangent at arc length s. */
export function pointAt(track: Track, sPos: number): { x: number; y: number; tx: number; ty: number } {
  const sp = mod(sPos, track.length);
  let i = Math.min(track.n - 1, Math.floor(sp / track.spacing));
  // Guard against accumulated spacing drift.
  while (i > 0 && track.s[i]! > sp) i--;
  while (i < track.n - 1 && track.s[i + 1]! <= sp) i++;
  const i2 = (i + 1) % track.n;
  const w = track.segLen[i]! > 0 ? (sp - track.s[i]!) / track.segLen[i]! : 0;
  const x = track.xs[i]! + (track.xs[i2]! - track.xs[i]!) * w;
  const y = track.ys[i]! + (track.ys[i2]! - track.ys[i]!) * w;
  const tx = track.tx[i]! + (track.tx[i2]! - track.tx[i]!) * w;
  const ty = track.ty[i]! + (track.ty[i2]! - track.ty[i]!) * w;
  const l = dhypot(tx, ty) || 1;
  return { x, y, tx: tx / l, ty: ty / l };
}

/** Sample index nearest to arc length s. */
export function segAt(track: Track, sPos: number): number {
  return Math.min(track.n - 1, Math.max(0, Math.floor(mod(sPos, track.length) / track.spacing)));
}

const tmpT = [0];

function searchRange(track: Track, x: number, y: number, from: number, count: number, best: { d2: number; seg: number; t: number }): void {
  const { n, xs, ys } = track;
  for (let k = 0; k < count; k++) {
    const i = (((from + k) % n) + n) % n;
    const i2 = (i + 1) % n;
    const d2 = pointSegDist2(x, y, xs[i]!, ys[i]!, xs[i2]!, ys[i2]!, tmpT);
    if (d2 < best.d2) {
      best.d2 = d2;
      best.seg = i;
      best.t = tmpT[0]!;
    }
  }
}

/**
 * Project a point onto the centerline. With a valid `hint` (the previous segment)
 * only a local window is searched, which keeps progress continuous through
 * crossovers and hairpins; a global search is the fallback when the hint is lost.
 */
export function projectOnTrack(track: Track, x: number, y: number, hint = -1): TrackProjection {
  const best = { d2: Infinity, seg: 0, t: 0 };
  if (hint >= 0 && hint < track.n) {
    searchRange(track, x, y, hint - SEARCH_WINDOW, SEARCH_WINDOW * 2 + 1, best);
    const lostLimit = track.wall + 80;
    if (best.d2 > lostLimit * lostLimit) {
      best.d2 = Infinity;
      searchRange(track, x, y, 0, track.n, best);
    }
  } else {
    searchRange(track, x, y, 0, track.n, best);
  }
  const i = best.seg;
  const i2 = (i + 1) % track.n;
  const ax = track.xs[i]!;
  const ay = track.ys[i]!;
  const dx = track.xs[i2]! - ax;
  const dy = track.ys[i2]! - ay;
  const len = dhypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const cx = ax + dx * best.t;
  const cy = ay + dy * best.t;
  const d = (x - cx) * -ty + (y - cy) * tx;
  return { seg: i, s: mod(track.s[i]! + best.t * track.segLen[i]!, track.length), d, cx, cy, tx, ty };
}

/** 1 when s lies on an elevated (bridge) span, else 0. */
export function levelAt(track: Track, sPos: number): number {
  for (const b of track.bridges) {
    if (b.from <= b.to ? sPos >= b.from && sPos <= b.to : sPos >= b.from || sPos <= b.to) return 1;
  }
  return 0;
}
