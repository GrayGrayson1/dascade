/**
 * DAS Bingo — shared contract (settings, messages, payloads, public state).
 *
 * Content modes:
 *   numbers — classic 75-ball, 5×5 card (B 1–15 · I 16–30 · N 31–45 · G 46–60 · O 61–75)
 *   text    — custom squares drawn from a host-provided pool, square boards 3×3 … 7×7
 *
 * A "call token" is a number: the ball number (1–75) in numbers mode, or an index
 * into `settings.items` in text mode. Card cells hold call tokens; the free center is -1.
 * Winning patterns are square boolean masks serialized as '0'/'1' strings (row-major).
 */
import { z } from 'zod';
import { cleanText, maskProfanity, normalizeForCompare } from '../text.ts';
import type { BaseRoomView } from '../protocol.ts';

export const BINGO_LIMITS = {
  maxItems: 500,
  itemLength: 60,
  /** Raw pasted item length accepted before cleaning/truncation. */
  rawItemLength: 240,
  minSize: 3,
  maxSize: 7,
  maxRounds: 8,
  maxPatternsPerRound: 12,
  patternName: 28,
  prizeLabel: 40,
  seedLength: 32,
  minCallSeconds: 3,
  maxCallSeconds: 15,
  maxPenaltySeconds: 60,
  maxTieWindowMs: 5000,
  minIntermissionSeconds: 3,
  maxIntermissionSeconds: 30,
} as const;

/** Numbers mode is always the classic 75-ball 5×5 card. */
export const BINGO_NUMBER_SIZE = 5;
export const BINGO_BALLS = 75;
export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
/** Card cell value for the free center square. */
export const BINGO_FREE = -1;
/** Seconds the room waits for a claim after every ball has been called. */
export const BINGO_EXHAUSTED_GRACE_MS = 30_000;

export const BINGO_MODES = ['numbers', 'text'] as const;
export type BingoMode = (typeof BINGO_MODES)[number];

/** Built-in pattern library (resolved per board size by the engine). */
export const BINGO_PRESET_IDS = [
  'any-line',
  'any-row',
  'any-column',
  'any-diagonal',
  'two-lines',
  'four-corners',
  'postage-stamp',
  'x',
  'plus',
  'frame',
  'inner-frame',
  'center-block',
  'diamond',
  'hourglass',
  'pyramid',
  'letter-t',
  'letter-l',
  'letter-u',
  'letter-h',
  'letter-z',
  'checkerboard',
  'heart',
  'smiley',
  'blackout',
] as const;
export type BingoPresetId = (typeof BINGO_PRESET_IDS)[number];

const MASK_RE = /^[01]+$/;

/** Accept rotated / mirrored copies of a pattern. Explicit host choices; never applied silently. */
const transformFields = {
  rotate: z.boolean().default(false),
  mirror: z.boolean().default(false),
};

export const BingoPresetRefSchema = z.object({
  type: z.literal('preset'),
  id: z.enum(BINGO_PRESET_IDS),
  ...transformFields,
});

export const BingoCustomRefSchema = z
  .object({
    type: z.literal('custom'),
    name: z
      .string()
      .max(120)
      .transform((s) => maskProfanity(cleanText(s, BINGO_LIMITS.patternName)) || 'Custom pattern'),
    size: z.number().int().min(BINGO_LIMITS.minSize).max(BINGO_LIMITS.maxSize),
    mask: z.string().max(BINGO_LIMITS.maxSize * BINGO_LIMITS.maxSize).regex(MASK_RE),
    ...transformFields,
  })
  .refine((p) => p.mask.length === p.size * p.size, { message: 'Pattern mask does not match its size', path: ['mask'] })
  .refine((p) => p.mask.includes('1'), { message: 'Pattern needs at least one square', path: ['mask'] });

export const BingoPatternRefSchema = z.union([BingoPresetRefSchema, BingoCustomRefSchema]);
export type BingoPatternRef = z.infer<typeof BingoPatternRefSchema>;
export type BingoPresetRef = z.infer<typeof BingoPresetRefSchema>;
export type BingoCustomRef = z.infer<typeof BingoCustomRefSchema>;

export const BingoRoundSchema = z.object({
  /** Any one of these patterns wins the round. */
  patterns: z.array(BingoPatternRefSchema).min(1).max(BINGO_LIMITS.maxPatternsPerRound),
  prize: z
    .string()
    .max(120)
    .transform((s) => maskProfanity(cleanText(s, BINGO_LIMITS.prizeLabel))),
});
export type BingoRound = z.infer<typeof BingoRoundSchema>;

/** Dedupe key for text items (case/diacritic-insensitive, falls back for emoji-only items). */
export function bingoItemKey(item: string): string {
  return normalizeForCompare(item) || item.toLowerCase();
}

/** Clean, bound and de-duplicate custom text items (idempotent). */
export function sanitizeBingoItems(items: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = maskProfanity(cleanText(raw, BINGO_LIMITS.itemLength));
    if (!item) continue;
    const key = bingoItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= BINGO_LIMITS.maxItems) break;
  }
  return out;
}

