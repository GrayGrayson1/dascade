/**
 * Static world geometry from the built track (pure three BufferGeometry; no materials). Built once
 * per track; every piece is a merged geometry so the whole road is a handful of draw calls.
 *
 *   road ribbons (main + branches) · shoulders · curbs · walls (per-biome profile) · drop-edge
 *   glow lips · embankment / cliff skirts · gap faces · start line · grid marks · boost pads ·
 *   ramps · surface zones (ice / mud / conveyor)
 *
 * Baked "ambient occlusion": vertex colours darken road edges, wall bases and skirt bottoms.
 */
import type { BufferGeometry } from 'three';
import type { KartTrack } from '@dascade/game-core/kart';
import type { WallStyle } from './biomes.ts';
import { GeoBuf, at, linRGB, type RGB, type V2, type V3 } from './geo.ts';
import { RoadIndex, curbMask, type RoadPath } from './roads.ts';
import { ROAD_TILE } from './textures.ts';

const EDGE_DROP = 1;

let worldAo: RGB = [0, 0, 0];
/** Tint that baked occlusion sinks toward for the next builds (biome AO colour; black = neutral). */
export function setWorldAo(rgb: RGB): void {
  worldAo = rgb;
}
function mkBuf(): GeoBuf {
  const g = new GeoBuf();
  g.ao = worldAo;
  return g;
}

function next(p: RoadPath, i: number): number {
  return p.closed ? (i + 1) % p.n : i + 1;
}
function segCount(p: RoadPath): number {
  return p.closed ? p.n : p.n - 1;
}
function sNext(p: RoadPath, i: number): number {
  const j = i + 1;
  return j < p.n ? p.s[j]! : p.length;
}

/** Point on path sample i at lateral d and height h. */
function P(p: RoadPath, i: number, d: number, h: number): V3 {
  return at(p.xs[i]!, p.ys[i]!, p.zs[i]!, p.tx[i]!, p.ty[i]!, d, h);
}

// ---------------------------------------------------------------------------------------------
// Road surface
// ---------------------------------------------------------------------------------------------

/** Road ribbon with darkened edges. u: 0 = left edge → 1 = right edge; v = s / ROAD_TILE. */
export function buildRoad(paths: readonly RoadPath[], surface: 'road' | 'dirt'): BufferGeometry | null {
  const g = mkBuf();
  for (const p of paths) {
    if (p.surface !== surface) continue;
    const lift = p.id < 0 ? 0 : -0.012; // branches tuck under the main road at junctions
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (p.noGround[i] || p.noGround[j]) continue;
      const v0 = p.s[i]! / ROAD_TILE;
      const v1 = sNext(p, i) / ROAD_TILE;
      const ci: number[] = [p.hwL[i]!, p.hwL[i]! - 0.9, -(p.hwR[i]! - 0.9), -p.hwR[i]!];
      const cj: number[] = [p.hwL[j]!, p.hwL[j]! - 0.9, -(p.hwR[j]! - 0.9), -p.hwR[j]!];
      const shade = [0.74, 1, 1, 0.74];
      for (let k = 0; k < 3; k++) {
        const wi = ci[0]! - ci[3]!;
        const wj = cj[0]! - cj[3]!;
        const ua0 = (ci[0]! - ci[k]!) / wi;
        const ub0 = (ci[0]! - ci[k + 1]!) / wi;
        const ua1 = (cj[0]! - cj[k]!) / wj;
        const ub1 = (cj[0]! - cj[k + 1]!) / wj;
        g.quad(P(p, i, ci[k]!, lift), P(p, i, ci[k + 1]!, lift), P(p, j, cj[k + 1]!, lift), P(p, j, cj[k]!, lift), [ua0, v0], [ub0, v0], [ub1, v1], [ua1, v1], shade[k], shade[k + 1], shade[k + 1], shade[k]);
      }
    }
  }
  return g.build();
}

