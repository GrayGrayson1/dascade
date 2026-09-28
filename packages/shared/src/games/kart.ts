/**
 * DASphalt GP — shared contract (server + client).
 *
 * A 3D kart racer (drift boosts, items, eight tracks in two cups) that shares the racing cabinet
 * with DASh Circuit but is its own game. Networking follows DASh Circuit's proven model:
 *  - Low-rate race meta (grid, laps, standings, Grand Prix points) lives in the Colyseus schema.
 *  - High-rate kart motion, projectiles, held items and item-box respawns travel as a
 *    compact binary snapshot (`kart:snap`, encoded by `@dascade/game-core/kart`).
 *  - Clients only ever send sequenced inputs (`kart:input`). The server owns positions,
 *    checkpoints, laps, item rolls, item hits, finish order and race time.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import type { RateSpec } from '../rateLimit.ts';

// ---------------------------------------------------------------------------
// Content ids + metadata (names/blurbs for the UI; physics lives in game-core)
// ---------------------------------------------------------------------------

export const KART_TRACK_IDS = [
  'pixel-plaza',
  'dune-drift',
  'harbor-hairpins',
  'frostbyte-pass',
  'pinball-park',
  'gearworks',
  'skyway-sprint',
  'midnight-mainframe',
] as const;
export type KartTrackId = (typeof KART_TRACK_IDS)[number];

export const KART_CUP_IDS = ['joystick', 'jackpot'] as const;
export type KartCupId = (typeof KART_CUP_IDS)[number];

export interface KartCupInfo {
  id: KartCupId;
  name: string;
  tracks: readonly KartTrackId[];
}

export const KART_CUPS: Record<KartCupId, KartCupInfo> = {
  joystick: { id: 'joystick', name: 'Joystick Cup', tracks: ['pixel-plaza', 'dune-drift', 'harbor-hairpins', 'frostbyte-pass'] },
  jackpot: { id: 'jackpot', name: 'Jackpot Cup', tracks: ['pinball-park', 'gearworks', 'skyway-sprint', 'midnight-mainframe'] },
};

export interface KartTrackInfo {
  id: KartTrackId;
  name: string;
  cup: KartCupId;
  /** One line for the track picker. */
  tagline: string;
  /** What makes it different (shown as chips in the picker). */
  features: readonly string[];
}

export const KART_TRACKS: Record<KartTrackId, KartTrackInfo> = {
  'pixel-plaza': {
    id: 'pixel-plaza',
    name: 'Pixel Plaza',
    cup: 'joystick',
    tagline: 'A wide neon boulevard around the giant cabinet. Learn to drift here.',
    features: ['Starter', 'Wide', 'Boost pads'],
  },
  'dune-drift': {
    id: 'dune-drift',
    name: 'Dune Drift',
    cup: 'joystick',
    tagline: 'Sweeping desert bends, a canyon jump and a sandy shortcut for the brave.',
    features: ['Jumps', 'Off-road', 'Shortcut'],
  },
  'harbor-hairpins': {
    id: 'harbor-hairpins',
    name: 'Harbor Hairpins',
    cup: 'joystick',
    tagline: 'Tight dockside hairpins under swinging cargo cranes.',
    features: ['Technical', 'Hazards', 'Narrow'],
  },
  'frostbyte-pass': {
    id: 'frostbyte-pass',
    name: 'Frostbyte Pass',
    cup: 'joystick',
    tagline: 'Climb the mountain, then slide down it. Mind the ice and the snowballs.',
    features: ['Elevation', 'Ice', 'Rolling hazards'],
  },
  'pinball-park': {
    id: 'pinball-park',
    name: 'Pinball Park',
    cup: 'jackpot',
    tagline: 'A carnival circuit full of bumpers. Wide, loud and chaotic.',
    features: ['Bumpers', 'Wide', 'Chaos'],
  },
  gearworks: {
    id: 'gearworks',
    name: 'Gearworks',
    cup: 'jackpot',
    tagline: 'Conveyor belts, stompers and sparks on the factory floor.',
    features: ['Conveyors', 'Stompers', 'Narrow'],
  },
  'skyway-sprint': {
    id: 'skyway-sprint',
    name: 'Skyway Sprint',
    cup: 'jackpot',
    tagline: 'Flat-out on a highway above the clouds. No walls. Don’t look down.',
    features: ['High speed', 'Drops', 'Big jumps'],
  },
  'midnight-mainframe': {
    id: 'midnight-mainframe',
    name: 'Midnight Mainframe',
    cup: 'jackpot',
    tagline: 'Narrow data lanes, laser gates and a secret bypass through the core.',
    features: ['Precision', 'Laser gates', 'Shortcut'],
  },
};

