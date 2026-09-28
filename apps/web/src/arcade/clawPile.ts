/**
 * The claw machine's pile — the part of the model the floor needs (pure, deterministic, DOM-free):
 * the glass case's geometry, the plush kinds, how a heap stacks and settles, and a fresh stock. The
 * floor machine draws this pile flat; the close-up's machine (clawPhysics.ts, loaded only with the
 * close-up) adds the gantry, the claw and the grip on top of it.
 *
 * Units: x runs left → right (0‥100), z front → back (0‥60), y is height above the glass floor.
 */

// ---------------------------------------------------------------------------------------------------
// World geometry

export const BOX = { w: 100, d: 60 } as const;
/** The prize chute: an open hole in the front-left corner (x0‥x1, z0‥z1), behind a low clear wall. */
export const CHUTE = { x0: 1, x1: 22, z0: 1, z1: 21, wall: 11 } as const;

export const GANTRY = {
  minX: 7,
  maxX: 94,
  minZ: 6,
  maxZ: 54,
  /** Parked over the chute. */
  homeX: 11.5,
  homeZ: 11,
  /** The claw head's height with the cable wound up. */
  topY: 62,
  /** Player-driven travel: top speed, acceleration, braking (units/s, units/s²). */
  maxSpeed: 30,
  accel: 85,
  brake: 150,
  /** The automatic carry home. */
  carrySpeed: 34,
  carryAccel: 120,
} as const;

// ---------------------------------------------------------------------------------------------------
// Toys

export type ToyKind = 'blob' | 'bunny' | 'star' | 'bot';
export const TOY_KINDS: readonly ToyKind[] = ['blob', 'bunny', 'star', 'bot'];
export const TOY_COLORS = 6;

export interface KindSpec {
  /** Horizontal radius and height. */
  r: number;
  h: number;
  mass: number;
  /** How well prongs hold it (squishy round plush 1, hard slippery bot less). */
  grip: number;
  /** How much it tilts when it hangs off-centre. */
  tilt: number;
  /** Its widest line, as a fraction of its height: prong tips need to get below it. */
  waist: number;
  name: string;
}

export const KINDS: Record<ToyKind, KindSpec> = {
  blob: { r: 6, h: 8, mass: 1, grip: 1, tilt: 1, waist: 0.45, name: 'blob' },
  bunny: { r: 4.6, h: 13, mass: 0.85, grip: 0.95, tilt: 1.5, waist: 0.32, name: 'bunny' },
  star: { r: 6.6, h: 5, mass: 0.7, grip: 0.8, tilt: 0.8, waist: 0.5, name: 'star' },
  bot: { r: 5.4, h: 9, mass: 1.25, grip: 0.8, tilt: 0.55, waist: 0.4, name: 'cube bot' },
};

export type ToyMode = 'pile' | 'held' | 'fall' | 'chute';

export interface ClawToy {
  id: number;
  kind: ToyKind;
  color: number;
  x: number;
  /** Bottom height. */
  y: number;
  z: number;
  mode: ToyMode;
  vx: number;
  vy: number;
  vz: number;
  /** Visual tilt (radians; + leans right on screen) — hanging off a prong, a shove, a tumble. */
  tilt: number;
  /** Arrived in a restock (the renderer tumbles it in). */
  fresh?: boolean;
}

/** Surface height of a toy at a floor point (−Infinity outside its footprint). */
export function toySurface(t: ClawToy, px: number, pz: number): number {
  const k = KINDS[t.kind];
  const dx = px - t.x;
  const dz = pz - t.z;
  const q = (dx * dx + dz * dz) / (k.r * k.r);
  if (q >= 1) return -Infinity;
  let f: number;
  switch (t.kind) {
    case 'blob':
      f = Math.sqrt(1 - q);
      break;
    case 'bunny':
      f = q < 0.12 ? 1 : 0.72 * Math.sqrt(1 - q);
      break;
    case 'star':
      f = 1 - 0.35 * q;
      break;
    default:
      f = q < 0.8 ? 1 : 1 - (q - 0.8) * 2.5;
  }
  return t.y + k.h * f;
}

/** The highest surface at a floor point among the resting toys (the floor is 0). */
export function surfaceAt(toys: readonly ClawToy[], px: number, pz: number, skip = -1): number {
  let best = 0;
  for (const t of toys) {
    if (t.mode !== 'pile' || t.id === skip) continue;
    const s = toySurface(t, px, pz);
    if (s > best) best = s;
  }
  return best;
}

/** The resting toy whose top is highest at a floor point (null over bare floor). */
export function topToyAt(toys: readonly ClawToy[], px: number, pz: number): ClawToy | null {
  let best: ClawToy | null = null;
  let top = 0;
  for (const t of toys) {
    if (t.mode !== 'pile') continue;
    const s = toySurface(t, px, pz);
    if (s > top) {
      top = s;
      best = t;
    }
  }
  return best;
}

export function inChute(x: number, z: number, slack = 0): boolean {
  return x < CHUTE.x1 + slack && z < CHUTE.z1 + slack && x > CHUTE.x0 - slack && z > CHUTE.z0 - slack;
}

/** Where the pile can be (stored positions are clamped into it; the chute is kept clear by settling). */
export const PILE_AREA = { x0: 4, x1: 96, z0: 4, z1: 56 } as const;