/** Shoulders (off-road strip between road edge and the wall/drop). Texture tiles every 8 u. */
export function buildShoulders(paths: readonly RoadPath[]): BufferGeometry | null {
  const g = mkBuf();
  for (const p of paths) {
    const sh = p.shoulder;
    if (sh <= 0.05) continue;
    const lift = p.id < 0 ? -0.02 : -0.03;
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (p.noGround[i] || p.noGround[j]) continue;
      const v0 = p.s[i]! / 8;
      const v1 = sNext(p, i) / 8;
      for (const side of [1, -1]) {
        const hi = side > 0 ? p.hwL[i]! : p.hwR[i]!;
        const hj = side > 0 ? p.hwL[j]! : p.hwR[j]!;
        const a = P(p, i, side * hi, lift);
        const b = P(p, i, side * (hi + sh), lift);
        const c = P(p, j, side * (hj + sh), lift);
        const d = P(p, j, side * hj, lift);
        const u1 = sh / 8;
        const wallSide = (side > 0 ? p.edgeL[i] : p.edgeR[i]) !== EDGE_DROP && p.walls;
        const so = wallSide ? 0.62 : 0.95;
        g.quad(a, b, c, d, [0, v0], [u1, v0], [u1, v1], [0, v1], 0.8, so, so, 0.8, side > 0);
      }
    }
  }
  return g.build();
}

/** Red/white (biome) kerbs on the road edges through corners. v tiles every 2 u. */
export function buildCurbs(paths: readonly RoadPath[], width = 1.1): BufferGeometry | null {
  const g = mkBuf();
  for (const p of paths) {
    if (p.surface !== 'road') continue;
    const mask = curbMask(p);
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (!mask[i] || !mask[j] || p.noGround[i] || p.noGround[j]) continue;
      const v0 = p.s[i]! / 2.4;
      const v1 = sNext(p, i) / 2.4;
      for (const side of [1, -1]) {
        const hi = side > 0 ? p.hwL[i]! : p.hwR[i]!;
        const hj = side > 0 ? p.hwL[j]! : p.hwR[j]!;
        const h = 0.035;
        // the kerb straddles the edge: 40% on the road, 60% on the shoulder, with a raised middle
        const a = P(p, i, side * (hi - width * 0.4), 0.01);
        const m = P(p, i, side * (hi + width * 0.1), h);
        const b = P(p, i, side * (hi + width * 0.6), -0.005);
        const aj = P(p, j, side * (hj - width * 0.4), 0.01);
        const mj = P(p, j, side * (hj + width * 0.1), h);
        const bj = P(p, j, side * (hj + width * 0.6), -0.005);
        g.quad(a, m, mj, aj, [0, v0], [0.5, v0], [0.5, v1], [0, v1], 1, 1, 1, 1, side > 0);
        g.quad(m, b, bj, mj, [0.5, v0], [1, v0], [1, v1], [0.5, v1], 1, 0.8, 0.8, 1, side > 0);
      }
    }
  }
  return g.build();
}

// ---------------------------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------------------------

/** Wall cross-section per style: [lateral offset from the wall line, height] from road side to far side. */
export const WALL_PROFILES: Record<WallStyle, readonly (readonly [number, number])[]> = {
  neon: [
    [0, 0],
    [0.12, 0.22],
    [0.24, 0.92],
    [0.3, 1.05],
    [0.52, 1.05],
    [0.58, 0.92],
    [0.7, 0.22],
    [0.82, 0],
  ],
  sandstone: [
    [0, 0],
    [0.18, 1.2],
    [0.4, 1.45],
    [0.9, 1.4],
    [1.2, 0],
  ],
  dock: [
    [0, 0],
    [0, 0.85],
    [0.6, 0.85],
    [0.6, 0],
  ],
  snowbank: [
    [0, 0],
    [0.35, 0.75],
    [0.85, 1.2],
    [1.5, 1.15],
    [2.2, 0.55],
    [2.7, 0],
  ],
  bumper: [
    [0, 0],
    [0, 0.25],
    [0.12, 0.32],
    [0.12, 0.92],
    [0.24, 1.02],
    [0.56, 1.02],
    [0.56, 0],
  ],
  hazard: [
    [0, 0],
    [0, 1.0],
    [0.35, 1.0],
    [0.35, 0],
  ],
  glass: [
    [0, 0],
    [0, 1.25],
    [0.1, 1.25],
    [0.1, 0],
  ],
  data: [
    [0, 0],
    [0, 0.95],
    [0.3, 0.95],
    [0.3, 0],
  ],
};