/** The eight racers. Every racer's stats sum to the same total; no racer is strictly better. */
export const KART_RACER_IDS = ['byte', 'nova', 'rex', 'mochi', 'brick', 'glitch', 'quack', 'coin'] as const;
export type KartRacerId = (typeof KART_RACER_IDS)[number];

export interface KartRacerStats {
  /** 1..5 each. Total is always 15. */
  speed: number;
  accel: number;
  handling: number;
  /** Traction: lateral grip, off-road and ice resistance. */
  grip: number;
  /** Bumps lighter karts around; heavier karts accelerate a little slower. */
  weight: number;
}

export interface KartRacerInfo {
  id: KartRacerId;
  name: string;
  /** Who they are (one line). */
  blurb: string;
  /** Archetype label for the picker ("All-rounder", "Heavy"…). */
  archetype: string;
  stats: KartRacerStats;
  /** The racer's signature colours (the kart's default paint + character trim). */
  colors: { main: string; trim: string };
}

export const KART_RACERS: Record<KartRacerId, KartRacerInfo> = {
  byte: {
    id: 'byte',
    name: 'Byte',
    blurb: 'A pocket-sized service robot who escaped the change machine.',
    archetype: 'Nimble',
    stats: { speed: 2, accel: 4, handling: 4, grip: 3, weight: 2 },
    colors: { main: '#22d3ee', trim: '#e2e8f0' },
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    blurb: 'Test pilot of the DASCADE space program. Good at everything.',
    archetype: 'All-rounder',
    stats: { speed: 3, accel: 3, handling: 3, grip: 3, weight: 3 },
    colors: { main: '#f97316', trim: '#f8fafc' },
  },
  rex: {
    id: 'rex',
    name: 'Rex Rally',
    blurb: 'Tiny arms, huge right foot.',
    archetype: 'Speedster',
    stats: { speed: 4, accel: 2, handling: 3, grip: 2, weight: 4 },
    colors: { main: '#2de38f', trim: '#fde047' },
  },
  mochi: {
    id: 'mochi',
    name: 'Mochi',
    blurb: 'The arcade cat. Corners like it has nine lives to spare.',
    archetype: 'Drifter',
    stats: { speed: 2, accel: 4, handling: 5, grip: 2, weight: 2 },
    colors: { main: '#ff4fd8', trim: '#fff1f2' },
  },
  brick: {
    id: 'brick',
    name: 'Brick',
    blurb: 'A golem of stacked arcade tiles. Slow to start, impossible to stop.',
    archetype: 'Heavy',
    stats: { speed: 5, accel: 1, handling: 2, grip: 2, weight: 5 },
    colors: { main: '#a78bfa', trim: '#fbbf24' },
  },
  glitch: {
    id: 'glitch',
    name: 'Glitch',
    blurb: 'A pixel ghost from a cabinet nobody unplugged. Slippery.',
    archetype: 'Slider',
    stats: { speed: 4, accel: 3, handling: 4, grip: 1, weight: 3 },
    colors: { main: '#a3e635', trim: '#1e1b4b' },
  },
  quack: {
    id: 'quack',
    name: 'Quack',
    blurb: 'A rubber-duck rally driver. Mud, sand, snow — all the same to Quack.',
    archetype: 'Off-roader',
    stats: { speed: 3, accel: 3, handling: 2, grip: 5, weight: 2 },
    colors: { main: '#ffd23f', trim: '#fb923c' },
  },
  coin: {
    id: 'coin',
    name: 'Captain Coin',
    blurb: 'The last token in the machine, and proud of it.',
    archetype: 'Cruiser',
    stats: { speed: 4, accel: 2, handling: 2, grip: 3, weight: 4 },
    colors: { main: '#fbbf24', trim: '#7c2d12' },
  },
};

