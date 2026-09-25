/**
 * Deterministic scenery for a track: a neon city of blocks and buildings around
 * the corridor, grandstands on the main straight, billboards, lamps, gantries over
 * the checkpoint gates and street segments for ambient traffic. Generated from the
 * track's decorSeed with a seeded RNG, so every client builds the identical city.
 * (Content, not outcomes — the seeded RNG is fine here.)
 */
import { createSeededRng, type Rng } from '@dascade/shared';
import { mod, pointSegDist2 } from './math.ts';
import { levelAt, pointAt, projectOnTrack, type Track } from './track.ts';

export type BuildingKind = 'tower' | 'block' | 'arcade' | 'hotel' | 'garage' | 'dome';

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Relative height 0.15..1 (drives 2.5D lean and shading). */
  height: number;
  kind: BuildingKind;
  /** Palette index for roof/wall colours. */
  tone: number;
  /** Neon accent colour index (0..3). */
  neon: number;
  seed: number;
  sign: string | null;
}

export interface Park {
  x: number;
  y: number;
  w: number;
  h: number;
  trees: Array<{ x: number; y: number; r: number }>;
}

export interface Stand {
  x: number;
  y: number;
  angle: number;
  length: number;
  depth: number;
  side: number;
}

export interface Billboard {
  x: number;
  y: number;
  angle: number;
  text: string;
  tone: number;
}

export interface Lamp {
  x: number;
  y: number;
  tone: number;
}

export interface Gantry {
  x: number;
  y: number;
  angle: number;
  span: number;
  gate: number;
}

export interface Street {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Decor {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  buildings: Building[];
  parks: Park[];
  lots: Array<{ x: number; y: number; w: number; h: number; seed: number }>;
  stands: Stand[];
  billboards: Billboard[];
  lamps: Lamp[];
  gantries: Gantry[];
  streets: Street[];
  /** City grid pitch (block + street). */
  cell: number;
  street: number;
}

const SIGNS = ['DASH', 'NEON', 'VOLT', 'ARCADE', 'NOODLE', 'PIXEL', 'TURBO', 'HOTEL', 'DRIFT', '24/7', 'CAFE', 'SYNTH', 'DAS', 'BYTE'];
const BOARDS = ['DASCADE', 'DASH CIRCUIT', 'VOLT ENERGY', 'NEON NOODLES', 'PIXEL TYRES', 'TURBO COLA', 'GRID FM', 'DRIFT KING', 'SYNTHWAVE', 'BYTE BANK'];

/** Spatial hash of centerline segments for fast "how far is the road" queries. */
class SegmentIndex {
  private readonly buckets = new Map<number, number[]>();
  constructor(
    private readonly track: Track,
    private readonly size = 128,
  ) {
    for (let i = 0; i < track.n; i++) {
      const key = this.key(Math.floor(track.xs[i]! / size), Math.floor(track.ys[i]! / size));
      let list = this.buckets.get(key);
      if (!list) this.buckets.set(key, (list = []));
      list.push(i);
    }
  }
  private key(bx: number, by: number): number {
    return (bx + 4096) * 8192 + (by + 4096);
  }
  /** Distance to the centerline, or `cap` when nothing is within ~cap. */
  distance(x: number, y: number, cap = 520): number {
    const { track, size } = this;
    const r = Math.ceil(cap / size);
    const bx = Math.floor(x / size);
    const by = Math.floor(y / size);
    let best = cap * cap;
    const t = [0];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const list = this.buckets.get(this.key(bx + i, by + j));
        if (!list) continue;
        for (const a of list) {
          const b = (a + 1) % track.n;
          const d2 = pointSegDist2(x, y, track.xs[a]!, track.ys[a]!, track.xs[b]!, track.ys[b]!, t);
          if (d2 < best) best = d2;
        }
      }
    }
    return Math.sqrt(best);
  }
}

let activeIndex: SegmentIndex | null = null;

