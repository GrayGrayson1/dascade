/**
 * DASphalt GP — top-down track preview + layout lint.
 *
 * Renders a kart track definition to an SVG (and a PNG via Playwright's Chromium) showing the
 * centreline, road width coloured by height, shoulders, edges (walls grey, drops red dashed),
 * surface zones, boost pads, ramps, gaps, item rows, hazards, branches, landmarks, the start
 * line + direction arrow and lap-fraction ticks. It also prints a lint report: lap length,
 * tightest corners, slopes, near self-overlaps, features off the road / landmarks on the road,
 * item rows placed in corners.
 *
 *   pnpm exec tsx scripts/kart-track-preview.ts harbor-hairpins [more ids…|all]
 *     --out .scratch/kart/previews   output directory (default)
 *     --spline                        force the preview's own spline (ignore buildTrack)
 *     --no-png                        SVG only
 *
 * When the game-core `buildTrack` exists, the preview uses the built geometry (samples, edges,
 * branches, hazards, item boxes, grid); otherwise it samples a centripetal Catmull-Rom itself.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KartTrackDef, ControlPoint } from '../packages/game-core/src/kart/trackdef.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_DIR = resolve(ROOT, 'packages/game-core/src/kart/tracks');
const ALL_IDS = ['pixel-plaza', 'dune-drift', 'harbor-hairpins', 'frostbyte-pass', 'pinball-park', 'gearworks', 'skyway-sprint', 'midnight-mainframe'];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) return process.argv[i + 1]!;
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------------------
// Geometry (fallback sampler; mirrors the circuit builder's centripetal Catmull-Rom)
// ---------------------------------------------------------------------------

interface Ring {
  n: number;
  xs: number[];
  ys: number[];
  zs: number[];
  hw: number[];
  tx: number[];
  ty: number[];
  s: number[];
  length: number;
  /** Arc length of each control point (fallback sampler only). */
  ctrlS: number[];
}

type P4 = readonly [number, number, number, number];

function cr(p0: P4, p1: P4, p2: P4, p3: P4, u: number): P4 {
  const tj = (ti: number, a: P4, b: P4) => ti + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || ti + 1e-4;
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const l = (a: P4, b: P4, ta: number, tb: number): P4 => {
    const w = tb - ta === 0 ? 0 : (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w];
  };
  const a1 = l(p0, p1, t0, t1);
  const a2 = l(p1, p2, t1, t2);
  const a3 = l(p2, p3, t2, t3);
  const b1 = l(a1, a2, t0, t2);
  const b2 = l(a2, a3, t1, t3);
  const out = l(b1, b2, t1, t2);
  // Height and width: smoothstep between the two control values (no overshoot).
  const sm = u * u * (3 - 2 * u);
  return [out[0], out[1], p1[2] + (p2[2] - p1[2]) * sm, p1[3] + (p2[3] - p1[3]) * sm];
}

function toP4(p: ControlPoint, hw: number): P4 {
  return [p[0], p[1], p[2] ?? 0, p[3] ?? hw];
}

