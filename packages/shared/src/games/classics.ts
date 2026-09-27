/**
 * DAScade Classics — shared kit contract (server + client) used by every Classics game
 * (paddle, snake, bricks, asteroids, memory, blocks).
 *
 * Two authority models (see docs/GAME_GUIDE.md §6, Classics kit):
 *  1. Server-simulated real-time (paddle, snake, asteroids co-op): the room runs the fixed-step
 *     sim, clients send bounded intents, the server broadcasts compact snapshots.
 *  2. Locally simulated, server-verified (bricks, blocks): the client runs the deterministic
 *     engine for instant feel and streams a tick-indexed input log (`classics:input`); the
 *     server replays the same engine with the same server-issued seed and owns the result.
 *  Memory Matrix is server-driven (server generates patterns and judges every tap).
 *
 * Every Classics room shares: per-player standings (`standings`), a small meta block
 * (`classics`), instant solo play (`classics:start`), host rematch and verified high scores
 * (GET /api/classics/scores/:gameId?board=<key>).
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import type { RateSpec } from '../rateLimit.ts';

// ---------------------------------------------------------------------------
// Timing + bounds
// ---------------------------------------------------------------------------

export const CLASSICS = {
  /** Fixed simulation rate for every Classics engine (client + server replay). */
  tickHz: 60,
  /** Client flushes its input log every N ticks (≈ 5 batches per second). */
  batchEveryTicks: 12,
  /** Most input events one batch may carry. */
  maxBatchEvents: 240,
  /** Most input events that may share one tick (flood guard). */
  maxEventsPerTick: 8,
  /** Longest verified run (ticks) — 60 minutes of play; a run that reaches it ends with reason 'time'. */
  maxRunTicks: 60 * 60 * 60,
  /** Most input events a whole run may carry. */
  maxRunEvents: 250_000,
  /** How far (ticks) a client may run ahead of the server wall clock (clock jitter). */
  aheadSlackTicks: 90,
  /** Multiplayer untimed races: a run this far behind the wall clock (ms) is ended. */
  maxLagMs: 30_000,
  /** Timed races: grace after the deadline for final batches to arrive (ms). */
  deadlineGraceMs: 12_000,
  /** High-score entries returned by the API. */
  boardSize: 10,
} as const;

export const CLASSICS_INPUT_RATE: RateSpec = { burst: 40, perSecond: 14 };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const CLASSICS_MSG = {
  /** client → server: {} — "Start"/"Retry" from the instructions or game-over card (solo & free play). */
  start: 'classics:start',
  /** client → server: {} — abandon the current run (solo "Restart" / "Quit to menu"). */
  quit: 'classics:quit',
  /** client → server (host, RESULTS): start the next match right away with the same settings. */
  rematch: 'classics:rematch',
  /** client → server: RunInputBatch (verified runs only; silent + rate limited). */
  input: 'classics:input',
  /** server → one player: RunTicket (seed etc.; re-sent with a resume log after reconnect). */
  run: 'classics:run',
  /** server → one player: RunAck (verified progress; `resync` asks the client to resend). */
  ack: 'classics:ack',
  /** server → one player: RunVerdict (the server's final, verified result for a run). */
  verdict: 'classics:verdict',
  /** server → all: ClassicsEvent (match flow, finished players, new records). */
  event: 'classics:event',
} as const;

export const RUN_ID_MAX = 24;

/** A tick-indexed slice of a verified run's input log. */
export const RunInputBatchSchema = z.object({
  runId: z.string().min(1).max(RUN_ID_MAX),
  /** 1-based batch sequence (strictly consecutive; duplicates are ignored). */
  seq: z.number().int().min(1).max(1_000_000),
  /**
   * The client simulated through this tick (its engine's tick counter after stepping). Clients stop
   * at CLASSICS.maxRunTicks; a batch that crosses it (e.g. an older client) still reaches the server,
   * which ends the run at the cap with a real verdict instead of dropping the batch.
   */
  upTo: z.number().int().min(0).max(CLASSICS.maxRunTicks * 2),
  /**
   * Flattened [dt, code, dt, code, …]: dt is the tick delta from the previous event (the first
   * one from the previous batch's `upTo`), code is a game-specific input code.
   */
  events: z
    .array(z.number().int().min(0).max(CLASSICS.maxRunTicks))
    .max(CLASSICS.maxBatchEvents * 2)
    .refine((a) => a.length % 2 === 0, 'events must be [dt, code] pairs'),
  /** The client's engine reported game over at `upTo`. */
  final: z.boolean().optional(),
  /** Client-side score (diagnostics only — never trusted). */
  clientScore: z.number().int().min(0).max(2_000_000_000).optional(),
});
export type RunInputBatch = z.infer<typeof RunInputBatchSchema>;

