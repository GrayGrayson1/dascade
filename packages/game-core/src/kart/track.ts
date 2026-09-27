/**
 * Track builder + road queries. A `KartTrackDef` (pure data, trackdef.ts) becomes a `KartTrack`:
 * the main centreline as an evenly spaced closed polyline (arc length, tangents, heights, per-side
 * half-widths and edge kinds), branches sampled the same way, checkpoint gates, a 30-slot grid,
 * item cubes, pads/ramps/gaps/zones, hazards and a racing line for bots.
 *
 * Shared by the server, client prediction and the renderer, so only deterministic math is used.
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import { clamp, datan2, dcos, dhypot, dsin, mod, pointSegDist2, segIntersect, wrapAngle, TAU } from './math.ts';
import type { BranchDef, ControlPoint, HazardKind, KartTrackDef, ZoneKind } from './trackdef.ts';

export const EDGE_WALL = 0;
export const EDGE_DROP = 1;

export const SURF_ROAD = 0;
export const SURF_OFFROAD = 1;
export const SURF_ICE = 2;
export const SURF_MUD = 3;
export const SURF_CONVEYOR = 4;
export const SURF_DIRT = 5;
export type SurfaceCode = 0 | 1 | 2 | 3 | 4 | 5;

export const KART_GRID_SLOTS = 30;
/** Target sample spacing of the centreline (u). */
export const TRACK_SPACING = 2.5;
/** Gravity (u/s²) used by the physics and by the builder's jump checks. */
export const GRAVITY = 30;

const DENSE_PER_SEGMENT = 24;
/** Samples searched either side of the hint when projecting. */
const WINDOW = 14;

export class KartTrackError extends Error {
  constructor(id: string, message: string) {
    super(`Kart track "${id}": ${message}`);
    this.name = 'KartTrackError';
  }
}

export interface GridSlot {
  x: number;
  y: number;
  z: number;
  heading: number;
  s: number;
  d: number;
}

export interface BuiltBranch {
  index: number;
  def: BranchDef;
  surface: 'road' | 'dirt';
  /** Main-line s where it leaves / rejoins. */
  from: number;
  to: number;
  n: number;
  spacing: number;
  length: number;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  s: Float64Array;
  segLen: Float64Array;
  curvature: Float64Array;
  hwL: Float64Array;
  hwR: Float64Array;
}

export interface BuiltBoostPad {
  s: number;
  d: number;
  length: number;
  width: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface BuiltRamp {
  s: number;
  d: number;
  width: number;
  launch: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface BuiltGap {
  from: number;
  to: number;
}

export interface BuiltZone {
  from: number;
  to: number;
  d0: number;
  d1: number;
  kind: ZoneKind;
  push: number;
}

export interface BuiltItemBox {
  x: number;
  y: number;
  z: number;
  s: number;
  d: number;
  row: number;
}

export interface BuiltHazard {
  index: number;
  kind: HazardKind;
  s: number;
  d: number;
  radius: number;
  periodTicks: number;
  /** Phase offset in ticks. */
  phase: number;
  amp: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface BuiltLandmark {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** World yaw (radians). */
  yaw: number;
  scale: number;
  s: number;
  d: number;
}

export interface RacingLine {
  d: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  curvature: Float64Array;
}

export interface KartTrack {
  def: KartTrackDef;
  id: KartTrackId;
  length: number;
  n: number;
  spacing: number;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  s: Float64Array;
  segLen: Float64Array;
  curvature: Float64Array;
  grade: Float64Array;
  hwL: Float64Array;
  hwR: Float64Array;
  edgeL: Uint8Array;
  edgeR: Uint8Array;
  noGround: Uint8Array;
  shoulder: number;
  branches: BuiltBranch[];
  gates: number[];
  grid: GridSlot[];
  boostPads: BuiltBoostPad[];
  ramps: BuiltRamp[];
  gaps: BuiltGap[];
  zones: BuiltZone[];
  itemBoxes: BuiltItemBox[];
  hazards: BuiltHazard[];
  landmarks: BuiltLandmark[];
  racingLine: RacingLine;
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}

// ---------------------------------------------------------------------------
// Spline sampling
// ---------------------------------------------------------------------------

type P4 = [number, number, number, number];

/** Centripetal Catmull-Rom (Barry–Goldman) over (x, y, z, hw) with knots from the planar distance. */
function catmullRom4(p0: P4, p1: P4, p2: P4, p3: P4, u: number, out: P4): void {
  const knot = (ti: number, a: P4, b: P4) => ti + (Math.sqrt(dhypot(b[0] - a[0], b[1] - a[1])) || 1e-4);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  for (let c = 0; c < 4; c++) {
    const l = (a: number, b: number, ta: number, tb: number) => (tb - ta === 0 ? a : a + ((b - a) * (t - ta)) / (tb - ta));
    const a1 = l(p0[c]!, p1[c]!, t0, t1);
    const a2 = l(p1[c]!, p2[c]!, t1, t2);
    const a3 = l(p2[c]!, p3[c]!, t2, t3);
    const b1 = l(a1, a2, t0, t2);
    const b2 = l(a2, a3, t1, t3);
    out[c] = l(b1, b2, t1, t2);
  }
}

interface Sampled {
  n: number;
  spacing: number;
  length: number;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  hw: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  s: Float64Array;
  segLen: Float64Array;
  curvature: Float64Array;
}

/**
 * Dense spline → even resample. `closed` rings wrap; open polylines (branches) are sampled from
 * pts[1] to pts[m-2] (pts[0] and pts[m-1] only shape the end tangents).
 */
function sampleSpline(pts: readonly P4[], closed: boolean): Sampled {
  const m = pts.length;
  const dense: P4[] = [];
  const segs = closed ? m : m - 3;
  for (let i = 0; i < segs; i++) {
    const i1 = closed ? i : i + 1;
    const p0 = pts[(i1 - 1 + m) % m]!;
    const p1 = pts[i1 % m]!;
    const p2 = pts[(i1 + 1) % m]!;
    const p3 = pts[(i1 + 2) % m]!;
    for (let k = 0; k < DENSE_PER_SEGMENT; k++) {
      const o: P4 = [0, 0, 0, 0];
      catmullRom4(p0, p1, p2, p3, k / DENSE_PER_SEGMENT, o);
      dense.push(o);
    }
  }
  if (!closed) dense.push([...pts[m - 2]!] as P4);
  const dn = dense.length;
  const edges = closed ? dn : dn - 1;
  const dS = new Float64Array(edges + 1);
  for (let i = 0; i < edges; i++) {
    const a = dense[i]!;
    const b = dense[(i + 1) % dn]!;
    dS[i + 1] = dS[i]! + dhypot(b[0] - a[0], b[1] - a[1]);
  }
  const total = dS[edges]!;
  const segCount = Math.max(closed ? 16 : 2, Math.round(total / TRACK_SPACING));
  const spacing = total / segCount;
  const n = closed ? segCount : segCount + 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  const hw = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = Math.min(total, k * spacing);
    while (j < edges - 1 && dS[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dn]!;
    const segL = dS[j + 1]! - dS[j]!;
    const w = segL > 0 ? clamp((target - dS[j]!) / segL, 0, 1) : 0;
    xs[k] = a[0] + (b[0] - a[0]) * w;
    ys[k] = a[1] + (b[1] - a[1]) * w;
    zs[k] = a[2] + (b[2] - a[2]) * w;
    hw[k] = a[3] + (b[3] - a[3]) * w;
  }
  return finishPolyline(xs, ys, zs, hw, closed);
}

function finishPolyline(xs: Float64Array, ys: Float64Array, zs: Float64Array, hw: Float64Array, closed: boolean): Sampled {
  const n = xs.length;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const segLen = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nx = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const pv = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const dx = xs[nx]! - xs[pv]!;
    const dy = ys[nx]! - ys[pv]!;
    const l = dhypot(dx, dy) || 1;
    tx[i] = dx / l;
    ty[i] = dy / l;
    if (closed || i < n - 1) {
      const i2 = (i + 1) % n;
      segLen[i] = dhypot(xs[i2]! - xs[i]!, ys[i2]! - ys[i]!);
    }
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    s[i] = acc;
    acc += segLen[i]!;
  }
  const length = closed ? acc : s[n - 1]!;
  const curvature = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    if (a === b) continue;
    const ds = closed ? segLen[a]! + segLen[i]! : s[b]! - s[a]!;
    curvature[i] = ds > 0 ? wrapAngle(datan2(ty[b]!, tx[b]!) - datan2(ty[a]!, tx[a]!)) / ds : 0;
  }
  return { n, spacing: length / (closed ? n : n - 1), length, xs, ys, zs, hw, tx, ty, s, segLen, curvature };
}

// ---------------------------------------------------------------------------
// Helpers on the built main line
// ---------------------------------------------------------------------------

function inSpan(sv: number, from: number, to: number): boolean {
  return from <= to ? sv >= from && sv <= to : sv >= from || sv <= to;
}

/** Sample index i with s[i] ≤ s < s[i+1] on the main ring. */
export function mainIndexAt(track: KartTrack, sPos: number): number {
  const sp = mod(sPos, track.length);
  let i = Math.min(track.n - 1, Math.floor(sp / track.spacing));
  while (i > 0 && track.s[i]! > sp) i--;
  while (i < track.n - 1 && track.s[i + 1]! <= sp) i++;
  return i;
}

export interface CentrePoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  hwL: number;
  hwR: number;
}

