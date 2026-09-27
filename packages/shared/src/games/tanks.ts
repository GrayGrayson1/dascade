/**
 * DAS Tanks — shared contract (server + client).
 *
 * Turn-based side-view artillery. The server owns everything that matters: terrain,
 * wind, tank positions, hit points, ammo, the shot simulation and the turn order.
 * Clients only send intents (aim, drive, fire) and animate the server's result:
 *  - Low-rate battle state (terrain heightmap, tanks, wind, turn) lives in the schema.
 *  - Every shot is resolved instantly by the server (`@dascade/game-core/tanks`) and
 *    broadcast as a `ShotScript` (projectile paths + a timed list of explosions,
 *    damage, falls and deaths) that clients play back. The next turn starts only once
 *    the script's duration has elapsed on the server clock.
 *
 * Nothing in this game is hidden information: every tank, loadout and the terrain are
 * public. Future wind is decided at the start of each turn by the server's crypto RNG.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import type { RateSpec } from '../rateLimit.ts';

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Battlefield size in world units (y-up heightmap, one column per unit). */
export const TANKS_WORLD = {
  width: 1600,
  height: 900,
  /** Indestructible floor: terrain never goes below this height. */
  bedrock: 24,
  /** Dirt never piles above this height. */
  ceiling: 760,
  /** Heights travel quantized to 1/HEIGHT_SCALE units (uint16 per column). */
  heightScale: 4,
} as const;

/** Tank body geometry (world units). The tank's (x, y) is the centre of its tracks on the ground. */
export const TANK_GEOM = {
  /** Half the width of the hull (the footprint that rests on terrain). */
  halfWidth: 15,
  /** Height of the turret pivot above the ground. */
  pivot: 13,
  /** Barrel length (projectiles spawn at its tip). */
  barrel: 20,
  /** Hit sphere centre above the ground and radius. */
  hitCenter: 8,
  hitRadius: 15,
} as const;

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export const WEAPON_IDS = ['shell', 'heavy', 'cluster', 'airburst', 'driller', 'dirt'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const ARSENALS = ['standard', 'plenty', 'shells'] as const;
export type ArsenalId = (typeof ARSENALS)[number];

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  /** ≤ 8 chars, for tight HUD slots. */
  short: string;
  blurb: string;
  /** Starting ammo per arsenal; -1 = unlimited. */
  ammo: Record<ArsenalId, number>;
}

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  shell: {
    id: 'shell',
    name: 'Standard Shell',
    short: 'Shell',
    blurb: 'Reliable all-rounder. Unlimited.',
    ammo: { standard: -1, plenty: -1, shells: -1 },
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy Shell',
    short: 'Heavy',
    blurb: 'Huge blast and crater. Shrugs off some wind.',
    ammo: { standard: 2, plenty: 4, shells: 0 },
  },
  cluster: {
    id: 'cluster',
    name: 'Cluster Shot',
    short: 'Cluster',
    blurb: 'Splits into five bomblets at the top of its arc.',
    ammo: { standard: 2, plenty: 4, shells: 0 },
  },
  airburst: {
    id: 'airburst',
    name: 'Airburst',
    short: 'Airburst',
    blurb: 'Proximity fuse: wide blast above tanks. No crater.',
    ammo: { standard: 2, plenty: 4, shells: 0 },
  },
  driller: {
    id: 'driller',
    name: 'Driller',
    short: 'Driller',
    blurb: 'Bores through hills, then detonates underground.',
    ammo: { standard: 2, plenty: 4, shells: 0 },
  },
  dirt: {
    id: 'dirt',
    name: 'Dirt Mound',
    short: 'Dirt',
    blurb: 'Raises a hill of earth. Build cover or bury a crater.',
    ammo: { standard: 3, plenty: 6, shells: 0 },
  },
};

export function startingAmmo(arsenal: ArsenalId): Record<WeaponId, number> {
  const out = {} as Record<WeaponId, number>;
  for (const id of WEAPON_IDS) out[id] = WEAPONS[id].ammo[arsenal];
  return out;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const TERRAIN_STYLES = ['random', 'hills', 'mesa', 'valley', 'peaks'] as const;
export type TerrainStyle = (typeof TERRAIN_STYLES)[number];
export type ConcreteTerrainStyle = Exclude<TerrainStyle, 'random'>;

export const WIND_LEVELS = ['off', 'light', 'normal', 'strong'] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];
/** Maximum |wind| per level. */
export const WIND_MAX: Record<WindLevel, number> = { off: 0, light: 5, normal: 10, strong: 15 };

export const MOVEMENT_LEVELS = ['off', 'short', 'long'] as const;
export type MovementLevel = (typeof MOVEMENT_LEVELS)[number];
/** Driving budget (world units) per turn. */
export const FUEL_PER_TURN: Record<MovementLevel, number> = { off: 0, short: 60, long: 140 };

export const BATTLE_THEMES = ['dusk', 'night', 'aurora', 'ember'] as const;
export type BattleTheme = (typeof BATTLE_THEMES)[number];