export function wallThickness(style: WallStyle): number {
  const pr = WALL_PROFILES[style];
  return pr[pr.length - 1]![0];
}

/** Which samples of each path get a wall on each side (edge = wall, has ground, not on another road). */
export function wallMasks(paths: readonly RoadPath[], index: RoadIndex, style: WallStyle): { left: Uint8Array; right: Uint8Array }[] {
  const T = wallThickness(style);
  return paths.map((p, pi) => {
    const left = new Uint8Array(p.n);
    const right = new Uint8Array(p.n);
    if (!p.walls) return { left, right };
    for (let i = 0; i < p.n; i++) {
      if (p.noGround[i]) continue;
      for (const side of [1, -1] as const) {
        const edge = side > 0 ? p.edgeL[i] : p.edgeR[i];
        if (edge === EDGE_DROP) continue;
        const hw = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder + T * 0.5;
        const x = p.xs[i]! - p.ty[i]! * side * hw;
        const y = p.ys[i]! + p.tx[i]! * side * hw;
        const dist = index.edgeDistance(x, y, 30, { skipPath: pi, nearS: p.s[i]!, skipS: 24, z: p.zs[i]!, dz: 3 });
        if (dist < p.shoulder + 0.8) continue;
        (side > 0 ? left : right)[i] = 1;
      }
    }
    // for branches, never wall the first/last few samples (they merge into the main road)
    if (!p.closed) for (let k = 0; k < Math.min(4, p.n); k++) left[k] = right[k] = left[p.n - 1 - k] = right[p.n - 1 - k] = 0;
    return { left, right };
  });
}

/** Walls along the edges. u = s / 4 along, v = height / max height (top = 1). */
export function buildWalls(paths: readonly RoadPath[], masks: ReturnType<typeof wallMasks>, style: WallStyle): BufferGeometry | null {
  const g = mkBuf();
  const prof = WALL_PROFILES[style];
  const maxH = Math.max(...prof.map((q) => q[1]));
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi]!;
    const m = masks[pi]!;
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      for (const side of [1, -1] as const) {
        const mk = side > 0 ? m.left : m.right;
        if (!mk[i] || !mk[j]) continue;
        const ei = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder;
        const ej = (side > 0 ? p.hwL[j]! : p.hwR[j]!) + p.shoulder;
        const u0 = p.s[i]! / 4;
        const u1 = sNext(p, i) / 4;
        for (let k = 0; k < prof.length - 1; k++) {
          const [o0, h0] = prof[k]!;
          const [o1, h1] = prof[k + 1]!;
          const a = P(p, i, side * (ei + o0), h0 - 0.02);
          const b = P(p, i, side * (ei + o1), h1 - 0.02);
          const c = P(p, j, side * (ej + o1), h1 - 0.02);
          const d = P(p, j, side * (ej + o0), h0 - 0.02);
          const sa = 0.55 + 0.45 * (h0 / maxH);
          const sb = 0.55 + 0.45 * (h1 / maxH);
          g.quad(a, b, c, d, [u0, h0 / maxH], [u0, h1 / maxH], [u1, h1 / maxH], [u1, h0 / maxH], sa, sb, sb, sa, side > 0);
        }
        // end caps where the wall starts/stops
        const prevOn = p.closed || i > 0 ? mk[(i - 1 + p.n) % p.n] : 0;
        const nextOn = p.closed || j + 1 < p.n ? mk[(j + 1) % p.n] : 0;
        if (!prevOn) capWall(g, p, i, side, ei, prof, maxH, true);
        if (!nextOn) capWall(g, p, j, side, ej, prof, maxH, false);
      }
    }
  }
  return g.build();
}