/** Interpolated main-line point at arc length s (wraps). */
export function pointAtS(track: KartTrack, sPos: number): CentrePoint {
  const sp = mod(sPos, track.length);
  const i = mainIndexAt(track, sp);
  const i2 = (i + 1) % track.n;
  const w = track.segLen[i]! > 0 ? clamp((sp - track.s[i]!) / track.segLen[i]!, 0, 1) : 0;
  const tx = track.tx[i]! + (track.tx[i2]! - track.tx[i]!) * w;
  const ty = track.ty[i]! + (track.ty[i2]! - track.ty[i]!) * w;
  const l = dhypot(tx, ty) || 1;
  return {
    x: track.xs[i]! + (track.xs[i2]! - track.xs[i]!) * w,
    y: track.ys[i]! + (track.ys[i2]! - track.ys[i]!) * w,
    z: track.zs[i]! + (track.zs[i2]! - track.zs[i]!) * w,
    tx: tx / l,
    ty: ty / l,
    hwL: track.hwL[i]! + (track.hwL[i2]! - track.hwL[i]!) * w,
    hwR: track.hwR[i]! + (track.hwR[i2]! - track.hwR[i]!) * w,
  };
}

/** World position of (s, d) on the main line. */
export function worldAt(track: KartTrack, sPos: number, d: number): { x: number; y: number; z: number; heading: number } {
  const p = pointAtS(track, sPos);
  return { x: p.x - p.ty * d, y: p.y + p.tx * d, z: p.z, heading: datan2(p.ty, p.tx) };
}

/** Racing-line point at main s (interpolated). */
export function racingPointAt(track: KartTrack, sPos: number): { x: number; y: number; z: number; d: number } {
  const sp = mod(sPos, track.length);
  const i = mainIndexAt(track, sp);
  const i2 = (i + 1) % track.n;
  const w = track.segLen[i]! > 0 ? clamp((sp - track.s[i]!) / track.segLen[i]!, 0, 1) : 0;
  const rl = track.racingLine;
  return {
    x: rl.xs[i]! + (rl.xs[i2]! - rl.xs[i]!) * w,
    y: rl.ys[i]! + (rl.ys[i2]! - rl.ys[i]!) * w,
    z: rl.zs[i]! + (rl.zs[i2]! - rl.zs[i]!) * w,
    d: rl.d[i]! + (rl.d[i2]! - rl.d[i]!) * w,
  };
}

// ---------------------------------------------------------------------------
// Projection / ground queries
// ---------------------------------------------------------------------------

export interface RoadHint {
  branch: number;
  seg: number;
}

export interface GroundInfo {
  z: number;
  hasGround: boolean;
  s: number;
  roadS: number;
  d: number;
  branch: number;
  seg: number;
  onRoad: boolean;
  surface: SurfaceCode;
  edge: 0 | 1;
  hw: number;
  tx: number;
  ty: number;
}

/** Internal projection result (reused scratch objects in hot paths). */
export interface Loc {
  branch: number;
  seg: number;
  t: number;
  roadS: number;
  s: number;
  d: number;
  tx: number;
  ty: number;
  z: number;
  hwL: number;
  hwR: number;
  edgeL: number;
  edgeR: number;
  noGround: boolean;
  /** Squared planar distance to the centreline. */
  dist2: number;
  /** Distance past an open branch end along its tangent (0 on the main ring / inside a branch). */
  beyond: number;
}

export function newLoc(): Loc {
  return {
    branch: -1,
    seg: 0,
    t: 0,
    roadS: 0,
    s: 0,
    d: 0,
    tx: 1,
    ty: 0,
    z: 0,
    hwL: 1,
    hwR: 1,
    edgeL: 0,
    edgeR: 0,
    noGround: false,
    dist2: 0,
    beyond: 0,
  };
}

