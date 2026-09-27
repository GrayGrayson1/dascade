/**
 * DASino — shared contract between the casino-floor room and its client.
 *
 * One room hosts three tables: European roulette (shared rounds), the "Neon 7s"
 * slot machine (per-player spins) and Dice High/Low (shared rounds). Every
 * player has one virtual chip balance used at all three tables.
 *
 * VIRTUAL CHIPS ONLY. There is no real-money wagering, no purchases of chips,
 * no deposits, withdrawals, cash-out, crypto or external gambling integration.
 * Free refills are purely virtual and only restore the starting balance.
 *
 * Nothing in DASino is hidden information: bets are public (it's social) and
 * outcomes are decided and settled by the server before clients animate them.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DASINO_LIMITS = {
  minStartingBalance: 100,
  maxStartingBalance: 1_000_000,
  minBet: 1,
  maxBet: 100_000,
  minBettingSeconds: 5,
  maxBettingSeconds: 60,
  /** Distinct roulette spots one player may cover in a round. */
  maxRouletteSpots: 40,
  /** Largest single chip amount accepted in a bet message. */
  maxChip: 100_000,
  /** Largest slot line bet. */
  maxLineBet: 20_000,
  tickerSize: 12,
  historySize: 20,
} as const;

export const DasinoSettingsSchema = z
  .object({
    /** Chips every player starts with (and is refilled to). */
    startingBalance: z.number().int().min(DASINO_LIMITS.minStartingBalance).max(DASINO_LIMITS.maxStartingBalance),
    /** Smallest chip that may be placed / smallest slot total bet. */
    minBet: z.number().int().min(DASINO_LIMITS.minBet).max(DASINO_LIMITS.maxBet),
    /** Largest total on one bet spot / largest slot total bet. */
    maxBet: z.number().int().min(DASINO_LIMITS.minBet).max(DASINO_LIMITS.maxBet),
    /** Roulette betting window in seconds. */
    rouletteBettingSeconds: z.number().int().min(DASINO_LIMITS.minBettingSeconds).max(DASINO_LIMITS.maxBettingSeconds),
    /** Dice betting window in seconds. */
    diceBettingSeconds: z.number().int().min(DASINO_LIMITS.minBettingSeconds).max(DASINO_LIMITS.maxBettingSeconds),
    /** Free (virtual) top-up to the starting balance when a player drops below the min bet. */
    allowRefills: z.boolean(),
  })
  .refine((s) => s.maxBet >= s.minBet, { message: 'Max bet must be at least the min bet', path: ['maxBet'] })
  .refine((s) => s.startingBalance >= s.minBet, { message: 'Starting chips must cover the min bet', path: ['startingBalance'] });

export type DasinoSettings = z.infer<typeof DasinoSettingsSchema>;

export const DEFAULT_DASINO_SETTINGS: DasinoSettings = {
  startingBalance: 10_000,
  minBet: 5,
  maxBet: 5_000,
  rouletteBettingSeconds: 15,
  diceBettingSeconds: 12,
  allowRefills: true,
};

// ---------------------------------------------------------------------------
// Timing (shared so the client animations line up with server settlement)
// ---------------------------------------------------------------------------

export const DASINO_TIMING = {
  /** "No more bets" pause between the betting window and the spin. */
  rouletteClosedMs: 1_500,
  /** Wheel + ball animation. Bets settle when it ends. */
  rouletteSpinMs: 7_500,
  /** Result display before the next betting window. */
  rouletteResultMs: 5_000,
  /** Dice tumble animation. Bets settle when it ends. */
  diceRollMs: 2_400,
  /** Result display before the next round. */
  diceResultMs: 3_600,
  /**
   * The server's one-spin-in-flight lock per player. Clients animate the reels
   * for at least ~1.8s after the click, so an honest client never hits the lock.
   */
  slotSpinMs: 1_600,
  /** When a slot big win appears on the public ticker (after the spinner's reels stop). */
  slotRevealMs: 2_200,
} as const;