/** Sent privately when a verified run is issued (and again, with `resume`, after a reconnect). */
export interface RunTicket {
  runId: string;
  /** state.classics.matchNo the run belongs to (clients ignore tickets from an older match). */
  matchNo: number;
  /** Deterministic engine seed (everyone in a race gets the same seed). */
  seed: string;
  /** Server epoch ms when the run's clock starts (the client starts simulating then). */
  startAt: number;
  /** Tick limit (timed races); 0 = play until game over. */
  limitTicks: number;
  /** Game-specific engine options (from room settings). */
  options: Record<string, number | string | boolean>;
  /** High-score board this run counts for ('' = unranked). */
  board: string;
  /** Present after a reconnect: replay these events to `upTo`, then continue. */
  resume?: { events: number[]; upTo: number; ackSeq: number };
  /** The run already ended (reconnect after the verdict). */
  ended?: boolean;
}

export interface RunAck {
  runId: string;
  /** Last batch accepted. */
  seq: number;
  /** Server-verified tick. */
  upTo: number;
  /** The server could not use the last batch (gap/overlap): resend from `seq + 1` / `upTo`. */
  resync?: boolean;
}

export type RunEndReason = 'over' | 'time' | 'quit' | 'lag' | 'rejected' | 'left';

export interface RunSummary {
  score: number;
  level: number;
  lives: number;
  /** Game-specific headline stat (lines, bricks, rounds…). */
  stat: number;
}

export interface RunVerdict extends RunSummary {
  runId: string;
  reason: RunEndReason;
  ticks: number;
  /** New personal best in this room session. */
  best: boolean;
  /** Position on the global board (1-based) when recorded, else null. */
  rank: number | null;
  /** Id of the recorded high-score entry (to highlight it). */
  entryId: string | null;
  board: string;
}

export type ClassicsEvent =
  | { kind: 'match-start'; startAt: number; entrants: number }
  | { kind: 'player-over'; playerId: string; score: number; place: number | null; reason: RunEndReason }
  | { kind: 'record'; playerId: string; name: string; score: number; rank: number; board: string }
  | { kind: 'time-up' };

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

/**
 * idle     – seated, nothing issued yet (solo before Start, lobby)
 * ready    – instructions card: waiting for the player to press Start (solo / free play)
 * playing  – a run/round set is live
 * over     – finished (see the verdict); solo can Retry
 * out      – left / forfeited this match
 */
export const CLASSICS_STATUS = ['idle', 'ready', 'playing', 'over', 'out'] as const;
export type ClassicsStatus = (typeof CLASSICS_STATUS)[number];

export interface ClassicsStandingView {
  name: string;
  color: string;
  score: number;
  level: number;
  lives: number;
  stat: number;
  status: ClassicsStatus;
  /** Best verified score this room session. */
  best: number;
  runs: number;
  /** 1-based live rank among entrants (0 = unranked). */
  rank: number;
  /** Server-verified tick of the current run (verified games). */
  ticks: number;
}

export interface ClassicsMetaView {
  solo: boolean;
  /** 'solo' | 'race' | game-specific mode label. */
  mode: string;
  /** Server epoch ms when the current match's runs start (0 = not scheduled). */
  startAt: number;
  /** Server epoch ms when a timed race ends (0 = untimed). */
  endsAt: number;
  /** Increments every match. */
  matchNo: number;
  entrants: number;
  /** Label for the standings' `stat` column (e.g. "Lines"). */
  statLabel: string;
  /** High-score board of the current mode ('' = unranked). */
  board: string;
}

export interface ClassicsPublicState extends BaseRoomView {
  standings: Record<string, ClassicsStandingView>;
  classics: ClassicsMetaView;
}

// ---------------------------------------------------------------------------
// High scores (GET /api/classics/scores/:gameId?board=<key>)
// ---------------------------------------------------------------------------

export interface HighScoreEntry {
  id: string;
  name: string;
  score: number;
  level: number;
  stat: number;
  /** Epoch ms. */
  at: number;
}

export interface HighScoreBoardView {
  gameId: string;
  board: string;
  statLabel: string;
  entries: HighScoreEntry[];
}

export const BOARD_KEY_RE = /^[a-z0-9-]{1,24}$/;