export const TEAM_COUNT = 2;
/** Tanks on one battlefield (players + CPU). */
export const MAX_TANKS = 8;

export const CPU_SKILLS = ['rookie', 'veteran', 'ace'] as const;
export type CpuSkill = (typeof CPU_SKILLS)[number];
export const CPU_SKILL_LABEL: Record<CpuSkill, string> = { rookie: 'Rookie', veteran: 'Veteran', ace: 'Ace' };
export const TEAM_NAMES = ['Blaze', 'Frost'] as const;
export const TEAM_COLORS = ['#ff8a3d', '#22d3ee'] as const;

export const TanksSettingsSchema = z.object({
  mode: z.enum(['ffa', 'teams']),
  terrain: z.enum(TERRAIN_STYLES),
  wind: z.enum(WIND_LEVELS),
  /** Seconds per turn. */
  turnSeconds: z.number().int().min(10).max(90),
  /** Starting hit points. */
  armor: z.number().int().min(50).max(300),
  arsenal: z.enum(ARSENALS),
  movement: z.enum(MOVEMENT_LEVELS),
  /** After this many full rounds the healthiest tank (or team) wins. */
  maxRounds: z.number().int().min(3).max(40),
  /** Teams mode: shells can damage teammates (you always take your own splash damage). */
  friendlyFire: z.boolean(),
  /** CPU-driven tanks added to the battle (solo rooms always get at least one). */
  cpu: z.number().int().min(0).max(MAX_TANKS - 1),
  cpuSkill: z.enum(CPU_SKILLS),
});
export type TanksSettings = z.infer<typeof TanksSettingsSchema>;

