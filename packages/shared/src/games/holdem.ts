/**
 * DAS Hold'em — shared contract (settings, messages, payloads, public state shape).
 * No-limit Texas Hold'em with VIRTUAL chips only. Imported by the server room and the client.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

/** Physical seats around the table (the playable count is the room's maxPlayers, 2–10). */
export const HOLDEM_MAX_SEATS = 10;
export const HOLDEM_MIN_STACK = 1_000;
export const HOLDEM_MAX_STACK = 1_000_000;
/** Largest single amount a client may ever name (well above any reachable stack). */
export const HOLDEM_MAX_AMOUNT = 1_000_000_000;
/** Pause between hands (winners on display). */
export const HOLDEM_INTERMISSION_MS = 5_000;
/** Consecutive timeouts before a player is sat out automatically. */
export const HOLDEM_TIMEOUTS_TO_SIT_OUT = 2;
/** A disconnected player's turn is auto-played after this grace. */
export const HOLDEM_DISCONNECT_GRACE_MS = 8_000;
/** Hand-history entries kept in public state (across hands, oldest dropped first). */
export const HOLDEM_LOG_LIMIT = 160;

export const HoldemSettingsSchema = z
  .object({
    /** Virtual chips every player starts (and rebuys) with. */
    startingStack: z.number().int().min(HOLDEM_MIN_STACK).max(HOLDEM_MAX_STACK),
    smallBlind: z.number().int().min(1).max(50_000),
    bigBlind: z.number().int().min(2).max(100_000),
    /** Raise the blinds every N hands (0 = never). */
    blindIncreaseEvery: z.number().int().min(0).max(100),
    /** Percentage the blinds grow by at each level. */
    blindIncreasePct: z.number().int().min(10).max(200),
    /** Seconds each player has to act. */
    actionSeconds: z.number().int().min(10).max(60),
    /** Busted players may take a fresh (virtual) starting stack. */
    allowRebuys: z.boolean(),
    /** 'all' = every hand still live at showdown is tabled; 'winners' = losing hands are mucked face down. */
    showdownReveal: z.enum(['all', 'winners']),
  })
  .refine((s) => s.bigBlind >= s.smallBlind, { message: 'The big blind must be at least the small blind', path: ['bigBlind'] })
  .refine((s) => s.startingStack >= s.bigBlind * 10, {
    message: 'Starting stack must be at least 10 big blinds',
    path: ['startingStack'],
  });
export type HoldemSettings = z.infer<typeof HoldemSettingsSchema>;

export const DEFAULT_HOLDEM_SETTINGS: HoldemSettings = {
  startingStack: 10_000,
  smallBlind: 50,
  bigBlind: 100,
  blindIncreaseEvery: 0,
  blindIncreasePct: 50,
  actionSeconds: 25,
  allowRebuys: true,
  showdownReveal: 'all',
};

export const HOLDEM_MSG = {
  /** client → server: betting action. */
  act: 'holdem:act',
  /** client → server: take (or, in the lobby, move to) a seat. */
  sit: 'holdem:sit',
  /** client → server: sit out / come back. */
  sitOut: 'holdem:sitOut',
  /** client → server: busted player takes a fresh virtual stack. */
  rebuy: 'holdem:rebuy',
  /** client → server: voluntarily table your cards after the hand. */
  show: 'holdem:show',
  /** client → server (host): end the game and show the leaderboard. */
  end: 'holdem:end',
  /** server → one client: your private hole cards. */
  private: 'holdem:private',
  /** server → everyone: animation / sound cues. State stays the source of truth. */
  event: 'holdem:event',
} as const;

export const HOLDEM_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;
export type HoldemActionType = (typeof HOLDEM_ACTIONS)[number];

export const HoldemActSchema = z.object({
  action: z.enum(HOLDEM_ACTIONS),
  /** For bet/raise: the TOTAL you bet to on this street ("raise to"). Whole chips. */
  amount: z.number().int().min(0).max(HOLDEM_MAX_AMOUNT).optional(),
  /** The public actionSeq the client decided on; stale decisions are refused. */
  seq: z.number().int().min(0).max(0xffffffff).optional(),
});
export type HoldemActPayload = z.infer<typeof HoldemActSchema>;

export const HoldemSitSchema = z.object({ seat: z.number().int().min(0).max(HOLDEM_MAX_SEATS - 1) });
export const HoldemSitOutSchema = z.object({ sittingOut: z.boolean() });
export const HoldemEmptySchema = z.object({}).optional();