function capWall(g: GeoBuf, p: RoadPath, i: number, side: 1 | -1, e: number, prof: readonly (readonly [number, number])[], maxH: number, start: boolean): void {
  // fan from the base centre
  const mid = (prof[0]![0] + prof[prof.length - 1]![0]) / 2;
  const c = P(p, i, side * (e + mid), -0.02);
  for (let k = 0; k < prof.length - 1; k++) {
    const a = P(p, i, side * (e + prof[k]![0]), prof[k]![1] - 0.02);
    const b = P(p, i, side * (e + prof[k + 1]![0]), prof[k + 1]![1] - 0.02);
    const flip = (side > 0) !== start;
    if (flip) g.tri(c, b, a, [0.5, 0], [0, 1], [0, 1], 0.6, 0.9, 0.9);
    else g.tri(c, a, b, [0.5, 0], [0, 1], [0, 1], 0.6, 0.9, 0.9);
  }
  void maxH;
}

/** Topper styles: a fence/bunting strip standing on the wall's crest (edges read at speed). */
export const WALL_TOPPER: Partial<Record<WallStyle, { offset: number; base: number; height: number; tile: number }>> = {
  snowbank: { offset: 1.15, base: 1.05, height: 1.0, tile: 3 },
  bumper: { offset: 0.4, base: 1.0, height: 0.9, tile: 4 },
};

/** Vertical textured strip on top of every walled segment (u = s / tile, v 0 → 1 up). */
export function buildWallTopper(paths: readonly RoadPath[], masks: ReturnType<typeof wallMasks>, style: WallStyle): BufferGeometry | null {
  const t = WALL_TOPPER[style];
  if (!t) return null;
  const g = mkBuf();
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi]!;
    const m = masks[pi]!;
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      for (const side of [1, -1] as const) {
        const mk = side > 0 ? m.left : m.right;
        if (!mk[i] || !mk[j]) continue;
        const ei = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder + t.offset;
        const ej = (side > 0 ? p.hwL[j]! : p.hwR[j]!) + p.shoulder + t.offset;
        const u0 = p.s[i]! / t.tile;
        const u1 = sNext(p, i) / t.tile;
        g.quad(P(p, i, side * ei, t.base), P(p, i, side * ei, t.base + t.height), P(p, j, side * ej, t.base + t.height), P(p, j, side * ej, t.base), [u0, 0], [u0, 1], [u1, 1], [u1, 0], 1, 1, 1, 1, side > 0);
      }
    }
  }
  return g.build();
}

/** Glowing lip strips on drop edges (readability: "the road ends here"). */
export function buildDropLips(paths: readonly RoadPath[]): BufferGeometry | null {
  const g = mkBuf();
  for (const p of paths) {
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (p.noGround[i] || p.noGround[j]) continue;
      for (const side of [1, -1] as const) {
        const ei = side > 0 ? p.edgeL[i] : p.edgeR[i];
        const ej = side > 0 ? p.edgeL[j] : p.edgeR[j];
        if (ei !== EDGE_DROP || ej !== EDGE_DROP) continue;
        const wi = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder;
        const wj = (side > 0 ? p.hwL[j]! : p.hwR[j]!) + p.shoulder;
        const band = (seg: number) => (Math.floor(p.s[seg]! / 3) % 2 ? 1 : 0.55);
        g.quad(P(p, i, side * (wi - 0.35), 0.03), P(p, i, side * wi, 0.03), P(p, j, side * wj, 0.03), P(p, j, side * (wj - 0.35), 0.03), [0, 0], [1, 0], [1, 1], [0, 1], band(i), band(i), band(i), band(i), side > 0);
        // outward face so the lip reads from the road
        g.quad(P(p, i, side * wi, 0.03), P(p, i, side * wi, -0.35), P(p, j, side * wj, -0.35), P(p, j, side * wj, 0.03), [0, 0], [1, 0], [1, 1], [0, 1], 0.9, 0.5, 0.5, 0.9, side > 0);
      }
    }
  }
  return g.build();
}