/** Cosmetic kart bodies (no stat effect). */
export const KART_BODY_IDS = ['buggy', 'rocket', 'tub'] as const;
export type KartBodyId = (typeof KART_BODY_IDS)[number];
export const KART_BODIES: Record<KartBodyId, { id: KartBodyId; name: string }> = {
  buggy: { id: 'buggy', name: 'Buggy' },
  rocket: { id: 'rocket', name: 'Rocket' },
  tub: { id: 'tub', name: 'Tub' },
};

/** Quick-pick paints (any #rrggbb is accepted). */
export const KART_PAINTS = [
  '#22d3ee',
  '#f97316',
  '#ff4fd8',
  '#ffd23f',
  '#2de38f',
  '#a78bfa',
  '#ff5a5f',
  '#60a5fa',
  '#a3e635',
  '#f8fafc',
  '#1f2937',
  '#fbbf24',
] as const;

/**
 * Items. Ids are also their wire codes' order (index + 1; 0 = no item), so append only.
 * Categories drive the position-weighted distribution (game-core/kart/items).
 */
export const KART_ITEM_IDS = ['turbo', 'turbo3', 'puck', 'puck3', 'seeker', 'mine', 'fizz', 'shield', 'magnet', 'warp', 'pulse'] as const;
export type KartItemId = (typeof KART_ITEM_IDS)[number];

export type KartItemCategory = 'boost' | 'offense' | 'trap' | 'defense' | 'comeback' | 'rare';

export interface KartItemInfo {
  id: KartItemId;
  name: string;
  category: KartItemCategory;
  /** One line shown in the item slot tooltip and the how-to-play sheet. */
  blurb: string;
  /** Uses in one pickup. */
  uses: number;
}

export const KART_ITEMS: Record<KartItemId, KartItemInfo> = {
  turbo: { id: 'turbo', name: 'Turbo Cell', category: 'boost', blurb: 'A burst of speed. Punches through off-road.', uses: 1 },
  turbo3: { id: 'turbo3', name: 'Turbo Trio', category: 'boost', blurb: 'Three Turbo Cells. Chain them.', uses: 3 },
  puck: { id: 'puck', name: 'Bounce Puck', category: 'offense', blurb: 'Fires straight and ricochets off walls. Aim back to fire behind.', uses: 1 },
  puck3: { id: 'puck3', name: 'Puck Trio', category: 'offense', blurb: 'Three Bounce Pucks.', uses: 3 },
  seeker: { id: 'seeker', name: 'Seeker Drone', category: 'offense', blurb: 'Follows the track and hunts the racer just ahead of you.', uses: 1 },
  mine: { id: 'mine', name: 'Glitch Mine', category: 'trap', blurb: 'Drops behind you — or lob it ahead. Spins out whoever touches it.', uses: 1 },
  fizz: { id: 'fizz', name: 'Fizz Puddle', category: 'trap', blurb: 'A slick of soda. Drive through it and you lose your grip.', uses: 1 },
  shield: { id: 'shield', name: 'Bubble Shield', category: 'defense', blurb: 'Blocks one hit for a while.', uses: 1 },
  magnet: { id: 'magnet', name: 'Slip Magnet', category: 'comeback', blurb: 'Locks onto the kart ahead and slingshots you toward it.', uses: 1 },
  warp: { id: 'warp', name: 'Warp Rail', category: 'rare', blurb: 'Rides the racing line at full tilt. Untouchable while it lasts.', uses: 1 },
  pulse: { id: 'pulse', name: 'Pulse Wave', category: 'rare', blurb: 'A shockwave that rattles every racer close ahead of you.', uses: 1 },
};

