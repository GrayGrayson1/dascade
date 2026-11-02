/**
 * DAS Tanks — shared contract (server + client).
 *
 * Scorched-earth artillery for one to eight tanks. A match is a run of battles on fresh
 * battlefields; between battles every crew spends the credits it earned (damage, kills,
 * survival) in the shop, and unspent ammo carries over. The server owns everything that
 * matters: terrain, wind, tanks, shields, inventories, credits, the shot simulation and the
 * turn order. Clients only send intents (aim, drive, fire, use an item, buy, sell, ready)
 * and animate the server's results:
 *  - Low-rate state (terrain heightmap, tanks, fleet, wind, stage) lives in the schema.
 *  - Every shot — a single turn, a whole volley, or an environmental hazard — is resolved
 *    instantly by the server (`@dascade/game-core/tanks`) and broadcast as a `ShotScript`
 *    (projectile paths + a timed list of terrain changes, damage, falls, deaths and quips)
 *    that clients play back. The battle moves on once the script has played out.
 *
 * Nothing in this game is hidden information: terrain, tanks, inventories and credits are
 * public. Future wind and every random roll come from the server's crypto RNG.
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
  /** Shield bubble radius around the hit centre. */
  shieldRadius: 27,
  /** Earth this deep over the tank's centre column means it is buried. */
  buriedDepth: 8,
} as const;

// ---------------------------------------------------------------------------
// Arsenal
// ---------------------------------------------------------------------------

export const WEAPON_IDS = [
  // Blast
  'shell',
  'heavy',
  'mininuke',
  'nuke',
  'airburst',
  // Splitters
  'cluster',
  'mirv',
  'popper',
  // Rollers & bouncers
  'roller',
  'heavyroller',
  'leapfrog',
  // Fire
  'napalm',
  'hotnapalm',
  // Specials
  'driller',
  'seeker',
  'railgun',
  'skylance',
  'warp',
  'tracer',
  // Earthworks
  'excavator',
  'dirtclod',
  'dirtball',
  'tonofdirt',
  'mudslide',
] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const ITEM_IDS = ['parachute', 'shield', 'heavyshield', 'deflector', 'battery', 'fuel'] as const;
export type ItemId = (typeof ITEM_IDS)[number];
/** Items a crew switches on during its turn (parachutes deploy by themselves). */
export const USABLE_ITEMS = ['shield', 'heavyshield', 'deflector', 'battery', 'fuel'] as const;
export type UsableItemId = (typeof USABLE_ITEMS)[number];
export type ShieldKind = '' | 'shield' | 'heavyshield' | 'deflector';

export type ShopId = Exclude<WeaponId, 'shell'> | ItemId;
export const SHOP_IDS: readonly ShopId[] = [...(WEAPON_IDS.filter((w) => w !== 'shell') as Array<Exclude<WeaponId, 'shell'>>), ...ITEM_IDS];

export const WEAPON_CATEGORIES = ['blast', 'split', 'roll', 'fire', 'special', 'earth'] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<WeaponCategory | 'defense', string> = {
  blast: 'Blast',
  split: 'Splitters',
  roll: 'Rollers & bouncers',
  fire: 'Fire',
  special: 'Specials',
  earth: 'Earthworks',
  defense: 'Defense',
};

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  /** ≤ 8 chars, for tight HUD slots. */
  short: string;
  category: WeaponCategory;
  blurb: string;
  /** Shop price per bundle (credits) and units per bundle. Shell: free and unlimited. */
  price: number;
  bundle: number;
}

