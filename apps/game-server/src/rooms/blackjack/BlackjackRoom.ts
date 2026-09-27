/**
 * DASjack 21 — authoritative multiplayer blackjack against the house (virtual chips only).
 *
 * Round flow inside the PLAYING phase (the `stage` field):
 *   BETTING  — chips go in the circle; the window opens when the first chip lands and
 *              closes early once every connected seat has locked a bet or sat out.
 *   DEALING  — two passes from first base; the dealer's hole card is NOT in state.
 *   INSURANCE— only under an Ace (when enabled); short window, undecided = declined.
 *   PEEK     — US peek under an Ace / 10 (when enabled). A dealer natural ends the round.
 *   PLAYING  — every seat decides SIMULTANEOUSLY on its own hands with its own timer
 *              (refreshed on each of its actions); timeouts / away players stand.
 *   DEALER   — hole card revealed, draws to H17/S17.
 *   SETTLING — per-hand results and payouts, then (SHUFFLING if the cut card came out) → BETTING.
 *
 * The house's secrets (hole card, shoe order) live only in BlackjackRound / Shoe.
 */
import type { ArraySchema } from '@colyseus/schema';
import { RATE, formatChips } from '@dascade/shared';
import {
  BLACKJACK_LIMITS,
  BLACKJACK_MSG,
  BlackjackActionSchema,
  BlackjackBetSchema,
  BlackjackEmptySchema,
  BlackjackInsuranceSchema,
  BlackjackLockSchema,
  BlackjackSettingsSchema,
  BlackjackSitSchema,
  DEFAULT_BLACKJACK_SETTINGS,
  type BlackjackSettings,
  type BlackjackStage,
} from '@dascade/shared/games/blackjack';
import {
  BlackjackRound,
  Shoe,
  dealerPeeksWith,
  handLabel,
  handValue,
  isNatural,
  upCardLabel,
  type DealStep,
  type RoundHand,
  type RoundSeat,
  type TableRules,
} from '@dascade/game-core/blackjack';
import { cardToCode, type Card } from '@dascade/game-core/cards';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted, withLeaversLast } from '../outcomePlacements.ts';
import { log } from '../../lib/log.ts';
import { BjHand, BjSeat, BlackjackState } from './schema.ts';
import { readTestHooks, type BlackjackTestHooks } from './testHooks.ts';

/** Seats fill from the middle of the arc outwards (0 = first base, 6 = third base). */
const SEAT_PREFERENCE = [3, 2, 4, 1, 5, 0, 6] as const;

/** Animation pacing (ms). Scaled by DASCADE_BJ_PACE outside production (tests); see testHooks.ts. */
const PACE = {
  noMoreBets: 700,
  dealStep: 340,
  afterDeal: 450,
  peek: 1300,
  afterInsurance: 450,
  reveal: 850,
  dealerDraw: 800,
  beforeSettle: 650,
  settle: 5200,
  shuffle: 2000,
  afterDecisions: 450,
  /** Decision clock of a player who dropped (still in their reconnect grace): capped to this. */
  disconnectDecision: 8000,
} as const;
type PaceKey = keyof typeof PACE;

/** Stacks kept for players who left mid-game, keyed by their browser's guest id (bounded). */
const MAX_BANKED_STACKS = 64;

interface BankedStack {
  balance: number;
  bought: number;
  refills: number;
  lastBet: number;
  handsPlayed: number;
  handsWon: number;
  blackjacks: number;
  biggestWin: number;
}

const code = (c: Card) => cardToCode(c);

function toTableRules(s: BlackjackSettings): TableRules {
  return {
    decks: s.decks,
    dealerHitsSoft17: s.dealerHitsSoft17,
    blackjackPayout: s.blackjackPayout,
    doubleRule: s.doubleRule,
    doubleAfterSplit: s.doubleAfterSplit,
    maxHands: s.maxHands,
    resplitAces: s.resplitAces,
    hitSplitAces: s.hitSplitAces,
    surrender: s.surrender,
    insurance: s.insurance,
    dealerPeek: s.dealerPeek,
  };
}

/** Make a primitive ArraySchema equal `next` with minimal operations (append-only when possible). */
function syncStrings(arr: ArraySchema<string>, next: readonly string[]): void {
  let prefix = arr.length <= next.length;
  if (prefix) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== next[i]) {
        prefix = false;
        break;
      }
    }
  }
  if (!prefix) {
    arr.clear();
    for (const v of next) arr.push(v);
    return;
  }
  for (let i = arr.length; i < next.length; i++) arr.push(next[i]!);
}

export class BlackjackRoom extends BaseGameRoom<BlackjackState, BlackjackSettings> {
  readonly gameId = 'blackjack' as const;
  protected readonly settingsSchema = BlackjackSettingsSchema;
  override settingsEditablePhases = ['LOBBY', 'PLAYING'] as const;

  /** Rules in effect for the current / next round (settings edits apply between rounds). */
  protected tableRules: BlackjackSettings = structuredClone(DEFAULT_BLACKJACK_SETTINGS);
  protected shoe: Shoe | null = null;
  protected round: BlackjackRound | null = null;
  /** Environment test hooks (inert in production; see testHooks.ts). */
  protected hooks: BlackjackTestHooks = { pace: 1, stacking: false, stacks: [] };
  /** Test/development only: per-round cards to stack on top of the shoe (tests / visual QA). */
  protected testStacks: string[][] = [];
  private pace = 1;
  private rulesDirty = false;
  private readonly decisionTimers = new Set<string>();
  /** Each deciding seat's full deadline (a dropped player's clock is cut short; coming back restores it). */
  private readonly decisionDeadlines = new Map<string, number>();
  /** Guest ids of seated players who left while their seat was still being settled. */
  private readonly leftGuests = new Map<string, string>();
  /** Stacks of players who left, restored if the same browser sits down again this game. */
  private readonly bank = new Map<string, BankedStack>();

