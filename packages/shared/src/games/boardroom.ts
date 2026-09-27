/**
 * DAS Boardroom kit — shared contract for two-player, turn-based board games (chess, checkers…).
 *
 * Server rooms extend `BoardGameRoom` (apps/game-server/src/rooms/boardroom); clients render with
 * the `_boardroom` kit (apps/web/src/games/_boardroom). This file holds everything both sides need:
 * sides, time controls (clock presets), the common lobby settings, message names/payloads and the
 * public state shape the kit synchronizes.
 *
 * Sides are generic: 'first' moves first (White in chess, Dark in checkers), 'second' replies.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

export const BOARD_SIDES = ['first', 'second'] as const;
export type BoardSide = (typeof BOARD_SIDES)[number];

export function otherSide(side: BoardSide): BoardSide {
  return side === 'first' ? 'second' : 'first';
}

// ---------------------------------------------------------------------------
// Time controls
// ---------------------------------------------------------------------------

/** Largest custom base time (minutes) and increment (seconds). */
export const CLOCK_MAX_BASE_MINUTES = 180;
export const CLOCK_MAX_INCREMENT_SECONDS = 60;

/** `baseMinutes: 0` = untimed (the increment is ignored). */
export const TimeControlSchema = z.object({
  baseMinutes: z.number().int().min(0).max(CLOCK_MAX_BASE_MINUTES),
  incrementSeconds: z.number().int().min(0).max(CLOCK_MAX_INCREMENT_SECONDS),
});
export type TimeControl = z.infer<typeof TimeControlSchema>;

export type ClockCategory = 'untimed' | 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface ClockPreset extends TimeControl {
  /** Stable id, e.g. '3+2' ('untimed' for no clock). */
  id: string;
  /** Short label for chips/buttons: "3+2", "Untimed". */
  label: string;
  category: ClockCategory;
}

/** The standard presets offered in lobbies and the Tournament Center (in display order). */
export const CLOCK_PRESETS: readonly ClockPreset[] = [
  { id: 'untimed', label: 'Untimed', baseMinutes: 0, incrementSeconds: 0, category: 'untimed' },
  { id: '1+0', label: '1+0', baseMinutes: 1, incrementSeconds: 0, category: 'bullet' },
  { id: '3+0', label: '3+0', baseMinutes: 3, incrementSeconds: 0, category: 'blitz' },
  { id: '3+2', label: '3+2', baseMinutes: 3, incrementSeconds: 2, category: 'blitz' },
  { id: '5+0', label: '5+0', baseMinutes: 5, incrementSeconds: 0, category: 'blitz' },
  { id: '10+0', label: '10+0', baseMinutes: 10, incrementSeconds: 0, category: 'rapid' },
  { id: '10+5', label: '10+5', baseMinutes: 10, incrementSeconds: 5, category: 'rapid' },
  { id: '15+10', label: '15+10', baseMinutes: 15, incrementSeconds: 10, category: 'rapid' },
] as const;

/** Estimated game duration (base + 40 × increment, in minutes) → category, like the major sites. */
export function clockCategory(tc: TimeControl): ClockCategory {
  if (tc.baseMinutes <= 0) return 'untimed';
  const estimate = tc.baseMinutes + (40 * tc.incrementSeconds) / 60;
  if (estimate < 3) return 'bullet';
  if (estimate < 8) return 'blitz';
  if (estimate < 25) return 'rapid';
  return 'classical';
}

/** The preset matching a time control, or null for a custom one. */
export function presetFor(tc: TimeControl): ClockPreset | null {
  if (tc.baseMinutes <= 0) return CLOCK_PRESETS[0] ?? null;
  return CLOCK_PRESETS.find((p) => p.baseMinutes === tc.baseMinutes && p.incrementSeconds === tc.incrementSeconds) ?? null;
}

/** "3+2", "Untimed", "45+15". */
export function timeControlLabel(tc: TimeControl): string {
  return tc.baseMinutes <= 0 ? 'Untimed' : `${tc.baseMinutes}+${tc.incrementSeconds}`;
}

