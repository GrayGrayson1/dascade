/**
 * Pixel Paddle — shared contract (server + client).
 *
 * Networking model (server-simulated real time, see PaddleRoom):
 *  - The server runs the fixed 60 Hz paddle simulation from `@dascade/game-core/paddle`.
 *  - Clients send only intents (`paddle:input`): the paddle position they are steering towards
 *    and a "serve" flag. The server moves each paddle towards its target at the capped paddle
 *    speed, so a client can never teleport or out-run the rules.
 *  - Ball + paddle motion travels in a compact binary snapshot (`paddle:snap`) every 2 ticks.
 *  - Low-rate match meta (scores, serve, sides, winner) lives in the schema state.
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';
import type { RateSpec } from '../rateLimit.ts';

export const PADDLE_AI_LEVELS = ['rookie', 'pro', 'ace', 'legend'] as const;
export type PaddleAiLevel = (typeof PADDLE_AI_LEVELS)[number];

export const PADDLE_AI_LABELS: Record<PaddleAiLevel, string> = {
  rookie: 'Rookie',
  pro: 'Pro',
  ace: 'Ace',
  legend: 'Legend',
};

export const PADDLE_SPEEDS = ['chill', 'classic', 'turbo'] as const;
export type PaddleSpeed = (typeof PADDLE_SPEEDS)[number];

export const PADDLE_SPEED_LABELS: Record<PaddleSpeed, string> = {
  chill: 'Chill',
  classic: 'Classic',
  turbo: 'Turbo',
};

export const PADDLE_TARGETS = [3, 5, 7, 11, 15, 21] as const;

export const PaddleSettingsSchema = z.object({
  /** Points needed to win a game. */
  target: z.number().int().min(3).max(21),
  /** A game must be won by two clear points (deuce). */
  winBy2: z.boolean(),
  /** Ball serve speed, top speed and rally speed-up. */
  speed: z.enum(PADDLE_SPEEDS),
  /** House paddle difficulty (solo practice, a lone seated player, and disconnected-player cover). */
  ai: z.enum(PADDLE_AI_LEVELS),
});
export type PaddleSettings = z.infer<typeof PaddleSettingsSchema>;

export const DEFAULT_PADDLE_SETTINGS: PaddleSettings = {
  target: 7,
  winBy2: true,
  speed: 'classic',
  ai: 'pro',
};

/** Tournament games always use this format regardless of lobby settings (the series is handled by the platform). */
export const PADDLE_TOURNAMENT_RULES = { target: 7, winBy2: true, speed: 'classic' } as const;

/** Rate limit for input packets (~30/s nominal, bursts allowed after a network stall). */
export const PADDLE_INPUT_RATE: RateSpec = { burst: 45, perSecond: 40 };

export const PADDLE_MSG = {
  /** client → server: PaddleInput (COUNTDOWN/PLAYING, silent + rate limited). */
  input: 'paddle:input',
  /** server → all: binary snapshot (Uint8Array, see encodePaddleSnapshot). */
  snap: 'paddle:snap',
  /** server → all: PaddleEvent (hits, points, game over) for sound and effects. */
  event: 'paddle:event',
  /** client → server (solo only): pause / resume the game. */
  pause: 'paddle:pause',
} as const;

export const PaddlePauseSchema = z.object({ paused: z.boolean() });

export const PADDLE_Y_MAX = 900;

export const PaddleInputSchema = z.object({
  /** Where this player wants their paddle (field units, 0 = top). */
  y: z.number().finite().min(0).max(PADDLE_Y_MAX),
  /** Launch the ball when you hold serve. */
  serve: z.boolean().optional(),
  /** Client's measured round-trip time (ms). Only used, capped, to be fair about hits near the paddle edge. */
  rtt: z.number().finite().min(0).max(2_000).optional(),
});
export type PaddleInput = z.infer<typeof PaddleInputSchema>;

export type PaddleEventPayload =
  | { kind: 'hit'; side: 0 | 1; rally: number; speed: number; offset: number; x: number; y: number }
  | { kind: 'wall'; x: number; y: number }
  | { kind: 'serve'; side: 0 | 1 }
  | { kind: 'point'; scorer: 0 | 1; scores: [number, number]; rally: number; gamePoint: boolean }
  | { kind: 'over'; winner: 0 | 1; scores: [number, number]; reason: 'score' | 'forfeit' };

export type PaddleStatus = 'idle' | 'serve' | 'play' | 'point' | 'over';

export interface PaddleSideView {
  /** Room player id ('' for the house paddle). */
  playerId: string;
  name: string;
  color: string;
  /** Paddle is driven by the house AI (solo opponent or covering a dropped player). */
  ai: boolean;
  score: number;
  hits: number;
}

export interface PaddleMatchView {
  status: PaddleStatus;
  target: number;
  winBy2: boolean;
  speed: PaddleSpeed;
  aiLevel: PaddleAiLevel;
  /** Side holding serve (0 = left, 1 = right). */
  server: number;
  /** -1 until decided. */
  winner: number;
  reason: '' | 'score' | 'forfeit';
  rally: number;
  longestRally: number;
  pointsPlayed: number;
  /** Increments each match (matches the snapshot header). */
  matchId: number;
  /** Server epoch ms when play (re)starts after the READY lead-in or a pause. */
  startAt: number;
  /** Solo game paused. */
  paused: boolean;
}

export interface PaddlePublicState extends ClassicsPublicState {
  left: PaddleSideView;
  right: PaddleSideView;
  match: PaddleMatchView;
}
