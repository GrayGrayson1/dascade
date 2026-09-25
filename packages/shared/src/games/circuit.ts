/**
 * DASh Circuit — shared contract (server + client).
 *
 * Networking model (see apps/web/src/games/circuit/net and the CircuitRoom):
 *  - Low-rate race meta (grid, laps, standings, best laps, finish order) lives in the
 *    Colyseus schema state (`cars`, `racers`, `race`).
 *  - High-rate car motion travels as a compact binary snapshot (`circuit:snap`,
 *    encoded by `@dascade/game-core/circuit`) broadcast every 2–3 simulation ticks.
 *  - Clients only ever send inputs (`circuit:input`): a sequence number plus 1–8
 *    bit-packed input frames. The server owns positions, checkpoints, laps, finish
 *    order and race time.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import type { RateSpec } from '../rateLimit.ts';

// ---------------------------------------------------------------------------
// Content ids
// ---------------------------------------------------------------------------

export const CIRCUIT_TRACK_IDS = ['neon-loop', 'skyline-switchback'] as const;
export type CircuitTrackId = (typeof CIRCUIT_TRACK_IDS)[number];

export const CHASSIS_IDS = ['volt', 'brick', 'comet', 'pixel'] as const;
export type ChassisId = (typeof CHASSIS_IDS)[number];

export const DECAL_IDS = ['none', 'stripes', 'flames', 'checker', 'bolt', 'panel'] as const;
export type DecalId = (typeof DECAL_IDS)[number];

export const WHEEL_IDS = ['spoke', 'disc', 'turbo'] as const;
export type WheelId = (typeof WHEEL_IDS)[number];

/** Curated paint swatches (any #rrggbb is accepted; these are the quick picks). */
export const CAR_PAINTS = [
  '#22d3ee',
  '#f97316',
  '#ff4fd8',
  '#ffd23f',
  '#2de38f',
  '#a78bfa',
  '#ff5a5f',
  '#60a5fa',
  '#a3e635',
  '#f8f6ff',
  '#1f2937',
  '#0ea5a4',
  '#e11d48',
  '#fb923c',
  '#8b5cf6',
  '#facc15',
] as const;

export const NAMEPLATE_MAX = 8;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour');

export const CarConfigSchema = z.object({
  chassis: z.enum(CHASSIS_IDS),
  primary: HexColor,
  secondary: HexColor,
  decal: z.enum(DECAL_IDS),
  wheels: z.enum(WHEEL_IDS),
  number: z.number().int().min(0).max(99),
  /** Raw nameplate; the server sanitizes and trims it to NAMEPLATE_MAX characters. */
  nameplate: z.string().max(32),
});
export type CarConfig = z.infer<typeof CarConfigSchema>;

/** A pleasant default car derived from a player's lobby colour and name. */
export function defaultCarConfig(color: string, name: string, seed = 0): CarConfig {
  const primary = /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#22d3ee';
  const secondary = primary === '#f97316' ? '#22d3ee' : '#f97316';
  return {
    chassis: CHASSIS_IDS[Math.abs(seed) % CHASSIS_IDS.length] ?? 'volt',
    primary,
    secondary,
    decal: DECAL_IDS[1 + (Math.abs(seed * 7) % (DECAL_IDS.length - 1))] ?? 'stripes',
    wheels: WHEEL_IDS[Math.abs(seed) % WHEEL_IDS.length] ?? 'spoke',
    number: (Math.abs(seed * 13) % 98) + 1,
    nameplate: nameplateFrom(name),
  };
}