const tmpT = [0];

interface Poly {
  n: number;
  xs: Float64Array;
  ys: Float64Array;
}

function searchPoly(
  p: Poly,
  closed: boolean,
  x: number,
  y: number,
  from: number,
  count: number,
  best: { d2: number; seg: number; t: number },
): void {
  const n = p.n;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < count; k++) {
    let i = from + k;
    if (closed) i = ((i % n) + n) % n;
    else if (i < 0 || i >= segs) continue;
    const i2 = closed ? (i + 1) % n : i + 1;
    const d2 = pointSegDist2(x, y, p.xs[i]!, p.ys[i]!, p.xs[i2]!, p.ys[i2]!, tmpT);
    if (d2 < best.d2) {
      best.d2 = d2;
      best.seg = i;
      best.t = tmpT[0]!;
    }
  }
}

const bestA = { d2: Infinity, seg: 0, t: 0 };

function fillMain(track: KartTrack, x: number, y: number, seg: number, t: number, d2: number, out: Loc): void {
  const n = track.n;
  const i = seg;
  const i2 = (i + 1) % n;
  const ax = track.xs[i]!;
  const ay = track.ys[i]!;
  const dx = track.xs[i2]! - ax;
  const dy = track.ys[i2]! - ay;
  const len = dhypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  out.branch = -1;
  out.seg = i;
  out.t = t;
  out.roadS = mod(track.s[i]! + t * track.segLen[i]!, track.length);
  out.s = out.roadS;
  out.d = (x - cx) * -ty + (y - cy) * tx;
  out.tx = tx;
  out.ty = ty;
  out.z = track.zs[i]! + (track.zs[i2]! - track.zs[i]!) * t;
  out.hwL = track.hwL[i]! + (track.hwL[i2]! - track.hwL[i]!) * t;
  out.hwR = track.hwR[i]! + (track.hwR[i2]! - track.hwR[i]!) * t;
  const near = t < 0.5 ? i : i2;
  out.edgeL = track.edgeL[near]!;
  out.edgeR = track.edgeR[near]!;
  out.noGround = track.noGround[near] === 1;
  out.dist2 = d2;
  out.beyond = 0;
}

function fillBranch(track: KartTrack, b: BuiltBranch, x: number, y: number, seg: number, t: number, d2: number, out: Loc): void {
  const i = seg;
  const i2 = i + 1;
  const ax = b.xs[i]!;
  const ay = b.ys[i]!;
  const dx = b.xs[i2]! - ax;
  const dy = b.ys[i2]! - ay;
  const len = dhypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  out.branch = b.index;
  out.seg = i;
  out.t = t;
  out.roadS = b.s[i]! + t * b.segLen[i]!;
  out.s = mod(b.from + (out.roadS / b.length) * (b.to - b.from), track.length);
  out.d = (x - cx) * -ty + (y - cy) * tx;
  out.tx = tx;
  out.ty = ty;
  out.z = b.zs[i]! + (b.zs[i2]! - b.zs[i]!) * t;
  out.hwL = b.hwL[i]! + (b.hwL[i2]! - b.hwL[i]!) * t;
  out.hwR = b.hwR[i]! + (b.hwR[i2]! - b.hwR[i]!) * t;
  out.edgeL = track.def.edge === 'drop' ? EDGE_DROP : EDGE_WALL;
  out.edgeR = out.edgeL;
  out.noGround = false;
  out.dist2 = d2;
  // Clamped at an open end: how far past it the point lies (along the road).
  out.beyond = (i === 0 && t === 0) || (i === b.n - 2 && t === 1) ? Math.sqrt(Math.max(0, d2 - out.d * out.d)) : 0;
}

/** How far outside its road a location is (negative = inside the road); past a branch end counts double. */
function excess(l: Loc): number {
  return Math.abs(l.d) - (l.d >= 0 ? l.hwL : l.hwR) + l.beyond * 2;
}

const candMain = newLoc();
const candBranch = newLoc();

function copyLoc(from: Loc, to: Loc): void {
  to.branch = from.branch;
  to.seg = from.seg;
  to.t = from.t;
  to.roadS = from.roadS;
  to.s = from.s;
  to.d = from.d;
  to.tx = from.tx;
  to.ty = from.ty;
  to.z = from.z;
  to.hwL = from.hwL;
  to.hwR = from.hwR;
  to.edgeL = from.edgeL;
  to.edgeR = from.edgeR;
  to.noGround = from.noGround;
  to.dist2 = from.dist2;
  to.beyond = from.beyond;
}

function projectMain(track: KartTrack, x: number, y: number, hintSeg: number, out: Loc): void {
  bestA.d2 = Infinity;
  if (hintSeg >= 0 && hintSeg < track.n) {
    searchPoly(track, true, x, y, hintSeg - WINDOW, WINDOW * 2 + 1, bestA);
    const lost = track.hwL[hintSeg]! + track.hwR[hintSeg]! + track.shoulder * 2 + 30;
    if (bestA.d2 > lost * lost) {
      bestA.d2 = Infinity;
      searchPoly(track, true, x, y, 0, track.n, bestA);
    }
  } else {
    searchPoly(track, true, x, y, 0, track.n, bestA);
  }
  fillMain(track, x, y, bestA.seg, bestA.t, bestA.d2, out);
}

function projectBranch(track: KartTrack, b: BuiltBranch, x: number, y: number, from: number, count: number, out: Loc): boolean {
  bestA.d2 = Infinity;
  searchPoly(b, false, x, y, from, count, bestA);
  if (bestA.d2 === Infinity) return false;
  fillBranch(track, b, x, y, bestA.seg, bestA.t, bestA.d2, out);
  return true;
}

/** Junction zone lengths (u) in which the other road is considered. */
const JUNCTION = 30;
/**
 * Road switching inside a junction: a kart only changes road once it is within this distance (u)
 * of its current road's edge (or beyond it) and the other road contains it better. A kart
 * brushing the branch side of the main road stays on the main road; the margin is larger than the
 * kart radius so a wall at the road edge (no shoulder) can never block a real switch.
 */
const SWITCH_EDGE = 1.5;

/** With a shoulder the kart must actually leave its road to switch; with a wall at the edge, get close. */
function prefer(track: KartTrack, candidate: number, current: number): boolean {
  return current > (track.shoulder >= SWITCH_EDGE ? 0 : -SWITCH_EDGE) && candidate < current - 0.01;
}