/** PGN TimeControl tag: "300+2" (seconds), "-" when untimed. */
export function timeControlPgn(tc: TimeControl): string {
  return tc.baseMinutes <= 0 ? '-' : `${tc.baseMinutes * 60}+${tc.incrementSeconds}`;
}

// ---------------------------------------------------------------------------
// Common lobby settings (spread into each game's settings schema)
// ---------------------------------------------------------------------------

export const SIDE_MODES = ['random', 'host_first', 'host_second'] as const;
export type SideMode = (typeof SIDE_MODES)[number];

/**
 * Settings every board game shares. Build your schema with
 * `z.object({ ...BOARD_SETTINGS_SHAPE, myOption: z.boolean() })` and your defaults with
 * `{ ...DEFAULT_BOARD_SETTINGS, myOption: true }`.
 */
export const BOARD_SETTINGS_SHAPE = {
  timeControl: TimeControlSchema,
  /** Who plays the first side in a casual room (tournaments decide sides themselves). */
  sides: z.enum(SIDE_MODES),
  /** Casual rooms: the game changes DASCADE ratings (tournament matches are always rated). */
  rated: z.boolean(),
  /** Casual, unrated games: players may ask to take back a move (the opponent must accept). */
  allowUndo: z.boolean(),
} as const;

export const BoardSettingsSchema = z.object(BOARD_SETTINGS_SHAPE);
export type BoardSettings = z.infer<typeof BoardSettingsSchema>;

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  timeControl: { baseMinutes: 10, incrementSeconds: 5 },
  sides: 'random',
  rated: false,
  allowUndo: true,
};

// ---------------------------------------------------------------------------
// Messages (each game prefixes them with its id: `chess:resign`, `checkers:draw`…)
// ---------------------------------------------------------------------------

export const BOARD_ACTIONS = {
  /** client → server: resign the current game. */
  resign: 'resign',
  /** client → server: draw offer ({ action }). */
  draw: 'draw',
  /** client → server: take-back request ({ action }). */
  undo: 'undo',
  /** client → server: rematch vote in RESULTS ({ action }). */
  rematch: 'rematch',
  /** client → server: claim the win in an untimed game after the opponent stopped moving ({}). */
  claim: 'claim',
  /** server → everyone: kit events (offers, undo, flag, end) for toasts/sounds. */
  event: 'boardEvent',
} as const;

/** `boardMsg('chess', 'resign')` → 'chess:resign'. */
export function boardMsg(gameId: string, action: keyof typeof BOARD_ACTIONS): string {
  return `${gameId}:${BOARD_ACTIONS[action]}`;
}

export const OFFER_ACTIONS = ['offer', 'accept', 'decline', 'cancel'] as const;
export type OfferAction = (typeof OFFER_ACTIONS)[number];
export const BoardOfferSchema = z.object({ action: z.enum(OFFER_ACTIONS) });
export type BoardOfferPayload = z.infer<typeof BoardOfferSchema>;
export const BoardEmptySchema = z.object({}).strict().optional();

export type BoardOfferKind = 'draw' | 'undo' | 'rematch';

/**
 * Untimed games have no clock, so an idle rule keeps a silent opponent from stalling the room:
 * once the side to move has not moved for UNTIMED_CLAIM_MS the waiting player may claim the win;
 * after UNTIMED_FORFEIT_MS without a move the idle side forfeits automatically.
 */
export const UNTIMED_CLAIM_MS = 5 * 60_000;
export const UNTIMED_FORFEIT_MS = 20 * 60_000;

