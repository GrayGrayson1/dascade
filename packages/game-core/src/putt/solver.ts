/**
 * Shot solver: a coarse "distance to the cup" flow field over the hole (walls block,
 * portals connect, sand costs more) plus a brute-force intent search. Used by tests to prove
 * every hole is playable within par, and by integration tests to find good shots. Not used
 * by the live server (players decide their own shots).
 */
import { PUTT_ANGLE_UNITS, PUTT_POWER_MAX, PUTT_POWER_MIN } from '@dascade/shared/games/putt';
import { PHYS, compileHole, restLie, simulateShot, surfaceAt, type CompiledHole, type ShotSim } from './physics.ts';
import { segDist2 } from './math.ts';
import type { HoleDef } from './types.ts';

export interface FlowField {
  cell: number;
  ox: number;
  oy: number;
  cols: number;
  rows: number;
  dist: Float64Array;
}

const fieldCache = new WeakMap<HoleDef, FlowField>();

function blocked(h: CompiledHole, x: number, y: number): boolean {
  const s = surfaceAt(h, x, y);
  if (s === 'water' || s === 'void') return true;
  const R = PHYS.ballR;
  for (const seg of h.segs) {
    const r = seg.r - 1;
    if (segDist2(x, y, seg.ax, seg.ay, seg.bx, seg.by) < r * r) return true;
  }
  for (const c of h.circs) {
    const r = c.r - 1;
    if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < r * r) return true;
  }
  void R;
  return false;
}

/** Walking distance from every grid cell to the cup (Infinity = unreachable). */
export function flowField(def: HoleDef, cell = 8): FlowField {
  const cached = fieldCache.get(def);
  if (cached && cached.cell === cell) return cached;
  const h = compileHole(def);
  const ox = h.bounds.minX;
  const oy = h.bounds.minY;
  const cols = Math.ceil((h.bounds.maxX - ox) / cell) + 1;
  const rows = Math.ceil((h.bounds.maxY - oy) / cell) + 1;
  const n = cols * rows;
  const pass = new Uint8Array(n);
  const cost = new Float64Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * cell;
      const y = oy + r * cell;
      const i = r * cols + c;
      pass[i] = blocked(h, x, y) ? 0 : 1;
      cost[i] = surfaceAt(h, x, y) === 'sand' ? 3 : 1;
    }
  }
  const idx = (x: number, y: number) => {
    const c = Math.max(0, Math.min(cols - 1, Math.round((x - ox) / cell)));
    const r = Math.max(0, Math.min(rows - 1, Math.round((y - oy) / cell)));
    return r * cols + c;
  };
  const exits = new Map<number, number[]>();
  for (const p of h.portals) {
    const to = idx(p.tx, p.ty);
    const list = exits.get(to) ?? [];
    list.push(idx(p.fx, p.fy));
    exits.set(to, list);
  }
  const dist = new Float64Array(n).fill(Infinity);
  // Simple binary-heap Dijkstra.
  const heap: number[] = [];
  const hd: number[] = [];
  const push = (i: number, d: number) => {
    heap.push(i);
    hd.push(d);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p]! <= hd[k]!) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      [hd[p], hd[k]] = [hd[k]!, hd[p]!];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0]!, hd[0]!];
    const li = heap.pop()!;
    const ld = hd.pop()!;
    if (heap.length) {
      heap[0] = li;
      hd[0] = ld;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && hd[l]! < hd[m]!) m = l;
        if (r < heap.length && hd[r]! < hd[m]!) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        [hd[m], hd[k]] = [hd[k]!, hd[m]!];
        k = m;
      }
    }
    return top;
  };
  const start = idx(def.cup[0], def.cup[1]);
  dist[start] = 0;
  push(start, 0);
  const D = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;
  while (heap.length) {
    const [i, d] = pop();
    if (d > dist[i]!) continue;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    for (const [dc, dr, w] of D) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!pass[j]) continue;
      const nd = d + w * cell * cost[j]!;
      if (nd < dist[j]!) {
        dist[j] = nd;
        push(j, nd);
      }
    }
    for (const entry of exits.get(i) ?? []) {
      if (d + cell < dist[entry]!) {
        dist[entry] = d + cell;
        push(entry, d + cell);
      }
    }
  }
  const field = { cell, ox, oy, cols, rows, dist };
  fieldCache.set(def, field);
  return field;
}