/**
 * Project (x, y) onto the road network near the hint: the main line within a local window (so
 * hairpins and overpasses never alias) plus any branch whose junction is nearby. The road the
 * point is most "inside" wins (ties keep the current road).
 */
export function locate(track: KartTrack, x: number, y: number, branch: number, seg: number, out: Loc): Loc {
  const bs = track.branches;
  if (branch >= 0 && branch < bs.length) {
    const b = bs[branch]!;
    const segC = clamp(seg, 0, b.n - 2);
    if (!projectBranch(track, b, x, y, segC - WINDOW, WINDOW * 2 + 1, candBranch) || candBranch.dist2 > 60 * 60) {
      projectMain(track, x, y, -1, out);
      return out;
    }
    copyLoc(candBranch, out);
    if (candBranch.roadS < JUNCTION || candBranch.roadS > b.length - JUNCTION) {
      const mainHint = mainIndexAt(track, candBranch.s);
      projectMain(track, x, y, mainHint, candMain);
      if (prefer(track, excess(candMain), excess(candBranch))) copyLoc(candMain, out);
    }
    return out;
  }
  projectMain(track, x, y, seg, candMain);
  copyLoc(candMain, out);
  let bestEx = excess(candMain);
  for (let k = 0; k < bs.length; k++) {
    const b = bs[k]!;
    const nearStart = inSpan(candMain.s, mod(b.from - JUNCTION * 0.5, track.length), mod(b.from + JUNCTION, track.length));
    const nearEnd = inSpan(candMain.s, mod(b.to - JUNCTION, track.length), mod(b.to + JUNCTION * 0.5, track.length));
    if (!nearStart && !nearEnd) continue;
    const span = Math.ceil(JUNCTION / b.spacing) + 2;
    const ok = nearStart
      ? projectBranch(track, b, x, y, 0, span, candBranch)
      : projectBranch(track, b, x, y, b.n - 1 - span, span, candBranch);
    if (!ok) continue;
    const ex = excess(candBranch);
    if (prefer(track, ex, bestEx)) {
      bestEx = ex;
      copyLoc(candBranch, out);
    }
  }
  return out;
}

const zoneScratch = { kind: -1 as number, push: 0 };

/** The surface zone at main s / lateral d (zones only exist on the main road). Returns -1 = none. */
export function zoneAt(track: KartTrack, sPos: number, d: number): { kind: number; push: number } {
  zoneScratch.kind = -1;
  zoneScratch.push = 0;
  for (const z of track.zones) {
    if (d < z.d0 || d > z.d1 || !inSpan(sPos, z.from, z.to)) continue;
    zoneScratch.kind = z.kind === 'ice' ? SURF_ICE : z.kind === 'mud' ? SURF_MUD : SURF_CONVEYOR;
    zoneScratch.push = z.push;
    return zoneScratch;
  }
  return zoneScratch;
}

/** Surface code of a located point. */
export function surfaceOf(track: KartTrack, l: Loc): SurfaceCode {
  const hw = l.d >= 0 ? l.hwL : l.hwR;
  if (l.branch < 0) {
    const zone = zoneAt(track, l.s, l.d);
    if (zone.kind >= 0) return zone.kind as SurfaceCode;
  } else if (track.branches[l.branch]!.surface === 'dirt') {
    return Math.abs(l.d) <= hw + track.shoulder ? SURF_DIRT : SURF_OFFROAD;
  }
  return Math.abs(l.d) <= hw ? SURF_ROAD : SURF_OFFROAD;
}

const groundLoc = newLoc();

