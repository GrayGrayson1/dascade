/**
 * DASjack 21 — shared contract between the blackjack room and its client.
 *
 * Virtual chips only. All amounts are integer chips. Fractional payouts
 * (3:2 / 6:5 blackjacks on odd bets, surrender halves, insurance stakes on odd
 * bets) round DOWN in the house's favour. Even money on a natural pays exactly 1:1.
 *
 * Hidden information: the dealer's hole card and the shoe order never appear in
 * any of these types before the hole card is legally revealed.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const BLACKJACK_PAYOUTS = ['3:2', '6:5', '1:1'] as const;
export type BlackjackPayout = (typeof BLACKJACK_PAYOUTS)[number];

/** Which starting two-card hands may be doubled. 9-11 / 10-11 refer to HARD totals. */
export const DOUBLE_RULES = ['any', '9-11', '10-11'] as const;
export type DoubleRule = (typeof DOUBLE_RULES)[number];

export const BLACKJACK_LIMITS = {
  seats: 7,
  minDecks: 1,
  maxDecks: 8,
  maxHands: 4,
  minBet: 1,
  maxBet: 100_000,
  minStartingBalance: 100,
  maxStartingBalance: 1_000_000,
  minTimerSeconds: 5,
  maxTimerSeconds: 60,
  minPenetration: 50,
  maxPenetration: 90,
} as const;

export const BlackjackSettingsSchema = z
  .object({
    /** Decks in the shoe (1–8). */
    decks: z.number().int().min(BLACKJACK_LIMITS.minDecks).max(BLACKJACK_LIMITS.maxDecks),
    /** true = H17 (dealer hits soft 17), false = S17 (dealer stands on all 17s). */
    dealerHitsSoft17: z.boolean(),
    blackjackPayout: z.enum(BLACKJACK_PAYOUTS),
    doubleRule: z.enum(DOUBLE_RULES),
    /** Double after split. */
    doubleAfterSplit: z.boolean(),
    /** Maximum hands a player may hold after splitting (1 = splitting disabled). */
    maxHands: z.number().int().min(1).max(BLACKJACK_LIMITS.maxHands),
    resplitAces: z.boolean(),
    /** Split aces may take more than one card. */
    hitSplitAces: z.boolean(),
    /** Late surrender (after the dealer peeks) on the first two cards. */
    surrender: z.boolean(),
    insurance: z.boolean(),
    /** US hole-card peek: the dealer checks for blackjack under an Ace or 10-value up card. */
    dealerPeek: z.boolean(),
    minBet: z.number().int().min(BLACKJACK_LIMITS.minBet).max(BLACKJACK_LIMITS.maxBet),
    maxBet: z.number().int().min(BLACKJACK_LIMITS.minBet).max(BLACKJACK_LIMITS.maxBet),
    startingBalance: z.number().int().min(BLACKJACK_LIMITS.minStartingBalance).max(BLACKJACK_LIMITS.maxStartingBalance),
    /** Betting window once the first chip hits the felt. */
    bettingSeconds: z.number().int().min(BLACKJACK_LIMITS.minTimerSeconds).max(BLACKJACK_LIMITS.maxTimerSeconds),
    /** Per-player decision window, refreshed after each of their actions. */
    decisionSeconds: z.number().int().min(BLACKJACK_LIMITS.minTimerSeconds).max(BLACKJACK_LIMITS.maxTimerSeconds),
    /** Shoe penetration in percent: the cut card sits this deep into the shoe. */
    penetration: z.number().int().min(BLACKJACK_LIMITS.minPenetration).max(BLACKJACK_LIMITS.maxPenetration),
  })
  .refine((s) => s.maxBet >= s.minBet, { message: 'Max bet must be at least the min bet', path: ['maxBet'] })
  .refine((s) => s.startingBalance >= s.minBet, { message: 'Starting chips must cover the min bet', path: ['startingBalance'] });

export type BlackjackSettings = z.infer<typeof BlackjackSettingsSchema>;

export const DEFAULT_BLACKJACK_SETTINGS: BlackjackSettings = {
  decks: 6,
  dealerHitsSoft17: false,
  blackjackPayout: '3:2',
  doubleRule: 'any',
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  surrender: true,
  insurance: true,
  dealerPeek: true,
  minBet: 10,
  maxBet: 500,
  startingBalance: 1000,
  bettingSeconds: 15,
  decisionSeconds: 20,
  penetration: 75,
};

// ---------------------------------------------------------------------------
// Messages (client → server)
// ---------------------------------------------------------------------------

export const BLACKJACK_MSG = {
  /** Set the chips in your betting circle (absolute amount; 0 clears). */
  bet: 'blackjack:bet',
  /** Lock your bet in (or sit the round out with no bet); `locked: false` unlocks. */
  lock: 'blackjack:lock',
  /** Move to an empty seat during betting. */
  sit: 'blackjack:sit',
  /** Hit / stand / double / split / surrender on your active hand. */
  action: 'blackjack:action',
  /** Take or decline insurance (for a natural: even money, a guaranteed 1:1). */
  insurance: 'blackjack:insurance',
  /** Free virtual chip refill when you cannot cover the minimum bet. */
  refill: 'blackjack:refill',
  /** Spectator asks to be dealt in from the next round. */
  queue: 'blackjack:queue',
  /** Host ends the game after the current round → RESULTS. */
  end: 'blackjack:end',
} as const;

export const BLACKJACK_ACTIONS = ['hit', 'stand', 'double', 'split', 'surrender'] as const;
export type BlackjackAction = (typeof BLACKJACK_ACTIONS)[number];