// ---------------------------------------------------------------------------
// Player look (lobby choice)
// ---------------------------------------------------------------------------

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour');

export const KartLookSchema = z.object({
  racer: z.enum(KART_RACER_IDS),
  body: z.enum(KART_BODY_IDS),
  paint: HexColor,
});
export type KartLook = z.infer<typeof KartLookSchema>;

export function defaultKartLook(seed = 0): KartLook {
  const racer = KART_RACER_IDS[Math.abs(seed) % KART_RACER_IDS.length] ?? 'nova';
  return { racer, body: KART_BODY_IDS[Math.abs(seed) % KART_BODY_IDS.length] ?? 'buggy', paint: KART_RACERS[racer].colors.main };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const KART_MODES = ['race', 'gp', 'timetrial'] as const;
export type KartMode = (typeof KART_MODES)[number];

export const KART_BOT_SKILLS = ['easy', 'normal', 'hard'] as const;
export type KartBotSkill = (typeof KART_BOT_SKILLS)[number];

export const KartSettingsSchema = z.object({
  /** race = one track; gp = a four-track cup with points; timetrial = solo against the clock (no items, a Turbo Trio). */
  mode: z.enum(KART_MODES),
  track: z.enum(KART_TRACK_IDS),
  cup: z.enum(KART_CUP_IDS),
  laps: z.number().int().min(1).max(5),
  items: z.boolean(),
  /** Computer racers added to the grid (never more than the free grid slots). */
  bots: z.number().int().min(0).max(11),
  botSkill: z.enum(KART_BOT_SKILLS),
  /** Seconds the rest of the field gets after the first human crosses the line (bots never start it). */
  finishWindowSec: z.number().int().min(10).max(60),
});
export type KartSettings = z.infer<typeof KartSettingsSchema>;

export const DEFAULT_KART_SETTINGS: KartSettings = {
  mode: 'race',
  track: 'pixel-plaza',
  cup: 'joystick',
  laps: 3,
  items: true,
  bots: 5,
  botSkill: 'normal',
  finishWindowSec: 25,
};

/** Grand Prix points by finishing place (index 0 = 1st). Places beyond the table score 0. */
export const KART_GP_POINTS = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1] as const;

// ---------------------------------------------------------------------------
// Simulation + network timing (shared so client prediction matches the server)
// ---------------------------------------------------------------------------

export const KART_SIM = {
  /** Fixed simulation rate (Hz) for the server and client prediction. */
  tickRate: 60,
  /** Client sends one input packet every N simulation ticks. */
  inputEvery: 2,
  /** Hard cap of input frames in one packet (catch-up after a hitch). */
  maxInputsPerPacket: 8,
  /** Start sequence length (COUNTDOWN phase): 3-2-1-GO lights. */
  countdownMs: 4_000,
  /** Kart slots on the grid (humans + bots). */
  gridSlots: 30,
  /** Most computer racers a room adds. */
  maxBots: 11,
} as const;

/** Rate limit for input packets: ~30/s nominal, bursts allowed after network stalls. */
export const KART_INPUT_RATE: RateSpec = { burst: 45, perSecond: 40 };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const KART_MSG = {
  /** client → server: KartLook (LOBBY/RESULTS). */
  look: 'kart:look',
  /** client → server: KartInputPacket (COUNTDOWN/PLAYING; silent + rate limited). */
  input: 'kart:input',
  /** server → all: binary snapshot (Uint8Array): display records for every kart + entities + boxes. */
  snap: 'kart:snap',
  /** server → one racer, same tick as each snap: that racer's exact kart state + input ack (binary, `decodeKartOwn`). */
  own: 'kart:own',
  /** server → all / one: KartEvent. */
  event: 'kart:event',
  /** client → server (host, RESULTS): the next Grand Prix race now, or a rematch with the same settings. */
  next: 'kart:next',
  /**
   * client → server `KartPausePayload` (solo rooms only, COUNTDOWN/PLAYING): pause or resume the race.
   * Mirrored in `race.paused`; while paused the sim, snapshots and every race clock stand still.
   */
  pause: 'kart:pause',
} as const;