/** Road/ground query for a world point (renderer, sim, bots). `hint` keeps the search local. */
export function groundAt(track: KartTrack, x: number, y: number, hint?: RoadHint): GroundInfo {
  locate(track, x, y, hint ? hint.branch : -1, hint ? hint.seg : -1, groundLoc);
  const l = groundLoc;
  const left = l.d >= 0;
  const hw = left ? l.hwL : l.hwR;
  const edge = (left ? l.edgeL : l.edgeR) as 0 | 1;
  const beyond = Math.abs(l.d) > hw + track.shoulder;
  return {
    z: l.z,
    hasGround: !l.noGround && !(beyond && edge === EDGE_DROP),
    s: l.s,
    roadS: l.roadS,
    d: l.d,
    branch: l.branch,
    seg: l.seg,
    onRoad: Math.abs(l.d) <= hw,
    surface: surfaceOf(track, l),
    edge,
    hw,
    tx: l.tx,
    ty: l.ty,
  };
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

export interface HazardPose {
  x: number;
  y: number;
  z: number;
  s: number;
  d: number;
  heading: number;
  active: boolean;
  /** 0..1 position in the cycle. */
  phase: number;
  radius: number;
}

/** Landmarks that float above the track (allowed over the road). */
export const FLOATING_LANDMARKS: ReadonlySet<string> = new Set(['blimp', 'hot-air-balloon']);
/** Landmarks that span the road when centred on it (|d| < 1): gates and arches. */
export const SPANNING_LANDMARKS: ReadonlySet<string> = new Set(['arch', 'mesa-arch']);

const HAZARD_RADIUS: Record<HazardKind, number> = { bumper: 2.2, stomper: 2.6, sweeper: 1.8, roller: 1.6, laser: 0 };

/**
 * Roller cycle: wind up at the top for the first ROLLER_WINDUP of the period (inactive — shown as
 * a telegraph), roll the full `amp` over ROLLER_DUTY at a constant speed, then vanish at the bottom.
 */
export const ROLLER_WINDUP = 0.2;
export const ROLLER_DUTY = 0.76;

/** Rolling speed of a roller hazard (u/s). */
export function rollerSpeed(h: BuiltHazard): number {
  return h.amp / ((ROLLER_DUTY * h.periodTicks) / 60);
}

/** Stomper height profile over its cycle (0 = slammed down). */
function stomperLift(p: number): number {
  if (p < 0.5) return 1;
  if (p < 0.6) return 1 - (p - 0.5) / 0.1;
  if (p < 0.82) return 0;
  return (p - 0.82) / 0.18;
}

/** Pose of hazard `index` at `tick` — a pure function of the tick, identical everywhere. */
export function hazardPose(track: KartTrack, index: number, tick: number): HazardPose {
  const h = track.hazards[index]!;
  const P = h.periodTicks;
  const p = ((((Math.floor(tick) + h.phase) % P) + P) % P) / P;
  let sPos = h.s;
  let d = h.d;
  let active = true;
  let lift = 0;
  switch (h.kind) {
    case 'bumper':
      break;
    case 'stomper':
      lift = stomperLift(p) * 4.5;
      active = p >= 0.58 && p < 0.84;
      break;
    case 'sweeper':
      d = h.d + h.amp * dsin(TAU * p);
      break;
    case 'roller': {
      // Telegraph: it waits (inactive) at the top of its run, then rolls down at a constant speed.
      const r = clamp((p - ROLLER_WINDUP) / ROLLER_DUTY, 0, 1);
      sPos = mod(h.s - h.amp * r, track.length);
      active = p >= ROLLER_WINDUP && p < ROLLER_WINDUP + ROLLER_DUTY;
      break;
    }
    case 'laser':
      active = p < 0.5;
      break;
  }
  const c = pointAtS(track, sPos);
  const z = c.z + (h.kind === 'roller' ? h.radius : 0) + lift;
  return { x: c.x - c.ty * d, y: c.y + c.tx * d, z, s: sPos, d, heading: datan2(c.ty, c.tx), active, phase: p, radius: h.radius };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function toP4(p: ControlPoint, hw: number): P4 {
  return [p[0], p[1], p[2] ?? 0, p[3] ?? hw];
}

function checkFrac(id: string, v: number, what: string): void {
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new KartTrackError(id, `${what} must be a lap fraction in [0, 1) (got ${v})`);
}

export function buildTrack(def: KartTrackDef): KartTrack {
  const id = def.id;
  const fail = (msg: string): never => {
    throw new KartTrackError(id, msg);
  };
  if (!def.points || def.points.length < 4) fail('needs at least 4 control points');
  if (!(def.halfWidth >= 4 && def.halfWidth <= 16)) fail(`halfWidth ${def.halfWidth} must be within 4..16`);
  if (!(def.shoulder >= 0 && def.shoulder <= 20)) fail(`shoulder ${def.shoulder} must be within 0..20`);
  for (const [k, p] of def.points.entries()) {
    if (!p.every((v) => v === undefined || Number.isFinite(v))) fail(`control point ${k} is not finite`);
    if ((p[2] ?? 0) < -100 || (p[2] ?? 0) > 150) fail(`control point ${k} height must be within -100..150`);
    if (p[3] !== undefined && (p[3] < 3.5 || p[3] > 18)) fail(`control point ${k} halfWidth must be within 3.5..18`);
  }

  // 1. Main line.
  const main = sampleSpline(
    def.points.map((p) => toP4(p, def.halfWidth)),
    true,
  );
  const { n, length: L } = main;
  const at = (f: number) => f * L;
  const edgeL = new Uint8Array(n);
  const edgeR = new Uint8Array(n);
  const noGround = new Uint8Array(n);
  const defEdge = def.edge === 'drop' ? EDGE_DROP : EDGE_WALL;
  edgeL.fill(defEdge);
  edgeR.fill(defEdge);
  for (const span of def.edges ?? []) {
    checkFrac(id, span.from, 'edge span from');
    checkFrac(id, span.to, 'edge span to');
    const kind = span.kind === 'drop' ? EDGE_DROP : EDGE_WALL;
    for (let i = 0; i < n; i++) {
      if (!inSpan(main.s[i]!, at(span.from), at(span.to))) continue;
      if (span.side !== 'right') edgeL[i] = kind;
      if (span.side !== 'left') edgeR[i] = kind;
    }
  }
  const gaps: BuiltGap[] = [];
  for (const g of def.gaps ?? []) {
    checkFrac(id, g.from, 'gap from');
    checkFrac(id, g.to, 'gap to');
    if (!(g.to > g.from)) fail(`gap ${g.from}..${g.to} must not wrap (to > from)`);
    const gap = { from: at(g.from), to: at(g.to) };
    if (gap.to - gap.from < 3) fail(`gap at ${g.from} is shorter than 3 u`);
    gaps.push(gap);
    for (let i = 0; i < n; i++) if (main.s[i]! >= gap.from && main.s[i]! <= gap.to) noGround[i] = 1;
  }
  const grade = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    grade[i] = (main.zs[b]! - main.zs[a]!) / (main.segLen[a]! + main.segLen[i]! || 1);
  }

  const track: KartTrack = {
    def,
    id,
    length: L,
    n,
    spacing: main.spacing,
    xs: main.xs,
    ys: main.ys,
    zs: main.zs,
    tx: main.tx,
    ty: main.ty,
    s: main.s,
    segLen: main.segLen,
    curvature: main.curvature,
    grade,
    hwL: main.hw,
    hwR: Float64Array.from(main.hw),
    edgeL,
    edgeR,
    noGround,
    shoulder: def.shoulder,
    branches: [],
    gates: [],
    grid: [],
    boostPads: [],
    ramps: [],
    gaps,
    zones: [],
    itemBoxes: [],
    hazards: [],
    landmarks: [],
    racingLine: {
      d: new Float64Array(n),
      xs: new Float64Array(n),
      ys: new Float64Array(n),
      zs: new Float64Array(n),
      curvature: new Float64Array(n),
    },
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
  };

  // 2. Geometry sanity: grades, tight curves, self-intersections.
  for (let i = 0; i < n; i++) {
    if (Math.abs(grade[i]!) > 0.4) fail(`slope too steep near s=${main.s[i]!.toFixed(0)} (grade ${grade[i]!.toFixed(2)}, max 0.4)`);
    const k = main.curvature[i]!;
    const inner = k > 0 ? track.hwL[i]! : track.hwR[i]!;
    if (Math.abs(k) * inner > 0.92)
      fail(`curve too tight for the road width near s=${main.s[i]!.toFixed(0)} (radius ${(1 / Math.abs(k)).toFixed(1)} u)`);
  }
  checkSelfOverlap(track, fail);

  // 3. Branches.
  for (const [bi, bd] of (def.branches ?? []).entries()) track.branches.push(buildBranch(track, bd, bi, fail));

  // 4. Features.
  for (const z of def.zones ?? []) {
    checkFrac(id, z.from, 'zone from');
    checkFrac(id, z.to, 'zone to');
    if (!(z.d1 > z.d0)) fail(`zone at ${z.from} needs d0 < d1`);
    const lim = def.halfWidth * 1.8 + def.shoulder;
    if (Math.abs(z.d0) > lim || Math.abs(z.d1) > lim) fail(`zone at ${z.from} lies off the road`);
    track.zones.push({ from: at(z.from), to: at(z.to), d0: z.d0, d1: z.d1, kind: z.kind, push: z.kind === 'conveyor' ? (z.push ?? 4) : 0 });
  }
  for (const p of def.boostPads ?? []) {
    checkFrac(id, p.at, 'boost pad at');
    const length = p.length ?? 4;
    const width = p.width ?? 3;
    const c = pointAtS(track, at(p.at));
    const hw = p.d >= 0 ? c.hwL : c.hwR;
    if (Math.abs(p.d) + width / 2 > hw + 0.5) fail(`boost pad at ${p.at} lies off the road`);
    if (gapAt(track, at(p.at), length)) fail(`boost pad at ${p.at} is over a gap`);
    const w = worldAt(track, at(p.at), p.d);
    track.boostPads.push({ s: at(p.at), d: p.d, length, width, x: w.x, y: w.y, z: w.z, heading: w.heading });
  }
  for (const r of def.ramps ?? []) {
    checkFrac(id, r.at, 'ramp at');
    const c = pointAtS(track, at(r.at));
    const d = r.d ?? 0;
    const width = r.width ?? c.hwL + c.hwR;
    if (Math.abs(d) + width / 2 > Math.max(c.hwL, c.hwR) + 0.5) fail(`ramp at ${r.at} is wider than the road`);
    if (!(r.launch >= 3 && r.launch <= 16)) fail(`ramp at ${r.at} launch ${r.launch} must be within 3..16`);
    const w = worldAt(track, at(r.at), d);
    const ramp: BuiltRamp = { s: at(r.at), d, width, launch: r.launch, x: w.x, y: w.y, z: w.z, heading: w.heading };
    checkRampLanding(track, ramp, fail);
    track.ramps.push(ramp);
  }
  for (const g of gaps) {
    // Must be jumpable at 80 % of a typical top speed from a ramp shortly before it.
    const ramp = track.ramps.find((r) => r.s <= g.from && g.from - r.s <= 40);
    if (!ramp) fail(`gap at s=${g.from.toFixed(0)} has no ramp within 40 u before it`);
    const v = 24;
    const vz = ramp!.launch * 0.85;
    const drop = pointAtS(track, ramp!.s).z - pointAtS(track, g.to).z;
    const tAir = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * Math.max(0, drop + 0.01))) / GRAVITY;
    if (v * tAir < g.to - ramp!.s + 2)
      fail(`gap at s=${g.from.toFixed(0)} is too long to jump (${(g.to - ramp!.s).toFixed(0)} u, reach ${(v * tAir).toFixed(0)} u)`);
  }
  for (const [rowIdx, row] of (def.itemRows ?? []).entries()) {
    checkFrac(id, row.at, 'item row at');
    if (!(row.count >= 2 && row.count <= 6)) fail(`item row at ${row.at} needs 2..6 cubes`);
    const spread = row.spread ?? 0.7;
    if (!(spread > 0 && spread <= 1)) fail(`item row at ${row.at} spread must be in (0, 1]`);
    if (gapAt(track, at(row.at), 2)) fail(`item row at ${row.at} is over a gap`);
    const c = pointAtS(track, at(row.at));
    for (let k = 0; k < row.count; k++) {
      const u = row.count === 1 ? 0.5 : k / (row.count - 1);
      const d = -c.hwR * spread + (c.hwL + c.hwR) * spread * u;
      const w = worldAt(track, at(row.at), d);
      track.itemBoxes.push({ x: w.x, y: w.y, z: w.z, s: at(row.at), d, row: rowIdx });
    }
  }
  if (track.itemBoxes.length > 64) fail('at most 64 item cubes');
  for (const [hi, h] of (def.hazards ?? []).entries()) {
    checkFrac(id, h.at, 'hazard at');
    if (!(h.period >= 0.5 && h.period <= 30)) fail(`hazard ${hi} period must be within 0.5..30 s`);
    const c = pointAtS(track, at(h.at));
    const radius = h.radius ?? (h.kind === 'laser' ? Math.max(c.hwL, c.hwR) : HAZARD_RADIUS[h.kind]);
    if (Math.abs(h.d) > Math.max(c.hwL, c.hwR) + def.shoulder) fail(`hazard ${hi} lies off the road`);
    const amp = h.amp ?? (h.kind === 'sweeper' ? 4 : h.kind === 'roller' ? 60 : 0);
    if (h.kind === 'sweeper' && Math.abs(h.d) + amp > Math.max(c.hwL, c.hwR) + def.shoulder + 1) fail(`hazard ${hi} sweeps off the road`);
    const periodTicks = Math.max(30, Math.round(h.period * 60));
    const w = worldAt(track, at(h.at), h.d);
    track.hazards.push({
      index: hi,
      kind: h.kind,
      s: at(h.at),
      d: h.d,
      radius,
      periodTicks,
      phase: Math.round((h.phase ?? 0) * periodTicks),
      amp,
      x: w.x,
      y: w.y,
      z: w.z,
      heading: w.heading,
    });
  }
  checkRollerLanes(track, fail);
  for (const [li, lm] of (def.landmarks ?? []).entries()) {
    checkFrac(id, lm.at, 'landmark at');
    const c = pointAtS(track, at(lm.at));
    const floating = FLOATING_LANDMARKS.has(lm.kind) || (lm.z ?? 0) >= 8;
    const spanning = SPANNING_LANDMARKS.has(lm.kind) && Math.abs(lm.d) < 1;
    if (!floating && !spanning && Math.abs(lm.d) < (lm.d >= 0 ? c.hwL : c.hwR) + def.shoulder + 1)
      fail(`landmark ${li} (${lm.kind}) sits on the road — move it clear of the shoulder`);
    const w = worldAt(track, at(lm.at), lm.d);
    track.landmarks.push({
      kind: lm.kind,
      x: w.x,
      y: w.y,
      z: w.z + (lm.z ?? 0),
      yaw: wrapAngle(w.heading + (lm.yaw ?? 0)),
      scale: lm.scale ?? 1,
      s: at(lm.at),
      d: lm.d,
    });
  }

  // 5. Gates (never inside a branch or gap span), grid, racing line, bounds.
  buildGates(track, fail);
  buildGrid(track, fail);
  buildRacingLine(track);
  computeBounds(track);
  return track;
}