function distToTrack(_track: Track, x: number, y: number): number {
  return activeIndex ? activeIndex.distance(x, y) : Math.abs(projectOnTrack(_track, x, y).d);
}

/** Min distance from any of a rect's sample points to the centerline, minus a sampling tolerance. */
function rectClearance(track: Track, x: number, y: number, w: number, h: number): number {
  let min = Infinity;
  const nx = 4;
  const ny = 4;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const d = distToTrack(track, x + (w * i) / nx, y + (h * j) / ny);
      if (d < min) min = d;
    }
  }
  const step = Math.max(w / nx, h / ny);
  return min - step * 0.72;
}

export function generateDecor(track: Track): Decor {
  activeIndex = new SegmentIndex(track);
  try {
    return buildDecor(track);
  } finally {
    activeIndex = null;
  }
}

function buildDecor(track: Track): Decor {
  const rng: Rng = createSeededRng(`circuit-decor:${track.def.id}:${track.def.decorSeed}`);
  const margin = 900;
  const bounds = {
    minX: Math.floor((track.bounds.minX - margin) / 10) * 10,
    minY: Math.floor((track.bounds.minY - margin) / 10) * 10,
    maxX: Math.ceil((track.bounds.maxX + margin) / 10) * 10,
    maxY: Math.ceil((track.bounds.maxY + margin) / 10) * 10,
  };
  const cell = 320;
  const street = 64;
  const clearance = track.wall + 26;
  const buildings: Building[] = [];
  const parks: Park[] = [];
  const lots: Decor['lots'] = [];

  const ox = bounds.minX;
  const oy = bounds.minY;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cell);

  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const bx = ox + cx * cell + street / 2;
      const by = oy + cy * cell + street / 2;
      const bs = cell - street;
      const whole = rectClearance(track, bx, by, bs, bs);
      const roll = rng.next();
      if (whole > clearance) {
        if (roll < 0.1) {
          parks.push(makePark(rng, bx, by, bs, bs));
          continue;
        }
        if (roll < 0.17) {
          lots.push({ x: bx, y: by, w: bs, h: bs, seed: rng.int(1e6) });
          continue;
        }
        if (roll < 0.42) {
          buildings.push(makeBuilding(rng, bx + 6, by + 6, bs - 12, bs - 12));
          continue;
        }
      }
      // Subdivide into 2×2 lots; keep the ones that clear the corridor.
      const half = (bs - 12) / 2;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const lx = bx + i * (half + 12);
          const ly = by + j * (half + 12);
          if (rectClearance(track, lx, ly, half, half) <= clearance) continue;
          const r = rng.next();
          if (r < 0.1) parks.push(makePark(rng, lx, ly, half, half));
          else if (r < 0.18) lots.push({ x: lx, y: ly, w: half, h: half, seed: rng.int(1e6) });
          else buildings.push(makeBuilding(rng, lx + 4, ly + 4, half - 8, half - 8));
        }
      }
    }
  }

  // Grandstands on both sides of the main straight, around the start/finish line.
  const stands: Stand[] = [];
  const standLen = 150;
  for (let k = -4; k <= 3; k++) {
    const sPos = mod(k * (standLen + 18) + 40, track.length);
    const p = pointAt(track, sPos);
    const angle = Math.atan2(p.ty, p.tx);
    for (const side of [-1, 1]) {
      const off = track.wall + 26 + 34;
      stands.push({ x: p.x - p.ty * off * side, y: p.y + p.tx * off * side, angle, length: standLen, depth: 58, side });
    }
  }

  // Billboards on the outside of straights, lamps along both barriers.
  const billboards: Billboard[] = [];
  const lamps: Lamp[] = [];
  const L = track.length;
  let boardIdx = rng.int(BOARDS.length);
  for (let sPos = 700; sPos < L - 900; sPos += 780 + rng.int(300)) {
    const i = Math.floor(sPos / track.spacing) % track.n;
    const k = track.curvature[i]!;
    const side = k > 0 ? -1 : 1; // outside of the bend
    const p = pointAt(track, sPos);
    const off = track.wall + 40;
    const bxp = p.x - p.ty * off * side;
    const byp = p.y + p.tx * off * side;
    if (distToTrack(track, bxp, byp) < track.wall + 20 || levelAt(track, sPos)) continue;
    billboards.push({ x: bxp, y: byp, angle: Math.atan2(p.ty, p.tx), text: BOARDS[boardIdx++ % BOARDS.length]!, tone: rng.int(4) });
  }
  let side = 1;
  for (let sPos = 60; sPos < L; sPos += 230) {
    const p = pointAt(track, sPos);
    const off = track.wall + 12;
    side = -side;
    const lx = p.x - p.ty * off * side;
    const ly = p.y + p.tx * off * side;
    if (distToTrack(track, lx, ly) < track.wall + 4) continue;
    lamps.push({ x: lx, y: ly, tone: rng.int(3) });
  }

  // Gantries over every checkpoint gate (gate 0 carries the start lights).
  const gantries: Gantry[] = track.gates.map((sPos, gate) => {
    const p = pointAt(track, sPos);
    return { x: p.x, y: p.y, angle: Math.atan2(p.ty, p.tx), span: track.wall * 2 + 24, gate };
  });

  // Streets for ambient traffic: grid lines split wherever they approach the corridor.
  const streets: Street[] = [];
  const pushRuns = (horizontal: boolean, fixed: number, from: number, to: number) => {
    let runStart: number | null = null;
    const stepLen = 40;
    for (let v = from; v <= to + 0.01; v += stepLen) {
      const x = horizontal ? v : fixed;
      const y = horizontal ? fixed : v;
      const ok = distToTrack(track, x, y) > track.wall + 60;
      if (ok && runStart === null) runStart = v;
      if ((!ok || v + stepLen > to) && runStart !== null) {
        const end = ok ? v : v - stepLen;
        if (end - runStart > 360) {
          streets.push(horizontal ? { x1: runStart, y1: fixed, x2: end, y2: fixed } : { x1: fixed, y1: runStart, x2: fixed, y2: end });
        }
        runStart = null;
      }
    }
  };
  for (let cy = 0; cy <= rows; cy++) pushRuns(true, oy + cy * cell, ox, ox + cols * cell);
  for (let cx = 0; cx <= cols; cx++) pushRuns(false, ox + cx * cell, oy, oy + rows * cell);

  return { bounds, buildings, parks, lots, stands, billboards, lamps, gantries, streets, cell, street };
}

