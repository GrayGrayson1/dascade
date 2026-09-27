/**
 * Asteroid Run — shared contract (server + client).
 *
 * Networking model (server-simulated real time, solo and co-op alike; see AsteroidsRoom):
 *  - The server runs the 60 Hz simulation from `@dascade/game-core/asteroids`.
 *  - Clients send sequenced, bit-packed control frames (`asteroids:input`, 2 per packet).
 *    The server applies at most one frame per tick per ship (a credit bank), so a client can
 *    never fly or fire faster than real time. Firing, hits, damage, drops and score are all
 *    decided on the server.
 *  - The world travels as a compact binary snapshot (`asteroids:snap`) every 3 ticks; each
 *    ship carries the last applied input seq so the owner can reconcile its predicted ship.
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';
import type { RateSpec } from '../rateLimit.ts';

export const ASTEROIDS_DIFFICULTIES = ['cadet', 'pilot', 'ace'] as const;
export type AsteroidsDifficulty = (typeof ASTEROIDS_DIFFICULTIES)[number];
export const ASTEROIDS_DIFFICULTY_LABELS: Record<AsteroidsDifficulty, string> = { cadet: 'Cadet', pilot: 'Pilot', ace: 'Ace' };

export const AsteroidsSettingsSchema = z.object({
  difficulty: z.enum(ASTEROIDS_DIFFICULTIES),
  /** Lives per pilot. */
  lives: z.number().int().min(1).max(5),
  /** Co-op: downed pilots rejoin with one life when the team clears a wave. */
  revive: z.boolean(),
});
export type AsteroidsSettings = z.infer<typeof AsteroidsSettingsSchema>;

export const DEFAULT_ASTEROIDS_SETTINGS: AsteroidsSettings = {
  difficulty: 'pilot',
  lives: 3,
  revive: true,
};

/**
 * Bit-packed control frame (11 bits):
 *   bit 0 turn left · bit 1 turn right · bit 2 thrust · bit 3 fire · bit 4 aim (steer to bits 5–10)
 *   bits 5–10 aim direction (0–63, clockwise from +x, see DIRS in the classics kit)
 * Any integer in [0, ASTEROIDS_INPUT_MAX] is a valid frame.
 */
export const ASTEROIDS_INPUT_MAX = (1 << 11) - 1;

export interface ShipControls {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
  /** Steer towards `aimDir` (touch stick / gamepad) instead of left/right. */
  aim: boolean;
  aimDir: number;
}

export const NEUTRAL_CONTROLS: Readonly<ShipControls> = Object.freeze({ left: false, right: false, thrust: false, fire: false, aim: false, aimDir: 0 });

export function packControls(c: ShipControls): number {
  const dir = Math.max(0, Math.min(63, Math.round(c.aimDir) & 63));
  return (c.left ? 1 : 0) | (c.right ? 2 : 0) | (c.thrust ? 4 : 0) | (c.fire ? 8 : 0) | (c.aim ? 16 : 0) | (dir << 5);
}

export function unpackControls(frame: number): ShipControls {
  const f = frame >>> 0;
  return {
    left: (f & 1) !== 0,
    right: (f & 2) !== 0,
    thrust: (f & 4) !== 0,
    fire: (f & 8) !== 0,
    aim: (f & 16) !== 0,
    aimDir: (f >>> 5) & 63,
  };
}

export const ASTEROIDS_NET = {
  /** Client sends one packet every N ticks. */
  inputEvery: 2,
  /** Most frames in one packet (catch-up after a hitch). */
  maxInputsPerPacket: 8,
  /** Server snapshot every N ticks. */
  snapEvery: 3,
} as const;

export const AsteroidsInputSchema = z.object({
  seq: z.number().int().min(1).max(2 ** 31 - 1),
  inputs: z.array(z.number().int().min(0).max(ASTEROIDS_INPUT_MAX)).min(1).max(ASTEROIDS_NET.maxInputsPerPacket),
});
export type AsteroidsInputPacket = z.infer<typeof AsteroidsInputSchema>;

export const ASTEROIDS_INPUT_RATE: RateSpec = { burst: 45, perSecond: 40 };

export const ASTEROIDS_MSG = {
  /** client → server: AsteroidsInputPacket (PLAYING, silent + rate limited). */
  input: 'asteroids:input',
  /** server → all: binary world snapshot (Uint8Array). */
  snap: 'asteroids:snap',
  /** server → all: AsteroidsEventPayload (hits, explosions, pickups, waves) for sound and effects. */
  event: 'asteroids:event',
  /** client → server (solo only): pause / resume. */
  pause: 'asteroids:pause',
} as const;

export const AsteroidsPauseSchema = z.object({ paused: z.boolean() });

export const POWER_KINDS = ['spread', 'rapid', 'shield', 'nova', 'life'] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export const POWER_LABELS: Record<PowerKind, string> = {
  spread: 'Spread shot',
  rapid: 'Rapid fire',
  shield: 'Shield charge',
  nova: 'Nova pulse',
  life: 'Extra ship',
};

export const ROCK_KINDS = ['stone', 'iron', 'crystal'] as const;
export type RockKind = (typeof ROCK_KINDS)[number];

export type AsteroidsEventPayload =
  | { kind: 'rock'; x: number; y: number; size: number; rock: RockKind; by: string; points: number; destroyed: boolean }
  | { kind: 'ship-hit'; playerId: string; x: number; y: number; shield: number }
  | { kind: 'ship-down'; playerId: string; x: number; y: number; lives: number }
  | { kind: 'respawn'; playerId: string }
  | { kind: 'pickup'; playerId: string; power: PowerKind; x: number; y: number }
  | { kind: 'nova'; playerId: string; x: number; y: number }
  | { kind: 'wave'; wave: number; bonus: number }
  | { kind: 'revive'; playerId: string }
  | { kind: 'over'; wave: number; score: number };

export type AsteroidsStatus = 'idle' | 'play' | 'intermission' | 'over';

export interface PilotView {
  /** Ship slot (index inside binary snapshots). */
  slot: number;
  name: string;
  color: string;
  score: number;
  lives: number;
  shield: number;
  kills: number;
  /** Out of lives (can still be revived in co-op). */
  out: boolean;
  /** False once the player has left the match. */
  active: boolean;
}

export interface AsteroidsMatchView {
  status: AsteroidsStatus;
  wave: number;
  teamScore: number;
  difficulty: AsteroidsDifficulty;
  coop: boolean;
  matchId: number;
  /** Server epoch ms when the run (re)starts after the READY lead-in or a pause. */
  startAt: number;
  paused: boolean;
}

export interface AsteroidsPublicState extends ClassicsPublicState {
  pilots: Record<string, PilotView>;
  run: AsteroidsMatchView;
}