/** Kart-centre width that must stay free beside/between rollers (a kart is 2.2 u wide). */
export const ROLLER_SAFE_LANE = 2.4;

/**
 * Fairness: wherever rollers run, even with all of them on the road at once there must be a lane
 * at least ROLLER_SAFE_LANE wide (for the kart's centre) that none of them can reach.
 */
function checkRollerLanes(track: KartTrack, fail: (m: string) => never): void {
  const rollers = track.hazards.filter((h) => h.kind === 'roller');
  for (const h of rollers) {
    for (let k = 0; k <= h.amp; k += 4) {
      const sv = mod(h.s - k, track.length);
      const c = pointAtS(track, sv);
      const lo = -(c.hwR - 1.1);
      const hi = c.hwL - 1.1;
      const blocked: Array<[number, number]> = [];
      for (const o of rollers) {
        const rel = mod(o.s - sv, track.length);
        if (rel > o.amp + 1e-9) continue;
        blocked.push([o.d - o.radius - 1.1, o.d + o.radius + 1.1]);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      let edge = lo;
      let best = 0;
      for (const [a, b] of blocked) {
        best = Math.max(best, Math.min(a, hi) - edge);
        edge = Math.max(edge, b);
      }
      best = Math.max(best, hi - edge);
      if (best < ROLLER_SAFE_LANE)
        fail(`rollers near s=${sv.toFixed(0)} leave no safe lane (widest ${best.toFixed(1)} u, need ${ROLLER_SAFE_LANE})`);
    }
  }
}

function gapAt(track: KartTrack, sPos: number, margin: number): boolean {
  return track.gaps.some((g) => sPos >= g.from - margin && sPos <= g.to + margin);
}

function checkSelfOverlap(track: KartTrack, fail: (m: string) => never): void {
  const { n, xs, ys, zs, s, length } = track;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const sep = Math.min(s[j]! - s[i]!, length - (s[j]! - s[i]!));
      if (sep < 40) continue;
      const dx = xs[j]! - xs[i]!;
      const dy = ys[j]! - ys[i]!;
      const need = Math.max(track.hwL[i]!, track.hwR[i]!) + Math.max(track.hwL[j]!, track.hwR[j]!);
      const dz = Math.abs(zs[j]! - zs[i]!);
      if (dz >= 6) continue;
      if (dx * dx + dy * dy < need * need) {
        fail(
          `the road overlaps itself near (${xs[i]!.toFixed(0)}, ${ys[i]!.toFixed(0)}) (s=${s[i]!.toFixed(0)} and s=${s[j]!.toFixed(0)}); separate them or raise one by ≥ 6`,
        );
      }
      const j2 = (j + 1) % n;
      if (j2 === i) continue;
      if (segIntersect(xs[i]!, ys[i]!, xs[i2]!, ys[i2]!, xs[j]!, ys[j]!, xs[j2]!, ys[j2]!)) {
        fail(`self-intersection near (${xs[i]!.toFixed(0)}, ${ys[i]!.toFixed(0)})`);
      }
    }
  }
}