export const BlackjackBetSchema = z.strictObject({ amount: z.number().int().min(0).max(BLACKJACK_LIMITS.maxBet) });
export const BlackjackLockSchema = z.strictObject({ locked: z.boolean() });
export const BlackjackSitSchema = z.strictObject({ seat: z.number().int().min(0).max(BLACKJACK_LIMITS.seats - 1) });
/**
 * `hand` is the index of the hand you believe is active and `seq` your seat's `actionSeq` as you saw
 * it: a stale, replayed or double-clicked action (e.g. a second "hit" on the same hand) is rejected.
 */
export const BlackjackActionSchema = z.strictObject({
  action: z.enum(BLACKJACK_ACTIONS),
  hand: z.number().int().min(0).max(BLACKJACK_LIMITS.maxHands - 1),
  seq: z.number().int().min(0).optional(),
});
export const BlackjackInsuranceSchema = z.strictObject({ take: z.boolean() });
export const BlackjackEmptySchema = z.strictObject({}).optional();

// ---------------------------------------------------------------------------
// Public state (what state.toJSON() looks like on clients)
// ---------------------------------------------------------------------------

/**
 * Table stages inside the PLAYING phase:
 * BETTING → DEALING → (INSURANCE) → (PEEK) → PLAYING → DEALER → SETTLING → (SHUFFLING) → BETTING …
 */
export const BLACKJACK_STAGES = ['IDLE', 'BETTING', 'DEALING', 'INSURANCE', 'PEEK', 'PLAYING', 'DEALER', 'SETTLING', 'SHUFFLING'] as const;
export type BlackjackStage = (typeof BLACKJACK_STAGES)[number];

export type BlackjackHandStatus = 'waiting' | 'active' | 'stood' | 'bust' | 'blackjack' | 'surrendered';
export type BlackjackHandResult = '' | 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender';
/** `offered` covers both insurance and (for a natural) even money; `even` = even money taken (paid 1:1, no stake). */
export type BlackjackInsuranceState = '' | 'offered' | 'taken' | 'declined' | 'won' | 'lost' | 'even';

export interface BlackjackHandView {
  cards: string[];
  /** Chips riding on this hand (doubled hands show the doubled amount). */
  bet: number;
  doubled: boolean;
  /** Created by a split (21 on it is not a blackjack). */
  split: boolean;
  status: BlackjackHandStatus;
  total: number;
  soft: boolean;
  /** Human label, e.g. "Soft 17", "Blackjack", "Bust". */
  label: string;
  result: BlackjackHandResult;
  /** Net chips won (+) or lost (−) on this hand after settlement. */
  net: number;
}

export interface BlackjackSeatView {
  playerId: string;
  /** Display name, kept for seats settled after their player left. */
  name: string;
  /** Seat position 0–6; 0 is first base (dealt first, on the dealer's left). */
  seat: number;
  /** Chips in front of the player (excludes chips in the betting circle / on hands). */
  balance: number;
  /** Chips in the betting circle (pending during BETTING, the original wager during a round). */
  bet: number;
  lastBet: number;
  locked: boolean;
  sittingOut: boolean;
  /** Dealt into the current round. */
  inRound: boolean;
  hands: BlackjackHandView[];
  activeHand: number;
  /** Legal actions for the active hand (server-computed). */
  actions: BlackjackAction[];
  insurance: number;
  insuranceState: BlackjackInsuranceState;
  done: boolean;
  /** Decision deadline (server epoch ms, 0 = none). */
  deadline: number;
  /** Net result of the last settled round. */
  net: number;
  refills: number;
  /** Total chips received (starting stack + refills). Net for the game = balance − bought. */
  bought: number;
  /** Player left the room; the seat is settled and cleared after this round. */
  left: boolean;
  handsPlayed: number;
  handsWon: number;
  blackjacks: number;
  biggestWin: number;
  /** Bumps on every accepted decision and each new round; send it with `action` (stale ones are rejected). */
  actionSeq: number;
}

export interface BlackjackDealerView {
  /** Face-up cards only. Before the reveal this is just the up card. */
  cards: string[];
  /** A face-down hole card is on the table (its identity is server-only until revealed). */
  hasHole: boolean;
  revealed: boolean;
  /** Total of the VISIBLE cards. */
  total: number;
  soft: boolean;
  label: string;
  blackjack: boolean;
  bust: boolean;
  /** The dealer has peeked and does not have blackjack. */
  peeked: boolean;
}

/** Rules in effect for the current (or next) round. Settings edits mid-game apply between rounds. */
export type BlackjackTableRules = BlackjackSettings;

export interface BlackjackPublicState extends BaseRoomView {
  stage: BlackjackStage;
  seats: Record<string, BlackjackSeatView>;
  dealer: BlackjackDealerView;
  /** JSON of BlackjackTableRules for the current/next round. */
  rulesJson: string;
  shoeSize: number;
  shoeRemaining: number;
  /** Cards remaining in the shoe when the cut card comes out. */
  cutRemaining: number;
  discards: number;
  /** The cut card has come out — the shoe is reshuffled before the next round. */
  cutReached: boolean;
  shuffles: number;
  /** Host asked to end the game after this round. */
  endRequested: boolean;
  /** "No more bets" was called during BETTING: bets, locks and seat moves are refused until the deal. */
  betsClosed: boolean;
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by client and server
// ---------------------------------------------------------------------------

export function payoutText(payout: BlackjackPayout): string {
  const [a, b] = payout.split(':');
  return `${a} to ${b}`;
}

/** The printed arc on the felt, reflecting the actual rules. */
export function tableArcText(rules: Pick<BlackjackSettings, 'blackjackPayout' | 'dealerHitsSoft17'>): string {
  return `BLACKJACK PAYS ${payoutText(rules.blackjackPayout)} · DEALER ${rules.dealerHitsSoft17 ? 'HITS' : 'STANDS ON'} SOFT 17`;
}