/**
 * Bit-packed input frame (19 bits):
 *   bits 0–3   throttle 0..15  → 0..1
 *   bits 4–7   brake    0..15  → 0..1 (reverses when stopped)
 *   bits 8–14  steer    0..126 → -1..1 (63 = centre; positive = left)
 *   bit  15    drift    (hold: hop + drift; also the ramp trick)
 *   bit  16    item     (hold: trail the item behind you; the press uses it, the release fires a trailed item)
 *   bit  17    back     (aim the item backwards)
 *   bit  18    ahead    (aim the item forwards: lob a mine/fizz ahead)
 * Item aim is three-way: projectiles (puck, puck3, seeker) fire forward by default and backward with
 * `back`; traps (mine, fizz) drop behind by default and are lobbed ahead only with `ahead`. If both
 * bits are set, `back` wins.
 * Any integer in [0, KART_INPUT_MAX] decodes to an in-range input.
 */
export const KART_INPUT_MAX = (1 << 19) - 1;

export interface KartInput {
  throttle: number;
  brake: number;
  /** -1..1, positive = steer left. */
  steer: number;
  drift: boolean;
  item: boolean;
  back: boolean;
  /** Aim the item forwards (lob traps ahead). Optional: absent = false. */
  ahead?: boolean;
}

export const NEUTRAL_KART_INPUT: Readonly<KartInput> = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, item: false, back: false, ahead: false });

export function packKartInput(input: KartInput): number {
  const q = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const throttle = q(input.throttle * 15, 15);
  const brake = q(input.brake * 15, 15);
  const steer = q(input.steer * 63 + 63, 126);
  return (
    throttle |
    (brake << 4) |
    (steer << 8) |
    (input.drift ? 1 << 15 : 0) |
    (input.item ? 1 << 16 : 0) |
    (input.back ? 1 << 17 : 0) |
    (input.ahead ? 1 << 18 : 0)
  );
}

export function unpackKartInput(packed: number): KartInput {
  const p = packed >>> 0;
  const steerRaw = Math.min(126, (p >>> 8) & 127);
  return {
    throttle: (p & 15) / 15,
    brake: ((p >>> 4) & 15) / 15,
    steer: (steerRaw - 63) / 63,
    drift: ((p >>> 15) & 1) === 1,
    item: ((p >>> 16) & 1) === 1,
    back: ((p >>> 17) & 1) === 1,
    ahead: ((p >>> 18) & 1) === 1,
  };
}

/** Quantize an input exactly as it travels over the wire (prediction must use this). */
export function quantizeKartInput(input: KartInput): KartInput {
  return unpackKartInput(packKartInput(input));
}

export const KartInputSchema = z.object({
  /** Sequence number of inputs[0]; frames are consecutive (seq, seq+1, …). */
  seq: z.number().int().min(1).max(2 ** 31 - 1),
  inputs: z.array(z.number().int().min(0).max(KART_INPUT_MAX)).min(1).max(KART_SIM.maxInputsPerPacket),
});
export type KartInputPacket = z.infer<typeof KartInputSchema>;

export const KartPauseSchema = z.object({ paused: z.boolean() });
export type KartPausePayload = z.infer<typeof KartPauseSchema>;

// ---------------------------------------------------------------------------
// Events (server → client JSON messages)
// ---------------------------------------------------------------------------

export type KartHitCause = KartItemId | 'hazard' | 'fall' | 'bump';