function buildBranch(track: KartTrack, bd: BranchDef, index: number, fail: (m: string) => never): BuiltBranch {
  const id = track.id;
  checkFrac(id, bd.from, `branch ${index} from`);
  checkFrac(id, bd.to, `branch ${index} to`);
  if (!(bd.to > bd.from)) fail(`branch ${index} must not wrap the start line (to > from)`);
  if (!bd.points || bd.points.length < 1) fail(`branch ${index} needs at least one interior control point`);
  const L = track.length;
  const sFrom = bd.from * L;
  const sTo = bd.to * L;
  if (sTo - sFrom < 40) fail(`branch ${index} span is shorter than 40 u`);
  for (const g of track.gaps) if (g.to >= sFrom - 10 && g.from <= sTo + 10) fail(`branch ${index} overlaps a gap`);
  const hw = bd.halfWidth ?? Math.max(4, track.def.halfWidth * 0.7);
  const a = pointAtS(track, sFrom);
  const a0 = pointAtS(track, sFrom - 12);
  const b = pointAtS(track, sTo);
  const b3 = pointAtS(track, sTo + 12);
  const first = bd.points[0]!;
  const last = bd.points[bd.points.length - 1]!;
  if ((first[0] - a.x) * a.tx + (first[1] - a.y) * a.ty <= 0)
    fail(`branch ${index}'s first point is not ahead of its junction (from=${bd.from})`);
  if ((b.x - last[0]) * b.tx + (b.y - last[1]) * b.ty <= 0) fail(`branch ${index}'s last point is not before its rejoin (to=${bd.to})`);
  const pts: P4[] = [
    [a0.x, a0.y, a0.z, hw],
    [a.x, a.y, a.z, hw],
    ...bd.points.map((p) => toP4(p, hw)),
    [b.x, b.y, b.z, hw],
    [b3.x, b3.y, b3.z, hw],
  ];
  const sm = sampleSpline(pts, false);
  // Leave and rejoin smoothly: the first/last tangents must be within ~70° of the main line.
  const cosStart = sm.tx[0]! * a.tx + sm.ty[0]! * a.ty;
  const cosEnd = sm.tx[sm.n - 1]! * b.tx + sm.ty[sm.n - 1]! * b.ty;
  if (cosStart < 0.34) fail(`branch ${index} leaves the main road too sharply (move its first point further along the road)`);
  if (cosEnd < 0.34) fail(`branch ${index} rejoins the main road too sharply (move its last point back along the road)`);
  if (sm.length < (sTo - sFrom) * 0.35)
    fail(`branch ${index} is implausibly short (${sm.length.toFixed(0)} u for a ${(sTo - sFrom).toFixed(0)} u span)`);
  for (let i = 0; i < sm.n; i++) {
    if (Math.abs(sm.curvature[i]!) * sm.hw[i]! > 0.92) fail(`branch ${index} has a curve too tight for its width`);
  }
  return {
    index,
    def: bd,
    surface: bd.surface,
    from: sFrom,
    to: sTo,
    n: sm.n,
    spacing: sm.spacing,
    length: sm.length,
    xs: sm.xs,
    ys: sm.ys,
    zs: sm.zs,
    tx: sm.tx,
    ty: sm.ty,
    s: sm.s,
    segLen: sm.segLen,
    curvature: sm.curvature,
    hwL: sm.hw,
    hwR: Float64Array.from(sm.hw),
  };
}

/** A ramp must land on road: the centreline over the flight must stay within the road of the launch line. */
function checkRampLanding(track: KartTrack, r: BuiltRamp, fail: (m: string) => never): void {
  const v = 36;
  const tAir = (2 * r.launch * 1.15) / GRAVITY;
  const reach = v * tAir;
  const fx = dcos(r.heading);
  const fy = dsin(r.heading);
  for (let k = 4; k <= reach; k += 2) {
    const c = pointAtS(track, r.s + k);
    const lat = (c.x - r.x) * -fy + (c.y - r.y) * fx;
    if (Math.abs(lat) > Math.min(c.hwL, c.hwR) + track.shoulder) {
      fail(`ramp at s=${r.s.toFixed(0)} launches into the wall/off the road (the road turns within its ${reach.toFixed(0)} u flight)`);
    }
  }
}