export interface ItemInfo {
  id: ItemId;
  name: string;
  short: string;
  blurb: string;
  price: number;
  bundle: number;
}

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  shell: {
    id: 'shell',
    name: 'Standard Shell',
    short: 'Shell',
    category: 'blast',
    blurb: 'Reliable all-rounder. Free and unlimited.',
    price: 0,
    bundle: 0,
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy Shell',
    short: 'Heavy',
    category: 'blast',
    blurb: 'Big blast and crater. Shrugs off some wind.',
    price: 1800,
    bundle: 4,
  },
  mininuke: {
    id: 'mininuke',
    name: 'Mini Nuke',
    short: 'MiniNuke',
    category: 'blast',
    blurb: 'A blinding flash and a crater you can lose a tank in.',
    price: 6500,
    bundle: 2,
  },
  nuke: { id: 'nuke', name: 'Nuke', short: 'Nuke', category: 'blast', blurb: 'Ends arguments. Stand well back.', price: 12000, bundle: 1 },
  airburst: {
    id: 'airburst',
    name: 'Airburst',
    short: 'Airburst',
    category: 'blast',
    blurb: 'Proximity fuse: a wide blast above tanks, no crater.',
    price: 2600,
    bundle: 3,
  },
  cluster: {
    id: 'cluster',
    name: 'Cluster Shot',
    short: 'Cluster',
    category: 'split',
    blurb: 'Splits into five bomblets at the top of its arc.',
    price: 2800,
    bundle: 3,
  },
  mirv: {
    id: 'mirv',
    name: 'MIRV',
    short: 'MIRV',
    category: 'split',
    blurb: 'Five full warheads fan out from the top of the arc.',
    price: 7500,
    bundle: 2,
  },
  popper: {
    id: 'popper',
    name: 'Party Popper',
    short: 'Popper',
    category: 'split',
    blurb: 'Bursts on impact into a confetti of bouncing bomblets.',
    price: 4200,
    bundle: 2,
  },
  roller: {
    id: 'roller',
    name: 'Roller',
    short: 'Roller',
    category: 'roll',
    blurb: 'Lands, rolls downhill and blows up at the bottom — or on a tank.',
    price: 2400,
    bundle: 4,
  },
  heavyroller: {
    id: 'heavyroller',
    name: 'Heavy Roller',
    short: 'HvRoller',
    category: 'roll',
    blurb: 'A bigger roller for valley campers.',
    price: 4200,
    bundle: 3,
  },
  leapfrog: {
    id: 'leapfrog',
    name: 'Leapfrog',
    short: 'Leapfrog',
    category: 'roll',
    blurb: 'Bounces twice, exploding on every landing.',
    price: 3600,
    bundle: 3,
  },
  napalm: {
    id: 'napalm',
    name: 'Napalm',
    short: 'Napalm',
    category: 'fire',
    blurb: 'Splashes burning fuel that flows downhill and pools.',
    price: 4500,
    bundle: 3,
  },
  hotnapalm: {
    id: 'hotnapalm',
    name: 'Hot Napalm',
    short: 'HotNplm',
    category: 'fire',
    blurb: 'More fuel, hotter fire, wider pools.',
    price: 7200,
    bundle: 2,
  },
  driller: {
    id: 'driller',
    name: 'Driller',
    short: 'Driller',
    category: 'special',
    blurb: 'Bores through hills, then detonates underground. Digs you out, too.',
    price: 2400,
    bundle: 3,
  },
  seeker: {
    id: 'seeker',
    name: 'Seeker Missile',
    short: 'Seeker',
    category: 'special',
    blurb: 'After the top of its arc it steers toward the nearest enemy.',
    price: 6500,
    bundle: 2,
  },
  railgun: {
    id: 'railgun',
    name: 'Railgun',
    short: 'Railgun',
    category: 'special',
    blurb: 'A straight beam — no gravity, no wind — that punches through hills.',
    price: 6000,
    bundle: 2,
  },
  skylance: {
    id: 'skylance',
    name: 'Sky Lance',
    short: 'SkyLance',
    category: 'special',
    blurb: 'Marks where it lands; a beam from orbit follows a moment later.',
    price: 8000,
    bundle: 1,
  },
  warp: {
    id: 'warp',
    name: 'Warp Shell',
    short: 'Warp',
    category: 'special',
    blurb: 'Teleports your tank to wherever it lands. No damage.',
    price: 3200,
    bundle: 2,
  },
  tracer: {
    id: 'tracer',
    name: 'Tracer',
    short: 'Tracer',
    category: 'special',
    blurb: 'Harmless — but its path stays on screen to range your next shot.',
    price: 500,
    bundle: 10,
  },
  excavator: {
    id: 'excavator',
    name: 'Excavator',
    short: 'Excavate',
    category: 'earth',
    blurb: 'Clears a big bowl of earth without hurting anyone. Digs you out.',
    price: 1600,
    bundle: 3,
  },
  dirtclod: {
    id: 'dirtclod',
    name: 'Dirt Clod',
    short: 'DirtClod',
    category: 'earth',
    blurb: 'A small mound of earth. Patch a crater, raise a wall.',
    price: 900,
    bundle: 5,
  },
  dirtball: {
    id: 'dirtball',
    name: 'Dirt Ball',
    short: 'DirtBall',
    category: 'earth',
    blurb: 'A hill of earth. Build cover or bury a rival.',
    price: 1800,
    bundle: 3,
  },
  tonofdirt: {
    id: 'tonofdirt',
    name: 'Ton of Dirt',
    short: 'TonDirt',
    category: 'earth',
    blurb: 'Buries anything it lands on. They’ll have to dig out.',
    price: 3600,
    bundle: 2,
  },
  mudslide: {
    id: 'mudslide',
    name: 'Mudslide',
    short: 'Mudslide',
    category: 'earth',
    blurb: 'Liquid earth that flows into valleys and sets — burying who’s down there.',
    price: 3200,
    bundle: 2,
  },
};