export interface SkirtOptions {
  /** Three-space Y of the terrain (skirt bottoms for wall edges). */
  groundY: number;
  /** How far below the ground a drop/gap falls (cliff depth). */
  dropDepth: number;
  /** Floating-road mode (sky): skirts are a shallow slab underside instead of reaching the ground. */
  floating: boolean;
  sloped: boolean;
  wall: WallStyle;
  /** Linear rgb of the embankment / cliff. */
  color: RGB;
  cliff: RGB;
}

/** Embankments / cliffs / slab undersides below the road's outer edges, and gap faces. */
export function buildSkirts(paths: readonly RoadPath[], masks: ReturnType<typeof wallMasks>, o: SkirtOptions): BufferGeometry | null {
  const g = mkBuf();
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi]!;
    const m = masks[pi]!;
    const T = wallThickness(o.wall);
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (p.noGround[i] || p.noGround[j]) continue;
      for (const side of [1, -1] as const) {
        const drop = (side > 0 ? p.edgeL[i] : p.edgeR[i]) === EDGE_DROP;
        const walled = (side > 0 ? m.left : m.right)[i] === 1;
        const ei = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder + (walled ? T : 0);
        const ej = (side > 0 ? p.hwL[j]! : p.hwR[j]!) + p.shoulder + (walled ? T : 0);
        let bi: number;
        let bj: number;
        if (o.floating) {
          bi = -2.6;
          bj = -2.6;
        } else if (drop) {
          // a rock ledge; the terrain chasm below supplies the depth (a full-height wall would
          // hang through any road that passes underneath)
          bi = -Math.min(o.dropDepth, 6);
          bj = -Math.min(o.dropDepth, 6);
        } else {
          // terrain meets the road ~0.6 below it; a short skirt hides the seam
          bi = -2.4;
          bj = -2.4;
        }
        const slope = o.sloped && !drop && !o.floating ? 1.0 : o.floating ? -0.6 : 0.05;
        const a = P(p, i, side * ei, -0.02);
        const d = P(p, j, side * ej, -0.02);
        const b = P(p, i, side * (ei + slope * -bi), bi);
        const c = P(p, j, side * (ej + slope * -bj), bj);
        const col = drop || o.floating ? o.cliff : o.color;
        g.quad(a, b, c, d, [0, 0], [0, 1], [1, 1], [1, 0], 1, 0.35, 0.35, 1, side > 0, col);
      }
      if (o.floating) {
        // slab underside between the two skirt bottoms
        const L = (k: number) => (p.hwL[k]! + p.shoulder) - 0.6 * 2.6;
        const R = (k: number) => (p.hwR[k]! + p.shoulder) - 0.6 * 2.6;
        g.quad(P(p, i, L(i), -2.6), P(p, i, -R(i), -2.6), P(p, j, -R(j), -2.6), P(p, j, L(j), -2.6), [0, 0], [1, 0], [1, 1], [0, 1], 0.3, 0.3, 0.3, 0.3, true, o.cliff);
      }
    }
    // gap faces (the road ends in a cliff)
    for (let i = 0; i < segCount(p); i++) {
      const j = next(p, i);
      if (p.noGround[i] === p.noGround[j]) continue;
      const k = p.noGround[i] ? j : i;
      const L = p.hwL[k]! + p.shoulder;
      const R = p.hwR[k]! + p.shoulder;
      const depth = o.floating ? -3 : -Math.min(o.dropDepth, 12);
      const flip = p.noGround[i] === 1;
      g.quad(P(p, k, L, -0.02), P(p, k, -R, -0.02), P(p, k, -R, depth), P(p, k, L, depth), [0, 0], [1, 0], [1, 1], [0, 1], 1, 1, 0.3, 0.3, flip, o.cliff);
      // a hazard lip on the edge
      g.quad(P(p, k, L, 0.02), P(p, k, -R, 0.02), P(p, k, -R, -0.4), P(p, k, L, -0.4), [0, 0], [1, 0], [1, 1], [0, 1], 1, 1, 1, 1, flip, linRGB(0xffd23f));
    }
  }
  return g.build();
}