export type BoardEvent =
  | { type: 'offer'; kind: BoardOfferKind; side: BoardSide; action: OfferAction | 'expired' }
  | { type: 'undo'; plies: number; ply: number }
  | { type: 'flag'; side: BoardSide }
  | { type: 'end'; winner: BoardSide | 'draw'; reason: string; text: string }
  | { type: 'rematch'; gameNumber: number };

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Kit-level end reasons (games add their own, e.g. 'checkmate', 'stalemate', 'no_moves'). */
export const BOARD_REASONS = {
  resign: 'resign',
  timeout: 'timeout',
  /** Flag fell but the winner could not possibly win (e.g. lone king in chess). */
  timeoutInsufficient: 'timeout_insufficient',
  agreement: 'agreement',
  /** Disconnected longer than the reconnect grace period. */
  abandoned: 'abandoned',
  /** Untimed game: the side to move stopped moving (claimed by the opponent, or the hard limit passed). */
  idle: 'idle',
  /** Left the room (or was removed) mid-game. */
  forfeit: 'forfeit',
} as const;

// ---------------------------------------------------------------------------
// Public state (what state.toJSON() looks like for every board game)
// ---------------------------------------------------------------------------

export interface BoardSeatView {
  side: BoardSide;
  /** '' before the first game starts. */
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  /** DASCADE rating at the start of the game (an internal rating — not FIDE/USCF). */
  rating: number;
  ratingGames: number;
  provisional: boolean;
  /** Rating change after a rated game (0 otherwise). */
  ratingDelta: number;
  /** Server epoch ms when a disconnected player forfeits by abandonment (0 = connected). */
  awayDeadline: number;
}

export interface BoardClockView {
  /** false = untimed game. */
  enabled: boolean;
  baseMs: number;
  incrementMs: number;
  /** Remaining time of each side as of `turnStartedAt` (the running side keeps losing time after it). */
  firstMs: number;
  secondMs: number;
  /** Side whose clock is running ('' = stopped). */
  running: '' | BoardSide;
  /** Server epoch ms when the running clock (re)started. Compare with serverNow(). */
  turnStartedAt: number;
  /** Side that ran out of time. */
  flagged: '' | BoardSide;
}

export interface BoardOffersView {
  /** Side with a pending draw offer ('' = none). */
  drawBy: '' | BoardSide;
  /** Side with a pending take-back request. */
  undoBy: '' | BoardSide;
  /** Plies the pending take-back would undo (1 or 2). */
  undoPlies: number;
  /** Sides that asked for a rematch (RESULTS phase). */
  rematch: BoardSide[];
}

export interface BoardResultView {
  over: boolean;
  /** '' while playing. */
  winner: '' | BoardSide | 'draw';
  reason: string;
  /** Human sentence, e.g. "White wins by checkmate". */
  text: string;
}

export interface BoardRoomView extends BaseRoomView {
  /** Always two entries: [first, second]. */
  seats: BoardSeatView[];
  turn: BoardSide;
  /** Completed turns in this game (a checkers multi-jump is one turn). Move payloads echo it. */
  ply: number;
  clock: BoardClockView;
  offers: BoardOffersView;
  result: BoardResultView;
  /** This game changes DASCADE ratings. */
  rated: boolean;
  /** Take-backs are possible in this game (casual + unrated + enabled). */
  undoAllowed: boolean;
  /** Draw offers are possible in this game. */
  drawOffersAllowed: boolean;
  /** Games started in this room (rematches included). */
  gameNumber: number;
  /** Server epoch ms when the current turn began (timed and untimed games; 0 when not playing). */
  turnSince: number;
  /** Untimed games: server epoch ms from which the waiting player may claim the win (0 = not applicable). */
  idleClaimAt: number;
  /** Untimed games: server epoch ms when the idle side forfeits automatically (0 = not applicable). */
  idleForfeitAt: number;
}

/** Live remaining time for a side at `now` (server epoch ms). */
export function clockRemaining(clock: BoardClockView, side: BoardSide, now: number): number {
  const base = side === 'first' ? clock.firstMs : clock.secondMs;
  if (!clock.enabled) return base;
  if (clock.running !== side) return Math.max(0, base);
  return Math.max(0, base - Math.max(0, now - clock.turnStartedAt));
}