export const BingoSettingsSchema = z.object({
  mode: z.enum(BINGO_MODES),
  /** Board size for text mode (numbers mode is always 5×5). */
  size: z.number().int().min(BINGO_LIMITS.minSize).max(BINGO_LIMITS.maxSize),
  /** Free center square (odd board sizes only). */
  freeCenter: z.boolean(),
  items: z
    .array(z.string().max(BINGO_LIMITS.rawItemLength))
    .max(BINGO_LIMITS.maxItems * 2)
    .transform((items) => sanitizeBingoItems(items)),
  /** single = only rounds[0] is played; progressive = every round in order. */
  format: z.enum(['single', 'progressive']),
  rounds: z.array(BingoRoundSchema).min(1).max(BINGO_LIMITS.maxRounds),
  callerMode: z.enum(['auto', 'manual']),
  callSeconds: z.number().int().min(BINGO_LIMITS.minCallSeconds).max(BINGO_LIMITS.maxCallSeconds),
  /** Manual caller may pick a specific ball / item (e.g. reading from a physical cage). Random draws otherwise. */
  manualPick: z.boolean(),
  /** Daub called squares automatically (otherwise players tap to daub). */
  autoMark: z.boolean(),
  /** Deal fresh cards at the start of every round. */
  newCardsEachRound: z.boolean(),
  /** Keep called balls between rounds (line → two lines → full house style). */
  continueCalls: z.boolean(),
  falseClaimPenaltySec: z.number().int().min(0).max(BINGO_LIMITS.maxPenaltySeconds),
  announceFalseClaims: z.boolean(),
  /** A player who already won a round can't win another one. */
  oneWinPerPlayer: z.boolean(),
  /** Show everyone how many squares each player still needs. */
  showProgress: z.boolean(),
  /** Valid claims within this window after the first winner share the round. */
  tieWindowMs: z.number().int().min(0).max(BINGO_LIMITS.maxTieWindowMs),
  intermissionSec: z.number().int().min(BINGO_LIMITS.minIntermissionSeconds).max(BINGO_LIMITS.maxIntermissionSeconds),
  // No card seed here: settings are public, and a known seed reveals every card. A fixed seed is
  // set privately with BINGO_MSG.setSeed (host only) and revealed on the results screen.
});
export type BingoSettings = z.infer<typeof BingoSettingsSchema>;

