/**
 * Kart bodies (buggy, rocket, tub), the shared wheel, and assembled kart models.
 *
 * Model space: origin on the ground under the kart centre, +X forward, +Y up, −Z = kart's left.
 * A kart is ~2.1 long and ~1.4 wide. `buildKartArt` returns:
 *  - body: chassis + seated driver torso, merged (1 draw call)
 *  - head: the driver's head around its neck pivot (1 draw call; turns/leans)
 *  - lod:  a ~150-triangle stand-in with wheels for far karts (1 draw call)
 *  - spec: anchors (wheels, seat, head pivot, exhausts, trailed item, name tag height)
 * Wheels are drawn by the renderer with one InstancedMesh for every kart (`buildWheelGeometry`).
 * Results are cached by racer/body/paint; callers must not dispose cached geometry
 * (use `clearKartArtCache()` when the renderer is disposed).
 */
import type { BufferGeometry } from 'three';
import type { KartBodyId, KartRacerId } from '@dascade/shared/games/kart';
import { MeshBuilder } from './builder.ts';
import { HEAD_PIVOT, buildRacerHead, buildRacerTorso } from './racers.ts';
import { RACER_ART, hexToInt, shadeInt, trimFor } from './palette.ts';

export interface WheelSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  front: boolean;
}

export interface KartBodySpec {
  wheels: readonly WheelSpec[];
  /** Driver hips. */
  seat: readonly [number, number, number];
  /** Neck pivot in kart space. */
  head: readonly [number, number, number];
  exhausts: readonly (readonly [number, number, number])[];
  /** Where a trailed item hangs. */
  trail: readonly [number, number, number];
  /** Name tag height. */
  top: number;
  /** Rear emblem plate centre (faces −X). */
  plate: readonly [number, number, number];
}

const DARK = 0x1c1f2b;
const METAL = 0x9aa4b8;
const CHROME = 0xd6dde8;
const RUBBER = 0x22232b;
const LIGHT = 0xfff6c8;
const TAIL = 0xff3048;

const W_FRONT = 0.25;
const W_REAR = 0.3;

export const KART_SPECS: Record<KartBodyId, KartBodySpec> = {
  buggy: {
    wheels: [
      { x: 0.72, y: W_FRONT, z: -0.66, r: W_FRONT, front: true },
      { x: 0.72, y: W_FRONT, z: 0.66, r: W_FRONT, front: true },
      { x: -0.66, y: W_REAR, z: -0.7, r: W_REAR, front: false },
      { x: -0.66, y: W_REAR, z: 0.7, r: W_REAR, front: false },
    ],
    seat: [-0.22, 0.42, 0],
    head: [-0.24, 0.92, 0],
    exhausts: [
      [-1.2, 0.62, -0.2],
      [-1.2, 0.62, 0.2],
    ],
    trail: [-1.45, 0.35, 0],
    top: 1.75,
    plate: [-1.1, 0.31, 0],
  },
  rocket: {
    wheels: [
      { x: 0.66, y: W_FRONT, z: -0.64, r: W_FRONT, front: true },
      { x: 0.66, y: W_FRONT, z: 0.64, r: W_FRONT, front: true },
      { x: -0.62, y: W_REAR, z: -0.68, r: W_REAR, front: false },
      { x: -0.62, y: W_REAR, z: 0.68, r: W_REAR, front: false },
    ],
    seat: [-0.2, 0.62, 0],
    head: [-0.22, 1.12, 0],
    exhausts: [[-1.1, 0.5, 0]],
    trail: [-1.55, 0.4, 0],
    top: 1.95,
    plate: [-0.97, 0.8, 0],
  },
  tub: {
    wheels: [
      { x: 0.62, y: 0.22, z: -0.6, r: 0.22, front: true },
      { x: 0.62, y: 0.22, z: 0.6, r: 0.22, front: true },
      { x: -0.6, y: 0.24, z: -0.62, r: 0.24, front: false },
      { x: -0.6, y: 0.24, z: 0.62, r: 0.24, front: false },
    ],
    seat: [-0.12, 0.5, 0],
    head: [-0.14, 1.0, 0],
    exhausts: [
      [-1.05, 0.5, -0.3],
      [-1.05, 0.5, 0.3],
    ],
    trail: [-1.4, 0.35, 0],
    top: 1.85,
    plate: [-0.99, 0.42, 0],
  },
};