// ---------------------------------------------------------------------------------------------
// Decals: start line, grid, pads, ramps, zones
// ---------------------------------------------------------------------------------------------

export function buildStartLine(track: KartTrack): BufferGeometry | null {
  const g = mkBuf();
  const p = pathOfMain(track);
  const i = 0;
  const j = 1;
  const L = p.hwL[i]!;
  const R = p.hwR[i]!;
  const len = 2.4;
  const f = len / Math.max(0.1, p.s[j]!);
  const q = (k: number, d: number): V3 => {
    const x = p.xs[0]! + (p.xs[k]! - p.xs[0]!) * f;
    const y = p.ys[0]! + (p.ys[k]! - p.ys[0]!) * f;
    return at(x, y, p.zs[0]!, p.tx[0]!, p.ty[0]!, d, 0.025);
  };
  const reps = Math.max(2, Math.round((L + R) / 1.2 / 8)) * 8;
  g.quad(q(0, L), q(0, -R), q(j, -R), q(j, L), [0, 0], [reps / 8, 0], [reps / 8, 1], [0, 1]);
  return g.build();
}

function pathOfMain(track: KartTrack): RoadPath {
  return {
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
  };
}

/** White grid-box brackets on the asphalt. */
export function buildGridMarks(track: KartTrack): BufferGeometry | null {
  const g = mkBuf();
  for (const slot of track.grid) {
    const c = Math.cos(slot.heading);
    const s = Math.sin(slot.heading);
    const pt = (fx: number, lx: number): V3 => [slot.x + c * fx - s * lx, slot.z + 0.02, -(slot.y + s * fx + c * lx)];
    // front bar + two short side ticks
    const w = 0.85;
    const bar = (f0: number, f1: number, l0: number, l1: number) => g.quad(pt(f0, l0), pt(f0, l1), pt(f1, l1), pt(f1, l0), [0, 0], [1, 0], [1, 1], [0, 1], 1, 1, 1, 1, false);
    bar(1.3, 1.5, w, -w);
    bar(0.3, 1.5, w, w - 0.16);
    bar(0.3, 1.5, -w + 0.16, -w);
  }
  return g.build();
}

/** Boost pads as flat quads (v along the pad → scroll the texture to animate). */
export function buildBoostPads(track: KartTrack): BufferGeometry | null {
  const g = mkBuf();
  for (const pad of track.boostPads) {
    const c = Math.cos(pad.heading);
    const s = Math.sin(pad.heading);
    const pt = (fx: number, lx: number, h = 0.04): V3 => [pad.x + c * fx - s * lx, pad.z + h, -(pad.y + s * fx + c * lx)];
    const L = pad.length / 2;
    const W = pad.width / 2;
    const reps = Math.max(1, Math.round(pad.length / pad.width / 2 + 0.5));
    g.quad(pt(-L, W), pt(-L, -W), pt(L, -W), pt(L, W), [0, 0], [1, 0], [1, reps], [0, reps], 1, 1, 1, 1);
  }
  return g.build();
}