/** Private payload: only ever sent to the seat's owner. */
export interface HoldemPrivatePayload {
  handNumber: number;
  /** Your seat in this hand (-1 when you hold no cards). */
  seat: number;
  cards: string[];
}

export type HoldemStreet = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type HoldemLastAction = '' | 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'timeout';
export type HoldemSitOutReason = '' | 'self' | 'timeout' | 'away';

export type HoldemEvent =
  | { type: 'deal'; handNumber: number; seats: number[]; button: number }
  | { type: 'action'; seat: number; action: HoldemLastAction; amount: number }
  | { type: 'street'; street: HoldemStreet; cards: string[] }
  | { type: 'reveal'; seats: number[] }
  | { type: 'win'; handNumber: number; seats: number[]; amounts: number[]; uncontested: boolean };

// ---------------------------------------------------------------------------
// Public (synchronized) state as seen by clients (state.toJSON()).
// ---------------------------------------------------------------------------

export interface HoldemSeatView {
  index: number;
  /** '' = empty seat. */
  playerId: string;
  name: string;
  /** Chips behind (not counting chips already bet). */
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in during the whole hand. */
  committed: number;
  /** Dealt into the current hand. */
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  sitOutReason: HoldemSitOutReason;
  /** Holds face-down cards (render card backs; the faces are private). */
  hasCards: boolean;
  lastAction: HoldemLastAction;
  lastAmount: number;
  /** Tabled cards (showdown / voluntary show). Empty otherwise. */
  shownCards: string[];
  /** Hand description for tabled cards, e.g. "Full House, Kings over Sevens". */
  handLabel: string;
  /** Chips won in the last completed hand. */
  won: number;
  /** Total virtual buy-ins (starting stack + rebuys). */
  buyIns: number;
  rebuys: number;
  /** Out of chips. */
  busted: boolean;
  /** Seated after the hand started; dealt in next hand. */
  waiting: boolean;
  /** Left mid-hand; the seat frees up when the hand ends. */
  left: boolean;
}

export interface HoldemPotView {
  amount: number;
  /** Seat indices that can win this pot. */
  eligible: number[];
}

export interface HoldemWinnerView {
  seat: number;
  playerId: string;
  name: string;
  potIndex: number;
  amount: number;
  /** '' when the pot was won uncontested. */
  description: string;
  /** Best five cards (for highlighting), empty when not shown. */
  bestCards: string[];
}

export interface HoldemLegalView {
  /** Seat these actions belong to (-1 = nobody to act). */
  seat: number;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (already capped at the stack). */
  callAmount: number;
  canRaise: boolean;
  /** True when nothing has been bet on this street (the raise button reads "Bet"). */
  isBet: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface HoldemLogEntry {
  hand: number;
  text: string;
  kind: 'hand' | 'blind' | 'action' | 'street' | 'show' | 'win' | 'info';
}

export interface HoldemStandingView {
  playerId: string;
  name: string;
  stack: number;
  buyIns: number;
  net: number;
  rank: number;
  /** Hands in which this player won at least part of a pot. */
  handsWon: number;
  /** Largest single-hand win. */
  bestPot: number;
}

export interface HoldemPublicState extends BaseRoomView {
  /** Playable seats this game (2–10). */
  tableSize: number;
  seats: HoldemSeatView[];
  board: string[];
  /** Collected pots (main first). Bets in front of seats are not included yet. */
  pots: HoldemPotView[];
  street: HoldemStreet;
  handNumber: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  toActSeat: number;
  /** Server epoch ms when the acting player's time runs out (0 = none). */
  actionDeadline: number;
  /** Total length of the current decision's clock (ms). */
  actionMs: number;
  /** Increments on every accepted action / street change. */
  actionSeq: number;
  currentBet: number;
  minRaiseTo: number;
  smallBlind: number;
  bigBlind: number;
  blindLevel: number;
  /** Hands until the blinds go up (0 = no increases). */
  handsToNextLevel: number;
  legal: HoldemLegalView;
  winners: HoldemWinnerView[];
  log: HoldemLogEntry[];
  /** All-in: no more betting, the board is being run out. */
  runout: boolean;
  /** Short line for the table ("Waiting for players…"). */
  tableMessage: string;
  /** The host asked to end the game: it ends once the hand in progress is finished. */
  endRequested: boolean;
  standings: HoldemStandingView[];
}

/** Formats blinds "50/100" style. */
export function formatBlinds(sb: number, bb: number): string {
  const f = (n: number) => (n >= 1000 && n % 100 === 0 ? `${+(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US'));
  return `${f(sb)}/${f(bb)}`;
}