/** Uppercase, printable, ≤ NAMEPLATE_MAX characters. Used by the client for previews; the server re-sanitizes. */
export function nameplateFrom(raw: string): string {
  const cleaned = Array.from(raw.normalize('NFC').replace(/[^\p{L}\p{N} .\-_!?#*]/gu, '').trim().toUpperCase())
    .slice(0, NAMEPLATE_MAX)
    .join('')
    .trim();
  return cleaned || 'RACER';
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const CircuitSettingsSchema = z.object({
  track: z.enum(CIRCUIT_TRACK_IDS),
  laps: z.number().int().min(1).max(10),
  collisions: z.boolean(),
  boost: z.boolean(),
  /** Seconds the rest of the field gets after the winner crosses the line. */
  finishWindowSec: z.number().int().min(10).max(90),
});
export type CircuitSettings = z.infer<typeof CircuitSettingsSchema>;

export const DEFAULT_CIRCUIT_SETTINGS: CircuitSettings = {
  track: 'neon-loop',
  laps: 3,
  collisions: true,
  boost: true,
  finishWindowSec: 30,
};

// ---------------------------------------------------------------------------
// Simulation + network timing (shared so client prediction matches the server)
// ---------------------------------------------------------------------------

export const CIRCUIT_SIM = {
  /** Fixed simulation rate (Hz) for both the server and client prediction. */
  tickRate: 60,
  /** Client sends one input packet every N simulation ticks. */
  inputEvery: 2,
  /** Hard cap of input frames in one packet (allows catch-up after a hitch). */
  maxInputsPerPacket: 8,
  /** Length of the start-light sequence (the COUNTDOWN phase). */
  countdownMs: 4_200,
  /** How many red lights are in the gantry. */
  lights: 5,
} as const;

/** Rate limit for input packets: ~30/s nominal, bursts allowed after network stalls. */
export const CIRCUIT_INPUT_RATE: RateSpec = { burst: 45, perSecond: 40 };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const CIRCUIT_MSG = {
  /** client → server: CarConfig (LOBBY/RESULTS). */
  car: 'circuit:car',
  /** client → server: CircuitInputPacket (COUNTDOWN/PLAYING, silent + rate limited). */
  input: 'circuit:input',
  /** server → all: binary car snapshot (Uint8Array). */
  snap: 'circuit:snap',
  /** server → all / one: CircuitEvent (laps, splits, finishes, fastest lap). */
  event: 'circuit:event',
  /** client → server (host, RESULTS): race again right away with the same settings. */
  rematch: 'circuit:rematch',
} as const;

/**
 * Bit-packed input frame (17 bits):
 *   bits 0–3  throttle 0..15   → 0..1
 *   bits 4–7  brake    0..15   → 0..1
 *   bits 8–14 steer    0..126 → -1..1 (63 = centre)
 *   bit  15   drift
 *   bit  16   boost
 * Any integer in [0, INPUT_MAX] decodes to an in-range input, so validation is a
 * simple bounds check and a malicious packet can never produce out-of-range controls.
 */
export const INPUT_MAX = (1 << 17) - 1;

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  boost: boolean;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, boost: false });

export function packInput(input: CarInput): number {
  const q = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const throttle = q(input.throttle * 15, 15);
  const brake = q(input.brake * 15, 15);
  const steer = q(input.steer * 63 + 63, 126);
  return throttle | (brake << 4) | (steer << 8) | (input.drift ? 1 << 15 : 0) | (input.boost ? 1 << 16 : 0);
}

export function unpackInput(packed: number): CarInput {
  const p = packed >>> 0;
  const steerRaw = Math.min(126, (p >>> 8) & 127);
  return {
    throttle: (p & 15) / 15,
    brake: ((p >>> 4) & 15) / 15,
    steer: (steerRaw - 63) / 63,
    drift: ((p >>> 15) & 1) === 1,
    boost: ((p >>> 16) & 1) === 1,
  };
}

/** Quantize an input exactly the way it travels over the wire (prediction must use this). */
export function quantizeInput(input: CarInput): CarInput {
  return unpackInput(packInput(input));
}

export const CircuitInputSchema = z.object({
  /** Sequence number of inputs[0]; frames are consecutive (seq, seq+1, …). */
  seq: z.number().int().min(1).max(2 ** 31 - 1),
  inputs: z.array(z.number().int().min(0).max(INPUT_MAX)).min(1).max(CIRCUIT_SIM.maxInputsPerPacket),
});
export type CircuitInputPacket = z.infer<typeof CircuitInputSchema>;

// ---------------------------------------------------------------------------
// Events (server → client JSON messages)
// ---------------------------------------------------------------------------

export type CircuitEvent =
  | { kind: 'lap'; playerId: string; lap: number; lapMs: number; best: boolean; fastest: boolean }
  | { kind: 'split'; playerId: string; lap: number; gate: number; splitMs: number }
  | { kind: 'finish'; playerId: string; place: number; timeMs: number }
  | { kind: 'final-lap'; playerId: string }
  | { kind: 'dnf'; playerId: string; reason: 'timeout' | 'left' | 'disconnected' }
  | { kind: 'go' };

// ---------------------------------------------------------------------------
// Public (synchronized) state shapes, as seen by clients after toJSON()
// ---------------------------------------------------------------------------

export interface CarLookView {
  chassis: ChassisId;
  primary: string;
  secondary: string;
  decal: DecalId;
  wheels: WheelId;
  number: number;
  nameplate: string;
}

export interface RacerView {
  /** Grid slot = car index inside binary snapshots. */
  slot: number;
  /** Display name captured at the start (kept if the player leaves). */
  name: string;
  /** 0 = on the grid, 1..laps = current lap, laps+1 = finished. */
  lap: number;
  /** Next checkpoint gate index (0 = start/finish line). */
  gate: number;
  /** 1-based race position. */
  position: number;
  /** Validated race distance in track units (updated a few times per second). */
  distance: number;
  lapStartMs: number;
  lastLapMs: number;
  bestLapMs: number;
  finished: boolean;
  finishMs: number;
  /** 1-based finish order (0 = not finished). */
  finishOrder: number;
  dnf: boolean;
  wrongWay: boolean;
  /** False once the car has been retired from the track (left / away). */
  active: boolean;
}

export type RaceStatus = 'idle' | 'grid' | 'racing' | 'done';

export interface RaceMetaView {
  status: RaceStatus;
  trackId: CircuitTrackId;
  laps: number;
  /** Server epoch ms when the lights go out (0 = not scheduled). */
  goAt: number;
  /** Server epoch ms when the finish window closes (0 = no winner yet). */
  finishDeadline: number;
  fastestLapMs: number;
  fastestLapBy: string;
  /** Total racers on the grid this race. */
  entrants: number;
  solo: boolean;
  /** Increments every race (matches the snapshot header). */
  raceId: number;
}

export interface CircuitPublicState extends BaseRoomView {
  cars: Record<string, CarLookView>;
  racers: Record<string, RacerView>;
  race: RaceMetaView;
}

/** Local-storage document key for personal bests per track (solo time trial). */
export const circuitBestKey = (trackId: CircuitTrackId) => `circuit-best-${trackId}`;
export const CIRCUIT_CAR_DOC = 'circuit-car';

export interface CircuitBestDoc {
  trackId: CircuitTrackId;
  lapMs: number;
  /** Split times at each checkpoint gate (index = gate), for live deltas. */
  splits: number[];
  raceMs?: number;
  laps?: number;
  savedAt: number;
}