export const DEFAULT_BINGO_SETTINGS: BingoSettings = {
  mode: 'numbers',
  size: 5,
  freeCenter: true,
  items: [],
  format: 'single',
  rounds: [{ patterns: [{ type: 'preset', id: 'any-line', rotate: false, mirror: false }], prize: '' }],
  callerMode: 'auto',
  callSeconds: 6,
  manualPick: false,
  autoMark: true,
  newCardsEachRound: false,
  continueCalls: false,
  falseClaimPenaltySec: 10,
  announceFalseClaims: true,
  oneWinPerPlayer: false,
  showProgress: true,
  tieWindowMs: 1500,
  intermissionSec: 10,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const BINGO_MSG = {
  /** client → server: "BINGO!" (no payload; the server checks your real card against real calls). */
  claim: 'bingo:claim',
  /** client → server: daub / undaub a square (UI aid only; synced so reconnects restore it). */
  mark: 'bingo:mark',
  /** host → server: call the next ball (random) or, in manual mode, a specific one. */
  call: 'bingo:call',
  /** host → server: undo the last hand-picked call (random draws are final). */
  undo: 'bingo:undo',
  /** host → server: pause / resume the automatic caller. */
  pause: 'bingo:pause',
  /** host → server: change the automatic call interval. */
  speed: 'bingo:speed',
  /** host → server: switch between the automatic and manual caller. */
  callerMode: 'bingo:callerMode',
  /** host → server: skip the intermission. */
  nextRound: 'bingo:nextRound',
  /** host → server: end the game now and show results. */
  endGame: 'bingo:endGame',
  /** host → server (lobby): set or clear the private fixed card seed. */
  setSeed: 'bingo:setSeed',
  /** server → host only: the current private fixed card seed ('' = random every game). */
  seed: 'bingo:seed',
  /** server → one player: your card (+ marks and lockout). */
  card: 'bingo:card',
  /** server → one player: the verdict on your claim. */
  claimResult: 'bingo:claimResult',
  /** server → everyone: animation cues (winner, false alarm, undo). */
  event: 'bingo:event',
} as const;

export const BingoClaimSchema = z.object({}).optional();
export const BingoMarkSchema = z.object({
  cell: z.number().int().min(0).max(BINGO_LIMITS.maxSize * BINGO_LIMITS.maxSize - 1),
  marked: z.boolean(),
});
export const BingoCallSchema = z
  .object({
    /** Manual mode only: the exact ball / item index to call. Omit for a random draw. */
    value: z.number().int().min(0).max(Math.max(BINGO_BALLS, BINGO_LIMITS.maxItems)).optional(),
  })
  .optional();
export const BingoPauseSchema = z.object({ paused: z.boolean() });
export const BingoSpeedSchema = z.object({
  seconds: z.number().int().min(BINGO_LIMITS.minCallSeconds).max(BINGO_LIMITS.maxCallSeconds),
});
export const BingoCallerModeSchema = z.object({ mode: z.enum(['auto', 'manual']) });
export const BingoEmptySchema = z.object({}).optional();
/** Fixed card seed ('' = a fresh secret seed every game). */
export const BingoSeedSchema = z.object({
  seed: z
    .string()
    .max(120)
    .transform((s) => cleanText(s, BINGO_LIMITS.seedLength)),
});

// ---------------------------------------------------------------------------
// Payloads (server → client)
// ---------------------------------------------------------------------------

/** Sent only to the host: the fixed card seed they set (never in public state or settings). */
export interface BingoSeedPayload {
  /** The seed's value; only ever sent to the host who typed it. */
  seed: string;
  /** A fixed seed is set, but by someone else (e.g. before a host change): the value stays hidden. */
  hidden: boolean;
}

export interface BingoCardPayload {
  /** Matches state.matchId; ignore cards from a previous match. */
  matchId: string;
  /** Deal number (increments when fresh cards are dealt). */
  deal: number;
  /** Card serial within the deal (reproducible from the seed). */
  serial: number;
  size: number;
  /** Row-major call tokens; BINGO_FREE for the free center. */
  cells: number[];
  /** Daubed cell indices (restored after reconnect). */
  marks: number[];
  /**
   * Calls before this index in `state.calls` don't count on this card: it was dealt mid-round
   * (late join / rejoin as a new player), so it can't cash in balls drawn before it existed.
   * 0 for cards dealt at the start of a round.
   */
  fromCall: number;
  /** Server epoch ms until which this player can't claim (false-claim penalty). */
  lockedUntil: number;
}

export type BingoClaimReason = 'no_pattern' | 'locked' | 'no_card' | 'round_over' | 'already_won' | 'one_win' | 'spectator' | 'caller';

export interface BingoClaimResultPayload {
  ok: boolean;
  reason?: BingoClaimReason;
  message: string;
  lockedUntil?: number;
  /** When ok: the pattern that matched and the matching mask. */
  patternName?: string;
  mask?: string;
}

export type BingoEvent =
  | { kind: 'winner'; playerId: string; name: string; round: number; patternName: string; shared: boolean }
  | { kind: 'falseAlarm'; playerId: string; name: string }
  | { kind: 'undo'; token: number }
  | { kind: 'roundOver'; round: number; winners: string[]; reason: 'won' | 'exhausted' | 'ended' };

// ---------------------------------------------------------------------------
// Public state as seen by clients (state.toJSON())
// ---------------------------------------------------------------------------

export type BingoRoundStatus = 'idle' | 'calling' | 'claiming' | 'closed';

export interface BingoPlayerView {
  id: string;
  wins: number;
  falseClaims: number;
  lockedUntil: number;
  /** Squares still needed for the closest pattern (-1 = hidden / no card). */
  need: number;
  hasCard: boolean;
}

export interface BingoWinnerView {
  playerId: string;
  name: string;
  color: string;
  avatar: string;
  round: number;
  /** Number of calls made when the claim was accepted. */
  callCount: number;
  patternName: string;
  /** Matched mask ('0'/'1' string). */
  mask: string;
  /** The winner's card (revealed once the claim is verified). */
  cells: number[];
  serial: number;
  deal: number;
  prize: string;
  at: number;
}

/** A pattern resolved for the current board size, as published in state.planJson. */
export interface BingoPlanPattern {
  name: string;
  /** Every mask that satisfies this pattern (families and accepted transforms expanded). */
  masks: string[];
  family: boolean;
  rotate: boolean;
  mirror: boolean;
}

export interface BingoPlanRound {
  index: number;
  prize: string;
  /** Short summary of the pattern set ("Any line", "Four corners or Big X"). */
  title: string;
  patterns: BingoPlanPattern[];
}

export interface BingoPublicState extends BaseRoomView {
  matchId: string;
  mode: BingoMode;
  size: number;
  free: boolean;
  poolSize: number;
  totalRounds: number;
  /** JSON BingoPlanRound[] for the whole match. */
  planJson: string;
  roundStatus: BingoRoundStatus;
  calls: number[];
  lastCallAt: number;
  nextCallAt: number;
  callerMode: 'auto' | 'manual';
  manualPick: boolean;
  callIntervalMs: number;
  paused: boolean;
  canUndo: boolean;
  claimWindowEndsAt: number;
  deal: number;
  winners: BingoWinnerView[];
  bingo: Record<string, BingoPlayerView>;
  /** Revealed on the results screen. */
  seed: string;
  /** The host set a fixed card seed (its value stays private until results). */
  customSeed: boolean;
  showProgress: boolean;
  autoMark: boolean;
}