type BodyFn = (b: MeshBuilder, paint: number, trim: number) => void;

const BODY: Record<KartBodyId, BodyFn> = {
  buggy(b, paint, trim) {
    const pDark = shadeInt(paint, -0.3);
    b.box(0, 0.26, 0, 1.8, 0.1, 1.0, DARK);
    // side pods + nose
    b.box(0.0, 0.4, -0.5, 1.1, 0.24, 0.26, paint).box(0.0, 0.4, 0.5, 1.1, 0.24, 0.26, paint);
    b.box(0.0, 0.53, -0.5, 1.0, 0.03, 0.2, trim).box(0.0, 0.53, 0.5, 1.0, 0.03, 0.2, trim);
    b.box(0.72, 0.38, 0, 0.56, 0.22, 0.78, paint);
    b.boxR(0.52, 0.5, 0, 0.3, 0.1, 0.6, 'z', 0.35, paint);
    b.box(0.74, 0.5, 0, 0.5, 0.02, 0.14, trim);
    b.box(1.06, 0.3, 0, 0.12, 0.14, 1.3, pDark);
    b.box(1.07, 0.4, -0.3, 0.04, 0.08, 0.14, LIGHT, 1).box(1.07, 0.4, 0.3, 0.04, 0.08, 0.14, LIGHT, 1);
    // number plate
    b.box(1.0, 0.44, 0, 0.02, 0.14, 0.24, 0xf8fafc).box(1.012, 0.44, 0, 0.01, 0.08, 0.06, DARK);
    // seat (low back so shoulders and head read from the chase cam)
    b.box(-0.22, 0.38, 0, 0.42, 0.12, 0.56, DARK);
    b.boxR(-0.44, 0.55, 0, 0.1, 0.24, 0.58, 'z', 0.14, trim);
    // slim chrome roll hoop: two uprights meeting in a low arch behind the shoulders
    for (const z of [-0.34, 0.34]) b.boxR(-0.56, 0.7, z, 0.05, 0.56, 0.05, 'x', z > 0 ? 0.18 : -0.18, CHROME);
    // engine: finned block, painted cover, chrome intake
    b.box(-0.78, 0.46, 0, 0.42, 0.3, 0.62, 0x2f3544);
    for (let i = 0; i < 4; i++) {
      b.box(-0.78, 0.36 + i * 0.075, -0.32, 0.38, 0.025, 0.03, METAL).box(-0.78, 0.36 + i * 0.075, 0.32, 0.38, 0.025, 0.03, METAL);
    }
    b.box(-0.8, 0.645, 0, 0.44, 0.07, 0.56, paint);
    b.box(-0.8, 0.685, 0, 0.3, 0.02, 0.1, trim);
    b.cyl(-0.72, 0.74, 0, 0.09, 0.1, CHROME, 10);
    b.cyl(-0.72, 0.8, 0, 0.11, 0.03, 0x1c1f2b, 10);
    // twin exhausts: chrome pipes rising out of the block, flared tips (glow discs sit at the tips)
    for (const z of [-0.2, 0.2]) {
      b.boxR(-0.98, 0.56, z, 0.3, 0.07, 0.07, 'z', 0.35, CHROME);
      b.cyl(-1.13, 0.62, z, 0.07, 0.12, CHROME, 10, 'x', 0, 0.09);
      b.cyl(-1.13, 0.62, z, 0.05, 0.13, 0x1a1a20, 10, 'x');
    }
    // rear bumper + diffuser + emblem plate + tail bars
    b.box(-1.03, 0.32, 0, 0.12, 0.18, 1.32, paint);
    b.box(-1.03, 0.43, 0, 0.13, 0.03, 1.34, trim);
    for (let i = -2; i <= 2; i++) b.box(-1.0, 0.17, i * 0.2, 0.2, 0.1, 0.03, 0x14151c);
    b.box(-0.98, 0.21, 0, 0.18, 0.02, 1.0, 0x14151c);
    b.box(-1.095, 0.33, -0.47, 0.02, 0.07, 0.26, TAIL, 1).box(-1.095, 0.33, 0.47, 0.02, 0.07, 0.26, TAIL, 1);
    b.box(-1.0, 0.2, 0, 0.14, 0.05, 0.1, TAIL, 0.9);
    // low ducktail spoiler over the engine (keeps the driver's back in view from the chase cam)
    b.boxR(-1.0, 0.7, 0, 0.22, 0.04, 1.2, 'z', 0.35, paint);
    b.boxR(-1.0, 0.72, 0, 0.2, 0.012, 1.2, 'z', 0.35, trim);
    b.box(-0.98, 0.64, -0.6, 0.26, 0.18, 0.03, paint).box(-0.98, 0.64, 0.6, 0.26, 0.18, 0.03, paint);
    // steering wheel
    b.box(0.3, 0.6, 0, 0.1, 0.24, 0.05, DARK);
    b.torus(0.25, 0.72, 0, 0.13, 0.025, DARK, 4, 10, 0, 'x');
  },
  rocket(b, paint, trim) {
    const pDark = shadeInt(paint, -0.28);
    b.box(0, 0.26, 0, 1.6, 0.1, 0.9, DARK);
    b.push().translate(-0.05, 0.5, 0).scale(1, 0.85, 1);
    b.cyl(0, 0, 0, 0.44, 1.5, paint, 10, 'x');
    b.cone(1.04, 0, 0, 0.44, 0.58, paint, 10, 'x');
    b.cone(1.36, 0, 0, 0.12, 0.1, trim, 10, 'x', 0.2);
    b.torus(0.44, 0, 0, 0.445, 0.04, trim, 4, 18, 0, 'x');
    b.torus(-0.5, 0, 0, 0.445, 0.04, trim, 4, 18, 0, 'x');
    b.cyl(-0.83, 0, 0, 0.36, 0.16, pDark, 10, 'x', 0, 0.44);
    b.cone(-1.0, 0, 0, 0.28, 0.24, 0x2a2d3a, 10, 'x', 0, true);
    b.torus(-1.02, 0, 0, 0.27, 0.035, CHROME, 4, 16, 0, 'x');
    b.cyl(-1.08, 0, 0, 0.17, 0.03, 0x14151c, 10, 'x');
    b.pop();
    // V-tail fins (the driver shows between them) + side fins
    for (const z of [-1, 1]) {
      b.push().translate(-0.78, 0.86, z * 0.3).rotate('x', -z * 0.5);
      b.boxR(0, 0.14, 0, 0.44, 0.36, 0.05, 'z', 0.45, trim);
      b.boxR(-0.06, 0.26, 0, 0.2, 0.06, 0.055, 'z', 0.45, 0xff3048, 0.9);
      b.pop();
    }
    b.boxR(-0.72, 0.36, -0.52, 0.5, 0.06, 0.42, 'z', 0, trim).boxR(-0.72, 0.36, 0.52, 0.5, 0.06, 0.42, 'z', 0, trim);
    // tail lights on the side fins
    b.box(-0.97, 0.37, -0.62, 0.02, 0.05, 0.2, TAIL, 1).box(-0.97, 0.37, 0.62, 0.02, 0.05, 0.2, TAIL, 1);
    // cockpit ring + seat
    b.cyl(-0.2, 0.84, 0, 0.36, 0.08, DARK, 10);
    b.box(-0.2, 0.62, 0, 0.4, 0.1, 0.5, DARK);
    b.boxR(-0.43, 0.8, 0, 0.1, 0.3, 0.5, 'z', 0.15, DARK);
    // windscreen
    b.boxR(0.2, 0.92, 0, 0.04, 0.2, 0.46, 'z', -0.6, 0x9be7ff, 0.35);
    // wheel pods
    b.box(0.66, 0.36, -0.52, 0.5, 0.12, 0.1, pDark).box(0.66, 0.36, 0.52, 0.5, 0.12, 0.1, pDark);
    b.box(-0.62, 0.36, -0.54, 0.5, 0.12, 0.1, pDark).box(-0.62, 0.36, 0.54, 0.5, 0.12, 0.1, pDark);
    b.box(1.05, 0.48, -0.26, 0.06, 0.06, 0.1, LIGHT, 1).box(1.05, 0.48, 0.26, 0.06, 0.06, 0.1, LIGHT, 1);
    b.box(0.28, 0.82, 0, 0.1, 0.2, 0.05, DARK);
    b.torus(0.24, 0.94, 0, 0.12, 0.024, DARK, 4, 10, 0, 'x');
  },
  tub(b, paint, trim) {
    const pDark = shadeInt(paint, -0.28);
    b.box(0, 0.24, 0, 1.6, 0.1, 1.1, DARK);
    b.push().scale(1.18, 1, 0.9);
    b.cyl(0, 0.48, 0, 0.8, 0.44, paint, 14, 'y', 0, 0.84);
    b.cyl(0, 0.72, 0, 0.86, 0.06, trim, 14);
    b.torus(0, 0.3, 0, 0.84, 0.12, RUBBER, 5, 20, 0, 'y');
    b.cyl(0, 0.71, 0, 0.72, 0.06, pDark, 14);
    b.pop();
    // stripes
    b.box(0.6, 0.5, 0, 0.5, 0.1, 1.2, trim);
    b.box(0.97, 0.52, -0.2, 0.02, 0.08, 0.14, LIGHT, 1).box(0.97, 0.52, 0.2, 0.02, 0.08, 0.14, LIGHT, 1);
    // seat
    b.box(-0.12, 0.6, 0, 0.44, 0.12, 0.6, DARK);
    b.boxR(-0.37, 0.76, 0, 0.12, 0.28, 0.62, 'z', 0.1, trim);
    // bumper-car pole off to one side (never blocks the driver), tilted back, glowing tip
    b.push().translate(-0.66, 0.74, -0.46).rotate('x', 0.18).rotate('z', 0.25);
    b.cyl(0, 0.5, 0, 0.03, 1.0, CHROME, 6);
    b.ball(0, 1.02, 0, 0.09, trim, 1, 0.9);
    b.pop();
    // rear: twin exhaust stubs + diffuser
    for (const z of [-0.3, 0.3]) {
      b.cyl(-0.96, 0.5, z, 0.07, 0.16, CHROME, 10, 'x', 0, 0.09);
      b.cyl(-0.97, 0.5, z, 0.05, 0.17, 0x1a1a20, 10, 'x');
    }
    for (let i = -2; i <= 2; i++) b.box(-0.9, 0.2, i * 0.18, 0.2, 0.08, 0.03, 0x14151c);
    b.box(0.34, 0.72, 0, 0.1, 0.2, 0.05, DARK);
    b.torus(0.3, 0.84, 0, 0.13, 0.025, DARK, 4, 10, 0, 'x');
    b.box(-0.99, 0.62, -0.42, 0.04, 0.06, 0.2, TAIL, 1).box(-0.99, 0.62, 0.42, 0.04, 0.06, 0.2, TAIL, 1);
  },
};