export const ITEMS: Record<ItemId, ItemInfo> = {
  parachute: {
    id: 'parachute',
    name: 'Parachute',
    short: 'Chute',
    blurb: 'Opens by itself when you fall: no fall damage.',
    price: 1800,
    bundle: 3,
  },
  shield: {
    id: 'shield',
    name: 'Shield',
    short: 'Shield',
    blurb: 'A bubble that soaks up 60 damage. Switch it on during your turn.',
    price: 3000,
    bundle: 1,
  },
  heavyshield: { id: 'heavyshield', name: 'Heavy Shield', short: 'HvShield', blurb: 'Soaks up 130 damage.', price: 5800, bundle: 1 },
  deflector: {
    id: 'deflector',
    name: 'Deflector',
    short: 'Deflect',
    blurb: 'Bounces incoming shells away, and soaks up 60 damage.',
    price: 5200,
    bundle: 1,
  },
  battery: {
    id: 'battery',
    name: 'Battery',
    short: 'Battery',
    blurb: 'Repairs 25 armor. Use it during your turn.',
    price: 2400,
    bundle: 2,
  },
  fuel: { id: 'fuel', name: 'Fuel Can', short: 'Fuel', blurb: 'Extra fuel for this turn’s drive.', price: 1200, bundle: 2 },
};

/** Shield strength per kind. */
export const SHIELD_HP: Record<Exclude<ShieldKind, ''>, number> = { shield: 60, heavyshield: 130, deflector: 60 };
/** Armor a battery repairs. */
export const BATTERY_HP = 25;
/** Extra driving fuel per fuel can. */
export const FUEL_CAN = 150;
/** Inventory cap per weapon or item. */
export const MAX_STOCK = 99;

export function shopInfo(id: ShopId): { name: string; short: string; blurb: string; price: number; bundle: number } {
  return isItemId(id) ? ITEMS[id] : WEAPONS[id];
}

export function isWeaponId(id: string): id is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(id);
}

export function isItemId(id: string): id is ItemId {
  return (ITEM_IDS as readonly string[]).includes(id);
}

export type Ammo = Record<WeaponId, number>;
export type Items = Record<ItemId, number>;

export function emptyAmmo(): Ammo {
  const out = {} as Ammo;
  for (const id of WEAPON_IDS) out[id] = id === 'shell' ? -1 : 0;
  return out;
}

export function emptyItems(): Items {
  const out = {} as Items;
  for (const id of ITEM_IDS) out[id] = 0;
  return out;
}

/** The fixed loadout every tank gets at the start of each battle in the "stocked" economy. */
export const STOCKED_LOADOUT: Partial<Record<ShopId, number>> = {
  heavy: 3,
  mininuke: 1,
  airburst: 2,
  cluster: 2,
  mirv: 1,
  popper: 1,
  roller: 2,
  leapfrog: 1,
  napalm: 1,
  driller: 2,
  seeker: 1,
  warp: 1,
  tracer: 3,
  excavator: 1,
  dirtball: 2,
  tonofdirt: 1,
  mudslide: 1,
  parachute: 2,
  shield: 1,
  battery: 1,
};

// ---------------------------------------------------------------------------
// Economy and scoring
// ---------------------------------------------------------------------------

