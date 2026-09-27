/**
 * Ballistics constants and the physical behaviour of every weapon. Display names and
 * ammo counts live in the shared contract (`WEAPONS` in @dascade/shared/games/tanks).
 */
import type { WeaponId } from '@dascade/shared/games/tanks';

export const PHYS = {
  /** Simulation step (s). */
  dt: 1 / 120,
  /** Samples are recorded every N steps (60 Hz). */
  sampleEvery: 2,
  gravity: 280,
  /** Muzzle speed at power 100 (units/s). */
  maxSpeed: 780,
  /** Horizontal acceleration per unit of wind (units/s²). */
  windAccel: 4,
  /** Projectiles farther than this beyond the left/right edge are lost. */
  outMargin: 60,
  /** Flight time limit (s). */
  maxFlight: 16,
  /** Collision sampling resolution along a step (units). */
  collideStep: 2,
  /** The shooter's own tank can't be hit during the first moments of flight. */
  armTicks: 30,
  /** Wreck explosion delay after a tank is destroyed (ticks). */
  wreckDelayTicks: 36,
  /** Hard cap on simulated ticks for one shot (flight + delayed blasts). */
  maxTicks: 120 * 19,
  /** Visual fall acceleration (units/s²) — for animation timing only. */
  fallGravity: 900,
  /** Drops up to this height are harmless. */
  safeFall: 18,
  fallDamagePerUnit: 0.3,
  maxFallDamage: 35,
} as const;

export interface BlastSpec {
  radius: number;
  damage: number;
  terrain: 'crater' | 'dirt' | 'none';
}

export interface WeaponSpec {
  id: WeaponId;
  /** How strongly wind pushes the projectile (1 = fully). */
  windScale: number;
  blast: BlastSpec;
  cluster?: {
    count: number;
    /** Horizontal speed added per bomblet step from the centre (units/s). */
    spread: number;
    bomblet: BlastSpec;
    /** Burst when hitting something before the apex. */
    impactBlast: BlastSpec;
    /** Upward speed of bomblets thrown out by an early impact. */
    popSpeed: number;
  };
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
}

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  shell: { id: 'shell', windScale: 1, blast: { radius: 40, damage: 45, terrain: 'crater' } },
  heavy: { id: 'heavy', windScale: 0.75, blast: { radius: 66, damage: 68, terrain: 'crater' } },
  cluster: {
    id: 'cluster',
    windScale: 1,
    blast: { radius: 22, damage: 16, terrain: 'crater' },
    cluster: {
      count: 5,
      spread: 55,
      bomblet: { radius: 27, damage: 22, terrain: 'crater' },
      impactBlast: { radius: 22, damage: 16, terrain: 'crater' },
      popSpeed: 170,
    },
  },
  airburst: {
    id: 'airburst',
    windScale: 1,
    blast: { radius: 90, damage: 40, terrain: 'none' },
    airburst: { proximity: 42, fuseHeight: 36 },
  },
  driller: {
    id: 'driller',
    windScale: 0.9,
    blast: { radius: 36, damage: 50, terrain: 'crater' },
    drill: { length: 150, radius: 9, speed: 320 },
  },
  dirt: { id: 'dirt', windScale: 1, blast: { radius: 58, damage: 0, terrain: 'dirt' } },
};

export const WRECK_BLAST: BlastSpec = { radius: 38, damage: 18, terrain: 'crater' };

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

/** Animation time (ms) of a fall of `drop` units. */
export function fallDurationMs(drop: number): number {
  return Math.round(Math.sqrt((2 * Math.abs(drop)) / PHYS.fallGravity) * 1000);
}