/** 5×5 racer emblems for the rear plate (our own glyphs). */
const EMBLEM: Record<KartRacerId, readonly string[]> = {
  byte: ['..##.', '.##..', '#####', '..##.', '.##..'],
  nova: ['..#..', '#####', '.###.', '.#.#.', '#...#'],
  rex: ['.#.#.', '#.#.#', '.....', '.###.', '#####'],
  mochi: ['#...#', '##.##', '#####', '#.#.#', '.###.'],
  brick: ['#####', '#.#.#', '#####', '#.#.#', '#####'],
  glitch: ['.###.', '#####', '#.#.#', '#####', '#.#.#'],
  quack: ['..#..', '.###.', '#####', '#####', '.###.'],
  coin: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
};

function emblemPlate(b: MeshBuilder, racer: KartRacerId, at: readonly [number, number, number], trim: number): void {
  const [x, y, z] = at;
  const px = 0.034;
  b.box(x + 0.01, y, z, 0.03, 0.22, 0.24, 0x14151c);
  b.box(x + 0.005, y, z, 0.03, 0.235, 0.255, trim);
  b.box(x - 0.004, y, z, 0.02, 0.2, 0.22, 0x0d0e14);
  const rows = EMBLEM[racer];
  const c = RACER_ART[racer].main;
  rows.forEach((row, r) => {
    for (let k = 0; k < row.length; k++) if (row[k] === '#') b.box(x - 0.016, y + (2 - r) * px, z + (k - 2) * px, 0.012, px * 0.92, px * 0.92, c, 0.85);
  });
}