/** Credits earned per battle. */
export const EARNINGS = {
  /** Everyone who fought. */
  base: 1500,
  /** Per point of damage dealt to enemies. */
  perDamage: 20,
  perKill: 2500,
  /** Still alive when the battle ends. */
  survive: 1500,
  /** On the winning side (or last tank standing). */
  win: 4000,
  /** Per point of damage dealt to teammates (taken off). */
  perTeamDamage: 20,
} as const;

/** Match score per battle (separate from credits): the standings players compete on. */
export const SCORING = {
  perDamage: 1,
  perKill: 50,
  /** Battle placement bonus: 1st, 2nd, 3rd (free-for-all); every member of the winning team gets the first. */
  place: [100, 50, 25] as readonly number[],
  perTeamDamage: 1,
  perTeamKill: 50,
} as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const TERRAIN_STYLES = ['random', 'hills', 'mesa', 'valley', 'peaks', 'dunes', 'canyon', 'cliffs', 'islands'] as const;
export type TerrainStyle = (typeof TERRAIN_STYLES)[number];
export type ConcreteTerrainStyle = Exclude<TerrainStyle, 'random'>;
export const TERRAIN_LABEL: Record<TerrainStyle, string> = {
  random: 'Random',
  hills: 'Hills',
  mesa: 'Mesa',
  valley: 'Valley',
  peaks: 'Peaks',
  dunes: 'Dunes',
  canyon: 'Canyon',
  cliffs: 'Cliffs',
  islands: 'Islands',
};

export const WIND_LEVELS = ['off', 'light', 'normal', 'strong'] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];
/** Maximum |wind| per level. */
export const WIND_MAX: Record<WindLevel, number> = { off: 0, light: 5, normal: 10, strong: 15 };

export const MOVEMENT_LEVELS = ['off', 'short', 'long'] as const;
export type MovementLevel = (typeof MOVEMENT_LEVELS)[number];
/** Driving budget (world units) per turn. */
export const FUEL_PER_TURN: Record<MovementLevel, number> = { off: 0, short: 60, long: 140 };

/** What happens at the left/right edges of the battlefield. */
export const WALL_MODES = ['random', 'open', 'wrap', 'bounce', 'concrete'] as const;
export type WallMode = (typeof WALL_MODES)[number];
export type ConcreteWallMode = Exclude<WallMode, 'random'>;
export const WALL_LABEL: Record<WallMode, string> = {
  random: 'Random',
  open: 'Open',
  wrap: 'Wrap-around',
  bounce: 'Bounce',
  concrete: 'Concrete',
};

export const GRAVITY_LEVELS = ['low', 'normal', 'high'] as const;
export type GravityLevel = (typeof GRAVITY_LEVELS)[number];
export const GRAVITY_SCALE: Record<GravityLevel, number> = { low: 0.6, normal: 1, high: 1.45 };
export const GRAVITY_LABEL: Record<GravityLevel, string> = { low: 'Moon', normal: 'Earth', high: 'Heavy' };

export const ECONOMIES = ['shop', 'stocked', 'shells'] as const;
export type Economy = (typeof ECONOMIES)[number];

export const TURN_MODES = ['turns', 'volley'] as const;
export type TurnMode = (typeof TURN_MODES)[number];

export const TALK_LEVELS = ['off', 'some', 'lots'] as const;
export type TalkLevel = (typeof TALK_LEVELS)[number];

export const BATTLE_THEMES = ['dusk', 'night', 'aurora', 'ember', 'harvest'] as const;
export type BattleTheme = (typeof BATTLE_THEMES)[number];

export const TEAM_COUNT = 2;
/** Tanks on one battlefield (players + CPU). */
export const MAX_TANKS = 8;

export const CPU_SKILLS = ['rookie', 'veteran', 'ace'] as const;
export type CpuSkill = (typeof CPU_SKILLS)[number];
export const CPU_SKILL_LABEL: Record<CpuSkill, string> = { rookie: 'Rookie', veteran: 'Veteran', ace: 'Ace' };