/** Ramps: striped wedges rising to the lip. */
export function buildRamps(track: KartTrack): BufferGeometry | null {
  const g = mkBuf();
  for (const r of track.ramps) {
    const c = Math.cos(r.heading);
    const s = Math.sin(r.heading);
    const L = 4.5;
    const H = 0.7;
    const W = r.width / 2;
    const pt = (fx: number, lx: number, h: number): V3 => [r.x + c * fx - s * lx, r.z + h, -(r.y + s * fx + c * lx)];
    // top (sloped)
    g.quad(pt(-L, W, 0.02), pt(-L, -W, 0.02), pt(0, -W, H), pt(0, W, H), [0, 0], [W / 1.5, 0], [W / 1.5, 3], [0, 3], 1, 1, 1.15, 1.15);
    // lip face
    g.quad(pt(0, W, H), pt(0, -W, H), pt(0, -W, -0.4), pt(0, W, -0.4), [0, 0], [1, 0], [1, 0.02], [0, 0.02], 0.9, 0.9, 0.5, 0.5, false, linRGB(0x1b1b22));
    // sides
    for (const side of [W, -W]) g.tri(pt(-L, side, 0), pt(0, side, H), pt(0, side, -0.4), [0, 0], [0, 0.02], [0, 0.02], 0.7, 0.7, 0.5);
  }
  return g.build();
}

/** Surface zones as road decals. Conveyor u runs in the push direction. */
export function buildZones(track: KartTrack, kind: 'ice' | 'mud' | 'conveyor'): BufferGeometry | null {
  const g = mkBuf();
  const p = pathOfMain(track);
  for (const z of track.zones) {
    if (z.kind !== kind) continue;
    const span = z.to >= z.from ? z.to - z.from : track.length - z.from + z.to;
    const steps = Math.max(1, Math.ceil(span / track.spacing));
    const lift = kind === 'ice' ? 0.03 : 0.028;
    for (let k = 0; k < steps; k++) {
      const s0 = z.from + (span * k) / steps;
      const s1 = z.from + (span * (k + 1)) / steps;
      const a = pointOn(p, s0);
      const b = pointOn(p, s1);
      const tile = kind === 'conveyor' ? 3 : 8;
      const dir = kind === 'conveyor' && z.push < 0 ? -1 : 1;
      const qa = (pt: typeof a, d: number) => at(pt.x, pt.y, pt.z, pt.tx, pt.ty, d, lift);
      if (kind === 'conveyor') {
        // u across (push direction), v along
        const u0 = (z.d0 / tile) * dir;
        const u1 = (z.d1 / tile) * dir;
        g.quad(qa(a, z.d1), qa(a, z.d0), qa(b, z.d0), qa(b, z.d1), [u1, s0 / tile], [u0, s0 / tile], [u0, s1 / tile], [u1, s1 / tile]);
      } else {
        g.quad(qa(a, z.d1), qa(a, z.d0), qa(b, z.d0), qa(b, z.d1), [z.d1 / tile, s0 / tile], [z.d0 / tile, s0 / tile], [z.d0 / tile, s1 / tile], [z.d1 / tile, s1 / tile]);
      }
    }
  }
  return g.build();
}

function pointOn(p: RoadPath, sPos: number): { x: number; y: number; z: number; tx: number; ty: number } {
  const L = p.length;
  const sp = ((sPos % L) + L) % L;
  let lo = 0;
  let hi = p.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.s[mid]! <= sp) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = (i + 1) % p.n;
  const s1 = j === 0 ? L : p.s[j]!;
  const t = Math.max(0, Math.min(1, (sp - p.s[i]!) / Math.max(1e-6, s1 - p.s[i]!)));
  const lerp = (a: Float64Array) => a[i]! + (a[j]! - a[i]!) * t;
  const tx = lerp(p.tx);
  const ty = lerp(p.ty);
  const l = Math.sqrt(tx * tx + ty * ty) || 1;
  return { x: lerp(p.xs), y: lerp(p.ys), z: lerp(p.zs), tx: tx / l, ty: ty / l };
}

export { pointOn, pathOfMain };
export type { V2 };
