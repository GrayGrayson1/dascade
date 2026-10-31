/**
 * Ballistics constants and the physical behaviour of every weapon. Display names, shop
 * prices and bundles live in the shared contract (`WEAPONS` / `ITEMS` in
 * @dascade/shared/games/tanks).
 */
import type { WeaponId } from '@dascade/shared/games/tanks';

export const PHYS = {
  /** Simulation step (s). */
  dt: 1 / 120,
  /** Samples are recorded every N steps (60 Hz). */
  sampleEvery: 2,
  /** Earth gravity (the battle's gravity setting scales it). */
  gravity: 280,
  /** Muzzle speed at power 100 (units/s). */
  maxSpeed: 780,
  /** Horizontal acceleration per unit of wind (units/s²). */
  windAccel: 4,
  /** Projectiles farther than this beyond the left/right edge are lost (open walls). */
  outMargin: 60,
  /** Bounce walls keep this much horizontal speed. */
  wallBounce: 0.82,
  /** Flight time limit (s). */
  maxFlight: 16,
  /** Collision sampling resolution along a step (units). */
  collideStep: 2,
  /** The shooter's own tank can't be hit during the first moments of flight. */
  armTicks: 30,
  /** Wreck explosion delay after a tank is destroyed (ticks). */
  wreckDelayTicks: 36,
  /** Hard cap on simulated ticks for one script (flight + delayed blasts + burns). */
  maxTicks: 120 * 22,
  /** Visual fall acceleration (units/s²) — for animation timing only. */
  fallGravity: 900,
  /** Parachute descent speed (units/s) — animation timing only. */
  chuteSpeed: 90,
  /** Drops up to this height are harmless. */
  safeFall: 18,
  fallDamagePerUnit: 0.3,
  maxFallDamage: 35,
  /** Each projectile a deflector turns away costs it this much strength. */
  deflectCost: 10,
} as const;

export interface BlastSpec {
  radius: number;
  damage: number;
  terrain: 'crater' | 'dirt' | 'none';
}

export interface SplitSpec {
  /** apex: at the top of the arc (an earlier impact bursts and throws them out); impact: on landing. */
  at: 'apex' | 'impact';
  count: number;
  kind: 'bomblet' | 'warhead' | 'confetti';
  /** Horizontal speed added per sub-munition step from the centre (units/s); random spreads use ±spread. */
  spread: number;
  /** Random velocities (seeded) instead of an even fan. */
  random?: boolean;
  sub: BlastSpec;
  /** Upward speed of sub-munitions thrown out by an impact. */
  popSpeed: number;
}

