/**
 * Road paths + spatial queries shared by the world builders (pure; geometry-free; unit tested).
 *
 * A RoadPath unifies the main loop and each branch. `RoadIndex` hashes every sample so builders can
 * ask "is this point on some other road?" (suppress walls at junctions) and "how far is the nearest
 * road edge?" (terrain, prop scatter) quickly.
 */
import type { KartTrack } from '@dascade/game-core/kart';

export interface RoadPath {
  /** -1 = main, else branch index. */
  id: number;
  closed: boolean;
  surface: 'road' | 'dirt';
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  s: Float64Array;
  hwL: Float64Array;
  hwR: Float64Array;
  curvature: Float64Array;
  /** 0 wall, 1 drop (main only; branches: all walls for road branches, none for dirt). */
  edgeL: Uint8Array;
  edgeR: Uint8Array;
  noGround: Uint8Array;
  length: number;
  shoulder: number;
  /** Walls on this road (dirt cut-throughs have none). */
  walls: boolean;
}

export function roadPaths(track: KartTrack): RoadPath[] {
  const out: RoadPath[] = [
    {
      id: -1,
      closed: true,
      surface: 'road',
      n: track.n,
      xs: track.xs,
      ys: track.ys,
      zs: track.zs,
      tx: track.tx,
      ty: track.ty,
      s: track.s,
      hwL: track.hwL,
      hwR: track.hwR,
      curvature: track.curvature,
      edgeL: track.edgeL,
      edgeR: track.edgeR,
      noGround: track.noGround,
      length: track.length,
      shoulder: track.shoulder,
      walls: true,
    },
  ];
  for (const b of track.branches) {
    out.push({
      id: b.index,
      closed: false,
      surface: b.surface,
      n: b.n,
      xs: b.xs,
      ys: b.ys,
      zs: b.zs,
      tx: b.tx,
      ty: b.ty,
      s: b.s,
      hwL: b.hwL,
      hwR: b.hwR,
      curvature: b.curvature,
      edgeL: new Uint8Array(b.n),
      edgeR: new Uint8Array(b.n),
      noGround: new Uint8Array(b.n),
      length: b.length,
      shoulder: b.surface === 'dirt' ? 1.5 : track.shoulder,
      walls: b.surface === 'road',
    });
  }
  return out;
}

/** Uniform hash of every road sample. */
export class RoadIndex {
  readonly cell: number;
  private buckets = new Map<number, number[]>();
  /** Flattened sample refs: [pathIdx, sampleIdx] pairs. */
  private refs: number[] = [];

  constructor(
    readonly paths: readonly RoadPath[],
    cell = 16,
  ) {
    this.cell = cell;
    paths.forEach((p, pi) => {
      for (let i = 0; i < p.n; i++) {
        const k = this.key(Math.floor(p.xs[i]! / cell), Math.floor(p.ys[i]! / cell));
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push(this.refs.length);
        this.refs.push(pi, i);
      }
    });
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  /**
   * Signed-ish distance from (x, y) to the nearest road EDGE (negative = on a road). Only samples
   * within `radius` are examined; returns `radius` when none is near. Optionally skips samples of
   * path `skipPath` whose arc length is within `skipS` of `nearS` (so a wall doesn't hit its own road)
   * and samples whose height differs by more than `dz` (bridges).
   */
  edgeDistance(x: number, y: number, radius: number, opt?: { skipPath?: number; nearS?: number; skipS?: number; z?: number; dz?: number }): number {
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c);
    const cy = Math.floor(y / c);
    let best = radius;
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const b = this.buckets.get(this.key(gx, gy));
        if (!b) continue;
        for (const ref of b) {
          const pi = this.refs[ref]!;
          const i = this.refs[ref + 1]!;
          const p = this.paths[pi]!;
          if (opt?.skipPath === pi && opt.nearS !== undefined) {
            let ds = Math.abs(p.s[i]! - opt.nearS);
            if (p.closed) ds = Math.min(ds, p.length - ds);
            if (ds < (opt.skipS ?? 30)) continue;
          }
          if (opt?.z !== undefined && Math.abs(p.zs[i]! - opt.z) > (opt.dz ?? 3)) continue;
          const dx = x - p.xs[i]!;
          const dy = y - p.ys[i]!;
          // lateral side decides which half-width applies
          const side = -p.ty[i]! * dx + p.tx[i]! * dy;
          const hw = side >= 0 ? p.hwL[i]! : p.hwR[i]!;
          const dist = Math.sqrt(dx * dx + dy * dy) - hw;
          if (dist < best) best = dist;
        }
      }
    return best;
  }

  /** Nearest sample (path index, sample index, planar distance) within radius, or null. */
  nearest(x: number, y: number, radius: number): { path: number; i: number; dist: number } | null {
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c);
    const cy = Math.floor(y / c);
    let best: { path: number; i: number; dist: number } | null = null;
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++) {
        const b = this.buckets.get(this.key(gx, gy));
        if (!b) continue;
        for (const ref of b) {
          const pi = this.refs[ref]!;
          const i = this.refs[ref + 1]!;
          const p = this.paths[pi]!;
          const dx = x - p.xs[i]!;
          const dy = y - p.ys[i]!;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= radius && (!best || d < best.dist)) best = { path: pi, i, dist: d };
        }
      }
    return best;
  }
}

/** Curb mask: 1 where the road bends enough for kerbs (dilated so kerbs start before the corner). */
export function curbMask(p: RoadPath, minCurvature = 0.012, grow = 3): Uint8Array {
  const m = new Uint8Array(p.n);
  for (let i = 0; i < p.n; i++) {
    if (Math.abs(p.curvature[i]!) < minCurvature) continue;
    for (let k = -grow; k <= grow; k++) {
      let j = i + k;
      if (p.closed) j = ((j % p.n) + p.n) % p.n;
      else if (j < 0 || j >= p.n) continue;
      m[j] = 1;
    }
  }
  return m;
}