function sampleChain(pts: P4[], closed: boolean, spacing: number): Ring {
  const m = pts.length;
  const dense: P4[] = [];
  const ctrlIdx: number[] = [];
  const segs = closed ? m : m - 3;
  for (let i = 0; i < segs; i++) {
    const at = (k: number) => pts[closed ? (k + m) % m : k]!;
    const base = closed ? i : i + 1;
    ctrlIdx.push(dense.length);
    for (let k = 0; k < 48; k++) dense.push(cr(at(base - 1), at(base), at(base + 1), at(base + 2), k / 48));
  }
  if (!closed) dense.push(pts[m - 2]!);
  const dn = dense.length;
  const dS = [0];
  const last = closed ? dn : dn - 1;
  for (let i = 0; i < last; i++) {
    const a = dense[i]!;
    const b = dense[(i + 1) % dn]!;
    dS.push(dS[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = dS[last]!;
  const n = Math.max(4, Math.round(length / spacing));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const hw: number[] = [];
  let j = 0;
  const count = closed ? n : n + 1;
  for (let i = 0; i < count; i++) {
    const target = (i / n) * length;
    while (j < last - 1 && dS[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dn]!;
    const w = (target - dS[j]!) / Math.max(1e-9, dS[j + 1]! - dS[j]!);
    xs.push(a[0] + (b[0] - a[0]) * w);
    ys.push(a[1] + (b[1] - a[1]) * w);
    zs.push(a[2] + (b[2] - a[2]) * w);
    hw.push(a[3] + (b[3] - a[3]) * w);
  }
  const tx: number[] = [];
  const ty: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < count; i++) {
    const nx = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
    const pv = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
    const dx = xs[nx]! - xs[pv]!;
    const dy = ys[nx]! - ys[pv]!;
    const l = Math.hypot(dx, dy) || 1;
    tx.push(dx / l);
    ty.push(dy / l);
    s.push((i / n) * length);
  }
  return { n: count, xs, ys, zs, hw, tx, ty, s, length, ctrlS: ctrlIdx.map((k) => dS[k]!) };
}

function sampleMain(def: KartTrackDef): Ring {
  return sampleChain(def.points.map((p) => toP4(p, def.halfWidth)), true, 1);
}

/** Point on the main ring at lap fraction f. */
function at(r: Ring, f: number): { x: number; y: number; z: number; tx: number; ty: number; hw: number; i: number } {
  const ff = ((f % 1) + 1) % 1;
  const i = Math.min(r.n - 1, Math.round(ff * r.n)) % r.n;
  return { x: r.xs[i]!, y: r.ys[i]!, z: r.zs[i]!, tx: r.tx[i]!, ty: r.ty[i]!, hw: r.hw[i]!, i };
}
function off(p: { x: number; y: number; tx: number; ty: number }, d: number, along = 0): [number, number] {
  return [p.x - p.ty * d + p.tx * along, p.y + p.tx * d + p.ty * along];
}

function sampleBranch(def: KartTrackDef, r: Ring, b: NonNullable<KartTrackDef['branches']>[number]): Ring {
  const hw = b.halfWidth ?? def.halfWidth;
  const a0 = at(r, b.from - 8 / r.length);
  const a1 = at(r, b.from);
  const e1 = at(r, b.to);
  const e0 = at(r, b.to + 8 / r.length);
  const pts: P4[] = [
    [a0.x, a0.y, a0.z, hw],
    [a1.x, a1.y, a1.z, hw],
    ...b.points.map((p) => toP4(p, hw)),
    [e1.x, e1.y, e1.z, hw],
    [e0.x, e0.y, e0.z, hw],
  ];
  return sampleChain(pts, false, 1);
}

/**
 * Landmark clearance radii at scale 1: conservative copies of the renderer's measured footprints
 * (`landmarkFootprint`, apps/web/src/games/kart/render/landmarks.ts); see docs/KART.md § Landmarks.
 */
const LANDMARK_RADIUS: Record<string, number> = {
  'arcade-cabinet': 12, billboard: 9, tower: 10, arch: 18, 'radar-dish': 10, 'mesa-arch': 22, lighthouse: 7, crane: 12,
  'cargo-ship': 30, 'ice-castle': 20, 'frozen-joystick': 9, 'ferris-wheel': 14, 'circus-tent': 16, gears: 21, smokestack: 8,
  blimp: 26, 'cpu-tower': 14, 'data-spire': 8, 'cloud-island': 20, 'hot-air-balloon': 7,
};

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

function curvatureRadius(r: Ring, i: number): number {
  const n = r.n;
  const span = Math.max(2, Math.round(4 / (r.length / n)));
  const a = Math.atan2(r.ty[(i - span + n) % n]!, r.tx[(i - span + n) % n]!);
  const b = Math.atan2(r.ty[(i + span) % n]!, r.tx[(i + span) % n]!);
  let da = b - a;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const ds = (2 * span * r.length) / n;
  return Math.abs(da) < 1e-6 ? Infinity : ds / da; // signed: + = left turn
}

function edgeKind(def: KartTrackDef, f: number, side: 'left' | 'right'): 'wall' | 'drop' {
  let k = def.edge;
  for (const e of def.edges ?? []) {
    const inSpan = e.from <= e.to ? f >= e.from && f < e.to : f >= e.from || f < e.to;
    if (inSpan && (e.side === side || e.side === 'both')) k = e.kind;
  }
  return k;
}

function lint(def: KartTrackDef, r: Ring, branches: Ring[]): string[] {
  const out: string[] = [];
  const L = r.length;
  const fr = (i: number) => (i / r.n).toFixed(3);
  out.push(`length ${L.toFixed(0)} u · lap @28u/s ≈ ${(L / 28).toFixed(1)} s · par ${(def.parLapMs / 1000).toFixed(1)} s (${(L / (def.parLapMs / 1000)).toFixed(1)} u/s)`);
  const zMin = Math.min(...r.zs);
  const zMax = Math.max(...r.zs);
  const hwMin = Math.min(...r.hw);
  const hwMax = Math.max(...r.hw);
  let maxSlope = 0;
  let maxSlopeAt = 0;
  for (let i = 0; i < r.n; i++) {
    const j = (i + 5) % r.n;
    const sl = Math.abs(r.zs[j]! - r.zs[i]!) / Math.max(0.5, Math.hypot(r.xs[j]! - r.xs[i]!, r.ys[j]! - r.ys[i]!));
    if (sl > maxSlope) {
      maxSlope = sl;
      maxSlopeAt = i;
    }
  }
  out.push(`z ${zMin.toFixed(1)}..${zMax.toFixed(1)} · halfWidth ${hwMin.toFixed(1)}..${hwMax.toFixed(1)} · max slope ${(maxSlope * 100).toFixed(0)}% @${fr(maxSlopeAt)}`);

  // Corners: local minima of |radius|.
  const rad = Array.from({ length: r.n }, (_, i) => curvatureRadius(r, i));
  const corners: string[] = [];
  for (let i = 0; i < r.n; i++) {
    const a = Math.abs(rad[i]!);
    if (a > 60) continue;
    let isMin = true;
    for (let k = -15; k <= 15; k++) if (Math.abs(rad[(i + k + r.n) % r.n]!) < a) isMin = false;
    if (isMin) corners.push(`${fr(i)}:${rad[i]! > 0 ? 'L' : 'R'}${a.toFixed(0)}${a < r.hw[i]! * 1.6 ? '!' : ''}`);
  }
  out.push(`corners (radius<60; ! = tighter than 1.6×hw): ${corners.join(' ') || 'none'}`);

  // Near self-overlap (road + shoulder of far-apart samples). Crossings ≥ 6 u apart in height are flyovers (allowed).
  const sh = def.shoulder;
  const hits: string[] = [];
  const bridges: string[] = [];
  let lastHit = -999;
  for (let i = 0; i < r.n; i += 2) {
    for (let j = i + 2; j < r.n; j += 2) {
      const ds = Math.min(j - i, r.n - (j - i)) * (L / r.n);
      const need = r.hw[i]! + r.hw[j]! + 2 * sh + 2;
      if (ds < need * 3) continue;
      const dd = Math.hypot(r.xs[i]! - r.xs[j]!, r.ys[i]! - r.ys[j]!);
      if (dd < need) {
        const dz = Math.abs(r.zs[i]! - r.zs[j]!);
        if (i - lastHit > 20) (dz >= 6 ? bridges : hits).push(`${fr(i)}↔${fr(j)} dist ${dd.toFixed(1)} dz ${dz.toFixed(1)}`);
        lastHit = i;
      }
    }
  }
  out.push(hits.length ? `OVERLAPS: ${hits.join(' | ')}` : 'no self-overlap');
  if (bridges.length) out.push(`flyovers (dz ≥ 6): ${bridges.join(' | ')}`);

  // Branch vs main overlap (outside its own span).
  (def.branches ?? []).forEach((b, bi) => {
    const br = branches[bi]!;
    const bad: string[] = [];
    for (let k = 20; k < br.n - 20; k += 3) {
      for (let i = 0; i < r.n; i += 2) {
        const f = i / r.n;
        if (f > b.from - 0.03 && f < b.to + 0.03) continue;
        const dd = Math.hypot(br.xs[k]! - r.xs[i]!, br.ys[k]! - r.ys[i]!);
        if (dd < br.hw[k]! + r.hw[i]! + 2 * sh + 2) {
          bad.push(`${k}u↔${fr(i)}`);
          break;
        }
      }
    }
    const mainSpan = ((b.to - b.from) * L).toFixed(0);
    out.push(`branch ${bi} (${b.surface}) length ${br.length.toFixed(0)} u vs main ${mainSpan} u${bad.length ? ` OVERLAPS main at ${bad.slice(0, 5).join(', ')}` : ''}`);
  });

  // Landmarks off the road: footprint (LANDMARK_RADIUS) + shoulder + 4 u.
  for (const lm of def.landmarks ?? []) {
    const foot = (LANDMARK_RADIUS[lm.kind] ?? 10) * (lm.scale ?? 1);
    const p = off(at(r, lm.at), lm.d);
    let minD = Infinity;
    let minF = 0;
    for (let i = 0; i < r.n; i++) {
      const dd = Math.hypot(p[0] - r.xs[i]!, p[1] - r.ys[i]!) - r.hw[i]! - sh - foot;
      if (dd < minD) {
        minD = dd;
        minF = i / r.n;
      }
    }
    for (const br of branches)
      for (let i = 0; i < br.n; i++) minD = Math.min(minD, Math.hypot(p[0] - br.xs[i]!, p[1] - br.ys[i]!) - br.hw[i]! - sh - foot);
    if (lm.kind === 'arch' || lm.kind === 'mesa-arch' || lm.kind === 'blimp' || lm.kind === 'hot-air-balloon') minD = Math.max(minD, 99);
    out.push(`landmark ${lm.kind} @${lm.at} d${lm.d}: clearance ${minD.toFixed(1)} u (nearest ${minF.toFixed(3)})${minD < 4 ? ' TOO CLOSE' : ''}`);
  }

  // Features on the road.
  const onRoad = (name: string, f: number, d: number) => {
    const p = at(r, f);
    if (Math.abs(d) > p.hw + 0.01) out.push(`${name} @${f} d${d} is OFF the road (hw ${p.hw.toFixed(1)})`);
  };
  for (const b of def.boostPads ?? []) onRoad('boost', b.at, b.d + Math.sign(b.d) * (b.width ?? 3) / 2);
  for (const h of def.hazards ?? []) if (h.kind !== 'laser') onRoad(h.kind, h.at, h.d);
  for (const ir of def.itemRows ?? []) {
    const i = at(r, ir.at).i;
    const rr = Math.abs(rad[i]!);
    if (rr < 50) out.push(`item row @${ir.at} is in a corner (radius ${rr.toFixed(0)})`);
  }
  out.push(
    `features: ${def.itemRows?.length ?? 0} item rows, ${def.boostPads?.length ?? 0} pads, ${def.ramps?.length ?? 0} ramps, ${def.gaps?.length ?? 0} gaps, ${def.hazards?.length ?? 0} hazards, ${def.zones?.length ?? 0} zones, ${def.branches?.length ?? 0} branches`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

function heightColor(t: number): string {
  // 0 → deep blue, 0.5 → green, 1 → orange/red.
  const stops = [
    [40, 70, 160],
    [40, 150, 120],
    [150, 180, 60],
    [230, 150, 40],
    [220, 60, 60],
  ];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const k = Math.floor(x);
  const w = x - k;
  const a = stops[k]!;
  const b = stops[k + 1]!;
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * w)).join(',')})`;
}

function render(def: KartTrackDef, r: Ring, branches: Ring[], report: string[], built: Built | null, trace: [number, number, number][] = []): string {
  const sh = def.shoulder;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (let i = 0; i < r.n; i++) grow(r.xs[i]!, r.ys[i]!);
  for (const lm of def.landmarks ?? []) {
    const p = off(at(r, lm.at), lm.d);
    grow(p[0], p[1]);
  }
  const pad = 40;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const W = maxX - minX;
  const H = maxY - minY;
  const px = 1500 / Math.max(W, H);
  const reportH = 22 * (report.length + 1);
  const SX = (x: number) => ((x - minX) * px).toFixed(1);
  const SY = (y: number) => ((maxY - y) * px).toFixed(1); // y up
  const parts: string[] = [];
  const Wpx = W * px;
  const Hpx = H * px;
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Wpx.toFixed(0)}" height="${(Hpx + reportH).toFixed(0)}" viewBox="0 0 ${Wpx.toFixed(0)} ${(Hpx + reportH).toFixed(0)}" font-family="Menlo,monospace">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#10131c"/>`);
  // Grid every 50 u.
  for (let gx = Math.ceil(minX / 50) * 50; gx < maxX; gx += 50)
    parts.push(`<line x1="${SX(gx)}" y1="0" x2="${SX(gx)}" y2="${Hpx.toFixed(0)}" stroke="#1b2130" stroke-width="1"/>`);
  for (let gy = Math.ceil(minY / 50) * 50; gy < maxY; gy += 50)
    parts.push(`<line x1="0" y1="${SY(gy)}" x2="${Wpx.toFixed(0)}" y2="${SY(gy)}" stroke="#1b2130" stroke-width="1"/>`);

  const zMin = Math.min(...r.zs, ...branches.flatMap((b) => b.zs));
  const zMax = Math.max(...r.zs, ...branches.flatMap((b) => b.zs), zMin + 1);
  const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number], fill: string, extra = '') =>
    `<polygon points="${[a, b, c, d].map((p) => `${SX(p[0])},${SY(p[1])}`).join(' ')}" fill="${fill}" ${extra}/>`;

  const drawRibbon = (g: Ring, closed: boolean, surface: string | null, frOf: (i: number) => number | null) => {
    const last = closed ? g.n : g.n - 1;
    // Shoulder.
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % g.n;
      const pi = { x: g.xs[i]!, y: g.ys[i]!, tx: g.tx[i]!, ty: g.ty[i]! };
      const pj = { x: g.xs[j]!, y: g.ys[j]!, tx: g.tx[j]!, ty: g.ty[j]! };
      const wi = g.hw[i]! + sh;
      const wj = g.hw[j]! + sh;
      parts.push(quad(off(pi, wi), off(pj, wj), off(pj, -wj), off(pi, -wi), def.offroad === 'snow' ? '#c9d6e4' : def.offroad === 'sand' ? '#8a7440' : def.offroad === 'metal' ? '#545c6a' : '#2c3b2c'));
    }
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % g.n;
      const pi = { x: g.xs[i]!, y: g.ys[i]!, tx: g.tx[i]!, ty: g.ty[i]! };
      const pj = { x: g.xs[j]!, y: g.ys[j]!, tx: g.tx[j]!, ty: g.ty[j]! };
      const col = surface ?? heightColor((g.zs[i]! - zMin) / (zMax - zMin));
      parts.push(quad(off(pi, g.hw[i]!), off(pj, g.hw[j]!), off(pj, -g.hw[j]!), off(pi, -g.hw[i]!), col, `stroke="${col}" stroke-width="0.6"`));
    }
    // Edges.
    for (const side of ['left', 'right'] as const) {
      const sgn = side === 'left' ? 1 : -1;
      for (let i = 0; i < last; i += 1) {
        const j = (i + 1) % g.n;
        const f = frOf(i);
        const kind = f === null ? 'wall' : edgeKind(def, f, side);
        const a = off({ x: g.xs[i]!, y: g.ys[i]!, tx: g.tx[i]!, ty: g.ty[i]! }, sgn * (g.hw[i]! + sh));
        const b = off({ x: g.xs[j]!, y: g.ys[j]!, tx: g.tx[j]!, ty: g.ty[j]! }, sgn * (g.hw[j]! + sh));
        const style = kind === 'wall' ? 'stroke="#d8dde8" stroke-width="3"' : (i >> 2) % 2 === 0 ? 'stroke="#ff3355" stroke-width="3"' : '';
        if (style) parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" ${style}/>`);
      }
    }
  };
  drawRibbon(r, true, null, (i) => i / r.n);
  (def.branches ?? []).forEach((b, bi) => drawRibbon(branches[bi]!, false, b.surface === 'dirt' ? '#8d6a3f' : '#5a6f9a', () => null));

  // Centreline.
  parts.push(`<polyline fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="4 4" points="${r.xs.map((x, i) => `${SX(x)},${SY(r.ys[i]!)}`).join(' ')}"/>`);

  const band = (from: number, to: number, d0: number, d1: number, fill: string) => {
    const span = to >= from ? to - from : to + 1 - from;
    const steps = Math.max(2, Math.round(span * r.n));
    const left: string[] = [];
    const right: string[] = [];
    for (let k = 0; k <= steps; k++) {
      const p = at(r, from + (span * k) / steps);
      const a = off(p, d1);
      const b = off(p, d0);
      left.push(`${SX(a[0])},${SY(a[1])}`);
      right.unshift(`${SX(b[0])},${SY(b[1])}`);
    }
    parts.push(`<polygon points="${[...left, ...right].join(' ')}" fill="${fill}"/>`);
  };
  for (const z of def.zones ?? []) {
    const col = z.kind === 'ice' ? 'rgba(150,230,255,0.65)' : z.kind === 'mud' ? 'rgba(120,80,40,0.7)' : 'rgba(255,150,40,0.55)';
    band(z.from, z.to, z.d0, z.d1, col);
    if (z.kind === 'conveyor') {
      const span = z.to >= z.from ? z.to - z.from : z.to + 1 - z.from;
      for (let k = 1; k < 6; k++) {
        const p = at(r, z.from + (span * k) / 6);
        const mid = (z.d0 + z.d1) / 2;
        const a = off(p, mid - Math.sign(z.push ?? 1) * 3);
        const b = off(p, mid + Math.sign(z.push ?? 1) * 3);
        parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="#fff" stroke-width="2" marker-end="url(#arr)"/>`);
      }
    }
  }
  for (const g of def.gaps ?? []) band(g.from, g.to, -at(r, g.from).hw - sh, at(r, g.from).hw + sh, 'rgba(0,0,0,0.92)');
  for (const bp of def.boostPads ?? []) {
    const len = bp.length ?? 4;
    const wid = bp.width ?? 3;
    const p = at(r, bp.at);
    const c = [off(p, bp.d + wid / 2, -len / 2), off(p, bp.d + wid / 2, len / 2), off(p, bp.d - wid / 2, len / 2), off(p, bp.d - wid / 2, -len / 2)] as const;
    parts.push(quad(c[0], c[1], c[2], c[3], '#ffd400', 'stroke="#000" stroke-width="1"'));
  }
  for (const rp of def.ramps ?? []) {
    const p = at(r, rp.at);
    const w = rp.width ?? p.hw * 2;
    const d = rp.d ?? 0;
    const c = [off(p, d + w / 2, -2), off(p, d + w / 2, 2), off(p, d - w / 2, 2), off(p, d - w / 2, -2)] as const;
    parts.push(quad(c[0], c[1], c[2], c[3], '#ff40ff', 'stroke="#fff" stroke-width="1"'));
  }
  for (const ir of def.itemRows ?? []) {
    const p = at(r, ir.at);
    const spread = (ir.spread ?? 0.7) * p.hw;
    for (let k = 0; k < ir.count; k++) {
      const d = ir.count === 1 ? 0 : -spread + (2 * spread * k) / (ir.count - 1);
      const q = off(p, d);
      parts.push(`<rect x="${(Number(SX(q[0])) - 4).toFixed(1)}" y="${(Number(SY(q[1])) - 4).toFixed(1)}" width="8" height="8" fill="#7cf" stroke="#fff" stroke-width="1.5" transform="rotate(45 ${SX(q[0])} ${SY(q[1])})"/>`);
    }
  }
  for (const h of def.hazards ?? []) {
    const p = at(r, h.at);
    const q = off(p, h.d);
    const rad = (h.radius ?? (h.kind === 'bumper' ? 2 : h.kind === 'stomper' ? 3 : h.kind === 'laser' ? p.hw : 1.8)) * px;
    if (h.kind === 'laser') {
      const a = off(p, h.d + (h.radius ?? p.hw));
      const b = off(p, h.d - (h.radius ?? p.hw));
      parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="#ff2040" stroke-width="4" stroke-dasharray="6 3"/>`);
    } else if (h.kind === 'stomper') {
      const rr = rad;
      parts.push(`<rect x="${(Number(SX(q[0])) - rr).toFixed(1)}" y="${(Number(SY(q[1])) - rr).toFixed(1)}" width="${(2 * rr).toFixed(1)}" height="${(2 * rr).toFixed(1)}" fill="rgba(255,60,60,0.7)" stroke="#fff"/>`);
    } else {
      const col = h.kind === 'bumper' ? '#ff8a00' : h.kind === 'sweeper' ? '#b060ff' : '#ffffff';
      parts.push(`<circle cx="${SX(q[0])}" cy="${SY(q[1])}" r="${rad.toFixed(1)}" fill="${col}" fill-opacity="0.8" stroke="#000"/>`);
      if (h.kind === 'sweeper') {
        const a = off(p, h.d + (h.amp ?? 0));
        const b = off(p, h.d - (h.amp ?? 0));
        parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="#b060ff" stroke-width="2"/>`);
      }
      if (h.kind === 'roller') {
        const b = off(p, h.d, -(h.amp ?? 0));
        parts.push(`<line x1="${SX(q[0])}" y1="${SY(q[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="#fff" stroke-width="2" stroke-dasharray="5 3" marker-end="url(#arr)"/>`);
      }
    }
  }
  for (const lm of def.landmarks ?? []) {
    const q = off(at(r, lm.at), lm.d);
    const rr = (LANDMARK_RADIUS[lm.kind] ?? 10) * (lm.scale ?? 1) * px;
    parts.push(`<circle cx="${SX(q[0])}" cy="${SY(q[1])}" r="${Math.max(6, rr).toFixed(1)}" fill="rgba(255,200,40,0.35)" stroke="#ffc828" stroke-width="2"/>`);
    parts.push(`<text x="${SX(q[0])}" y="${(Number(SY(q[1])) + 4).toFixed(1)}" fill="#ffe28a" font-size="13" text-anchor="middle">★ ${lm.kind}</text>`);
  }
  // Fraction ticks.
  for (let k = 0; k < 20; k++) {
    const p = at(r, k / 20);
    const q = off(p, -(p.hw + sh + 7));
    parts.push(`<text x="${SX(q[0])}" y="${SY(q[1])}" fill="#8fa0c0" font-size="12" text-anchor="middle">${(k / 20).toFixed(2)}</text>`);
  }
  // Control points.
  def.points.forEach((cp, idx) => {
    parts.push(`<circle cx="${SX(cp[0])}" cy="${SY(cp[1])}" r="2.5" fill="#fff"/>`);
    parts.push(`<text x="${(Number(SX(cp[0])) + 4).toFixed(1)}" y="${(Number(SY(cp[1])) - 4).toFixed(1)}" fill="#fff" font-size="10">${idx}${cp[2] ? ` z${cp[2]}` : ''}</text>`);
  });
  // Built extras: checkpoint gates + grid slots.
  if (built) {
    for (const g of built.gates) {
      const i = Math.min(r.n - 1, Math.round((g / r.length) * r.n)) % r.n;
      const p = { x: r.xs[i]!, y: r.ys[i]!, tx: r.tx[i]!, ty: r.ty[i]! };
      const a = off(p, r.hw[i]!);
      const b = off(p, -r.hw[i]!);
      parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="rgba(120,255,160,0.5)" stroke-width="1.5"/>`);
    }
    for (const g of built.grid) {
      const fx = Math.cos(g.heading);
      const fy = Math.sin(g.heading);
      parts.push(`<line x1="${SX(g.x - fx)}" y1="${SY(g.y - fy)}" x2="${SX(g.x + fx)}" y2="${SY(g.y + fy)}" stroke="#fff" stroke-width="3"/>`);
    }
  }
  // Driven trace (--drive), coloured by speed: red slow → green fast.
  for (let k = 1; k < trace.length; k++) {
    const [x0, y0] = trace[k - 1]!;
    const [x1, y1, v] = trace[k]!;
    const t = Math.max(0, Math.min(1, (v - 12) / 22));
    parts.push(`<line x1="${SX(x0)}" y1="${SY(y0)}" x2="${SX(x1)}" y2="${SY(y1)}" stroke="rgb(${Math.round(255 * (1 - t))},${Math.round(80 + 175 * t)},60)" stroke-width="2.5"/>`);
  }
  // Start line + arrow.
  const s0 = at(r, 0);
  const a = off(s0, s0.hw);
  const b = off(s0, -s0.hw);
  parts.push(`<line x1="${SX(a[0])}" y1="${SY(a[1])}" x2="${SX(b[0])}" y2="${SY(b[1])}" stroke="#fff" stroke-width="5" stroke-dasharray="4 4"/>`);
  const ar = off(s0, 0, 30);
  parts.push(`<line x1="${SX(s0.x)}" y1="${SY(s0.y)}" x2="${SX(ar[0])}" y2="${SY(ar[1])}" stroke="#0f0" stroke-width="4" marker-end="url(#arr)"/>`);
  parts.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" stroke="#fff"/></marker></defs>`);
  // Legend + report.
  parts.push(`<text x="10" y="20" fill="#fff" font-size="18">${def.id} · biome ${def.biome} · hw ${def.halfWidth} · shoulder ${def.shoulder} ${def.offroad} · edge ${def.edge} · height ${zMin.toFixed(0)}(blue)…${zMax.toFixed(0)}(red)</text>`);
  report.forEach((line, k) =>
    parts.push(`<text x="10" y="${(Hpx + 20 + 22 * k).toFixed(0)}" fill="${/OVERLAP|OFF|TOO|corner \(/.test(line) ? '#ff7070' : '#cfd8ea'}" font-size="14">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`),
  );
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Built geometry (when game-core's buildTrack exists)
// ---------------------------------------------------------------------------

interface PolyLike {
  n: number;
  length: number;
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  zs: ArrayLike<number>;
  tx: ArrayLike<number>;
  ty: ArrayLike<number>;
  s: ArrayLike<number>;
  hwL: ArrayLike<number>;
  hwR: ArrayLike<number>;
}
interface BuiltLike extends PolyLike {
  branches: PolyLike[];
  grid: { x: number; y: number; heading: number }[];
  gates: number[];
}

function ringOf(p: PolyLike): Ring {
  const n = p.n;
  const arr = (a: ArrayLike<number>) => Array.from({ length: n }, (_, i) => a[i]!);
  const hwL = arr(p.hwL);
  const hwR = arr(p.hwR);
  return { n, xs: arr(p.xs), ys: arr(p.ys), zs: arr(p.zs), tx: arr(p.tx), ty: arr(p.ty), s: arr(p.s), hw: hwL.map((l, i) => (l + hwR[i]!) / 2), length: p.length, ctrlS: [] };
}

interface Built {
  main: Ring;
  branches: Ring[];
  grid: { x: number; y: number; heading: number }[];
  gates: number[];
}

async function tryBuilt(def: KartTrackDef): Promise<Built | null> {
  if (flag('spline')) return null;
  const file = resolve(ROOT, 'packages/game-core/src/kart/track.ts');
  if (!existsSync(file)) return null;
  let mod: { buildTrack?: (d: KartTrackDef) => BuiltLike };
  try {
    mod = (await import(file)) as typeof mod;
  } catch (err) {
    console.warn(`  (track.ts failed to load: ${(err as Error).message}; using the preview spline)`);
    return null;
  }
  if (!mod.buildTrack) return null;
  try {
    const t = mod.buildTrack(def);
    return { main: ringOf(t), branches: t.branches.map(ringOf), grid: t.grid, gates: t.gates };
  } catch (err) {
    console.warn(`  !! buildTrack REJECTED ${def.id}: ${(err as Error).message}`);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Headless drive (--drive): a simple pure-pursuit autopilot on the game-core physics
// ---------------------------------------------------------------------------

interface DriveResult {
  lapsMs: number[];
  wallHits: number;
  offroadTicks: number;
  falls: number;
  hazardHits: number;
  minSpeed: number;
  trace: [number, number, number][];
  events: string[];
}

interface CoreMods {
  buildTrack: (d: KartTrackDef) => CoreTrack;
  stepKart: (st: unknown, input: unknown, spec: unknown, track: CoreTrack, ctx: { locked: boolean; tick: number }) => { state: CoreState; info: CoreInfo };
  createKartState: (track: CoreTrack, slot: number) => CoreState;
  racerSpec: (id: string) => { turnRate: number; driftTurn: number; topSpeed: number };
  steerFactor: (v: number) => number;
}
interface CorePoly {
  n: number;
  length: number;
  spacing: number;
  xs: Float64Array;
  ys: Float64Array;
  curvature: Float64Array;
}
interface CoreTrack extends CorePoly {
  racingLine: { xs: Float64Array; ys: Float64Array; curvature: Float64Array };
  branches: (CorePoly & { from: number; to: number })[];
}
interface CoreState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  branch: number;
  driftDir: number;
  grounded: boolean;
}
interface CoreInfo {
  s: number;
  roadS: number;
  branch: number;
  onRoad: boolean;
  speed: number;
  wallImpact: number;
  fell: boolean;
  hazardHit: number;
  miniTurbo: number;
}

async function loadCore(): Promise<CoreMods> {
  const base = resolve(ROOT, 'packages/game-core/src/kart');
  const track = (await import(resolve(base, 'track.ts'))) as Pick<CoreMods, 'buildTrack'>;
  const kart = (await import(resolve(base, 'kart.ts'))) as Pick<CoreMods, 'stepKart' | 'createKartState' | 'steerFactor'>;
  const spec = (await import(resolve(base, 'spec.ts'))) as Pick<CoreMods, 'racerSpec'>;
  return { ...track, ...kart, ...spec };
}

function drive(core: CoreMods, def: KartTrackDef, opts: { laps: number; racer: string; drift: boolean; branch: number }): DriveResult {
  const track = core.buildTrack(def);
  const spec = core.racerSpec(opts.racer);
  let st = core.createKartState(track, 0);
  const res: DriveResult = { lapsMs: [], wallHits: 0, offroadTicks: 0, falls: 0, hazardHits: 0, minSpeed: Infinity, trace: [], events: [] };
  const L = track.length;
  const rl = track.racingLine;
  const idx = (poly: CorePoly, sv: number) => {
    const i = Math.floor(sv / poly.spacing);
    return poly === track ? ((i % poly.n) + poly.n) % poly.n : Math.max(0, Math.min(poly.n - 1, i));
  };
  // A point `ahead` units beyond the kart along the chosen route (main racing line, or branch `opts.branch`).
  const nearestOn = (b: CorePoly, x: number, y: number): number => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < b.n; i++) {
      const d2 = (b.xs[i]! - x) * (b.xs[i]! - x) + (b.ys[i]! - y) * (b.ys[i]! - y);
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    return best;
  };
  const pathPoint = (sMain: number, x: number, y: number, ahead: number): { x: number; y: number; k: number } => {
    const want = opts.branch;
    if (want >= 0) {
      const b = track.branches[want]!;
      const toFrom = (((b.from - sMain) % L) + L) % L;
      const inside = (((sMain - b.from) % L) + L) % L < b.to - b.from;
      if (inside) {
        const i0 = nearestOn(b, x, y);
        const t = i0 * b.spacing + ahead;
        if (t < b.length) {
          const i = idx(b, t);
          return { x: b.xs[i]!, y: b.ys[i]!, k: b.curvature[i]! };
        }
        const i = idx(track, b.to + (t - b.length));
        return { x: rl.xs[i]!, y: rl.ys[i]!, k: rl.curvature[i]! };
      }
      if (toFrom < ahead) {
        const i = idx(b, ahead - toFrom);
        return { x: b.xs[i]!, y: b.ys[i]!, k: b.curvature[i]! };
      }
    }
    const i = idx(track, sMain + ahead);
    return { x: rl.xs[i]!, y: rl.ys[i]!, k: rl.curvature[i]! };
  };
  let prevS = 0;
  let lapStart = 0;
  let lap = 0;
  const maxTicks = 60 * 60 * 4;
  let info: CoreInfo | null = null;
  for (let tick = 0; tick < maxTicks && lap < opts.laps + 1; tick++) {
    const sMain = info?.s ?? 0;
    const v = Math.hypot(st.vx, st.vy);
    const la = 5 + 0.42 * v;
    const tgt = pathPoint(sMain, st.x, st.y, la);
    const fx = Math.cos(st.heading);
    const fy = Math.sin(st.heading);
    const dx = tgt.x - st.x;
    const dy = tgt.y - st.y;
    const alpha = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy); // + = target to the left
    const wantYaw = (2 * Math.max(v, 4) * Math.sin(alpha)) / Math.max(la, 1);
    const sf = core.steerFactor(v);
    const avail = spec.turnRate * sf;
    // Look ahead for the tightest curvature over the braking horizon.
    let kMax = 0;
    let kSum = 0;
    const horizon = 8 + v * 0.9;
    for (let a = 4; a <= horizon; a += 3) {
      const p = pathPoint(sMain, st.x, st.y, a);
      kMax = Math.max(kMax, Math.abs(p.k));
      kSum += p.k;
    }
    const need = v * kMax;
    let throttle = 1;
    let brake = 0;
    let drift = false;
    let steer = Math.max(-1, Math.min(1, wantYaw / Math.max(avail, 0.1)));
    if (opts.drift) {
      const cornerSign = Math.sign(kSum);
      const holding = st.driftDir !== 0;
      if ((holding && need > 0.45 * avail) || (!holding && need > 0.7 * avail && v > 14)) drift = true;
      if (drift) {
        if (!holding) steer = cornerSign;
        else {
          const base = spec.turnRate * spec.driftTurn * Math.max(sf, 0.8);
          const along = Math.max(-1, Math.min(1, ((wantYaw * st.driftDir) / base - 0.62) / 0.48));
          steer = st.driftDir * along;
          if (Math.sign(wantYaw) !== st.driftDir && Math.abs(wantYaw) > 0.4 * base) drift = false; // released: corner flipped
        }
      }
      if (need > (drift ? 1.35 : 1.05) * (drift ? spec.turnRate * spec.driftTurn * Math.max(sf, 0.8) * 1.1 : avail)) throttle = 0;
    } else if (need > avail * 1.0) {
      throttle = 0;
      if (need > avail * 1.25) brake = 0.6;
    }
    const input = { throttle, brake, steer, drift, item: false, back: false };
    const out = core.stepKart(st, input, spec, track, { locked: false, tick });
    st = out.state;
    info = out.info;
    if (info.wallImpact > 3) res.wallHits++;
    if (!info.onRoad) res.offroadTicks++;
    if (info.fell) {
      res.falls++;
      res.events.push(`fell @${(info.s / L).toFixed(3)}`);
    }
    if (info.hazardHit >= 0) {
      res.hazardHits++;
      res.events.push(`hazard ${info.hazardHit} @${(info.s / L).toFixed(3)}`);
    }
    if (lap >= 1) res.minSpeed = Math.min(res.minSpeed, info.speed);
    if (tick % 6 === 0 && lap >= 1) res.trace.push([st.x, st.y, info.speed]);
    // Lap: progress wraps from the end of the lap to its start.
    if (prevS > L * 0.8 && info.s < L * 0.2) {
      if (lap >= 1) res.lapsMs.push(Math.round(((tick - lapStart) * 1000) / 60));
      lap++;
      lapStart = tick;
    }
    prevS = info.s;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Headless bot race (--race): the core KartSim with computer racers
// ---------------------------------------------------------------------------

interface RaceSimKart {
  slot: number;
  racer: string;
  state: { x: number; y: number };
  info: { speed: number; s: number; branch: number };
  progress: { lapTimes: number[]; bestLapMs: number; finished: boolean };
}
interface RaceSim {
  step(): { type: string; slot?: number; victim?: number; cause?: string; lapMs?: number }[];
  addRacer(slot: number, id: string, racer: string, bot: string | null): RaceSimKart;
  go(): unknown;
  status: string;
  karts: readonly RaceSimKart[];
}

async function race(def: KartTrackDef, opts: { racers: string[]; skill: string; laps: number; solo: boolean; items: boolean }): Promise<string[]> {
  const kart = (await import(resolve(ROOT, 'packages/game-core/src/kart/index.ts'))) as {
    buildTrack: (d: KartTrackDef) => unknown;
    KartSim: new (track: unknown, o: object, rng: unknown, raceId: number) => RaceSim;
  };
  const random = (await import(resolve(ROOT, 'packages/shared/src/random.ts'))) as { createSeededRng: (s: string) => unknown };
  const track = kart.buildTrack(def);
  const lines: string[] = [];
  const runs = opts.solo ? opts.racers.map((r) => [r]) : [opts.racers];
  for (const field of runs) {
    const sim = new kart.KartSim(track, { laps: opts.laps, items: opts.items, collisions: !opts.solo, finishWindowMs: 60_000, maxRaceMs: 60_000 * opts.laps * 2 }, random.createSeededRng(`${def.id}-${field.join()}`), 1);
    field.forEach((r, i) => sim.addRacer(i, `bot${i}`, r, opts.skill));
    sim.go();
    const hazards = new Map<number, string[]>();
    const falls = new Map<number, number>();
    const branchTicks = new Map<number, number>();
    let slowTicks = 0;
    for (let t = 0; t < 60 * 60 * opts.laps * 2 && sim.status !== 'done'; t++) {
      for (const e of sim.step()) {
        if (e.type === 'hit' && e.victim !== undefined) {
          const k = sim.karts.find((kk) => kk.slot === e.victim)!;
          if (e.cause === 'fall') falls.set(e.victim, (falls.get(e.victim) ?? 0) + 1);
          else if (e.cause === 'hazard') {
            const list = hazards.get(e.victim) ?? [];
            list.push((k.info.s / (track as { length: number }).length).toFixed(3));
            hazards.set(e.victim, list);
          }
        }
      }
      for (const k of sim.karts) {
        if (t > 300 && k.info.speed < 4 && !k.progress.finished) slowTicks++;
        if (k.info.branch >= 0) branchTicks.set(k.slot, (branchTicks.get(k.slot) ?? 0) + 1);
      }
    }
    for (const k of sim.karts) {
      const laps = k.progress.lapTimes.map((m) => (m / 1000).toFixed(2)).join(' / ');
      const hz = hazards.get(k.slot) ?? [];
      lines.push(
        `race ${opts.skill} ${k.racer}${opts.solo ? ' (solo)' : ''}: laps ${laps || 'DNF'} · best ${(k.progress.bestLapMs / 1000).toFixed(2)} s · falls ${falls.get(k.slot) ?? 0} · hazards ${hz.length}${hz.length ? ` @${hz.slice(0, 5).join(',')}` : ''}${branchTicks.get(k.slot) ? ` · branch ${((branchTicks.get(k.slot)! / 60) | 0)} s` : ''}`,
      );
    }
    if (slowTicks > 60) lines.push(`  !! karts were nearly stopped for ${(slowTicks / 60).toFixed(1)} kart-seconds (stuck?)`);
  }
  return lines;
}

async function loadDef(id: string): Promise<KartTrackDef> {
  const file = resolve(TRACKS_DIR, `${id}.ts`);
  const mod = (await import(file)) as Record<string, unknown>;
  for (const v of Object.values(mod)) {
    if (v && typeof v === 'object' && (v as KartTrackDef).id === id && Array.isArray((v as KartTrackDef).points)) return v as KartTrackDef;
  }
  throw new Error(`${file} exports no KartTrackDef with id ${id}`);
}

async function toPng(pngPath: string, svg: string): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const m = /width="(\d+)" height="(\d+)"/.exec(svg);
    const page = await browser.newPage({ viewport: { width: Number(m?.[1] ?? 1600), height: Number(m?.[2] ?? 1600) } });
    await page.setContent(`<html><body style="margin:0;background:#10131c">${svg}</body></html>`);
    await page.screenshot({ path: pngPath, animations: 'disabled', caret: 'initial' });
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const valued = new Set(['--out', '--racer', '--racers', '--skill', '--laps']);
  const ids = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !valued.has(all[i - 1]!));
  const list = ids.includes('all') || ids.length === 0 ? ALL_IDS.filter((id) => existsSync(resolve(TRACKS_DIR, `${id}.ts`))) : ids;
  const outDir = resolve(ROOT, arg('out', '.scratch/kart/previews'));
  mkdirSync(outDir, { recursive: true });
  for (const id of list) {
    const def = await loadDef(id);
    const built = await tryBuilt(def);
    const r = built?.main ?? sampleMain(def);
    const branches = built?.branches ?? (def.branches ?? []).map((b) => sampleBranch(def, r, b));
    const report = [built ? '(built geometry)' : '(preview spline)', ...lint(def, r, branches)];
    let trace: [number, number, number][] = [];
    if (flag('drive') && built) {
      const core = await loadCore();
      const racer = arg('racer', 'nova');
      const routes = [-1, ...(def.branches ?? []).map((_, i) => i)];
      for (const drift of [false, true]) {
        for (const branch of routes) {
          const d = drive(core, def, { laps: 2, racer, drift, branch });
          const avg = d.lapsMs.length ? d.lapsMs.reduce((a, b) => a + b, 0) / d.lapsMs.length : NaN;
          report.push(
            `drive ${racer}${drift ? ' +drift' : ''}${branch >= 0 ? ` via branch ${branch}` : ''}: laps ${d.lapsMs.map((m) => (m / 1000).toFixed(2)).join(' / ') || 'DNF'} (avg ${(avg / 1000).toFixed(2)} s, ${(r.length / (avg / 1000)).toFixed(1)} u/s) · walls ${d.wallHits} · offroad ${(d.offroadTicks / 60).toFixed(1)} s · falls ${d.falls} · hazards ${d.hazardHits} · vmin ${d.minSpeed.toFixed(1)}${d.events.length ? ` · ${d.events.slice(0, 6).join(', ')}` : ''}`,
          );
          if (drift && branch === -1) trace = d.trace;
        }
      }
    }
    if (flag('race') && built) {
      const racers = arg('racers', 'nova,byte,rex,mochi,brick,glitch,quack,coin').split(',');
      report.push(...(await race(def, { racers, skill: arg('skill', 'hard'), laps: Number(arg('laps', '3')), solo: flag('solo'), items: flag('items') })));
    }
    const svg = render(def, r, branches, report, built, trace);
    const svgPath = resolve(outDir, `${id}.svg`);
    writeFileSync(svgPath, svg);
    console.log(`\n== ${id} → ${svgPath}`);
    for (const line of report) console.log(`  ${line}`);
    if (!built) {
      const cps = r.ctrlS.map((s, i) => `${i}:${(s / r.length).toFixed(3)}`).join(' ');
      console.log(`  control point fractions: ${cps}`);
    }
    if (!flag('no-png')) {
      const pngPath = svgPath.replace(/\.svg$/, '.png');
      await toPng(pngPath, svg);
      console.log(`  png: ${pngPath}`);
    }
  }
}

void main();