export type KartEvent =
  | { kind: 'go' }
  | { kind: 'lap'; playerId: string; lap: number; lapMs: number; best: boolean; fastest: boolean }
  | { kind: 'final-lap'; playerId: string }
  | { kind: 'finish'; playerId: string; place: number; timeMs: number }
  | { kind: 'dnf'; playerId: string; reason: 'timeout' | 'left' | 'disconnected' }
  /** An item or hazard landed (or a shield/trailing item blocked it). `by` is null for hazards and falls. */
  | { kind: 'hit'; victim: string; by: string | null; cause: KartHitCause; blocked: boolean }
  /** Sent only to the racer whose roulette stopped. */
  | { kind: 'item'; playerId: string; item: KartItemId };

// ---------------------------------------------------------------------------
// Public (synchronized) state, as clients see it after toJSON()
// ---------------------------------------------------------------------------

export interface KartLookView {
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
}

export interface KartRacerView {
  /** Grid slot = kart index in binary snapshots. */
  slot: number;
  /** Display name captured at the start (kept if the player leaves). Bots: the racer's name. */
  name: string;
  bot: boolean;
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
  /** 0 = on the grid, 1..laps = current lap, laps+1 = finished. */
  lap: number;
  /** 1-based race position. */
  position: number;
  /** Validated race distance in track units (a few updates per second). */
  distance: number;
  lapStartMs: number;
  lastLapMs: number;
  bestLapMs: number;
  finished: boolean;
  finishMs: number;
  /** 1-based finish order (0 = not finished). */
  finishOrder: number;
  dnf: boolean;
  /** False once the kart has been retired from the track (left / away). */
  active: boolean;
}

export type KartRaceStatus = 'idle' | 'grid' | 'racing' | 'done';

export interface KartRaceMetaView {
  status: KartRaceStatus;
  mode: KartMode;
  trackId: KartTrackId;
  cup: KartCupId;
  /** Grand Prix round (1-based; 0 outside a Grand Prix). */
  round: number;
  rounds: number;
  laps: number;
  items: boolean;
  /** Server epoch ms when the race starts (0 = not scheduled). */
  goAt: number;
  /** Server epoch ms when the finish window closes (0 = no human has finished yet; bots never open it). */
  finishDeadline: number;
  fastestLapMs: number;
  fastestLapBy: string;
  entrants: number;
  solo: boolean;
  /** Increments every race (matches the snapshot header). */
  raceId: number;
  /**
   * Solo pause (`kart:pause`): the race is frozen. On resume `goAt`, `finishDeadline` and `phaseEndsAt`
   * move forward by the pause, so `serverNow() - goAt` stays the race time.
   */
  paused: boolean;
}

export interface KartGpEntryView {
  name: string;
  bot: boolean;
  racer: KartRacerId;
  paint: string;
  points: number;
  /** Finishing place in each finished round (0 = DNF / not raced). */
  places: number[];
}

export interface KartPublicState extends BaseRoomView {
  /** Lobby choices by player id. */
  looks: Record<string, KartLookView>;
  /** This race's entrants by racer id (player id, or `bot:<n>`). */
  racers: Record<string, KartRacerView>;
  race: KartRaceMetaView;
  /** Grand Prix standings by racer id (empty outside a Grand Prix). */
  gp: Record<string, KartGpEntryView>;
}

// ---------------------------------------------------------------------------
// Local documents
// ---------------------------------------------------------------------------

export const KART_LOOK_DOC = 'kart-look';
/** Personal best (race time + best lap) per track and lap count, for time trial. */
export const kartBestKey = (trackId: KartTrackId) => `kart-best-${trackId}`;
/** The personal-best ghost per track (a quantized position trace, capped in size). */
export const kartGhostKey = (trackId: KartTrackId) => `kart-ghost-${trackId}`;
/** Largest ghost document accepted from storage (bytes of JSON). */
export const KART_GHOST_MAX_BYTES = 96 * 1024;