/** Flow-field distance from a point to the cup (nearest reachable cell). */
export function distanceToCup(def: HoleDef, x: number, y: number): number {
  const f = flowField(def);
  const c0 = Math.round((x - f.ox) / f.cell);
  const r0 = Math.round((y - f.oy) / f.cell);
  let best = Infinity;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) continue;
      const d = f.dist[r * f.cols + c]!;
      if (d < best) best = d;
    }
  }
  return best;
}

export interface Candidate {
  angle: number;
  power: number;
  obstacleMs: number;
  sim: ShotSim;
  score: number;
}

export interface SearchOptions {
  /** Angle step in hundredths of a degree (default 3°). */
  angleStep?: number;
  powers?: readonly number[];
  /** Hole-clock times to try (moving obstacles). */
  obstacleMs?: readonly number[];
  /** Keep the best N results. */
  keep?: number;
}

const DEFAULT_POWERS = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960];

/** Brute-force the intents from a lie; returns the best candidates (holed first, then closest by flow distance). */
export function searchShots(def: HoleDef, from: { x: number; y: number }, opts: SearchOptions = {}): Candidate[] {
  const h = compileHole(def);
  const step = opts.angleStep ?? 300;
  const powers = opts.powers ?? DEFAULT_POWERS;
  const times = opts.obstacleMs ?? [0];
  const keep = opts.keep ?? 8;
  const out: Candidate[] = [];
  for (const t of times) {
    for (let angle = 0; angle < PUTT_ANGLE_UNITS; angle += step) {
      for (const p of powers) {
        const power = Math.max(PUTT_POWER_MIN, Math.min(PUTT_POWER_MAX, p));
        const sim = simulateShot(h, from, angle, power, t, { noSamples: true });
        if (sim.result === 'water' || sim.result === 'oob') continue;
        const score = sim.result === 'cup' ? -1 : distanceToCup(def, sim.end.x, sim.end.y);
        if (!Number.isFinite(score)) continue;
        out.push({ angle, power, obstacleMs: t, sim, score });
      }
    }
  }
  out.sort((a, b) => a.score - b.score || a.power - b.power);
  // Diversify: drop candidates that end almost where a better one ended.
  const picked: Candidate[] = [];
  for (const c of out) {
    if (picked.length >= keep) break;
    if (picked.some((p) => p.sim.result === c.sim.result && Math.abs(p.sim.end.x - c.sim.end.x) + Math.abs(p.sim.end.y - c.sim.end.y) < 24)) continue;
    picked.push(c);
  }
  return picked;
}

/** Beam search for the fewest strokes to hole out from the tee (null if not found within `maxStrokes`). */
export function solveHole(
  def: HoleDef,
  opts: SearchOptions & { beam?: number; maxStrokes?: number } = {},
): { strokes: number; line: Array<{ angle: number; power: number; obstacleMs: number }> } | null {
  const beam = opts.beam ?? 4;
  const maxStrokes = opts.maxStrokes ?? def.par + 1;
  let frontier: Array<{ x: number; y: number; line: Array<{ angle: number; power: number; obstacleMs: number }> }> = [
    { x: def.tee[0], y: def.tee[1], line: [] },
  ];
  for (let stroke = 1; stroke <= maxStrokes; stroke++) {
    const next: Array<{ x: number; y: number; line: Array<{ angle: number; power: number; obstacleMs: number }>; score: number }> = [];
    for (const node of frontier) {
      const cands = searchShots(def, node, { ...opts, keep: beam });
      for (const c of cands) {
        const line = [...node.line, { angle: c.angle, power: c.power, obstacleMs: c.obstacleMs }];
        if (c.sim.result === 'cup') return { strokes: stroke, line };
        const lie = restLie(c.sim);
        next.push({ ...lie, line, score: c.score });
      }
    }
    next.sort((a, b) => a.score - b.score);
    frontier = [];
    for (const n of next) {
      if (frontier.length >= beam) break;
      if (frontier.some((f) => Math.abs(f.x - n.x) + Math.abs(f.y - n.y) < 20)) continue;
      frontier.push(n);
    }
    if (!frontier.length) return null;
  }
  return null;
}
