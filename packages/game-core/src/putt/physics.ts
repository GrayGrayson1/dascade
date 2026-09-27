/**
 * DAS Putt physics — fixed-step (120 Hz), deterministic, allocation-light.
 *
 * Model (top-down): a rolling ball with constant rolling friction + a little linear drag,
 * continuous (swept) collisions against capsule walls and round posts/bumpers, constant-
 * acceleration slope zones, high-friction sand, water/void hazards, one-way teleport portals,
 * time-based moving obstacles (windmills, sweepers) and a cup that pulls a ball rolling over
 * it towards its centre and captures it only when slow enough (speed-dependent lip-outs).
 *
 * Only + − × ÷, Math.sqrt/floor/round/abs/min/max are used (see math.ts) so the server's
 * result can be reproduced bit-for-bit by any browser (trajectory previews).
 */
import { PUTT_PATH_EVENTS, PUTT_PATH_SAMPLE, PUTT_TICK_HZ, type PuttPathEventKind, type PuttShotResult } from '@dascade/shared/games/putt';
import { TAU, angleDir, dcos, dsin, frac, pointInPoly, ringBounds, segDist2, snap64, type Vec } from './math.ts';
import type { HoleDef, MoverDef, Pt } from './types.ts';

export const PHYS = {
  tickHz: PUTT_TICK_HZ,
  dt: 1 / PUTT_TICK_HZ,
  ballR: 9,
  cupR: 15,
  /** Launch speed at full power (units/s). */
  vMax: 1080,
  friction: 250,
  drag: 0.3,
  sandFriction: 1150,
  sandDrag: 2.6,
  stopSpeed: 7,
  settleSpeed: 14,
  settleTicks: 90,
  wallE: 0.74,
  wallKeep: 0.97,
  bankE: 0.82,
  kickerE: 1.22,
  postE: 0.55,
  bumperOut: 250,
  bumperGain: 1.05,
  bumperMax: 1250,
  hubE: 0.5,
  bladeE: 0.62,
  speedCap: 1500,
  cupPull: 1400,
  captureSpeed: 330,
  portalR: 22,
  portalExitMin: 170,
  portalKeep: 0.88,
  /** Longest simulated roll (ticks) — the ball stops wherever it is after this. */
  maxTicks: 25 * PUTT_TICK_HZ,
  wallWidth: 14,
} as const;

/** Launch speed for an intent power (per-mille). A gentle curve gives fine control on short putts. */
export function launchSpeed(powerPermille: number): number {
  const p = Math.min(1000, Math.max(0, powerPermille)) / 1000;
  return PHYS.vMax * p * (0.35 + 0.65 * p);
}

// ---------------------------------------------------------------------------
// Compiled hole
// ---------------------------------------------------------------------------

export type ColliderKind = 'wall' | 'bank' | 'kicker' | 'post' | 'bumper' | 'hub' | 'blade';

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  len: number;
  /** Ball radius + half wall width. */
  r: number;
  e: number;
  kind: ColliderKind;
  /** Mover index for blades (-1 otherwise). */
  mover: number;
  /** Surface velocity (movers). */
  svx: number;
  svy: number;
  /** Rotating movers: pivot + angular speed (rad/s) for the contact-point velocity. */
  px: number;
  py: number;
  w: number;
}

export interface Circ {
  x: number;
  y: number;
  /** Ball radius + object radius. */
  r: number;
  e: number;
  kind: ColliderKind;
  index: number;
}