  protected defaultSettings(): BlackjackSettings {
    return structuredClone(DEFAULT_BLACKJACK_SETTINGS);
  }

  protected createState(): BlackjackState {
    return new BlackjackState();
  }

  private get stage(): BlackjackStage {
    return this.state.stage as BlackjackStage;
  }

  private setStage(stage: BlackjackStage, status: string, timerMs = 0): void {
    this.state.stage = stage;
    this.state.statusText = status;
    this.setTimer(timerMs);
  }

  private ms(key: PaceKey): number {
    return Math.round(PACE[key] * this.pace);
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  protected override onRoomCreated(): void {
    this.hooks = readTestHooks(process.env);
    this.pace = this.hooks.pace;
    this.testStacks = this.hooks.stacks.map((r) => [...r]);
    if (this.testStacks.length > 0) log.warn('DASjack test shoe stacking is active (test/development only)', { rounds: this.testStacks.length });
    if (this.isSolo) this.countdownMs = 0;
    else if (this.pace !== 1) this.countdownMs = Math.round(this.countdownMs * this.pace);
    this.applyRules();

    const phases = ['PLAYING'] as const;
    this.handle(BLACKJACK_MSG.bet, BlackjackBetSchema, (p, { amount }) => this.onBet(p, amount), {
      phases,
      playersOnly: true,
      rate: { burst: 24, perSecond: 12 },
    });
    this.handle(BLACKJACK_MSG.lock, BlackjackLockSchema, (p, { locked }) => this.onLock(p, locked), { phases, playersOnly: true });
    this.handle(BLACKJACK_MSG.sit, BlackjackSitSchema, (p, { seat }) => this.onSit(p, seat), { phases, playersOnly: true });
    this.handle(BLACKJACK_MSG.action, BlackjackActionSchema, (p, { action, hand, seq }) => this.onAction(p, action, hand, seq), {
      phases,
      playersOnly: true,
      rate: { burst: 10, perSecond: 6 },
    });
    this.handle(BLACKJACK_MSG.insurance, BlackjackInsuranceSchema, (p, { take }) => this.onInsurance(p, take), { phases, playersOnly: true });
    this.handle(BLACKJACK_MSG.refill, BlackjackEmptySchema, (p) => this.onRefill(p), { phases, playersOnly: true, rate: RATE.heavy });
    this.handle(BLACKJACK_MSG.queue, BlackjackEmptySchema, (p) => this.onQueue(p), { phases });
    this.handle(BLACKJACK_MSG.end, BlackjackEmptySchema, () => this.onEndRequest(), { phases, hostOnly: true });
  }

  /**
   * The closing leaderboard ranks chips, and a removed player drops to the bottom of it — so while
   * the table runs, the host can't remove anyone who still has chips at it (e.g. the chip leader
   * right before closing the table). Moderation works as usual before and after the game.
   */
  protected override kickBlocker(target: PlayerRecord): string | null {
    if (this.phase !== 'PLAYING') return null;
    const seat = this.state.seats.get(target.id);
    if (!seat || seat.left) return null;
    if (seat.balance + seat.bet > 0 || this.round?.seat(target.id)) return 'Players with chips at the table can’t be removed mid-game — end the game first.';
    return null;
  }

  /**
   * "Back to lobby" / "Close room" mid-game closes the table properly first, so the session is still
   * reported. A round in play is never voided for it: the table closes once that round is settled
   * (as with "End game"), and the host is told to try again then.
   */
  protected override hostEndsMatch(): string | null {
    if (this.phase !== 'PLAYING') return null;
    if (this.roundLive()) {
      this.onEndRequest();
      return 'A round is in play — the table closes once it’s settled. Try again then.';
    }
    this.finishGame();
    return null;
  }

  protected override onPlayerJoined(player: PlayerRecord): void {
    if (this.isSolo && this.phase === 'LOBBY' && !player.state.spectator) this.startMatch();
    // A late joiner arriving while bets are open is dealt in straight away.
    if (player.state.queued) this.seatQueuedIfBettingOpen();
  }

  private bettingOpen(): boolean {
    return this.phase === 'PLAYING' && this.stage === 'BETTING' && !this.round && !this.state.betsClosed;
  }

  private seatQueuedIfBettingOpen(): void {
    if (!this.bettingOpen()) return;
    for (const p of this.promoteQueued()) {
      const seat = this.seatPlayer(p);
      if (seat) {
        this.clearSeatForRound(seat);
        this.toast(p, 'success', 'You have been dealt in. Place a bet!');
      }
    }
  }

  protected onGameStart(): void {
    this.bank.clear();
    this.leftGuests.clear();
    this.resetTable();
    this.applyRules();
    this.newShoe();
    for (const p of this.seatedPlayers()) this.seatPlayer(p);
    this.startBetting();
  }

  protected override onReturnToLobby(): void {
    this.cancelTableTimers();
    this.bank.clear();
    this.leftGuests.clear();
    this.resetTable();
    this.applyRules();
  }

  protected override onRoomDisposed(): void {
    this.round = null;
    this.shoe = null;
  }

  private resetTable(): void {
    this.round = null;
    this.shoe = null;
    this.state.betsClosed = false;
    this.state.seats.clear();
    this.resetDealer();
    this.state.stage = 'IDLE';
    this.state.endRequested = false;
    this.state.shoeSize = 0;
    this.state.shoeRemaining = 0;
    this.state.cutRemaining = 0;
    this.state.discards = 0;
    this.state.cutReached = false;
    this.state.shuffles = 0;
  }

  private resetDealer(): void {
    const d = this.state.dealer;
    d.cards.clear();
    d.hasHole = false;
    d.revealed = false;
    d.total = 0;
    d.soft = false;
    d.label = '';
    d.blackjack = false;
    d.bust = false;
    d.peeked = false;
  }

  /** Adopt the current settings as the table's rules (between rounds only). */
  private applyRules(): void {
    const prev = this.tableRules;
    this.tableRules = structuredClone(this.settings);
    this.state.rulesJson = JSON.stringify(this.tableRules);
    this.rulesDirty = false;
    if (this.shoe && (prev.decks !== this.tableRules.decks || prev.penetration !== this.tableRules.penetration)) this.newShoe();
  }

  private newShoe(): void {
    const shuffles = this.shoe?.shuffles ?? 0;
    this.shoe = new Shoe(this.tableRules.decks, this.tableRules.penetration, this.rng);
    this.shoe.shuffles += shuffles;
    this.publishShoe();
  }

  private publishShoe(): void {
    const shoe = this.shoe;
    if (!shoe) return;
    this.state.shoeSize = shoe.size;
    this.state.shoeRemaining = shoe.remaining;
    this.state.cutRemaining = shoe.cutRemaining;
    this.state.discards = shoe.discards;
    this.state.cutReached = shoe.needsShuffle;
    this.state.shuffles = shoe.shuffles;
  }

  protected override onSettingsChanged(): void {
    if (this.phase !== 'PLAYING') {
      this.applyRules();
      return;
    }
    if (this.stage === 'BETTING' && !this.round) {
      this.applyRules();
      this.revalidatePendingBets();
      this.toast('all', 'info', 'Table rules updated.');
    } else {
      this.rulesDirty = true;
      this.toast('all', 'info', 'Table rules updated — they apply from the next round.');
    }
  }

  /** New limits during betting: return anything that no longer fits. */
  private revalidatePendingBets(): void {
    for (const seat of this.state.seats.values()) {
      if (seat.bet > this.tableRules.maxBet || (seat.locked && seat.bet > 0 && seat.bet < this.tableRules.minBet)) {
        seat.balance += seat.bet;
        seat.bet = 0;
        seat.locked = false;
        seat.sittingOut = false;
        this.toastPlayer(seat.playerId, 'warning', 'Your bet no longer fits the table limits and was returned.');
      }
    }
  }

  // ===========================================================================
  // Seats
  // ===========================================================================

  private seatPlayer(player: PlayerRecord): BjSeat | null {
    const existing = this.state.seats.get(player.id);
    if (existing) return existing;
    const taken = new Set([...this.state.seats.values()].map((s) => s.seat));
    const index = SEAT_PREFERENCE.find((i) => !taken.has(i));
    if (index === undefined) return null;
    const seat = new BjSeat();
    seat.playerId = player.id;
    seat.name = player.state.name;
    seat.seat = index;
    seat.balance = this.tableRules.startingBalance;
    seat.bought = this.tableRules.startingBalance;
    const banked = player.guestId ? this.bank.get(player.guestId) : undefined;
    if (banked && player.guestId) {
      // Same browser sitting back down: the stack it left with, not a fresh buy-in.
      this.bank.delete(player.guestId);
      Object.assign(seat, banked);
      player.state.score = seat.balance - seat.bought;
    }
    this.state.seats.set(player.id, seat);
    return seat;
  }

  /** Release a seat for good, remembering its stack for the player's browser (if known). */
  private releaseSeat(playerId: string, guestId?: string): void {
    const seat = this.state.seats.get(playerId);
    const guest = guestId ?? this.leftGuests.get(playerId);
    this.leftGuests.delete(playerId);
    if (!seat) return;
    this.state.seats.delete(playerId);
    if (!guest || this.phase !== 'PLAYING') return;
    this.bank.delete(guest);
    this.bank.set(guest, {
      balance: seat.balance + seat.bet,
      bought: seat.bought,
      refills: seat.refills,
      lastBet: seat.lastBet,
      handsPlayed: seat.handsPlayed,
      handsWon: seat.handsWon,
      blackjacks: seat.blackjacks,
      biggestWin: seat.biggestWin,
    });
    while (this.bank.size > MAX_BANKED_STACKS) this.bank.delete(this.bank.keys().next().value!);
  }

  private seatsInOrder(): BjSeat[] {
    return [...this.state.seats.values()].sort((a, b) => a.seat - b.seat);
  }

  private clearSeatForRound(seat: BjSeat): void {
    seat.hands.clear();
    seat.actions.clear();
    seat.activeHand = -1;
    seat.inRound = false;
    seat.done = false;
    seat.deadline = 0;
    seat.insurance = 0;
    seat.insuranceState = '';
    seat.bet = 0;
    seat.locked = false;
    seat.sittingOut = false;
  }

  /** Can this seat still bet at all (has chips for the minimum)? */
  private canAffordMin(seat: BjSeat): boolean {
    return seat.balance + seat.bet >= this.tableRules.minBet;
  }

  private toastPlayer(playerId: string, kind: 'info' | 'success' | 'warning' | 'error', text: string): void {
    const p = this.players.get(playerId);
    if (p) this.toast(p, kind, text);
  }

  private isPresent(playerId: string): boolean {
    const p = this.players.get(playerId);
    return Boolean(p && p.client && !p.away);
  }

  // ===========================================================================
  // Betting
  // ===========================================================================

  private startBetting(): void {
    if (this.phase !== 'PLAYING') return;
    if (this.rulesDirty) this.applyRules();
    // Seats of players who became spectators or vanished are released first…
    this.state.betsClosed = false;
    for (const [id, seat] of [...this.state.seats.entries()]) {
      const p = this.players.get(id);
      if (!p || p.state.spectator || seat.left) this.releaseSeat(id, p?.guestId);
    }
    // …then queued late joiners are dealt in.
    for (const p of this.promoteQueued()) {
      if (this.seatPlayer(p)) this.toast(p, 'success', 'You have been dealt in. Place a bet!');
    }
    for (const seat of this.state.seats.values()) {
      this.clearSeatForRound(seat);
      const p = this.players.get(seat.playerId);
      if (p) seat.name = p.state.name;
    }
    this.resetDealer();
    this.round = null;
    this.setStage('BETTING', 'Place your bets');
    this.publishShoe();
  }

  private onBet(player: PlayerRecord, amount: number): void {
    const type = BLACKJACK_MSG.bet;
    if (this.stage !== 'BETTING' || this.state.betsClosed) return this.reject(player, type, 'wrong_phase', 'Bets are closed for this round.');
    const seat = this.state.seats.get(player.id);
    if (!seat) return this.reject(player, type, 'not_allowed', 'You are not seated at the table.');
    if (seat.locked) return this.reject(player, type, 'not_allowed', 'Your bet is already locked in.');
    const rules = this.tableRules;
    if (amount > rules.maxBet) return this.reject(player, type, 'not_allowed', `The table maximum is ${formatChips(rules.maxBet)}.`);
    const available = seat.balance + seat.bet;
    if (amount > available) return this.reject(player, type, 'insufficient_chips', 'You do not have enough chips for that bet.');
    seat.balance = available - amount;
    seat.bet = amount;
    seat.sittingOut = false;
    if (amount > 0 && this.state.phaseEndsAt === 0) {
      const ms = rules.bettingSeconds * 1000;
      this.setTimer(ms);
      this.schedule('stage', ms, () => this.closeBetting());
    }
    this.checkBettingComplete();
  }

  private onLock(player: PlayerRecord, locked: boolean): void {
    const type = BLACKJACK_MSG.lock;
    if (this.stage !== 'BETTING' || this.state.betsClosed) return this.reject(player, type, 'wrong_phase', 'Bets are closed for this round.');
    const seat = this.state.seats.get(player.id);
    if (!seat) return this.reject(player, type, 'not_allowed', 'You are not seated at the table.');
    if (!locked) {
      seat.locked = false;
      seat.sittingOut = false;
      return;
    }
    if (seat.bet === 0) {
      seat.locked = true;
      seat.sittingOut = true;
    } else if (seat.bet < this.tableRules.minBet) {
      return this.reject(player, type, 'not_allowed', `The table minimum is ${formatChips(this.tableRules.minBet)}.`);
    } else {
      seat.locked = true;
      seat.sittingOut = false;
    }
    this.checkBettingComplete();
  }

  private onSit(player: PlayerRecord, index: number): void {
    const type = BLACKJACK_MSG.sit;
    if (this.stage !== 'BETTING' || this.state.betsClosed) return this.reject(player, type, 'wrong_phase', 'You can change seats between rounds.');
    const seat = this.state.seats.get(player.id);
    if (!seat) return this.reject(player, type, 'not_allowed', 'You are not seated at the table.');
    if (seat.locked) return this.reject(player, type, 'not_allowed', 'Unlock your bet before changing seats.');
    if ([...this.state.seats.values()].some((s) => s.seat === index && s !== seat)) {
      return this.reject(player, type, 'not_allowed', 'That seat is taken.');
    }
    seat.seat = index;
  }

  /**
   * Close early once every present seat has decided (locked a bet, sat out, or cannot afford the minimum).
   * "No more bets" is called once and is final: re-sent locks / bets can't push the deal back.
   */
  private checkBettingComplete(): void {
    if (this.stage !== 'BETTING' || this.state.betsClosed) return;
    const present = [...this.state.seats.values()].filter((s) => this.isPresent(s.playerId) && !s.left);
    const anyBet = present.some((s) => s.locked && s.bet >= this.tableRules.minBet);
    if (!anyBet) return;
    const allDecided = present.every((s) => s.locked || (s.bet === 0 && !this.canAffordMin(s)));
    if (!allDecided) return;
    this.state.betsClosed = true;
    this.state.statusText = 'No more bets';
    this.setTimer(this.ms('noMoreBets'));
    this.schedule('stage', this.ms('noMoreBets'), () => this.closeBetting());
  }

  private closeBetting(): void {
    if (this.stage !== 'BETTING' || !this.shoe) return;
    const rules = this.tableRules;
    const entries: BjSeat[] = [];
    for (const seat of this.seatsInOrder()) {
      const present = this.isPresent(seat.playerId) && !seat.left;
      const valid = seat.bet >= rules.minBet && seat.bet <= rules.maxBet;
      // Locked bets stand even through a brief connection drop; unlocked chips of absent players go back.
      if (valid && (present || seat.locked)) {
        entries.push(seat);
        continue;
      }
      if (seat.bet > 0) {
        if (present && !valid) this.toastPlayer(seat.playerId, 'warning', `Your bet was below the table minimum of ${formatChips(rules.minBet)} and was returned.`);
        seat.balance += seat.bet;
        seat.bet = 0;
      }
    }
    if (entries.length === 0) {
      this.startBetting();
      return;
    }

    this.state.betsClosed = false;
    const stack = this.testStacks.shift();
    if (stack && this.hooks.stacking) this.shoe.stackTop(stack);

    this.round = new BlackjackRound(
      toTableRules(rules),
      this.shoe,
      entries.map((s) => ({ id: s.playerId, balance: s.balance + s.bet, bet: s.bet })),
    );
    this.state.round += 1;
    for (const seat of this.state.seats.values()) {
      const playing = entries.includes(seat);
      seat.inRound = playing;
      seat.locked = playing;
      seat.net = 0;
      seat.hands.clear();
      if (playing) {
        seat.lastBet = seat.bet;
        seat.actionSeq += 1;
        const hand = new BjHand();
        hand.bet = seat.bet;
        seat.hands.push(hand);
      }
    }
    const steps = this.round.deal();
    this.setStage('DEALING', 'Dealing');
    this.runDeal(steps, 0);
  }

  // ===========================================================================
  // Dealing (progressive, for the animation)
  // ===========================================================================

  private runDeal(steps: DealStep[], i: number): void {
    const round = this.round;
    if (!round) return;
    const step = steps[i];
    if (!step) {
      this.schedule('stage', this.ms('afterDeal'), () => this.afterDeal());
      return;
    }
    if (step.to === 'seat') {
      const seat = this.state.seats.get(step.id);
      const hand = seat?.hands[0];
      if (hand) {
        hand.cards.push(code(step.card));
        this.labelHand(hand, round.seat(step.id)!.hands[0]!.cards.slice(0, hand.cards.length), false);
      }
    } else if (step.hole) {
      // Only the fact that a face-down card exists is public.
      this.state.dealer.hasHole = true;
    } else if (step.card) {
      this.state.dealer.cards.push(code(step.card));
      this.state.dealer.label = upCardLabel(step.card);
      const v = handValue([step.card]);
      this.state.dealer.total = v.total;
      this.state.dealer.soft = v.soft;
    }
    this.state.shoeRemaining = Math.max(0, this.state.shoeRemaining - 1);
    this.schedule('stage', this.ms('dealStep'), () => this.runDeal(steps, i + 1));
  }

  private afterDeal(): void {
    const round = this.round;
    if (!round) return;
    this.projectAll();
    this.publishShoe();
    if (round.stage === 'insurance') {
      const ms = Math.min(this.tableRules.decisionSeconds, 10) * 1000;
      this.setStage('INSURANCE', 'Insurance? Dealer shows an Ace', ms);
      this.schedule('stage', ms, () => this.finishInsurance());
      for (const id of round.pendingInsurance()) if (!this.isPresent(id)) round.decideInsurance(id, false);
      this.projectAll();
      if (round.pendingInsurance().length === 0) this.schedule('stage', this.ms('afterInsurance'), () => this.finishInsurance());
      return;
    }
    this.beginPeek();
  }

  // ===========================================================================
  // Insurance + peek
  // ===========================================================================

  private onInsurance(player: PlayerRecord, take: boolean): void {
    const type = BLACKJACK_MSG.insurance;
    const round = this.round;
    if (this.stage !== 'INSURANCE' || !round) return this.reject(player, type, 'wrong_phase', 'Insurance is not being offered.');
    const res = round.decideInsurance(player.id, take);
    if (!res.ok) return this.reject(player, type, res.code, res.message);
    this.projectSeat(round.seat(player.id)!);
    if (round.pendingInsurance().length === 0) this.schedule('stage', this.ms('afterInsurance'), () => this.finishInsurance());
  }

  private finishInsurance(): void {
    const round = this.round;
    if (!round || this.stage !== 'INSURANCE') return;
    round.closeInsurance();
    this.projectAll();
    this.beginPeek();
  }

  private beginPeek(): void {
    const round = this.round;
    if (!round || !round.upCard) return;
    if (dealerPeeksWith(round.upCard, round.rules)) {
      this.setStage('PEEK', 'Dealer checks for blackjack');
      this.schedule('stage', this.ms('peek'), () => this.resolvePeek());
    } else {
      this.resolvePeek();
    }
  }

  private resolvePeek(): void {
    const round = this.round;
    if (!round) return;
    const outcome = round.resolvePeek();
    if (outcome.dealerBlackjack) {
      this.projectDealerCards(round.visibleDealerCards(), true);
      this.projectAll();
      this.setStage('DEALER', 'Dealer has blackjack');
      this.schedule('stage', this.ms('reveal') + this.ms('beforeSettle'), () => this.settleRound());
      return;
    }
    this.state.dealer.peeked = outcome.peeked;
    this.projectAll();
    if (round.stage === 'dealer') {
      this.schedule('stage', this.ms('afterDecisions'), () => this.playDealer());
      return;
    }
    this.startDecisions();
  }

  // ===========================================================================
  // Player decisions (simultaneous, per-seat timers)
  // ===========================================================================

  private startDecisions(): void {
    const round = this.round;
    if (!round) return;
    this.setStage('PLAYING', 'Players decide');
    for (const rs of round.seats) {
      if (rs.done) continue;
      const seat = this.state.seats.get(rs.id);
      if (!seat || seat.left || this.players.get(rs.id)?.away) {
        round.standAll(rs.id);
        this.projectSeat(rs);
        continue;
      }
      this.armDecisionTimer(rs.id);
    }
    this.refreshDecisionClock();
    this.checkDecisionsComplete();
  }

  /** A fresh decision clock for this seat (the table's full decision time). */
  private armDecisionTimer(id: string): void {
    this.decisionDeadlines.set(id, Date.now() + this.tableRules.decisionSeconds * 1000);
    this.scheduleDecision(id);
  }

  /**
   * (Re)schedules a seat's decision timeout: its full deadline, or — while its player's connection is
   * down — at most a few seconds, so one dropped player can't hold the whole table for the full clock.
   */
  private scheduleDecision(id: string): void {
    const full = this.decisionDeadlines.get(id);
    if (full === undefined) return;
    const now = Date.now();
    const deadline = this.players.get(id)?.client ? full : Math.min(full, now + this.ms('disconnectDecision'));
    const key = `decide:${id}`;
    const seat = this.state.seats.get(id);
    if (seat) seat.deadline = deadline;
    this.decisionTimers.add(key);
    this.schedule(key, Math.max(0, deadline - now), () => {
      this.decisionTimers.delete(key);
      this.decisionDeadlines.delete(id);
      this.timeoutSeat(id, 'Time is up — standing on your remaining hands.');
    });
  }

  private disarmDecisionTimer(id: string): void {
    const key = `decide:${id}`;
    this.cancel(key);
    this.decisionTimers.delete(key);
    this.decisionDeadlines.delete(id);
    const seat = this.state.seats.get(id);
    if (seat) seat.deadline = 0;
  }

  /** phaseEndsAt mirrors the latest per-seat deadline so the table shows one overall clock. */
  private refreshDecisionClock(): void {
    let latest = 0;
    for (const seat of this.state.seats.values()) latest = Math.max(latest, seat.deadline);
    this.state.phaseEndsAt = latest;
  }

  private onAction(player: PlayerRecord, action: 'hit' | 'stand' | 'double' | 'split' | 'surrender', hand: number, seq?: number): void {
    const type = BLACKJACK_MSG.action;
    const round = this.round;
    if (this.stage !== 'PLAYING' || !round) return this.reject(player, type, 'wrong_phase', 'It is not time for decisions.');
    const rs = round.seat(player.id);
    const seat = this.state.seats.get(player.id);
    if (!rs || !seat) return this.reject(player, type, 'not_your_turn', 'You have no hand in this round.');
    // A repeated message (double click, resend) carries the sequence it was sent for: it never applies twice.
    if (seq !== undefined && seq !== seat.actionSeq) return this.reject(player, type, 'not_allowed', 'That decision already went through.');
    const res = round.act(player.id, hand, action);
    if (!res.ok) return this.reject(player, type, res.code, res.message);
    seat.actionSeq += 1;
    this.projectSeat(rs);
    this.publishShoe();
    if (rs.done) this.disarmDecisionTimer(player.id);
    else this.armDecisionTimer(player.id);
    this.refreshDecisionClock();
    this.checkDecisionsComplete();
  }

  private timeoutSeat(id: string, notice?: string): void {
    const round = this.round;
    if (!round || this.stage !== 'PLAYING') return;
    const rs = round.seat(id);
    if (!rs || rs.done) return;
    round.standAll(id);
    this.disarmDecisionTimer(id);
    const seat = this.state.seats.get(id);
    if (seat) seat.actionSeq += 1;
    this.projectSeat(rs);
    this.publishShoe();
    if (notice) this.toastPlayer(id, 'warning', notice);
    this.refreshDecisionClock();
    this.checkDecisionsComplete();
  }

  private checkDecisionsComplete(): void {
    const round = this.round;
    if (!round || this.stage !== 'PLAYING' || round.stage !== 'dealer') return;
    for (const key of this.decisionTimers) this.cancel(key);
    this.decisionTimers.clear();
    this.decisionDeadlines.clear();
    for (const seat of this.state.seats.values()) seat.deadline = 0;
    this.state.phaseEndsAt = 0;
    this.state.statusText = 'Dealer’s turn';
    this.schedule('stage', this.ms('afterDecisions'), () => this.playDealer());
  }

  // ===========================================================================
  // Dealer + settlement
  // ===========================================================================

  private playDealer(): void {
    const round = this.round;
    if (!round || round.stage !== 'dealer') return;
    const up = round.upCard!;
    // The shoe counter follows the animation so it never hints at cards not yet shown.
    let remaining = this.shoe?.remaining ?? 0;
    const { hole, draws } = round.playDealer();
    this.setStage('DEALER', 'Dealer reveals');
    this.projectDealerCards([up, hole], true);
    const drawStep = (i: number) => {
      if (i >= draws.length) {
        this.state.statusText = this.dealerSummary();
        this.schedule('stage', this.ms('beforeSettle'), () => this.settleRound());
        return;
      }
      this.state.statusText = 'Dealer draws';
      this.projectDealerCards([up, hole, ...draws.slice(0, i + 1)], true);
      remaining = Math.max(0, remaining - 1);
      this.state.shoeRemaining = remaining;
      this.schedule('stage', this.ms('dealerDraw'), () => drawStep(i + 1));
    };
    this.schedule('stage', this.ms('reveal'), () => drawStep(0));
  }

  private dealerSummary(): string {
    const d = this.state.dealer;
    if (d.blackjack) return 'Dealer has blackjack';
    if (d.bust) return 'Dealer busts!';
    return `Dealer stands on ${d.total}`;
  }

  private settleRound(): void {
    const round = this.round;
    const shoe = this.shoe;
    if (!round || !shoe) return;
    const summary = round.settle();
    this.projectDealerCards(round.visibleDealerCards(), true);
    for (const rs of round.seats) {
      this.projectSeat(rs);
      const seat = this.state.seats.get(rs.id);
      if (!seat) continue;
      seat.net = rs.net;
      seat.bet = 0;
      seat.actions.clear();
      seat.activeHand = -1;
      seat.handsPlayed += rs.hands.length;
      seat.handsWon += rs.hands.filter((h) => h.result === 'win' || h.result === 'blackjack').length;
      seat.blackjacks += rs.hands.filter((h) => h.result === 'blackjack').length;
      seat.biggestWin = Math.max(seat.biggestWin, rs.net);
    }
    for (const seat of this.state.seats.values()) {
      const p = this.players.get(seat.playerId);
      if (p) p.state.score = seat.balance - seat.bought;
    }
    shoe.endRound();
    this.publishShoe();
    this.round = null;
    const status = summary.dealerBlackjack ? 'Dealer has blackjack' : summary.dealerBust ? 'Dealer busts!' : `Dealer has ${summary.dealerTotal}`;
    this.setStage('SETTLING', status, this.ms('settle'));
    this.schedule('stage', this.ms('settle'), () => this.afterSettle());
  }

  private afterSettle(): void {
    for (const [id, seat] of [...this.state.seats.entries()]) if (seat.left) this.releaseSeat(id);
    if (this.state.endRequested) {
      this.finishGame();
      return;
    }
    if (this.rulesDirty) this.applyRules();
    if (this.shoe?.needsShuffle) {
      this.resetDealer();
      for (const seat of this.state.seats.values()) this.clearSeatForRound(seat);
      this.setStage('SHUFFLING', 'Shuffling a fresh shoe', this.ms('shuffle'));
      this.schedule('stage', this.ms('shuffle'), () => {
        this.shoe?.shuffle();
        this.publishShoe();
        this.startBetting();
      });
      return;
    }
    this.startBetting();
  }

  // ===========================================================================
  // Projection: engine → public state (never touches the hole card before reveal)
  // ===========================================================================

  private projectAll(): void {
    const round = this.round;
    if (!round) return;
    for (const rs of round.seats) this.projectSeat(rs);
  }

  private labelHand(target: BjHand, cards: readonly Card[], fromSplit: boolean): void {
    const v = handValue(cards);
    target.total = v.total;
    target.soft = v.soft && v.total < 21;
    target.label = handLabel(cards, fromSplit);
  }

  private projectHand(target: BjHand, hand: RoundHand): void {
    syncStrings(target.cards, hand.cards.map(code));
    target.bet = hand.bet;
    target.doubled = hand.doubled;
    target.split = hand.fromSplit;
    target.status = hand.status;
    target.result = hand.result;
    target.net = hand.net;
    this.labelHand(target, hand.cards, hand.fromSplit);
    if (hand.status === 'surrendered') target.label = 'Surrendered';
  }

  private projectSeat(rs: RoundSeat): void {
    const seat = this.state.seats.get(rs.id);
    const round = this.round;
    if (!seat || !round) return;
    seat.balance = rs.balance;
    seat.bet = rs.bet;
    while (seat.hands.length > rs.hands.length) seat.hands.pop();
    rs.hands.forEach((hand, i) => {
      let target = seat.hands[i];
      if (!target) {
        target = new BjHand();
        seat.hands.push(target);
      }
      this.projectHand(target, hand);
    });
    seat.activeHand = rs.active;
    seat.done = rs.done;
    syncStrings(seat.actions, round.legalActions(rs.id));
    seat.insurance = rs.insurance;
    seat.insuranceState = rs.insuranceState;
  }

  /** Publish dealer cards that are LEGALLY visible (callers pass only revealed cards). */
  private projectDealerCards(cards: readonly Card[], revealed: boolean): void {
    const d = this.state.dealer;
    syncStrings(d.cards, cards.map(code));
    d.revealed = revealed;
    d.hasHole = !revealed && d.hasHole;
    const v = handValue(cards);
    d.total = v.total;
    d.soft = v.soft && v.total < 21;
    d.blackjack = revealed && isNatural(cards);
    d.bust = v.bust;
    d.label = revealed ? handLabel(cards) : cards[0] ? upCardLabel(cards[0]) : '';
  }

  // ===========================================================================
  // Chips, spectators, host controls
  // ===========================================================================

  private onRefill(player: PlayerRecord): void {
    const type = BLACKJACK_MSG.refill;
    const seat = this.state.seats.get(player.id);
    if (!seat) return this.reject(player, type, 'not_allowed', 'You are not seated at the table.');
    if (this.round?.seat(player.id)) return this.reject(player, type, 'not_allowed', 'Finish this round first.');
    if (seat.balance + seat.bet >= this.tableRules.minBet) return this.reject(player, type, 'not_allowed', 'You can still cover the minimum bet.');
    const start = this.tableRules.startingBalance;
    const before = seat.balance + seat.bet;
    seat.bet = 0;
    seat.locked = false;
    seat.sittingOut = false;
    seat.balance = start;
    seat.bought += start - before;
    seat.refills += 1;
    this.systemChat(`${player.state.name} grabbed a free refill of ${formatChips(start)} virtual chips.`);
  }

  private onQueue(player: PlayerRecord): void {
    const type = BLACKJACK_MSG.queue;
    if (!player.state.spectator) return this.reject(player, type, 'not_allowed', 'You are already seated.');
    if (player.state.queued) return;
    const seated = this.seatedPlayers().length;
    if (seated >= this.state.maxPlayers || this.state.seats.size >= BLACKJACK_LIMITS.seats) {
      return this.reject(player, type, 'not_allowed', 'Every seat is taken right now.');
    }
    player.state.queued = true;
    if (this.bettingOpen()) this.seatQueuedIfBettingOpen();
    else this.toast(player, 'success', 'You will be dealt in from the next round.');
  }

  /** Cards are out and bets are riding: between the deal and the settlement. */
  private roundLive(): boolean {
    return !(this.stage === 'BETTING' || this.stage === 'SHUFFLING' || this.stage === 'IDLE' || this.stage === 'SETTLING');
  }

  private onEndRequest(): void {
    if (!this.roundLive()) {
      this.finishGame();
      return;
    }
    if (!this.state.endRequested) {
      this.state.endRequested = true;
      this.toast('all', 'info', 'The host is closing the table after this round.');
    }
  }

  private cancelTableTimers(): void {
    this.cancel('stage');
    for (const key of this.decisionTimers) this.cancel(key);
    this.decisionTimers.clear();
    this.decisionDeadlines.clear();
  }

  private finishGame(): void {
    this.cancelTableTimers();
    for (const seat of this.state.seats.values()) {
      if (!this.round?.seat(seat.playerId) && seat.bet > 0) {
        seat.balance += seat.bet;
        seat.bet = 0;
      }
      seat.locked = false;
      seat.deadline = 0;
      const p = this.players.get(seat.playerId);
      if (p) p.state.score = seat.balance - seat.bought;
    }
    for (const [id, seat] of [...this.state.seats.entries()]) if (seat.left) this.state.seats.delete(id);
    this.leftGuests.clear();
    const standings = [...this.state.seats.values()]
      .map((s) => ({ seat: s, player: this.players.get(s.playerId), net: s.balance - s.bought }))
      .filter((x) => x.player)
      .sort((a, b) => b.net - a.net || b.seat.balance - a.seat.balance);
    this.state.stage = 'IDLE';
    this.state.endRequested = false;
    this.state.statusText = 'Table closed';
    this.reportBlackjackOutcome(standings);
    this.endMatch({
      players: standings.map((x, i) => ({
        playerId: x.player!.id,
        name: x.player!.state.name,
        guestId: x.player!.guestId,
        userId: x.player!.userId,
        score: x.net,
        placement: i + 1,
      })),
      details: { rounds: this.state.round },
    });
  }

  /**
   * DASCADE stats: places follow the closing leaderboard (chip balance, net of refills; equal rows
   * share a place), players who left mid-session last; `scores` are final balances. Solo sessions
   * count too (the house is the opponent). A session closed before any round was dealt is no contest.
   */
  private reportBlackjackOutcome(standings: ReadonlyArray<{ seat: BjSeat; net: number }>): void {
    if (this.state.round === 0) return;
    const placements = withLeaversLast(
      groupSorted(standings, (x) => x.seat.playerId, (a, b) => a.net === b.net && a.seat.balance === b.seat.balance),
      this.matchLeaverIds(),
    );
    const scores: Record<string, number> = {};
    const playerStats: Record<string, Record<string, number>> = {};
    for (const { seat } of standings) {
      scores[seat.playerId] = seat.balance;
      playerStats[seat.playerId] = {
        handsPlayed: seat.handsPlayed,
        handsWon: seat.handsWon,
        blackjacks: seat.blackjacks,
        bestWin: seat.biggestWin,
      };
    }
    this.reportOutcome({ placements, scores, reason: 'table_closed', details: { rounds: this.state.round, playerStats } });
  }

  // ===========================================================================
  // Presence
  // ===========================================================================

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    this.rescheduleDecision(player);
    this.checkBettingComplete();
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    this.rescheduleDecision(player);
    this.checkBettingComplete();
  }