/** CPU personalities: how each computer gunner picks targets, aims, and shops. */
export const PERSONAS = ['gunner', 'lobber', 'sniper', 'bully', 'vulture', 'hoarder', 'maniac', 'cyborg'] as const;
export type Persona = (typeof PERSONAS)[number];
export const PERSONA_INFO: Record<Persona, { label: string; name: string; blurb: string }> = {
  gunner: { label: 'Gunner', name: 'Sgt. Boomer', blurb: 'Steady and sensible.' },
  lobber: { label: 'Lobber', name: 'Mortar Mo', blurb: 'Loves a sky-high arc.' },
  sniper: { label: 'Sniper', name: 'Deadeye', blurb: 'Precise. Picks off the weak.' },
  bully: { label: 'Bully', name: 'Big Rusty', blurb: 'Always goes after the leader.' },
  vulture: { label: 'Vulture', name: 'Buzzard', blurb: 'Finishes off the wounded.' },
  hoarder: { label: 'Hoarder', name: 'Penny', blurb: 'Saves up, hides behind shields.' },
  maniac: { label: 'Maniac', name: 'Kaboom Kate', blurb: 'Buys the biggest bombs. Careless.' },
  cyborg: { label: 'Cyborg', name: 'Unit-7', blurb: 'Calculates every option.' },
};

export const TEAM_NAMES = ['Blaze', 'Frost'] as const;
export const TEAM_COLORS = ['#ff8a3d', '#22d3ee'] as const;

export const BATTLE_COUNTS = [1, 3, 5, 7, 10] as const;
export const START_CREDITS = [0, 10_000, 20_000, 50_000, 100_000] as const;

export const TanksSettingsSchema = z.object({
  mode: z.enum(['ffa', 'teams']),
  /** Turns: one tank fires at a time. Volley: everyone aims at once and all shots fly together. */
  turnMode: z.enum(TURN_MODES),
  /** Battles in the match (fresh battlefield each). */
  battles: z.number().int().min(1).max(10),
  economy: z.enum(ECONOMIES),
  /** Credits every crew starts the match with (shop economy). */
  startCredits: z.number().int().min(0).max(100_000),
  terrain: z.enum(TERRAIN_STYLES),
  walls: z.enum(WALL_MODES),
  gravity: z.enum(GRAVITY_LEVELS),
  wind: z.enum(WIND_LEVELS),
  /** Seconds per turn (and per volley aim window). */
  turnSeconds: z.number().int().min(10).max(90),
  /** Starting hit points each battle. */
  armor: z.number().int().min(50).max(300),
  movement: z.enum(MOVEMENT_LEVELS),
  /** A battle that lasts this many rounds is decided by armor left. */
  maxRounds: z.number().int().min(3).max(40),
  /** Teams mode: shells can damage teammates (you always take your own splash damage). */
  friendlyFire: z.boolean(),
  /** CPU-driven tanks added to the battle (solo rooms always get at least one). */
  cpu: z
    .number()
    .int()
    .min(0)
    .max(MAX_TANKS - 1),
  cpuSkill: z.enum(CPU_SKILLS),
  /** Speech bubbles when tanks fire and die. */
  talk: z.enum(TALK_LEVELS),
  /** Meteors and lightning now and then. */
  hazards: z.boolean(),
});
export type TanksSettings = z.infer<typeof TanksSettingsSchema>;