export interface Zone {
  ring: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CompiledHole {
  def: HoleDef;
  segs: Seg[];
  circs: Circ[];
  turf: Zone[];
  water: Zone[];
  sand: Zone[];
  slopes: Array<{ zone: Zone; ax: number; ay: number; mag: number }>;
  portals: Array<{ fx: number; fy: number; tx: number; ty: number; ex: number; ey: number }>;
  movers: MoverDef[];
  /** One live capsule per windmill arm / sweeper bar (geometry refreshed every tick). */
  moverSegs: Seg[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function zoneOf(pts: readonly Pt[]): Zone {
  const ring: number[] = [];
  for (const [x, y] of pts) ring.push(x, y);
  return { ring, ...ringBounds(ring) };
}

function inZone(z: Zone, x: number, y: number): boolean {
  return x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY && pointInPoly(x, y, z.ring);
}

function makeSeg(ax: number, ay: number, bx: number, by: number, r: number, e: number, kind: ColliderKind, mover = -1): Seg {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  return { ax, ay, bx, by, ux, uy, nx: -uy, ny: ux, len: l, r, e, kind, mover, svx: 0, svy: 0, px: 0, py: 0, w: 0 };
}

function setSeg(s: Seg, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  s.ax = ax;
  s.ay = ay;
  s.bx = bx;
  s.by = by;
  s.ux = dx / l;
  s.uy = dy / l;
  s.nx = -s.uy;
  s.ny = s.ux;
  s.len = l;
}

const compiledCache = new WeakMap<HoleDef, CompiledHole>();

/** Build the collision/zone structures for a hole (cached per definition object). */
export function compileHole(def: HoleDef): CompiledHole {
  const hit = compiledCache.get(def);
  if (hit) return hit;
  const R = PHYS.ballR;
  const segs: Seg[] = [];
  for (const w of def.walls) {
    const half = (w.width ?? PHYS.wallWidth) / 2;
    const kind: ColliderKind = w.kind === 'bank' ? 'bank' : w.kind === 'kicker' ? 'kicker' : 'wall';
    const e = kind === 'bank' ? PHYS.bankE : kind === 'kicker' ? PHYS.kickerE : PHYS.wallE;
    const pts = w.pts;
    const n = pts.length;
    const count = w.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      segs.push(makeSeg(a[0], a[1], b[0], b[1], R + half, e, kind));
    }
  }
  const circs: Circ[] = [];
  (def.posts ?? []).forEach((p, i) => circs.push({ x: p.at[0], y: p.at[1], r: R + p.r, e: PHYS.postE, kind: 'post', index: i }));
  (def.bumpers ?? []).forEach((b, i) => circs.push({ x: b.at[0], y: b.at[1], r: R + b.r, e: PHYS.bumperGain, kind: 'bumper', index: i }));
  const moverSegs: Seg[] = [];
  (def.movers ?? []).forEach((m, i) => {
    if (m.kind === 'windmill') {
      circs.push({ x: m.at[0], y: m.at[1], r: R + m.hubR, e: PHYS.hubE, kind: 'hub', index: i });
      for (let k = 0; k < m.arms; k++) moverSegs.push(makeSeg(0, 0, 1, 0, R + m.width / 2, PHYS.bladeE, 'blade', i));
    } else {
      moverSegs.push(makeSeg(0, 0, 1, 0, R + m.width / 2, PHYS.bladeE, 'blade', i));
    }
  });
  const turf = def.turf.map(zoneOf);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const z of [...turf, ...(def.water ?? []).map(zoneOf)]) {
    minX = Math.min(minX, z.minX);
    minY = Math.min(minY, z.minY);
    maxX = Math.max(maxX, z.maxX);
    maxY = Math.max(maxY, z.maxY);
  }
  const compiled: CompiledHole = {
    def,
    segs,
    circs,
    turf,
    water: (def.water ?? []).map(zoneOf),
    sand: (def.sand ?? []).map(zoneOf),
    slopes: (def.slopes ?? []).map((s) => ({
      zone: zoneOf(s.poly),
      ax: s.accel[0],
      ay: s.accel[1],
      mag: Math.sqrt(s.accel[0] * s.accel[0] + s.accel[1] * s.accel[1]),
    })),
    portals: (def.portals ?? []).map((p) => ({ fx: p.from[0], fy: p.from[1], tx: p.to[0], ty: p.to[1], ex: p.exit[0], ey: p.exit[1] })),
    movers: def.movers ?? [],
    moverSegs,
    bounds: { minX, minY, maxX, maxY },
  };
  compiledCache.set(def, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Moving obstacles (pure functions of the hole clock)
// ---------------------------------------------------------------------------

export interface MoverPose {
  /** Windmill: rotation angle (radians). Sweeper: bar centre. */
  angle: number;
  cx: number;
  cy: number;
  /** Windmill angular speed (rad/s); sweeper linear velocity (units/s). */
  w: number;
  vx: number;
  vy: number;
}

/** Pose of a moving obstacle at hole-clock time `tMs` (deterministic). */
export function moverPose(m: MoverDef, tMs: number, out: MoverPose = { angle: 0, cx: 0, cy: 0, w: 0, vx: 0, vy: 0 }): MoverPose {
  if (m.kind === 'windmill') {
    const turns = frac(m.phase + (m.dir * tMs) / m.periodMs);
    out.angle = turns * TAU;
    out.cx = m.at[0];
    out.cy = m.at[1];
    out.w = (m.dir * TAU * 1000) / m.periodMs;
    out.vx = 0;
    out.vy = 0;
    return out;
  }
  const u = frac(m.phase + tMs / m.periodMs);
  const up = u < 0.5;
  const tri = up ? 2 * u : 2 - 2 * u;
  const s = tri * tri * (3 - 2 * tri);
  const dsdt = (6 * tri * (1 - tri) * (up ? 2 : -2) * 1000) / m.periodMs;
  const dx = m.b[0] - m.a[0];
  const dy = m.b[1] - m.a[1];
  out.angle = 0;
  out.cx = m.a[0] + dx * s;
  out.cy = m.a[1] + dy * s;
  out.w = 0;
  out.vx = dx * dsdt;
  out.vy = dy * dsdt;
  return out;
}

/** Endpoints of every windmill arm / sweeper bar at `tMs` (for rendering and hit tests). */
export function moverBars(m: MoverDef, tMs: number): Array<[number, number, number, number]> {
  const pose = moverPose(m, tMs);
  if (m.kind === 'windmill') {
    const bars: Array<[number, number, number, number]> = [];
    for (let k = 0; k < m.arms; k++) {
      const a = pose.angle + (k * TAU) / m.arms;
      const c = dcos(a);
      const s = dsin(a);
      const r0 = m.hubR * 0.6;
      bars.push([pose.cx + c * r0, pose.cy + s * r0, pose.cx + c * m.length, pose.cy + s * m.length]);
    }
    return bars;
  }
  const hx = m.axis[0] * m.halfLength;
  const hy = m.axis[1] * m.halfLength;
  return [[pose.cx - hx, pose.cy - hy, pose.cx + hx, pose.cy + hy]];
}

const scratchPose: MoverPose = { angle: 0, cx: 0, cy: 0, w: 0, vx: 0, vy: 0 };

function updateMovers(h: CompiledHole, tMs: number): void {
  let k = 0;
  h.movers.forEach((m) => {
    const pose = moverPose(m, tMs, scratchPose);
    if (m.kind === 'windmill') {
      const r0 = m.hubR * 0.6;
      for (let i = 0; i < m.arms; i++) {
        const a = pose.angle + (i * TAU) / m.arms;
        const c = dcos(a);
        const s = dsin(a);
        const seg = h.moverSegs[k++]!;
        setSeg(seg, pose.cx + c * r0, pose.cy + s * r0, pose.cx + c * m.length, pose.cy + s * m.length);
        seg.px = pose.cx;
        seg.py = pose.cy;
        seg.w = pose.w;
        seg.svx = 0;
        seg.svy = 0;
      }
    } else {
      const hx = m.axis[0] * m.halfLength;
      const hy = m.axis[1] * m.halfLength;
      const seg = h.moverSegs[k++]!;
      setSeg(seg, pose.cx - hx, pose.cy - hy, pose.cx + hx, pose.cy + hy);
      seg.w = 0;
      seg.svx = pose.vx;
      seg.svy = pose.vy;
    }
  });
}

/** Whether a resting ball at (x, y) would sit where a moving obstacle sweeps (balls never rest there). */
export function inMoverSweep(h: CompiledHole, x: number, y: number): boolean {
  for (const m of h.movers) {
    if (m.kind === 'windmill') {
      const r = m.length + PHYS.ballR + m.width / 2;
      const dx = x - m.at[0];
      const dy = y - m.at[1];
      if (dx * dx + dy * dy < r * r) return true;
    } else {
      // Swept area = convex hull of the bar at both ends of its travel (a parallelogram).
      const R = PHYS.ballR + m.width / 2;
      const hx = m.axis[0] * m.halfLength;
      const hy = m.axis[1] * m.halfLength;
      const quad = [m.a[0] - hx, m.a[1] - hy, m.a[0] + hx, m.a[1] + hy, m.b[0] + hx, m.b[1] + hy, m.b[0] - hx, m.b[1] - hy];
      if (pointInPoly(x, y, quad)) return true;
      for (let i = 0; i < 8; i += 2) {
        const j = (i + 2) % 8;
        if (segDist2(x, y, quad[i]!, quad[i + 1]!, quad[j]!, quad[j + 1]!) < R * R) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export type Surface = 'turf' | 'sand' | 'water' | 'void';

export function surfaceAt(h: CompiledHole, x: number, y: number): Surface {
  let onTurf = false;
  for (const z of h.turf) {
    if (inZone(z, x, y)) {
      onTurf = true;
      break;
    }
  }
  if (!onTurf) {
    for (const z of h.water) if (inZone(z, x, y)) return 'water';
    return 'void';
  }
  for (const z of h.sand) if (inZone(z, x, y)) return 'sand';
  return 'turf';
}

function slopeAt(h: CompiledHole, x: number, y: number, out: Vec): number {
  out.x = 0;
  out.y = 0;
  for (const s of h.slopes) {
    if (inZone(s.zone, x, y)) {
      out.x += s.ax;
      out.y += s.ay;
    }
  }
  return Math.sqrt(out.x * out.x + out.y * out.y);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface SimEvent {
  tick: number;
  kind: PuttPathEventKind;
  x: number;
  y: number;
  /** Impact speed (collisions) or object index (bumper / portal). */
  v: number;
}

export interface ShotSim {
  result: PuttShotResult;
  /** Where the ball physically stopped (splash / fall point for hazards, cup centre when holed). */
  end: { x: number; y: number };
  ticks: number;
  /** Positions [x, y, …] at ticks 0, S, 2S, … and finally at `ticks` (S = PUTT_PATH_SAMPLE). */
  samples: number[];
  events: SimEvent[];
  /** Stopped by the simulation length cap. */
  capped: boolean;
}

export interface SimOptions {
  /** Stop at the first collision (trajectory previews). */
  untilFirstContact?: boolean;
  /** Hard tick limit (defaults to PHYS.maxTicks). */
  maxTicks?: number;
  /** Skip path sampling (solvers). */
  noSamples?: boolean;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Hit {
  t: number;
  nx: number;
  ny: number;
  e: number;
  kind: ColliderKind;
  index: number;
  seg: Seg | null;
}

const EPS = 1e-4;

/** Surface velocity of a collider at a contact point. */
function surfaceVel(seg: Seg | null, x: number, y: number, out: Vec): void {
  if (!seg || seg.kind !== 'blade') {
    out.x = 0;
    out.y = 0;
    return;
  }
  if (seg.w !== 0) {
    out.x = -seg.w * (y - seg.py);
    out.y = seg.w * (x - seg.px);
  } else {
    out.x = seg.svx;
    out.y = seg.svy;
  }
}

function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, r: number, best: number): number {
  const fx = px - cx;
  const fy = py - cy;
  const a = dx * dx + dy * dy;
  if (a <= 0) return -1;
  const b = fx * dx + fy * dy;
  if (b >= 0) return -1;
  const c = fx * fx + fy * fy - r * r;
  if (c < 0) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t < best ? t : -1;
}

function sweepSeg(ball: Ball, dx: number, dy: number, s: Seg, hit: Hit): void {
  const wx = ball.x - s.ax;
  const wy = ball.y - s.ay;
  const d0 = wx * s.nx + wy * s.ny;
  const sg = d0 >= 0 ? 1 : -1;
  const nx = s.nx * sg;
  const ny = s.ny * sg;
  const d0a = d0 * sg;
  const dd = dx * nx + dy * ny;
  if (dd < 0 && d0a >= s.r - EPS) {
    const t = (d0a - s.r) / -dd;
    if (t >= 0 && t < hit.t) {
      const along = (wx + dx * t) * s.ux + (wy + dy * t) * s.uy;
      if (along >= 0 && along <= s.len) {
        hit.t = t;
        hit.nx = nx;
        hit.ny = ny;
        hit.e = s.e;
        hit.kind = s.kind;
        hit.index = s.mover;
        hit.seg = s;
        return;
      }
    }
  }
  for (let end = 0; end < 2; end++) {
    const cx = end === 0 ? s.ax : s.bx;
    const cy = end === 0 ? s.ay : s.by;
    const t = rayCircle(ball.x, ball.y, dx, dy, cx, cy, s.r, hit.t);
    if (t >= 0) {
      const hx = ball.x + dx * t - cx;
      const hy = ball.y + dy * t - cy;
      const l = Math.sqrt(hx * hx + hy * hy) || 1;
      hit.t = t;
      hit.nx = hx / l;
      hit.ny = hy / l;
      hit.e = s.e;
      hit.kind = s.kind;
      hit.index = s.mover;
      hit.seg = s;
    }
  }
}

const sv: Vec = { x: 0, y: 0 };

/** Resolve a contact: reflect the ball's velocity relative to the (possibly moving) surface. */
function bounce(ball: Ball, nx: number, ny: number, e: number, kind: ColliderKind, seg: Seg | null): number {
  surfaceVel(seg, ball.x, ball.y, sv);
  const rvx = ball.vx - sv.x;
  const rvy = ball.vy - sv.y;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const tx = rvx - vn * nx;
  const ty = rvy - vn * ny;
  let out: number;
  let keep: number = PHYS.wallKeep;
  if (kind === 'bumper') {
    out = Math.min(PHYS.bumperMax, -vn * e + PHYS.bumperOut);
    keep = 1;
  } else {
    out = -vn * e;
  }
  ball.vx = tx * keep + nx * out + sv.x;
  ball.vy = ty * keep + ny * out + sv.y;
  const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const cap = kind === 'bumper' ? PHYS.bumperMax : PHYS.speedCap;
  if (sp > cap) {
    ball.vx *= cap / sp;
    ball.vy *= cap / sp;
  }
  return -vn;
}

/** Push the ball out of anything it overlaps (moving blades sweep into balls; numerical safety). */
function depenetrateSegs(list: Seg[], ball: Ball, onHit: (kind: ColliderKind, index: number, v: number) => void): void {
  for (const s of list) {
    const wx = ball.x - s.ax;
    const wy = ball.y - s.ay;
    let t = wx * s.ux + wy * s.uy;
    t = t < 0 ? 0 : t > s.len ? s.len : t;
    const cx = s.ax + s.ux * t;
    const cy = s.ay + s.uy * t;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= s.r * s.r) continue;
    const d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d > 1e-6) {
      nx = dx / d;
      ny = dy / d;
    } else {
      nx = s.nx;
      ny = s.ny;
    }
    ball.x = cx + nx * (s.r + 0.01);
    ball.y = cy + ny * (s.r + 0.01);
    const v = bounce(ball, nx, ny, s.e, s.kind, s);
    if (v > 0) onHit(s.kind, s.mover, v);
  }
}

/** Push the ball out of anything it overlaps (moving blades sweep into balls; numerical safety). */
function depenetrate(h: CompiledHole, ball: Ball, onHit: (kind: ColliderKind, index: number, v: number) => void): void {
  depenetrateSegs(h.segs, ball, onHit);
  if (h.moverSegs.length) depenetrateSegs(h.moverSegs, ball, onHit);
  for (const c of h.circs) {
    const dx = ball.x - c.x;
    const dy = ball.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= c.r * c.r) continue;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    ball.x = c.x + nx * (c.r + 0.01);
    ball.y = c.y + ny * (c.r + 0.01);
    const v = bounce(ball, nx, ny, c.e, c.kind, null);
    if (v > 0) onHit(c.kind, c.index, v);
  }
}

function eventKind(kind: ColliderKind): PuttPathEventKind {
  switch (kind) {
    case 'post':
    case 'hub':
      return 'post';
    case 'bumper':
      return 'bumper';
    case 'blade':
      return 'blade';
    default:
      return 'wall';
  }
}

/**
 * Simulate one stroke from `from` with an intent (angle in hundredths of a degree, power
 * per-mille), with moving obstacles at hole-clock time `obstacleMs` on the first tick.
 */
export function simulateShot(
  hole: HoleDef | CompiledHole,
  from: { x: number; y: number },
  angle: number,
  power: number,
  obstacleMs: number,
  opts: SimOptions = {},
): ShotSim {
  const h = 'segs' in hole ? hole : compileHole(hole);
  const dir = angleDir(angle);
  const speed = launchSpeed(power);
  const ball: Ball = { x: from.x, y: from.y, vx: dir.x * speed, vy: dir.y * speed };
  const dt = PHYS.dt;
  const R = PHYS.ballR;
  const cupX = h.def.cup[0];
  const cupY = h.def.cup[1];
  const cupR = PHYS.cupR;
  const maxTicks = opts.maxTicks ?? PHYS.maxTicks;
  const samples: number[] = [];
  const events: SimEvent[] = [];
  const lastHitTick = new Map<string, number>();
  const slope: Vec = { x: 0, y: 0 };
  const hit: Hit = { t: 1, nx: 0, ny: 0, e: 0, kind: 'wall', index: -1, seg: null };
  let tick = 0;
  let result: PuttShotResult = 'rest';
  let capped = false;
  let settle = 0;
  let inCup = false;
  let cupTicks = 0;
  let onSand = false;
  let portalLock = -1;
  let contact = false;
  let lastSampleTick = 0;
  const recordHit = (kind: ColliderKind, index: number, v: number) => {
    contact = true;
    if (v < 18) return;
    const key = `${kind}:${index}`;
    const last = lastHitTick.get(key);
    if (last !== undefined && tick - last < 5) return;
    lastHitTick.set(key, tick);
    events.push({ tick, kind: eventKind(kind), x: ball.x, y: ball.y, v: kind === 'bumper' ? index : Math.round(v) });
  };
  if (!opts.noSamples) samples.push(ball.x, ball.y);
  if (h.movers.length) updateMovers(h, obstacleMs);
  depenetrate(h, ball, () => undefined);

  while (tick < maxTicks) {
    tick++;
    const tMs = obstacleMs + ((tick - 1) * 1000) / PHYS.tickHz;
    if (h.movers.length) {
      updateMovers(h, tMs);
      depenetrate(h, ball, recordHit);
    }

    // --- Forces --------------------------------------------------------------
    const surface = surfaceAt(h, ball.x, ball.y);
    const sand = surface === 'sand';
    if (sand && !onSand) events.push({ tick, kind: 'sand', x: ball.x, y: ball.y, v: 0 });
    onSand = sand;
    slopeAt(h, ball.x, ball.y, slope);
    ball.vx += slope.x * dt;
    ball.vy += slope.y * dt;
    const cdx = cupX - ball.x;
    const cdy = cupY - ball.y;
    const cupD = Math.sqrt(cdx * cdx + cdy * cdy);
    const overCup = cupD < cupR;
    if (overCup && cupD > 0.25) {
      ball.vx += (cdx / cupD) * PHYS.cupPull * dt;
      ball.vy += (cdy / cupD) * PHYS.cupPull * dt;
    }
    const fr = sand ? PHYS.sandFriction : PHYS.friction;
    const dg = sand ? PHYS.sandDrag : PHYS.drag;
    let sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (sp > 0) {
      const dec = (fr + dg * sp) * dt;
      if (dec >= sp) {
        ball.vx = 0;
        ball.vy = 0;
      } else {
        const k = (sp - dec) / sp;
        ball.vx *= k;
        ball.vy *= k;
      }
    }

    // --- Swept motion ------------------------------------------------------------
    let remaining = 1;
    for (let iter = 0; iter < 8 && remaining > 1e-6; iter++) {
      const dx = ball.vx * dt * remaining;
      const dy = ball.vy * dt * remaining;
      if (dx === 0 && dy === 0) break;
      hit.t = 1;
      hit.seg = null;
      for (const s of h.segs) sweepSeg(ball, dx, dy, s, hit);
      for (const s of h.moverSegs) sweepSeg(ball, dx, dy, s, hit);
      for (const c of h.circs) {
        const t = rayCircle(ball.x, ball.y, dx, dy, c.x, c.y, c.r, hit.t);
        if (t >= 0) {
          const hx = ball.x + dx * t - c.x;
          const hy = ball.y + dy * t - c.y;
          const l = Math.sqrt(hx * hx + hy * hy) || 1;
          hit.t = t;
          hit.nx = hx / l;
          hit.ny = hy / l;
          hit.e = c.e;
          hit.kind = c.kind;
          hit.index = c.index;
          hit.seg = null;
        }
      }
      if (hit.t >= 1) {
        ball.x += dx;
        ball.y += dy;
        break;
      }
      ball.x += dx * hit.t + hit.nx * 0.002;
      ball.y += dy * hit.t + hit.ny * 0.002;
      remaining *= 1 - hit.t;
      const v = bounce(ball, hit.nx, hit.ny, hit.e, hit.kind, hit.seg);
      recordHit(hit.kind, hit.index, v);
      if (opts.untilFirstContact) break;
    }
    if (opts.untilFirstContact && contact) {
      result = 'rest';
      break;
    }

    // --- Hazards, portals, cup ---------------------------------------------------
    const after = surfaceAt(h, ball.x, ball.y);
    if (after === 'water' || after === 'void') {
      result = after === 'water' ? 'water' : 'oob';
      events.push({ tick, kind: after === 'water' ? 'water' : 'oob', x: ball.x, y: ball.y, v: 0 });
      break;
    }
    if (ball.x < h.bounds.minX - 50 || ball.x > h.bounds.maxX + 50 || ball.y < h.bounds.minY - 50 || ball.y > h.bounds.maxY + 50) {
      result = 'oob';
      events.push({ tick, kind: 'oob', x: ball.x, y: ball.y, v: 0 });
      break;
    }
    if (portalLock >= 0) {
      const p = h.portals[portalLock]!;
      const lock = PHYS.portalR * 1.6;
      const pdx = ball.x - p.tx;
      const pdy = ball.y - p.ty;
      if (pdx * pdx + pdy * pdy > lock * lock) portalLock = -1;
    }
    if (portalLock < 0) {
      const enter = PHYS.portalR * 0.75;
      for (let i = 0; i < h.portals.length; i++) {
        const p = h.portals[i]!;
        const pdx = ball.x - p.fx;
        const pdy = ball.y - p.fy;
        if (pdx * pdx + pdy * pdy < enter * enter) {
          events.push({ tick, kind: 'portal', x: ball.x, y: ball.y, v: i });
          const s0 = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
          const s1 = Math.max(s0 * PHYS.portalKeep, PHYS.portalExitMin);
          ball.x = p.tx;
          ball.y = p.ty;
          ball.vx = p.ex * s1;
          ball.vy = p.ey * s1;
          portalLock = i;
          break;
        }
      }
    }
    const ex = cupX - ball.x;
    const ey = cupY - ball.y;
    const d = Math.sqrt(ex * ex + ey * ey);
    sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (d < cupR) {
      if (!inCup) cupTicks = 0;
      inCup = true;
      cupTicks++;
      const q = d / cupR;
      const capture = PHYS.captureSpeed * (1 - 0.55 * q * q);
      if ((d < cupR - R * 0.35 && sp < capture) || sp < 40) {
        result = 'cup';
        ball.x = cupX;
        ball.y = cupY;
        ball.vx = 0;
        ball.vy = 0;
        events.push({ tick, kind: 'cup', x: cupX, y: cupY, v: 0 });
        break;
      }
    } else if (inCup) {
      inCup = false;
      if (cupTicks > 1) events.push({ tick, kind: 'lip', x: ball.x, y: ball.y, v: Math.round(sp) });
    }

    if (!opts.noSamples && tick % PUTT_PATH_SAMPLE === 0) {
      samples.push(ball.x, ball.y);
      lastSampleTick = tick;
    }

    // --- Rest ---------------------------------------------------------------------
    if (sp < PHYS.settleSpeed && !inCup) {
      const sweep = h.movers.length > 0 && inMoverSweep(h, ball.x, ball.y);
      if (!sweep) {
        if (sp < PHYS.stopSpeed) {
          const frNow = surfaceAt(h, ball.x, ball.y) === 'sand' ? PHYS.sandFriction : PHYS.friction;
          if (slopeAt(h, ball.x, ball.y, slope) <= frNow) break;
        }
        if (++settle >= PHYS.settleTicks) break;
      } else settle = 0;
    } else settle = 0;
    if (tick >= maxTicks) capped = true;
  }
  if (!opts.noSamples && lastSampleTick !== tick) samples.push(ball.x, ball.y);
  return { result, end: { x: ball.x, y: ball.y }, ticks: tick, samples, events, capped };
}

/** Final resting lie for a simulated shot (snapped so it is exact in float32 state). */
export function restLie(sim: ShotSim): { x: number; y: number } {
  return { x: snap64(sim.end.x), y: snap64(sim.end.y) };
}

export const PATH_EVENT_INDEX: Record<PuttPathEventKind, number> = Object.fromEntries(PUTT_PATH_EVENTS.map((k, i) => [k, i])) as Record<
  PuttPathEventKind,
  number
>;