function makeBuilding(rng: Rng, x: number, y: number, w: number, h: number): Building {
  const r = rng.next();
  const kind: BuildingKind = r < 0.22 ? 'tower' : r < 0.5 ? 'block' : r < 0.64 ? 'arcade' : r < 0.78 ? 'hotel' : r < 0.92 ? 'garage' : 'dome';
  const baseH = kind === 'tower' ? 0.75 : kind === 'hotel' ? 0.6 : kind === 'block' ? 0.4 : kind === 'arcade' ? 0.28 : kind === 'garage' ? 0.2 : 0.32;
  const height = Math.min(1, baseH + rng.next() * 0.25);
  const hasSign = kind === 'arcade' || kind === 'hotel' || rng.next() < 0.3;
  return {
    x,
    y,
    w,
    h,
    height,
    kind,
    tone: rng.int(6),
    neon: rng.int(4),
    seed: rng.int(1e9),
    sign: hasSign ? SIGNS[rng.int(SIGNS.length)]! : null,
  };
}

function makePark(rng: Rng, x: number, y: number, w: number, h: number): Park {
  const trees: Park['trees'] = [];
  const count = Math.max(3, Math.floor((w * h) / 5200));
  for (let i = 0; i < count; i++) {
    trees.push({ x: x + 14 + rng.next() * (w - 28), y: y + 14 + rng.next() * (h - 28), r: 10 + rng.next() * 12 });
  }
  return { x, y, w, h, trees };
}