export interface WeaponSpec {
  id: WeaponId;
  /** How strongly wind pushes the projectile (1 = fully, 0 = not at all). */
  windScale: number;
  /** Main blast (for splitters: the burst when it hits something before it splits). */
  blast: BlastSpec;
  split?: SplitSpec;
  airburst?: {
    /** Detonates when passing this close to an enemy tank's hit centre. */
    proximity: number;
    /** …or when this close above the ground while descending. */
    fuseHeight: number;
  };
  drill?: {
    /** Bore length through the ground (units). */
    length: number;
    /** Shaft radius. */
    radius: number;
    /** Bore speed (units/s) — timing of the underground detonation. */
    speed: number;
  };
  /** Rolls along the surface after landing; explodes when it stops, meets a tank or times out. */
  roll?: { maxMs: number };
  /** Bounces after each explosion: `hops` extra landings, keeping `keep` of its speed each time. */
  hop?: { hops: number; keep: number };
  /** Burning fuel that flows along the ground. `damage` caps what one tank can take from one splash. */
  fire?: { volume: number; burnMs: number; damage: number; hot: boolean };
  /** Liquid earth that flows into low ground and sets. */
  mud?: { volume: number };
  /** After the apex, steers toward the nearest enemy horizontally. */
  seek?: { accel: number; maxVx: number };
  /** Hitscan beam along the barrel: no gravity, no wind. */
  beam?: { range: number; pierce: number; radius: number; damage: number };
  /** Orbital strike at the landing point after a delay. */
  lance?: { delayMs: number; depth: number; radius: number; damage: number; reach: number };
  /** Teleports its shooter to the landing point. */
  warp?: boolean;
  /** Harmless ranging shot. */
  tracer?: boolean;
}

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  shell: { id: 'shell', windScale: 1, blast: { radius: 40, damage: 45, terrain: 'crater' } },
  heavy: { id: 'heavy', windScale: 0.75, blast: { radius: 66, damage: 68, terrain: 'crater' } },
  mininuke: { id: 'mininuke', windScale: 0.7, blast: { radius: 100, damage: 95, terrain: 'crater' } },
  nuke: { id: 'nuke', windScale: 0.6, blast: { radius: 160, damage: 135, terrain: 'crater' } },
  airburst: {
    id: 'airburst',
    windScale: 1,
    blast: { radius: 90, damage: 40, terrain: 'none' },
    airburst: { proximity: 42, fuseHeight: 36 },
  },
  cluster: {
    id: 'cluster',
    windScale: 1,
    blast: { radius: 22, damage: 16, terrain: 'crater' },
    split: { at: 'apex', count: 5, kind: 'bomblet', spread: 55, sub: { radius: 27, damage: 22, terrain: 'crater' }, popSpeed: 170 },
  },
  mirv: {
    id: 'mirv',
    windScale: 0.9,
    blast: { radius: 36, damage: 38, terrain: 'crater' },
    split: { at: 'apex', count: 5, kind: 'warhead', spread: 78, sub: { radius: 40, damage: 42, terrain: 'crater' }, popSpeed: 150 },
  },
  popper: {
    id: 'popper',
    windScale: 1,
    blast: { radius: 26, damage: 20, terrain: 'crater' },
    split: {
      at: 'impact',
      count: 9,
      kind: 'confetti',
      spread: 240,
      random: true,
      sub: { radius: 25, damage: 19, terrain: 'crater' },
      popSpeed: 300,
    },
  },
  roller: { id: 'roller', windScale: 1, blast: { radius: 44, damage: 50, terrain: 'crater' }, roll: { maxMs: 6000 } },
  heavyroller: { id: 'heavyroller', windScale: 0.85, blast: { radius: 64, damage: 68, terrain: 'crater' }, roll: { maxMs: 6000 } },
  leapfrog: { id: 'leapfrog', windScale: 1, blast: { radius: 34, damage: 34, terrain: 'crater' }, hop: { hops: 2, keep: 0.62 } },
  napalm: {
    id: 'napalm',
    windScale: 1,
    blast: { radius: 16, damage: 8, terrain: 'none' },
    fire: { volume: 1300, burnMs: 3200, damage: 55, hot: false },
  },
  hotnapalm: {
    id: 'hotnapalm',
    windScale: 1,
    blast: { radius: 18, damage: 10, terrain: 'none' },
    fire: { volume: 2400, burnMs: 4200, damage: 85, hot: true },
  },
  driller: {
    id: 'driller',
    windScale: 0.9,
    blast: { radius: 36, damage: 50, terrain: 'crater' },
    drill: { length: 150, radius: 9, speed: 320 },
  },
  seeker: { id: 'seeker', windScale: 0.35, blast: { radius: 44, damage: 52, terrain: 'crater' }, seek: { accel: 900, maxVx: 520 } },
  railgun: {
    id: 'railgun',
    windScale: 0,
    blast: { radius: 20, damage: 0, terrain: 'crater' },
    beam: { range: 1800, pierce: 160, radius: 5, damage: 52 },
  },
  skylance: {
    id: 'skylance',
    windScale: 1,
    blast: { radius: 0, damage: 0, terrain: 'none' },
    lance: { delayMs: 900, depth: 110, radius: 13, damage: 62, reach: 30 },
  },
  warp: { id: 'warp', windScale: 1, blast: { radius: 0, damage: 0, terrain: 'none' }, warp: true },
  tracer: { id: 'tracer', windScale: 1, blast: { radius: 0, damage: 0, terrain: 'none' }, tracer: true },
  excavator: { id: 'excavator', windScale: 1, blast: { radius: 72, damage: 0, terrain: 'crater' } },
  dirtclod: { id: 'dirtclod', windScale: 1, blast: { radius: 30, damage: 0, terrain: 'dirt' } },
  dirtball: { id: 'dirtball', windScale: 1, blast: { radius: 58, damage: 0, terrain: 'dirt' } },
  tonofdirt: { id: 'tonofdirt', windScale: 1, blast: { radius: 95, damage: 0, terrain: 'dirt' } },
  mudslide: { id: 'mudslide', windScale: 1, blast: { radius: 14, damage: 0, terrain: 'none' }, mud: { volume: 2600 } },
};

export const WRECK_BLAST: BlastSpec = { radius: 38, damage: 18, terrain: 'crater' };
export const METEOR_BLAST: BlastSpec = { radius: 36, damage: 30, terrain: 'crater' };
export const LIGHTNING = { damage: 22, reach: 22, crater: 14 } as const;

/** Blast damage to a tank whose hit centre is `dist` from the explosion (linear falloff). */
export function blastDamage(blast: BlastSpec, dist: number, hitRadius: number): number {
  if (blast.damage <= 0) return 0;
  const effective = Math.max(0, dist - hitRadius * 0.6);
  if (effective >= blast.radius) return 0;
  return Math.round(blast.damage * (1 - effective / blast.radius));
}

/** Damage from falling `drop` units. */
export function fallDamage(drop: number): number {
  if (drop <= PHYS.safeFall) return 0;
  return Math.min(PHYS.maxFallDamage, Math.floor((drop - PHYS.safeFall) * PHYS.fallDamagePerUnit));
}

/** Animation time (ms) of a fall of `drop` units (a parachute floats down slower). */
export function fallDurationMs(drop: number, chute = false): number {
  if (chute) return Math.round((Math.abs(drop) / PHYS.chuteSpeed) * 1000);
  return Math.round(Math.sqrt((2 * Math.abs(drop)) / PHYS.fallGravity) * 1000);
}

/** Whether a weapon can hurt anyone (tracers, warps and earthworks can't). */
export function isHarmless(id: WeaponId): boolean {
  const s = WEAPON_SPECS[id];
  return s.blast.damage <= 0 && !s.split && !s.fire && !s.beam && !s.lance && !s.roll && !s.hop;
}