export const DEFAULT_TANKS_SETTINGS: TanksSettings = {
  mode: 'ffa',
  terrain: 'random',
  wind: 'normal',
  turnSeconds: 30,
  armor: 100,
  arsenal: 'standard',
  movement: 'short',
  maxRounds: 15,
  friendlyFire: false,
  cpu: 0,
  cpuSkill: 'veteran',
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const TANKS_TIMING = {
  /** A disconnected active player keeps the turn at most this long. */
  disconnectedTurnMs: 10_000,
  /** A connected player who let this many turns in a row time out is treated as idle… */
  idleStrikes: 2,
  /** …and gets turns this short until they aim, drive or fire again (AFK players can't stall a battle). */
  idleTurnMs: 10_000,
  /** Absent (away / gone) players are skipped after this short beat. */
  absentSkipMs: 1_200,
  /** Pause after a shot script finishes before the next turn. */
  afterShotMs: 700,
  /** Pause after a skipped turn. */
  afterSkipMs: 900,
  /** Victory celebration before the RESULTS screen. */
  victoryMs: 3_200,
  /** Upper bound of a shot script's playback. */
  maxShotMs: 20_000,
} as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const TANKS_MSG = {
  /** client → server: live aim (angle/power/weapon) of the active player, for everyone to watch. */
  aim: 'tanks:aim',
  /** client → server: drive one step left (-1) or right (1), costs fuel. */
  move: 'tanks:move',
  /** client → server: fire with the given aim. `turnId` guards against stale/duplicate shots. */
  fire: 'tanks:fire',
  /** client → server (LOBBY): pick a team (-1 = auto). */
  team: 'tanks:team',
  /** client → server (host, RESULTS): start a new battle right away. */
  rematch: 'tanks:rematch',
  /** server → all: a resolved ShotScript to animate. */
  shot: 'tanks:shot',
  /** server → all: TanksEvent (turn start, skips, eliminations, victory). */
  event: 'tanks:event',
} as const;

export const ANGLE_MIN = 0;
export const ANGLE_MAX = 180;
export const POWER_MIN = 5;
export const POWER_MAX = 100;
/** World units driven per move message. */
export const MOVE_STEP = 6;

export const TanksAimSchema = z.object({
  angle: z.number().int().min(ANGLE_MIN).max(ANGLE_MAX),
  power: z.number().int().min(POWER_MIN).max(POWER_MAX),
  weapon: z.enum(WEAPON_IDS),
});
export type TanksAim = z.infer<typeof TanksAimSchema>;

export const TanksMoveSchema = z.object({ dir: z.union([z.literal(-1), z.literal(1)]) });
export type TanksMove = z.infer<typeof TanksMoveSchema>;

export const TanksFireSchema = TanksAimSchema.extend({
  turnId: z.number().int().min(0).max(65_535),
});
export type TanksFire = z.infer<typeof TanksFireSchema>;

export const TanksTeamSchema = z.object({ team: z.number().int().min(-1).max(TEAM_COUNT - 1) });

export const TANKS_AIM_RATE: RateSpec = { burst: 20, perSecond: 14 };
export const TANKS_MOVE_RATE: RateSpec = { burst: 24, perSecond: 20 };
export const TANKS_FIRE_RATE: RateSpec = { burst: 3, perSecond: 1 };

// ---------------------------------------------------------------------------
// Shot scripts (server → client playback)
// ---------------------------------------------------------------------------

/** Projectile samples are taken every SAMPLE_MS of simulated time. */
export const SHOT_SAMPLE_MS = 1000 / 60;

export type ProjectileKind = 'shell' | 'heavy' | 'cluster' | 'bomblet' | 'airburst' | 'driller' | 'dirt';
export type ProjectileEnd = 'boom' | 'split' | 'drill' | 'out' | 'fizzle';

export interface ProjectilePath {
  id: number;
  kind: ProjectileKind;
  /** Launch time (ms from the start of the shot). */
  t0: number;
  /** End time (ms). */
  t1: number;
  /** Flattened [x0, y0, x1, y1, …] sampled every SHOT_SAMPLE_MS from t0; the last pair is the exact end point. */
  pts: number[];
  end: ProjectileEnd;
}

export type BlastKind = WeaponId | 'bomblet' | 'wreck';

export type ShotEvent =
  /** Explosion: terrain 'crater' carves, 'dirt' adds earth, 'none' leaves the ground intact. */
  | { k: 'boom'; t: number; x: number; y: number; r: number; w: BlastKind; terrain: 'crater' | 'dirt' | 'none'; direct?: string }
  /** Driller bore: carves a shaft from (x0,y0) to (x1,y1) with radius r (applied at t). */
  | { k: 'bore'; t: number; x0: number; y0: number; x1: number; y1: number; r: number }
  /** Cluster split point. */
  | { k: 'split'; t: number; x: number; y: number }
  /** Hit points lost. */
  | { k: 'dmg'; t: number; id: string; amount: number; hp: number; src: 'blast' | 'fall' }
  /** Tank settles from y0 to y1 over dur ms (falls when y1 < y0, lifted by dirt when y1 > y0). */
  | { k: 'move'; t: number; id: string; y0: number; y1: number; dur: number }
  /** Tank destroyed. */
  | { k: 'death'; t: number; id: string };

export interface ShotTankResult {
  id: string;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface ShotScript {
  /** Increments every shot of the match (matches battle.shotSeq). */
  seq: number;
  turnId: number;
  shooterId: string;
  weapon: WeaponId;
  angle: number;
  power: number;
  wind: number;
  /** Barrel tip at launch. */
  origin: [number, number];
  projectiles: ProjectilePath[];
  /** Sorted by t. */
  events: ShotEvent[];
  /** Playback length (ms) including explosions settling. */
  durationMs: number;
  /** Final tank states after the shot. */
  tanks: ShotTankResult[];
  /** Enemy damage dealt by this shot (for callouts). */
  damage: number;
  kills: string[];
}

export type TanksEvent =
  | { kind: 'turn'; turnId: number; playerId: string; round: number; wind: number }
  | { kind: 'skip'; turnId: number; playerId: string; reason: 'timeout' | 'absent' }
  | { kind: 'eliminated'; playerId: string; reason: 'destroyed' | 'left' }
  | { kind: 'victory'; winners: string[]; team: number; reason: TanksEndReason };

export type TanksEndReason = 'last_standing' | 'team_win' | 'draw' | 'round_limit' | 'forfeit';

// ---------------------------------------------------------------------------
// Public (synchronized) state shapes, as seen by clients after toJSON()
// ---------------------------------------------------------------------------

export type BattleStage = 'idle' | 'aim' | 'resolving' | 'over';

export interface TankView {
  id: string;
  /** Spawn order (left to right). */
  slot: number;
  name: string;
  color: string;
  /** -1 in free-for-all. */
  team: number;
  x: number;
  /** Ground height under the tank (y-up world units). */
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  angle: number;
  power: number;
  weapon: WeaponId;
  fuel: number;
  maxFuel: number;
  ammo: Record<WeaponId, number>;
  /** 1-based final place once the battle is decided (0 = undecided). */
  place: number;
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  /** The player left the match (their tank was scuttled). */
  gone: boolean;
  /** Driven by the server's CPU gunner. */
  cpu: boolean;
}

export interface BattleView {
  stage: BattleStage;
  /** Base64 uint16 LE heights × heightScale, one per column. */
  terrain: string;
  terrainRev: number;
  width: number;
  height: number;
  theme: BattleTheme;
  style: ConcreteTerrainStyle;
  /** Current wind (-15..15; positive blows to the right). */
  wind: number;
  turnId: number;
  activeId: string;
  /** Server epoch ms when the active turn times out (0 = none). */
  turnEndsAt: number;
  /** Server epoch ms when the current shot's playback ends. */
  resolveEndsAt: number;
  shotSeq: number;
  mode: 'ffa' | 'teams';
  maxRounds: number;
  friendlyFire: boolean;
  /** Winning team (teams mode) or -1. */
  winnerTeam: number;
  /** Winning player ids, comma separated ('' until decided). */
  winners: string;
  reason: '' | TanksEndReason;
  /** Comma-separated ids of the next few tanks to play. */
  queue: string;
}

export interface CrewView {
  /** Lobby team pick (-1 = auto-assign). */
  team: number;
}

export interface TanksPublicState extends BaseRoomView {
  tanks: Record<string, TankView>;
  battle: BattleView;
  crew: Record<string, CrewView>;
}