export interface KartArt {
  body: BufferGeometry;
  head: BufferGeometry;
  lod: BufferGeometry;
  spec: KartBodySpec;
}

const cache = new Map<string, KartArt>();

export function kartArtKey(racer: KartRacerId, body: KartBodyId, paint: string): string {
  return `${racer}|${body}|${paint.toLowerCase()}`;
}

export function buildKartArt(racer: KartRacerId, body: KartBodyId, paint: string): KartArt {
  const key = kartArtKey(racer, body, paint);
  const hit = cache.get(key);
  if (hit) return hit;
  const art = RACER_ART[racer];
  const p = hexToInt(paint, art.main);
  const trim = trimFor(p, art.trim);
  const spec = KART_SPECS[body];

  const b = new MeshBuilder();
  b.ao = 0.35;
  BODY[body](b, p, trim);
  emblemPlate(b, racer, spec.plate, trim);
  b.push().translate(spec.seat[0], spec.seat[1], spec.seat[2]);
  buildRacerTorso(b, racer);
  b.pop();

  const h = new MeshBuilder();
  h.ao = 0.25;
  buildRacerHead(h, racer);

  // LOD: chunky silhouette in the right colours
  const l = new MeshBuilder();
  const top = spec.head[1];
  l.box(0, 0.42, 0, 2.0, 0.36, 1.1, p);
  l.box(0.2, 0.62, 0, 0.9, 0.06, 0.9, trim);
  l.box(spec.seat[0], spec.seat[1] + 0.3, 0, 0.36, 0.5, 0.5, art.main);
  l.box(spec.seat[0], top + 0.26, 0, 0.46, 0.44, 0.5, art.main);
  for (const w of spec.wheels) l.box(w.x, w.y, w.z, w.r * 2, w.r * 2, 0.22, RUBBER);
  l.box(-1.0, 0.45, 0, 0.05, 0.1, 0.8, TAIL, 0.9);

  const result: KartArt = { body: b.build(), head: h.build(), lod: l.build(), spec };
  cache.set(key, result);
  return result;
}