/** The highest a plush can rest in the heap (its bottom): the claw always has room above the pile. */
export const PILE_TOP = 26;

/** Eight directions round a circle (no trig in the model). */
const FAN: readonly [number, number][] = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);

/** Keeps a resting toy inside the glass and out of the chute hole (onto the floor beside it). */
function constrain(t: ClawToy): void {
  const r = KINDS[t.kind].r;
  t.x = clamp(t.x, r * 0.8, BOX.w - r * 0.8);
  t.z = clamp(t.z, r * 0.8, BOX.d - r * 0.8);
  // Beside the chute's wall: pushed out along the shallower side.
  const px = CHUTE.x1 + r * 0.7 - t.x;
  const pz = CHUTE.z1 + r * 0.7 - t.z;
  if (px > 0 && pz > 0) {
    if (px < pz) t.x += px;
    else t.z += pz;
  }
}

/**
 * Re-stacks the pile: every resting toy sits on the highest one it overlaps (or the floor), and toys
 * perched on an edge roll off outward, nudging what they rolled off. Toys left hanging in the air (the
 * one under them was taken) start falling instead of teleporting down.
 */
export function settlePile(toys: ClawToy[], iterations = 8, instant = false): void {
  const pile = toys.filter((t) => t.mode === 'pile');
  const target = new Map<number, number>();
  for (let it = 0; it < iterations; it++) {
    pile.sort((a, b) => (target.get(a.id) ?? a.y) - (target.get(b.id) ?? b.y) || a.id - b.id);
    const placed: ClawToy[] = [];
    let moved = false;
    for (const t of pile) {
      constrain(t);
      const kt = KINDS[t.kind];
      let best = 0;
      let sup: ClawToy | null = null;
      let supRatio = 0;
      for (const p of placed) {
        const kp = KINDS[p.kind];
        const lim = (kt.r + kp.r) * 0.8;
        const d = hyp(t.x - p.x, t.z - p.z);
        if (d >= lim) continue;
        const ratio = d / lim;
        const rest = (target.get(p.id) ?? p.y) + kp.h * (0.92 - 0.5 * ratio * ratio);
        if (rest > best) {
          best = rest;
          sup = p;
          supRatio = ratio;
        }
      }
      const perched = sup && supRatio > (target.get(sup.id) ?? sup.y) / 60 + 0.45 - (best > 16 ? 0.2 : 0);
      // A heap can only get so tall: anything that would rest above PILE_TOP slides off down the side.
      const tooHigh = sup && best > PILE_TOP;
      if (sup && (perched || tooHigh) && it < iterations - 1) {
        // Perched on an edge: roll outward, shove the one underneath a little the other way.
        const d = hyp(t.x - sup.x, t.z - sup.z);
        let ux = (t.x - sup.x) / Math.max(0.001, d);
        let uz = (t.z - sup.z) / Math.max(0.001, d);
        // Exactly on top (a hand-made pile): pick a direction from its id so stacks fan out.
        if (d < 0.05) [ux, uz] = FAN[t.id % FAN.length]!;
        const push = tooHigh ? 3 : (supRatio - 0.5) * 3;
        t.x += ux * push;
        t.z += uz * push;
        sup.x -= ux * push * 0.15;
        sup.z -= uz * push * 0.15;
        moved = true;
      }
      target.set(t.id, best);
      placed.push(t);
    }
    if (!moved) break;
  }
  for (const t of pile) {
    const y = target.get(t.id) ?? 0;
    if (t.y > y + 0.6 && !instant) {
      t.mode = 'fall';
      t.vx = 0;
      t.vz = 0;
      t.vy = 0;
    } else t.y = y;
  }
}

// ---------------------------------------------------------------------------------------------------
// Randomness (mulberry32 over the state's seed)

export function nextRandom(sim: { seed: number }): number {
  let a = (sim.seed = (sim.seed + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------
// Stock

/** A fresh machine's worth of toys, heaped towards the middle-back (settled). */
export function stockToys(seed: number, count: number, firstId = 1): ClawToy[] {
  const rng = { seed: seed | 0 };
  const toys: ClawToy[] = [];
  for (let i = 0; i < count; i++) toys.push(freshToy(rng, firstId + i, i, false));
  settleFully(toys);
  return toys;
}

export function freshToy(rng: { seed: number }, id: number, i: number, fresh: boolean): ClawToy {
  const kind = TOY_KINDS[(i + Math.floor(nextRandom(rng) * 2)) % TOY_KINDS.length]!;
  // A heap: two draws averaged lean towards the middle of the pile's area.
  const x = 29 + (nextRandom(rng) * 0.75 + nextRandom(rng) * 0.25) * 66;
  const z = 6 + (nextRandom(rng) * 0.75 + nextRandom(rng) * 0.25) * 48;
  return {
    id,
    kind,
    color: Math.floor(nextRandom(rng) * TOY_COLORS),
    x,
    z,
    y: fresh ? 58 + nextRandom(rng) * 10 : i * 0.5,
    mode: fresh ? 'fall' : 'pile',
    vx: 0,
    vy: 0,
    vz: 0,
    tilt: 0,
    fresh: fresh || undefined,
  };
}

/** Settles until nothing is left in the air (for a loaded or freshly stocked pile — no animation). */
export function settleFully(toys: ClawToy[]): void {
  for (const t of toys) if (t.mode === 'fall') t.mode = 'pile';
  settlePile(toys, 40, true);
}