export type DasinoTiming = { -readonly [K in keyof typeof DASINO_TIMING]: number };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const DASINO_MSG = {
  /** client → server: walk to a table. */
  table: 'dasino:table',
  /** client → server: place chips on a roulette spot. */
  rouletteBet: 'dasino:rouletteBet',
  /** client → server: place chips on a dice pick. */
  diceBet: 'dasino:diceBet',
  /** client → server: undo my last chip placement at a table. */
  undo: 'dasino:undo',
  /** client → server: take back all my bets at a table (betting window only). */
  clear: 'dasino:clear',
  /** client → server: repeat my bets from the last settled round. */
  rebet: 'dasino:rebet',
  /** client → server: double every bet I have at a table. */
  double: 'dasino:double',
  /** client → server: spin the slot machine. */
  spin: 'dasino:spin',
  /** client → server: free virtual top-up (only when below the min bet). */
  refill: 'dasino:refill',
  /** client → server: a spectator takes a free seat mid-session (a returning guest keeps their chips). */
  sit: 'dasino:sit',
  /** client → server (host): close the floor and show the leaderboard. */
  endSession: 'dasino:endSession',

  /** server → one client: my slot spin result (already settled). */
  slotResult: 'dasino:slotResult',
  /** server → one client: my private view (last slot result, rebet slips). */
  private: 'dasino:private',
  /** server → all: the wheel is spinning toward this number. */
  rouletteSpin: 'dasino:rouletteSpin',
  /** server → all: roulette round settled. */
  rouletteSettled: 'dasino:rouletteSettled',
  /** server → all: the dice are rolling to this result. */
  diceRoll: 'dasino:diceRoll',
  /** server → all: dice round settled. */
  diceSettled: 'dasino:diceSettled',
  /** server → all: a big win for the ticker / celebration. */
  bigWin: 'dasino:bigWin',
} as const;

export const DASINO_TABLES = ['floor', 'roulette', 'slots', 'dice'] as const;
export type DasinoTable = (typeof DASINO_TABLES)[number];

export const BET_TABLES = ['roulette', 'dice'] as const;
export type BetTable = (typeof BET_TABLES)[number];

export const DASINO_DICE_PICKS = ['higher', 'same', 'lower'] as const;
export type DasinoDicePick = (typeof DASINO_DICE_PICKS)[number];

const chip = z.number().int().min(1).max(DASINO_LIMITS.maxChip);

export const DasinoTableSchema = z.strictObject({ table: z.enum(DASINO_TABLES) });
/** Spot keys are validated against the engine's full bet map on the server. */
export const RouletteBetSchema = z.strictObject({
  spot: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z]+(:\d{1,2}(-\d{1,2}){0,5})?$/),
  amount: chip,
});
export const DiceBetSchema = z.strictObject({ pick: z.enum(DASINO_DICE_PICKS), amount: chip });
export const BetTableSchema = z.strictObject({ table: z.enum(BET_TABLES) });
export const SlotSpinSchema = z.strictObject({
  lineBet: z.number().int().min(1).max(DASINO_LIMITS.maxLineBet),
  lines: z.union([z.literal(1), z.literal(3), z.literal(5)]),
});
export const DasinoEmptySchema = z.strictObject({}).optional();

// ---------------------------------------------------------------------------
// Public state (state.toJSON())
// ---------------------------------------------------------------------------

export interface DasinoSeatView {
  id: string;
  /** Chips available to bet. */
  balance: number;
  /** Chips currently on the roulette/dice felt (already deducted from balance). */
  inPlay: number;
  /** Starting balance plus every refill. Net result = balance + inPlay − credited. */
  credited: number;
  refills: number;
  table: DasinoTable;
  /** Total chips wagered this session. */
  wagered: number;
  /** Total chips paid back this session. */
  returned: number;
  /** Largest single-round profit this session. */
  biggestWin: number;
  /** Slot spins this session. */
  spins: number;
}

export type RoulettePhase = 'IDLE' | 'BETTING' | 'CLOSED' | 'SPINNING' | 'RESULT';

export interface RouletteBetView {
  playerId: string;
  spot: string;
  amount: number;
}

export interface RoundPayoutView {
  playerId: string;
  staked: number;
  returned: number;
}

export interface RouletteTableView {
  phase: RoulettePhase;
  round: number;
  /** Server epoch ms when the current roulette phase ends. */
  endsAt: number;
  /** Winning number of the current/last spin (−1 before the first spin). */
  result: number;
  /** Server epoch ms the wheel animation started. */
  spinStartAt: number;
  spinMs: number;
  /** Cosmetic seed (ball launch angle / travel), identical on every client. */
  spinSeed: number;
  bets: RouletteBetView[];
  /** Most recent result last. */
  history: number[];
  /** Per-player totals of the last settled round. */
  payouts: RoundPayoutView[];
}

export type DicePhase = 'IDLE' | 'BETTING' | 'ROLLING' | 'RESULT';

export interface DiceBetView {
  playerId: string;
  pick: DasinoDicePick;
  amount: number;
}