export const DEFAULT_TANKS_SETTINGS: TanksSettings = {
  mode: 'ffa',
  turnMode: 'turns',
  battles: 3,
  economy: 'shop',
  startCredits: 20_000,
  terrain: 'random',
  walls: 'open',
  gravity: 'normal',
  wind: 'normal',
  turnSeconds: 30,
  armor: 100,
  movement: 'short',
  maxRounds: 12,
  friendlyFire: false,
  cpu: 0,
  cpuSkill: 'veteran',
  talk: 'some',
  hazards: false,
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
  /** The shop between battles (ends early once every crew is ready). */
  shopMs: 50_000,
  /** "Battle 2 of 5" splash before the first turn. */
  introMs: 2_800,
  /** Battle won: the victory splash and earnings before the shop. */
  battleOverMs: 4_500,
  /** Match won: the celebration before the RESULTS screen. */
  victoryMs: 3_800,
  /** Warning before a hazard strikes. */
  hazardWarnMs: 1_400,
  /** Upper bound of a shot script's playback. */
  maxShotMs: 24_000,
} as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const TANKS_MSG = {
  /** client → server: live aim (angle/power/weapon) of an acting tank, for everyone to watch. */
  aim: 'tanks:aim',
  /** client → server: drive one step left (-1) or right (1), costs fuel. */
  move: 'tanks:move',
  /** client → server: fire with the given aim (volley: lock it in). `turnId` guards against stale/duplicate shots. */
  fire: 'tanks:fire',
  /** client → server: switch on an item (shield, battery, fuel) during your turn. */
  item: 'tanks:item',
  /** client → server (shop): buy one bundle. */
  buy: 'tanks:buy',
  /** client → server (shop): sell back one bundle bought during this shop visit (full refund). */
  sell: 'tanks:sell',
  /** client → server (shop): done shopping (or not). */
  ready: 'tanks:ready',
  /** client → server (LOBBY): pick a team (-1 = auto). */
  team: 'tanks:team',
  /** client → server (host, RESULTS): start a new match right away. */
  rematch: 'tanks:rematch',
  /** server → all: a resolved ShotScript to animate. */
  shot: 'tanks:shot',
  /** server → all: TanksEvent (turns, volleys, items, battles, victory). */
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

export const TanksItemSchema = z.object({ item: z.enum(USABLE_ITEMS), turnId: z.number().int().min(0).max(65_535) });
export type TanksItem = z.infer<typeof TanksItemSchema>;

export const TanksBuySchema = z.object({ id: z.enum(SHOP_IDS as [ShopId, ...ShopId[]]) });
export type TanksBuy = z.infer<typeof TanksBuySchema>;
export const TanksReadySchema = z.object({ ready: z.boolean() });

export const TanksTeamSchema = z.object({
  team: z
    .number()
    .int()
    .min(-1)
    .max(TEAM_COUNT - 1),
});

export const TANKS_AIM_RATE: RateSpec = { burst: 20, perSecond: 14 };
export const TANKS_MOVE_RATE: RateSpec = { burst: 24, perSecond: 20 };
export const TANKS_FIRE_RATE: RateSpec = { burst: 3, perSecond: 1 };
export const TANKS_ITEM_RATE: RateSpec = { burst: 4, perSecond: 2 };
export const TANKS_SHOP_RATE: RateSpec = { burst: 12, perSecond: 8 };

// ---------------------------------------------------------------------------
// Shot scripts (server → client playback)
// ---------------------------------------------------------------------------

/** Projectile samples are taken every SAMPLE_MS of simulated time. */
export const SHOT_SAMPLE_MS = 1000 / 60;

export type ProjectileKind = WeaponId | 'bomblet' | 'warhead' | 'confetti' | 'rolling' | 'hop' | 'meteor';
/**
 * How a path ended: boom (exploded), split (broke into sub-munitions), drill (started boring),
 * roll (started rolling — a 'rolling' path follows), hop (bounced — a 'hop' path follows),
 * wrap (crossed a wrap-around wall — the projectile continues in a new path from the other edge),
 * warp (teleported its shooter), out (left the field), fizzle (timed out or a harmless landing).
 */
export type ProjectileEnd = 'boom' | 'split' | 'drill' | 'roll' | 'hop' | 'wrap' | 'warp' | 'out' | 'fizzle';

export interface ProjectilePath {
  id: number;
  kind: ProjectileKind;
  /** Shooter id ('' for a hazard). */
  owner: string;
  /** Launch time (ms from the start of the script). */
  t0: number;
  /** End time (ms). */
  t1: number;
  /** Flattened [x0, y0, x1, y1, …] sampled every SHOT_SAMPLE_MS from t0; the last pair is the exact end point. */
  pts: number[];
  end: ProjectileEnd;
}

export type BlastKind = WeaponId | 'bomblet' | 'warhead' | 'confetti' | 'wreck' | 'meteor' | 'lightning';
export type DamageSource = 'blast' | 'fall' | 'burn' | 'beam';
export type BeamKind = 'railgun' | 'skylance' | 'lightning';

export type ShotEvent =
  /** Explosion: terrain 'crater' carves, 'dirt' adds earth, 'none' leaves the ground intact. */
  | {
      k: 'boom';
      t: number;
      x: number;
      y: number;
      r: number;
      w: BlastKind;
      terrain: 'crater' | 'dirt' | 'none';
      direct?: string;
      owner: string;
    }
  /** A shaft carved from (x0,y0) to (x1,y1) with radius r (driller bore, railgun or lance channel), applied at t. */
  | { k: 'bore'; t: number; x0: number; y0: number; x1: number; y1: number; r: number }
  /** Terrain heights set directly for columns x0… (mudslide). Heights are already quantized. */
  | { k: 'patch'; t: number; x0: number; h: number[] }
  /** A splitter broke apart here. */
  | { k: 'split'; t: number; x: number; y: number; w: WeaponId }
  /** Burning fuel: intensity 1..9 per column from x0 (0 = not burning), burning for dur ms. */
  | { k: 'fire'; t: number; x0: number; cells: number[]; dur: number; hot: boolean }
  /** A straight beam (railgun shot, orbital lance, lightning bolt). */
  | { k: 'beam'; t: number; x0: number; y0: number; x1: number; y1: number; w: BeamKind }
  /** A Sky Lance target marker (the beam follows at the beam event). */
  | { k: 'mark'; t: number; x: number; y: number }
  /** Hit points lost. `shield` is what the shield soaked up first (included in neither amount nor hp). */
  | { k: 'dmg'; t: number; id: string; amount: number; hp: number; src: DamageSource; by: string; shield?: number }
  /** A shield took a hit (`hp` = shield left; 0 = it broke). */
  | { k: 'shield'; t: number; id: string; hp: number; absorbed: number }
  /** A deflector bounced a projectile away at (x, y). */
  | { k: 'deflect'; t: number; id: string; x: number; y: number }
  /** Tank settles from y0 to y1 over dur ms (falls when y1 < y0, lifted when y1 > y0); `chute` = a parachute opened. */
  | { k: 'move'; t: number; id: string; y0: number; y1: number; dur: number; chute?: boolean }
  /** A Warp Shell moved its shooter. */
  | { k: 'warp'; t: number; id: string; x0: number; y0: number; x1: number; y1: number }
  /** Tank destroyed (`by` = the tank whose shot did it; '' for hazards). */
  | { k: 'death'; t: number; id: string; by: string }
  /** A speech bubble. */
  | { k: 'quip'; t: number; id: string; line: string };

export interface ShotLaunch {
  shooterId: string;
  weapon: WeaponId;
  angle: number;
  power: number;
  /** Barrel tip at launch. */
  origin: [number, number];
  /** Launch time (ms from the start of the script). */
  t0: number;
}

export interface ShotTankResult {
  id: string;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  shield: number;
  shieldKind: ShieldKind;
}

export interface ShotScript {
  /** Increments every script of the battle (matches battle.shotSeq). */
  seq: number;
  turnId: number;
  kind: 'shot' | 'volley' | 'hazard';
  launches: ShotLaunch[];
  wind: number;
  projectiles: ProjectilePath[];
  /** Sorted by t. */
  events: ShotEvent[];
  /** Playback length (ms) including explosions settling. */
  durationMs: number;
  /** Final tank states after the script. */
  tanks: ShotTankResult[];
  /** Enemy damage dealt per shooter. */
  damage: Record<string, number>;
  kills: Array<{ by: string; id: string }>;
}

export type TanksEvent =
  | { kind: 'turn'; turnId: number; playerId: string; round: number; wind: number }
  | { kind: 'volley'; turnId: number; round: number; wind: number; ids: string[] }
  | { kind: 'locked'; turnId: number; playerId: string }
  | { kind: 'skip'; turnId: number; playerId: string; reason: 'timeout' | 'absent' }
  | { kind: 'item'; playerId: string; item: UsableItemId }
  | { kind: 'eliminated'; playerId: string; reason: 'destroyed' | 'left' }
  | { kind: 'hazard'; what: 'meteor' | 'lightning' }
  | { kind: 'shop'; battleNo: number; battles: number }
  | { kind: 'battle'; battleNo: number; battles: number; style: ConcreteTerrainStyle; walls: ConcreteWallMode }
  | { kind: 'battle_over'; battleNo: number; winners: string[]; team: number; reason: TanksEndReason }
  | { kind: 'victory'; winners: string[]; team: number; reason: TanksEndReason };

export type TanksEndReason = 'last_standing' | 'team_win' | 'draw' | 'round_limit' | 'forfeit' | 'points';

// ---------------------------------------------------------------------------
// Public (synchronized) state shapes, as seen by clients after toJSON()
// ---------------------------------------------------------------------------

/**
 * shop → intro → (aim → resolving → idle)* → battle_over → shop … → over.
 * `aim` is one tank's turn (turns mode) or everyone's aim window (volley mode).
 */
export type BattleStage = 'idle' | 'shop' | 'intro' | 'aim' | 'resolving' | 'battle_over' | 'over';

export interface TankView {
  id: string;
  /** Spawn order (left to right). */
  slot: number;
  name: string;
  color: string;
  /** -1 in free-for-all. */
  team: number;
  x: number;
  /** Ground height under the tank (y-up world units). Buried tanks sit below the surface. */
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  angle: number;
  power: number;
  weapon: WeaponId;
  fuel: number;
  maxFuel: number;
  /** Shield strength left (0 = none) and its kind. */
  shield: number;
  shieldMax: number;
  shieldKind: ShieldKind;
  /** Earth over the tank's centre (0 = not buried). */
  buried: number;
  /** Volley mode: shot locked in for this volley. */
  locked: boolean;
  /** 1-based place in this battle once it is decided (0 = undecided). */
  place: number;
  /** This battle. */
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  /** The player left the match (their tank was scuttled). */
  gone: boolean;
  /** Driven by the server's CPU gunner. */
  cpu: boolean;
}

/** A match participant (player or CPU): credits, inventory and the running score. */
export interface FleetView {
  id: string;
  name: string;
  color: string;
  team: number;
  cpu: boolean;
  /** CPU personality ('' for players). */
  persona: '' | Persona;
  credits: number;
  score: number;
  wins: number;
  kills: number;
  damage: number;
  ammo: Ammo;
  items: Items;
  /** Shop: done shopping. */
  ready: boolean;
  /** Bundles bought during this shop visit ("id:n,id:n") — those can be sold back for a full refund. */
  basket: string;
  /** Last battle: credits earned (total and breakdown) and score gained. */
  earned: number;
  earnBase: number;
  earnDamage: number;
  earnKills: number;
  earnSurvive: number;
  earnWin: number;
  earnPenalty: number;
  battleScore: number;
  /** Final match place (0 = undecided). */
  place: number;
  /** Left the match. */
  gone: boolean;
}

export interface BattleView {
  stage: BattleStage;
  /** Increments with every battlefield built (each battle of a match, every new match): clients reset their view when it changes. */
  battleSerial: number;
  /** Base64 uint16 LE heights × heightScale, one per column. */
  terrain: string;
  terrainRev: number;
  width: number;
  height: number;
  theme: BattleTheme;
  style: ConcreteTerrainStyle;
  walls: ConcreteWallMode;
  gravity: GravityLevel;
  economy: Economy;
  /** Current wind (-15..15; positive blows to the right). */
  wind: number;
  turnId: number;
  /** Turns mode: the tank taking its turn ('' in volley mode). */
  activeId: string;
  /** Server epoch ms when the turn / volley aim window times out (0 = none). */
  turnEndsAt: number;
  /** Server epoch ms when the shop, intro or battle-over splash ends (0 = none). */
  stageEndsAt: number;
  /** Server epoch ms when the current shot's playback ends. */
  resolveEndsAt: number;
  /** Scripts played this battle (0 at the start of every battle). */
  shotSeq: number;
  mode: 'ffa' | 'teams';
  turnMode: TurnMode;
  maxRounds: number;
  friendlyFire: boolean;
  /** 1-based battle number and the match length. */
  battleNo: number;
  battles: number;
  /** Winning team (teams mode) or -1 — of the battle while battle_over, of the match when over. */
  winnerTeam: number;
  /** Winning ids, comma separated ('' until decided). */
  winners: string;
  reason: '' | TanksEndReason;
  /** Comma-separated ids of the next few tanks to play (turns mode). */
  queue: string;
}

export interface CrewView {
  /** Lobby team pick (-1 = auto-assign). */
  team: number;
}

export interface TanksPublicState extends BaseRoomView {
  tanks: Record<string, TankView>;
  fleet: Record<string, FleetView>;
  battle: BattleView;
  crew: Record<string, CrewView>;
}