  /** A deciding seat's clock follows its player's connection (short while dropped, full on return). */
  private rescheduleDecision(player: PlayerRecord): void {
    if (this.stage !== 'PLAYING' || !this.decisionDeadlines.has(player.id)) return;
    this.scheduleDecision(player.id);
    this.refreshDecisionClock();
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    this.leaveTableFor(player, false);
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.leaveTableFor(player, true);
  }

  /**
   * A player is gone (away = seat kept; removed = seat released). Their hands in a live
   * round stand and are settled normally; pending chips go back to their stack.
   */
  private leaveTableFor(player: PlayerRecord, removed: boolean): void {
    if (this.phase !== 'PLAYING') {
      const seat = this.state.seats.get(player.id);
      if (!seat || !removed) return;
      // Keep the results board intact; elsewhere the seat is simply released.
      if (this.phase === 'RESULTS') seat.left = true;
      else this.state.seats.delete(player.id);
      return;
    }
    const seat = this.state.seats.get(player.id);
    if (!seat) return;
    const round = this.round;
    const inRound = Boolean(round?.seat(player.id));
    if (inRound && round) {
      if (this.stage === 'INSURANCE') {
        round.decideInsurance(player.id, false);
        this.projectSeat(round.seat(player.id)!);
        if (round.pendingInsurance().length === 0) this.schedule('stage', this.ms('afterInsurance'), () => this.finishInsurance());
      } else if (this.stage === 'PLAYING') {
        this.timeoutSeat(player.id);
      }
      if (removed) {
        seat.left = true;
        if (player.guestId) this.leftGuests.set(player.id, player.guestId);
      }
      return;
    }
    if (seat.bet > 0) {
      seat.balance += seat.bet;
      seat.bet = 0;
    }
    seat.locked = false;
    seat.sittingOut = false;
    if (removed) this.releaseSeat(player.id, player.guestId);
    this.checkBettingComplete();
  }
}
