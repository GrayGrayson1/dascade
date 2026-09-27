/**
 * Memory Matrix — shared contract. Server-driven: the room generates every pattern, plays it
 * on the server clock, judges each tap and owns scores/lives (classics kit ClassicsRoom).
 *
 * Round flow (public `stage`): intro → show (pattern broadcast with a server start time) →
 * input (players tap; private feedback) → review (the answer is revealed to everyone) → next.
 */
import { z } from 'zod';
import type { ClassicsPublicState } from './classics.ts';

export const MEMORY_VARIANTS = ['mixed', 'sequence', 'flash'] as const;
export type MemoryVariantId = (typeof MEMORY_VARIANTS)[number];
export const MEMORY_RULES = ['lives', 'sudden'] as const;
export type MemoryRule = (typeof MEMORY_RULES)[number];
export const MEMORY_LIVES = 3;
export const MEMORY_MAX_TILE = 24;
export const MEMORY_MAX_ROUND = 40;

export const MemorySettingsSchema = z.object({
  /** mixed = alternate sequence/flash rounds. */
  variant: z.enum(MEMORY_VARIANTS),
  /** lives = three misses and you're out; sudden = one miss and you're out. */
  rule: z.enum(MEMORY_RULES),
});
export type MemorySettings = z.infer<typeof MemorySettingsSchema>;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { variant: 'mixed', rule: 'lives' };

export function memoryBoardKey(s: MemorySettings): string {
  if (s.variant === 'mixed' && s.rule === 'lives') return 'classic';
  return `${s.variant}${s.rule === 'sudden' ? '-sudden' : ''}`;
}

export const MEMORY_MSG = {
  /** client → server: MemoryTap (players only, input stage). */
  tap: 'memory:tap',
  /** server → all: MemoryPatternMsg at the start of the show stage. */
  pattern: 'memory:pattern',
  /** server → one player: MemoryFeedback after each of their taps. */
  feedback: 'memory:feedback',
  /** server → all: MemoryReveal when a round closes. */
  reveal: 'memory:reveal',
  /** server → one player: MemoryYou (their progress this round; re-sent on reconnect). */
  you: 'memory:you',
} as const;

export const MemoryTapSchema = z.object({
  round: z.number().int().min(1).max(MEMORY_MAX_ROUND),
  tile: z.number().int().min(0).max(MEMORY_MAX_TILE),
});
export type MemoryTap = z.infer<typeof MemoryTapSchema>;

export interface MemoryPatternMsg {
  round: number;
  kind: 'sequence' | 'flash';
  size: number;
  tiles: number[];
  stepMs: number;
  gapMs: number;
  /** Server epoch ms when playback starts. */
  showAt: number;
}

export interface MemoryFeedback {
  round: number;
  tile: number;
  ok: boolean;
  progress: number;
  done: boolean;
  failed: boolean;
  points: number;
}

export interface MemoryReveal {
  round: number;
  kind: 'sequence' | 'flash';
  size: number;
  tiles: number[];
  results: Record<string, 'done' | 'failed'>;
}

export interface MemoryYou {
  round: number;
  progress: number;
  found: number[];
  state: MemoryMarkState;
}

export type MemoryStage = 'idle' | 'intro' | 'show' | 'input' | 'review';
export type MemoryMarkState = 'waiting' | 'watch' | 'input' | 'done' | 'failed' | 'out';

export interface MemoryMarkView {
  progress: number;
  state: MemoryMarkState;
}

export interface MemoryPublicState extends ClassicsPublicState {
  stage: MemoryStage;
  /** Server epoch ms when the current stage ends. */
  stageEndsAt: number;
  grid: number;
  kind: string;
  count: number;
  /** Per-player round status (never which tiles). */
  marks: Record<string, MemoryMarkView>;
}