function buildGates(track: KartTrack, fail: (m: string) => never): void {
  const L = track.length;
  const count = Math.max(4, track.def.checkpoints ?? Math.round(L / 80));
  const forbidden: Array<[number, number]> = [];
  for (const b of track.branches) forbidden.push([b.from - 10, b.to + 10]);
  for (const g of track.gaps) forbidden.push([g.from - 30, g.to + 20]);
  const blocked = (sv: number) => forbidden.some(([a, b]) => inSpan(mod(sv, L), mod(a, L), mod(b, L)));
  if (blocked(0)) fail('the start line lies inside a branch or gap span');
  const gates: number[] = [0];
  for (let g = 1; g < count; g++) {
    let sv = (g * L) / count;
    for (let guard = 0; guard < 8 && blocked(sv); guard++) {
      const span = forbidden.find(([a, b]) => inSpan(mod(sv, L), mod(a, L), mod(b, L)))!;
      sv = span[1] + 1;
    }
    if (blocked(sv) || sv >= L - 20) continue;
    if (sv - gates[gates.length - 1]! < 15) continue;
    gates.push(sv);
  }
  if (gates.length < 3) fail('too few checkpoint gates fit outside branch/gap spans');
  track.gates = gates;
}

function buildGrid(track: KartTrack, fail: (m: string) => never): void {
  const c0 = pointAtS(track, 0);
  const perRow = Math.min(c0.hwL, c0.hwR) >= 7.5 ? 3 : 2;
  for (let k = 0; k < KART_GRID_SLOTS; k++) {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const sv = mod(-(5 + row * 4.6 + col * 1.5), track.length);
    const c = pointAtS(track, sv);
    const lane = Math.min(c.hwL, c.hwR) * (perRow === 3 ? 0.62 : 0.42);
    const d = perRow === 3 ? (1 - col) * lane : (col === 0 ? 1 : -1) * lane;
    if (Math.abs(d) > Math.min(c.hwL, c.hwR) - 1) fail('grid slot off the road (start straight too narrow)');
    if (gapAt(track, sv, 2) || track.branches.some((b) => inSpan(sv, b.from, b.to))) fail('the starting grid overlaps a gap or branch');
    const w = worldAt(track, sv, d);
    track.grid.push({ x: w.x, y: w.y, z: w.z, heading: w.heading, s: sv, d });
  }
}

/**
 * Racing line: lateral offsets relaxed toward the midpoint of their neighbours (a discrete
 * curvature-minimising line, so it cuts to the inside of corners), clamped inside the road.
 */
function buildRacingLine(track: KartTrack): void {
  const { n, xs, ys, tx, ty } = track;
  const d = new Float64Array(n);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lo[i] = -(track.hwR[i]! - 2.2);
    hi[i] = track.hwL[i]! - 2.2;
  }
  // Funnel onto ramps (and boost pads get used by the bots themselves).
  for (const r of track.ramps) {
    for (let i = 0; i < n; i++) {
      const rel = mod(track.s[i]! - r.s, track.length);
      if (rel < track.length - 30 && rel > 20) continue;
      lo[i] = Math.max(lo[i]!, r.d - r.width / 2 + 1.5);
      hi[i] = Math.min(hi[i]!, r.d + r.width / 2 - 1.5);
      if (lo[i]! > hi[i]!) lo[i] = hi[i] = r.d;
    }
  }
  // Keep clear of dirt-branch mouths (a racing line hugging the inside would slip into the cut).
  for (const b of track.branches) {
    if (b.surface !== 'dirt') continue;
    const k = Math.min(b.n - 1, Math.ceil(25 / b.spacing));
    const c = pointAtS(track, b.from + 25);
    const side = (b.xs[k]! - c.x) * -c.ty + (b.ys[k]! - c.y) * c.tx >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const rel = mod(track.s[i]! - b.from, track.length);
      if (rel > 35 && rel < track.length - 12) continue;
      if (side > 0) hi[i] = Math.min(hi[i]!, track.hwL[i]! - 5.5);
      else lo[i] = Math.max(lo[i]!, -(track.hwR[i]! - 5.5));
    }
  }
  const passes: Array<[number, number]> = [
    [12, 160],
    [5, 160],
    [2, 60],
  ];
  const next = new Float64Array(n);
  for (const [k, iters] of passes) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - k + n) % n;
        const b = (i + k) % n;
        const ax = xs[a]! - ty[a]! * d[a]!;
        const ay = ys[a]! + tx[a]! * d[a]!;
        const bx = xs[b]! - ty[b]! * d[b]!;
        const by = ys[b]! + tx[b]! * d[b]!;
        const mx = (ax + bx) / 2 - xs[i]!;
        const my = (ay + by) / 2 - ys[i]!;
        const target = mx * -ty[i]! + my * tx[i]!;
        next[i] = clamp(d[i]! + (target - d[i]!) * 0.6, lo[i]!, hi[i]!);
      }
      d.set(next);
    }
  }
  const rl = track.racingLine;
  rl.d.set(d);
  for (let i = 0; i < n; i++) {
    rl.xs[i] = xs[i]! - ty[i]! * d[i]!;
    rl.ys[i] = ys[i]! + tx[i]! * d[i]!;
    rl.zs[i] = track.zs[i]!;
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n;
    const b = (i + 2) % n;
    const h0 = datan2(rl.ys[i]! - rl.ys[a]!, rl.xs[i]! - rl.xs[a]!);
    const h1 = datan2(rl.ys[b]! - rl.ys[i]!, rl.xs[b]! - rl.xs[i]!);
    const ds = dhypot(rl.xs[b]! - rl.xs[a]!, rl.ys[b]! - rl.ys[a]!) / 2 || 1;
    rl.curvature[i] = wrapAngle(h1 - h0) / ds;
  }
}

function computeBounds(track: KartTrack): void {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const add = (x: number, y: number, z: number, r: number) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (let i = 0; i < track.n; i++) add(track.xs[i]!, track.ys[i]!, track.zs[i]!, Math.max(track.hwL[i]!, track.hwR[i]!) + track.shoulder);
  for (const b of track.branches) for (let i = 0; i < b.n; i++) add(b.xs[i]!, b.ys[i]!, b.zs[i]!, b.hwL[i]! + track.shoulder);
  track.bounds = { minX, minY, minZ, maxX, maxY, maxZ };
}
