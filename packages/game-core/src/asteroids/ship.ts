/**
 * Asteroid Run — ship flight model (shared by the server simulation and client prediction).
 *
 * Deterministic by construction (CONTRACT §7): headings index the classics kit's hard-coded
 * 64-direction table (with a normalized blend between neighbours for smooth turning), only
 * + − × ÷ and Math.sqrt are used, and the motion state is rounded to float32 after every
 * tick so a snapshot carries it exactly.
 */
import { unpackControls, type ShipControls } from '@dascade/shared/games/asteroids';
import { DIR_COUNT, DIRS, mod } from '../classics/shared/index.ts';

export const WORLD = { width: 1600, height: 1000 } as const;

export const SHIP = {
  radius: 17,
  /** Heading change per tick (direction-table units; 64 = full turn). Multiple of 1/8. */
  turn: 0.625,
  accel: 0.19,
  maxSpeed: 8.5,
  /** Velocity kept per tick while coasting / thrusting. */
  drag: 0.991,
  thrustDrag: 0.996,
  fireCooldown: 10,
  rapidCooldown: 5,
  bulletSpeed: 13,
  bulletLife: 54,
  /** Spread shot side angle (direction-table units). */
  spreadAngle: 2.5,
  noseOffset: 20,
} as const;

export const f32 = Math.fround;

export interface ShipMotion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading in direction-table units [0, 64), always a multiple of 1/8. */
  h: number;
  /** Ticks until the gun can fire again. */
  cooldown: number;
  /** Bullets fired so far (bullet ids derive from it). */
  shots: number;
  /** Ticks of spread shot left. */
  spread: number;
  /** Ticks of rapid fire left. */
  rapid: number;
  /** Thrusting this tick (render + audio). */
  thrusting: boolean;
}

export interface BulletSpawn {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Unit vector of a (fractional) heading: normalized blend of the two nearest table entries. */
export function headingVec(h: number): [number, number] {
  const hh = mod(h, DIR_COUNT);
  const i = Math.floor(hh);
  const t = hh - i;
  const a = DIRS[i % DIR_COUNT]!;
  if (t === 0) return [a[0], a[1]];
  const b = DIRS[(i + 1) % DIR_COUNT]!;
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const l = Math.sqrt(x * x + y * y);
  return [x / l, y / l];
}

/** Wrap a coordinate into [0, size). */
export function wrap(v: number, size: number): number {
  if (v >= 0 && v < size) return v;
  const r = v % size;
  return r < 0 ? r + size : r;
}

/** Shortest signed toroidal delta from a to b. */
export function delta(a: number, b: number, size: number): number {
  let d = b - a;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

export function bulletId(slot: number, shot: number): number {
  return ((slot & 0xf) << 12) | (shot & 0xfff);
}

/**
 * Advance a ship's motion and gun by one tick. Returns the bullets fired this tick (the
 * caller adds them to the world). `canFire` is false while dead/respawning.
 */
export function stepShipMotion(s: ShipMotion, frame: number | ShipControls, slot: number, canFire = true): BulletSpawn[] {
  const c = typeof frame === 'number' ? unpackControls(frame) : frame;
  // Turning: stick aim steers the shortest way to the target direction.
  if (c.aim) {
    const diff = mod(c.aimDir - s.h + DIR_COUNT / 2, DIR_COUNT) - DIR_COUNT / 2;
    const stepH = diff > SHIP.turn ? SHIP.turn : diff < -SHIP.turn ? -SHIP.turn : diff;
    s.h = mod(s.h + stepH, DIR_COUNT);
  } else if (c.left !== c.right) {
    s.h = mod(s.h + (c.right ? SHIP.turn : -SHIP.turn), DIR_COUNT);
  }
  s.h = Math.round(s.h * 8) / 8;
  if (s.h >= DIR_COUNT) s.h -= DIR_COUNT;
  const [dx, dy] = headingVec(s.h);
  s.thrusting = c.thrust;
  if (c.thrust) {
    s.vx += dx * SHIP.accel;
    s.vy += dy * SHIP.accel;
    s.vx *= SHIP.thrustDrag;
    s.vy *= SHIP.thrustDrag;
  } else {
    s.vx *= SHIP.drag;
    s.vy *= SHIP.drag;
  }
  const sp2 = s.vx * s.vx + s.vy * s.vy;
  if (sp2 > SHIP.maxSpeed * SHIP.maxSpeed) {
    const k = SHIP.maxSpeed / Math.sqrt(sp2);
    s.vx *= k;
    s.vy *= k;
  }
  s.vx = f32(s.vx);
  s.vy = f32(s.vy);
  s.x = f32(wrap(s.x + s.vx, WORLD.width));
  s.y = f32(wrap(s.y + s.vy, WORLD.height));
  if (s.spread > 0) s.spread--;
  if (s.rapid > 0) s.rapid--;
  if (s.cooldown > 0) s.cooldown--;
  const out: BulletSpawn[] = [];
  if (c.fire && canFire && s.cooldown === 0) {
    s.cooldown = s.rapid > 0 ? SHIP.rapidCooldown : SHIP.fireCooldown;
    const angles = s.spread > 0 ? [-SHIP.spreadAngle, 0, SHIP.spreadAngle] : [0];
    for (const a of angles) {
      const [bx, by] = a === 0 ? [dx, dy] : headingVec(s.h + a);
      s.shots = (s.shots + 1) & 0xfff;
      out.push({
        id: bulletId(slot, s.shots),
        x: wrap(s.x + bx * SHIP.noseOffset, WORLD.width),
        y: wrap(s.y + by * SHIP.noseOffset, WORLD.height),
        vx: bx * SHIP.bulletSpeed + s.vx,
        vy: by * SHIP.bulletSpeed + s.vy,
      });
    }
  }
  return out;
}
