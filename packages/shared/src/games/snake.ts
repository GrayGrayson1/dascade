/**
 * Neon Snake — shared contract (server + client).
 *
 * Networking model (server-simulated grid, see SnakeRoom):
 *  - The server steps the grid simulation from `@dascade/game-core/snake` at a steady rate.
 *  - Clients send only turn intents (`snake:turn`). The server buffers up to three per snake,
 *    so quick double turns are never lost, and ignores 180° reversals.
 *  - Every step the server broadcasts a compact binary grid snapshot (`snake:snap`).
 *  - Scores, lengths, lives and the match clock live in the schema state.
 *
 * Modes
 *  - survival: one life. A crash (wall, yourself, another snake) ends your run and your body
 *    breaks into sparks. Last snake alive wins; at the time cap the living rank by length.
 *  - frenzy: timed arena with respawns (2 s later, length reset, score kept). Highest score wins.
 *  - Solo play is always survival score attack with a speed-up every few pickups.
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';
import type { RateSpec } from '../rateLimit.ts';

export const SNAKE_MODES = ['survival', 'frenzy'] as const;
export type SnakeMode = (typeof SNAKE_MODES)[number];
export const SNAKE_MODE_LABELS: Record<SnakeMode, string> = { survival: 'Survival', frenzy: 'Frenzy (respawn)' };

export const SNAKE_SPEEDS = ['relaxed', 'normal', 'fast'] as const;
export type SnakeSpeed = (typeof SNAKE_SPEEDS)[number];
export const SNAKE_SPEED_LABELS: Record<SnakeSpeed, string> = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };
/** Grid steps per second for each speed. */
export const SNAKE_STEP_MS: Record<SnakeSpeed, number> = { relaxed: 140, normal: 110, fast: 85 };

export const SNAKE_ARENAS = ['auto', 'small', 'medium', 'large'] as const;
export type SnakeArena = (typeof SNAKE_ARENAS)[number];
export const SNAKE_ARENA_LABELS: Record<SnakeArena, string> = { auto: 'Auto', small: 'Small', medium: 'Medium', large: 'Large' };

export const SnakeSettingsSchema = z.object({
  mode: z.enum(SNAKE_MODES),
  speed: z.enum(SNAKE_SPEEDS),
  arena: z.enum(SNAKE_ARENAS),
  /** Edges wrap around instead of being deadly walls. */
  wrap: z.boolean(),
  /** Rare power items (gems, phase, magnet). */
  powerUps: z.boolean(),
  /** Match length (frenzy) or survival time cap, in seconds. */
  roundSeconds: z.number().int().min(60).max(600),
});
export type SnakeSettings = z.infer<typeof SnakeSettingsSchema>;

export const DEFAULT_SNAKE_SETTINGS: SnakeSettings = {
  mode: 'survival',
  speed: 'normal',
  arena: 'auto',
  wrap: false,
  powerUps: true,
  roundSeconds: 180,
};

/** Head-to-head tournament games always use this format. */
export const SNAKE_TOURNAMENT_SETTINGS: SnakeSettings = {
  mode: 'survival',
  speed: 'normal',
  arena: 'small',
  wrap: false,
  powerUps: true,
  roundSeconds: 150,
};

/** Grid directions: 0 up, 1 right, 2 down, 3 left. */
export const SnakeTurnSchema = z.object({
  dir: z.number().int().min(0).max(3),
});
export type SnakeTurn = z.infer<typeof SnakeTurnSchema>;

/** Turns are tiny; a human never needs more than ~12 per second. */
export const SNAKE_TURN_RATE: RateSpec = { burst: 12, perSecond: 14 };

export const SNAKE_MSG = {
  /** client → server: SnakeTurn (PLAYING, silent + rate limited). */
  turn: 'snake:turn',
  /** server → all: binary grid snapshot (Uint8Array). */
  snap: 'snake:snap',
  /** server → all: SnakeEventPayload for sound and effects. */
  event: 'snake:event',
  /** client → server (solo only): pause / resume. */
  pause: 'snake:pause',
} as const;

export const SnakePauseSchema = z.object({ paused: z.boolean() });

export const SNAKE_ITEM_KINDS = ['energy', 'spark', 'gem', 'phase', 'magnet'] as const;
export type SnakeItemKind = (typeof SNAKE_ITEM_KINDS)[number];

export type SnakeDeathCause = 'wall' | 'self' | 'snake' | 'head' | 'left';

export type SnakeEventPayload =
  | { kind: 'eat'; playerId: string; item: SnakeItemKind; x: number; y: number; points: number }
  | { kind: 'death'; playerId: string; cause: SnakeDeathCause; by: string; x: number; y: number }
  | { kind: 'respawn'; playerId: string }
  | { kind: 'level'; level: number }
  | { kind: 'over'; winners: string[]; draw: boolean };

export type SnakeStatus = 'idle' | 'ready' | 'running' | 'over';

export interface SnakeView {
  /** Slot = snake index inside binary snapshots. */
  slot: number;
  name: string;
  color: string;
  alive: boolean;
  score: number;
  length: number;
  kills: number;
  deaths: number;
  best: number;
  /** Server epoch ms of the next respawn (frenzy), 0 otherwise. */
  respawnAt: number;
  /** Final place (1-based) once the match is decided, 0 before. */
  place: number;
  /** False once the player has left the match. */
  active: boolean;
}

export interface SnakeMatchView {
  status: SnakeStatus;
  mode: SnakeMode;
  solo: boolean;
  cols: number;
  rows: number;
  wrap: boolean;
  /** Current step length (ms). */
  stepMs: number;
  /** Solo level (speed tier). */
  level: number;
  /** Server epoch ms when the round ends (0 = not running). */
  endsAt: number;
  /** Server epoch ms when the snakes start moving. */
  startAt: number;
  /** JSON array of winning player ids (several = shared first place). */
  winnersJson: string;
  draw: boolean;
  matchId: number;
  /** Solo game paused. */
  paused: boolean;
}

export interface SnakePublicState extends ClassicsPublicState {
  snakes: Record<string, SnakeView>;
  match: SnakeMatchView;
}