/** Head pivot sanity: the head pivot equals seat + HEAD_PIVOT for every body. */
export function headPivotFor(body: KartBodyId): [number, number, number] {
  const s = KART_SPECS[body].seat;
  return [s[0] + HEAD_PIVOT[0], s[1] + HEAD_PIVOT[1], s[2] + HEAD_PIVOT[2]];
}

/** Z scale that turns the unit wheel (0.8 wide) into a ~0.26-wide tyre. */
export const WHEEL_WIDTH_SCALE = 0.32;

let wheelGeom: BufferGeometry | null = null;
/**
 * Unit wheel (radius 1, axle along Z). Tyre is dark (instance colour barely shows on it); the hub
 * is white so the per-kart instance colour tints it. A lighter spoke makes the spin readable.
 */
export function buildWheelGeometry(): BufferGeometry {
  if (wheelGeom) return wheelGeom;
  const b = new MeshBuilder();
  // carcass
  b.cyl(0, 0, 0, 0.9, 0.8, 0x19191f, 14, 'z');
  // staggered block tread (two offset rows) so the rolling surface reads from behind
  const lugs = 14;
  for (let i = 0; i < lugs; i++) {
    for (const [zc, off] of [
      [0.2, 0],
      [-0.2, 0.5],
    ] as const) {
      const a = ((i + off) / lugs) * Math.PI * 2;
      b.boxR(Math.cos(a) * 0.93, Math.sin(a) * 0.93, zc, 0.2, 0.18, 0.34, 'z', a, 0x2a2a33);
    }
  }
  // sidewall stripe (white → tinted by the kart's instance colour) + dark inner lip
  b.torus(0, 0, 0.41, 0.72, 0.035, 0xffffff, 3, 20, 0, 'z').torus(0, 0, -0.41, 0.72, 0.035, 0xffffff, 3, 20, 0, 'z');
  // hub: white (tinted) rim, dark spokes, chrome cap
  b.cyl(0, 0, 0, 0.56, 0.86, 0xffffff, 10, 'z');
  b.box(0, 0, 0, 0.9, 0.16, 0.9, 0x4a5060);
  b.box(0, 0, 0, 0.16, 0.9, 0.9, 0x4a5060);
  b.cyl(0, 0, 0, 0.2, 0.94, 0xd6dde8, 8, 'z');
  wheelGeom = b.build();
  return wheelGeom;
}

export function clearKartArtCache(): void {
  for (const a of cache.values()) {
    a.body.dispose();
    a.head.dispose();
    a.lod.dispose();
  }
  cache.clear();
  wheelGeom?.dispose();
  wheelGeom = null;
}