export interface DiceHistoryView {
  round: number;
  point: number;
  a: number;
  b: number;
  outcome: DasinoDicePick;
}

export interface DiceTableView {
  phase: DicePhase;
  round: number;
  endsAt: number;
  /** The point dice (their total is the point). */
  pointA: number;
  pointB: number;
  /** The roll dice (0 until the roll starts). */
  rollA: number;
  rollB: number;
  rollStartAt: number;
  rollMs: number;
  bets: DiceBetView[];
  history: DiceHistoryView[];
  payouts: RoundPayoutView[];
}

export type DasinoGame = 'roulette' | 'slots' | 'dice';

export interface DasinoTickerView {
  id: string;
  playerId: string;
  name: string;
  game: DasinoGame;
  /** Profit in chips. */
  amount: number;
  /** Return ÷ stake. */
  multiple: number;
  /** Short description, e.g. "17 straight up" or "DAS · DAS · DAS". */
  label: string;
  at: number;
}

/** Final leaderboard row (written when the host closes the floor). */
export interface DasinoResultView {
  playerId: string;
  name: string;
  avatar: string;
  color: string;
  placement: number;
  /** Net session result (balance − starting chips − refills). */
  net: number;
  balance: number;
  wagered: number;
  biggestWin: number;
  refills: number;
}

export interface DasinoPublicState extends BaseRoomView {
  seats: Record<string, DasinoSeatView>;
  roulette: RouletteTableView;
  dice: DiceTableView;
  ticker: DasinoTickerView[];
  results: DasinoResultView[];
}

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

export interface SlotLineWinPayload {
  line: number;
  symbol: string;
  count: number;
  multiplier: number;
  pay: number;
  cells: Array<[number, number]>;
}

export interface SlotResultPayload {
  /** Per-player spin counter. */
  id: number;
  stops: [number, number, number];
  lines: number;
  lineBet: number;
  totalBet: number;
  wins: SlotLineWinPayload[];
  totalWin: number;
  /** Balance after the spin settled (server truth). */
  balance: number;
  /** Server epoch ms when the spin was decided. */
  at: number;
}

export interface BetSlipEntry {
  spot: string;
  amount: number;
}

export interface DasinoPrivatePayload {
  lastSlot: SlotResultPayload | null;
  /** My roulette bets from the last round I played (for Rebet). */
  lastRoulette: BetSlipEntry[];
  /** My dice bets from the last round I played (for Rebet). */
  lastDice: Array<{ pick: DasinoDicePick; amount: number }>;
}

export interface RouletteSpinPayload {
  round: number;
  result: number;
  startAt: number;
  durationMs: number;
  seed: number;
}

export interface RouletteSettledPayload {
  round: number;
  result: number;
  payouts: RoundPayoutView[];
}

export interface DiceRollPayload {
  round: number;
  point: number;
  a: number;
  b: number;
  startAt: number;
  durationMs: number;
}

export interface DiceSettledPayload {
  round: number;
  point: number;
  total: number;
  outcome: DasinoDicePick;
  payouts: RoundPayoutView[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Net session result for a seat (positive = up on the session). */
export function seatNet(seat: Pick<DasinoSeatView, 'balance' | 'inPlay' | 'credited'>): number {
  return seat.balance + seat.inPlay - seat.credited;
}

/** Chip denominations offered at the table for the current limits. */
export const DASINO_CHIPS = [1, 5, 25, 100, 500, 1_000, 5_000, 25_000] as const;

export function tableChips(settings: Pick<DasinoSettings, 'minBet' | 'maxBet'>): number[] {
  const chips = DASINO_CHIPS.filter((c) => c >= settings.minBet && c <= settings.maxBet);
  return chips.length ? chips : [settings.minBet];
}

/** Slot line-bet steps offered for the current limits and line count. */
export const SLOT_LINE_BETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 20_000] as const;

export function slotLineBets(settings: Pick<DasinoSettings, 'minBet' | 'maxBet'>, lines: number): number[] {
  const steps: number[] = SLOT_LINE_BETS.filter((b) => b * lines >= settings.minBet && b * lines <= settings.maxBet);
  // Always offer the table minimum, even when it isn't one of the preset steps (e.g. min = max = 7).
  const least = Math.max(1, Math.ceil(settings.minBet / lines));
  if (least <= DASINO_LIMITS.maxLineBet && least * lines <= settings.maxBet && !steps.includes(least)) steps.unshift(least);
  return steps;
}
