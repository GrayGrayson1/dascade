/**
 * One round of multiplayer blackjack against the house, as a pure state machine.
 *
 *   new ──deal()──▶ insurance? ──closeInsurance()──▶ peek ──resolvePeek()──▶ players
 *     players ──act()/standAll() until every seat is done──▶ dealer ──playDealer()──▶ showdown ──settle()──▶ settled
 *   A dealer blackjack found by the peek jumps straight from peek to showdown.
 *
 * Players act SIMULTANEOUSLY (each on their own hands), which keeps a full
 * table fast.
 *
 * Under an Ace, non-naturals may buy insurance (half the bet, rounded down; pays
 * 2:1) and a natural may take EVEN MONEY: a guaranteed 1:1 on the hand whatever
 * the hole card (true even money, not insurance on a natural — the two only agree
 * at 3:2 tables on even bets). Balances are integer chips: stakes are taken from `balance` when
 * wagered and the returns are credited at settlement.
 *
 * The dealer's hole card is private to this object until it is revealed.
 */
import type {
  BlackjackAction,
  BlackjackHandResult,
  BlackjackHandStatus,
  BlackjackInsuranceState,
} from '@dascade/shared/games/blackjack';
import type { Card } from '../cards/index.ts';
import { handValue, isAce, isNatural, isPair } from './hand.ts';
import {
  blackjackWinnings,
  dealerHasBlackjack,
  dealerPeeksWith,
  dealerShouldHit,
  doubleRuleAllows,
  doubleRuleText,
  insuranceCost,
  surrenderRefund,
  type TableRules,
} from './rules.ts';

export type { BlackjackAction };
export type HandStatus = BlackjackHandStatus;
export type HandResult = BlackjackHandResult;
export type InsuranceState = BlackjackInsuranceState;

export interface CardSource {
  draw(): Card;
}

export interface RoundEntry {
  id: string;
  /** Chips the player has BEFORE this bet is taken. */
  balance: number;
  bet: number;
}

export interface RoundHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  /** Created by splitting aces (one card each unless hitSplitAces). */
  splitAces: boolean;
  status: HandStatus;
  result: HandResult;
  /** Chips credited back at settlement (stake included). */
  payout: number;
  net: number;
}

export interface RoundSeat {
  id: string;
  balance: number;
  /** Original wager. */
  bet: number;
  hands: RoundHand[];
  /** Index of the hand awaiting a decision, −1 when none. */
  active: number;
  insurance: number;
  insuranceState: InsuranceState;
  done: boolean;
  net: number;
}

export type RoundStage = 'new' | 'insurance' | 'peek' | 'players' | 'dealer' | 'showdown' | 'settled';

/** A dealt card. The hole card's identity is withheld (`card: null`). */
export type DealStep = { to: 'seat'; id: string; card: Card } | { to: 'dealer'; card: Card | null; hole: boolean };

export type RoundErrorCode = 'not_your_turn' | 'not_allowed' | 'insufficient_chips' | 'wrong_phase';
export interface RoundError {
  ok: false;
  code: RoundErrorCode;
  message: string;
}
export type ActionOutcome = { ok: true; drawn: Card[] } | RoundError;

export interface PeekOutcome {
  /** The dealer looked at the hole card. */
  peeked: boolean;
  dealerBlackjack: boolean;
}

export interface DealerOutcome {
  hole: Card;
  draws: Card[];
}

const ACTION_ORDER: readonly BlackjackAction[] = ['hit', 'stand', 'double', 'split', 'surrender'];

function fail(code: RoundErrorCode, message: string): RoundError {
  return { ok: false, code, message };
}

function newHand(cards: Card[], bet: number, fromSplit: boolean, splitAces: boolean): RoundHand {
  return { cards, bet, doubled: false, fromSplit, splitAces, status: 'waiting', result: '', payout: 0, net: 0 };
}

/**
 * Why `action` is not allowed on the seat's hand, or null when it is legal.
 * Pure: used for legal-action lists and precise rejection messages.
 */
export function actionBlocker(seat: RoundSeat, handIndex: number, action: BlackjackAction, rules: TableRules): RoundError | null {
  const hand = seat.hands[handIndex];
  if (!hand || hand.status !== 'active' || seat.active !== handIndex) return fail('not_your_turn', 'That hand is not waiting for a decision.');
  const v = handValue(hand.cards);
  const two = hand.cards.length === 2;
  switch (action) {
    case 'stand':
      return null;
    case 'hit':
      if (v.total >= 21) return fail('not_allowed', 'This hand cannot take another card.');
      if (hand.splitAces && !rules.hitSplitAces) return fail('not_allowed', 'Split aces receive one card each.');
      return null;
    case 'double':
      if (!two || hand.doubled) return fail('not_allowed', 'You can only double on your first two cards.');
      if (hand.fromSplit && !rules.doubleAfterSplit) return fail('not_allowed', 'Doubling after a split is not allowed at this table.');
      if (hand.splitAces && !rules.hitSplitAces) return fail('not_allowed', 'Split aces cannot be doubled.');
      if (!doubleRuleAllows(hand.cards, rules.doubleRule)) return fail('not_allowed', `Doubling is allowed on ${doubleRuleText(rules.doubleRule)}.`);
      if (seat.balance < hand.bet) return fail('insufficient_chips', 'Not enough chips to double.');
      return null;
    case 'split': {
      if (!two || !isPair(hand.cards)) return fail('not_allowed', 'You can only split two cards of the same value.');
      if (seat.hands.length >= rules.maxHands) {
        return fail('not_allowed', rules.maxHands <= 1 ? 'Splitting is disabled at this table.' : `You can split into at most ${rules.maxHands} hands.`);
      }
      if (hand.splitAces && isAce(hand.cards[0]!) && !rules.resplitAces) return fail('not_allowed', 'Aces cannot be re-split at this table.');
      if (seat.balance < hand.bet) return fail('insufficient_chips', 'Not enough chips to split.');
      return null;
    }
    case 'surrender':
      if (!rules.surrender) return fail('not_allowed', 'Surrender is not offered at this table.');
      if (!two || seat.hands.length !== 1 || hand.fromSplit || hand.doubled) return fail('not_allowed', 'You can only surrender your first two cards.');
      return null;
  }
}

export function legalActions(seat: RoundSeat, rules: TableRules): BlackjackAction[] {
  if (seat.done || seat.active < 0) return [];
  return ACTION_ORDER.filter((a) => actionBlocker(seat, seat.active, a, rules) === null);
}

export interface SeatSettlement {
  id: string;
  net: number;
  balance: number;
  hands: Array<{ result: HandResult; bet: number; payout: number; net: number }>;
  insurance: { stake: number; result: InsuranceState };
}

export interface RoundSettlement {
  dealerTotal: number;
  dealerBlackjack: boolean;
  dealerBust: boolean;
  seats: SeatSettlement[];
}

export class BlackjackRound {
  readonly rules: TableRules;
  readonly seats: RoundSeat[];
  stage: RoundStage = 'new';
  /** The dealer peeked and does not have blackjack. */
  peeked = false;
  holeRevealed = false;
  private up: Card | null = null;
  private hole: Card | null = null;
  private draws: Card[] = [];
  private readonly byId = new Map<string, RoundSeat>();

  constructor(
    rules: TableRules,
    private readonly shoe: CardSource,
    entries: readonly RoundEntry[],
  ) {
    if (entries.length === 0) throw new Error('A round needs at least one bet.');
    this.rules = { ...rules };
    this.seats = entries.map((e) => {
      if (this.byId.has(e.id)) throw new Error(`Duplicate seat ${e.id}`);
      if (!Number.isInteger(e.bet) || e.bet < 1) throw new Error(`Invalid bet ${e.bet}`);
      if (!Number.isInteger(e.balance) || e.bet > e.balance) throw new Error(`Bet ${e.bet} exceeds balance ${e.balance}`);
      const seat: RoundSeat = {
        id: e.id,
        balance: e.balance - e.bet,
        bet: e.bet,
        hands: [],
        active: -1,
        insurance: 0,
        insuranceState: '',
        done: false,
        net: 0,
      };
      this.byId.set(e.id, seat);
      return seat;
    });
  }

  seat(id: string): RoundSeat | undefined {
    return this.byId.get(id);
  }

  get upCard(): Card | null {
    return this.up;
  }

  /** Dealer cards that are face up (the hole card only after the reveal). */
  visibleDealerCards(): Card[] {
    if (!this.up) return [];
    return this.holeRevealed && this.hole ? [this.up, this.hole, ...this.draws] : [this.up];
  }

  /** Whether the dealer's final hand is a natural (only meaningful after the reveal). */
  get dealerBlackjack(): boolean {
    return this.holeRevealed && dealerHasBlackjack(this.visibleDealerCards());
  }

  get insuranceOffered(): boolean {
    return this.rules.insurance && this.up !== null && isAce(this.up);
  }

  private draw(sink?: Card[]): Card {
    const card = this.shoe.draw();
    sink?.push(card);
    return card;
  }

  // -------------------------------------------------------------------------
  // Deal
  // -------------------------------------------------------------------------

  /** Two cards to every seat (first base first) and to the dealer: up card, then the hole card. */
  deal(): DealStep[] {
    if (this.stage !== 'new') throw new Error('Round already dealt');
    const steps: DealStep[] = [];
    for (const seat of this.seats) seat.hands = [newHand([], seat.bet, false, false)];
    for (let pass = 0; pass < 2; pass++) {
      for (const seat of this.seats) {
        const card = this.draw();
        seat.hands[0]!.cards.push(card);
        steps.push({ to: 'seat', id: seat.id, card });
      }
      if (pass === 0) {
        this.up = this.draw();
        steps.push({ to: 'dealer', card: this.up, hole: false });
      } else {
        this.hole = this.draw();
        steps.push({ to: 'dealer', card: null, hole: true });
      }
    }
    if (this.insuranceOffered) {
      for (const seat of this.seats) {
        // A natural is offered EVEN MONEY, which costs nothing, so it is always available.
        if (isNatural(seat.hands[0]!.cards)) {
          seat.insuranceState = 'offered';
          continue;
        }
        const cost = insuranceCost(seat.bet);
        seat.insuranceState = cost >= 1 && seat.balance >= cost ? 'offered' : '';
      }
      this.stage = this.seats.some((s) => s.insuranceState === 'offered') ? 'insurance' : 'peek';
    } else {
      this.stage = 'peek';
    }
    return steps;
  }

  // -------------------------------------------------------------------------
  // Insurance
  // -------------------------------------------------------------------------

  pendingInsurance(): string[] {
    return this.seats.filter((s) => s.insuranceState === 'offered').map((s) => s.id);
  }

  decideInsurance(id: string, take: boolean): { ok: true } | RoundError {
    if (this.stage !== 'insurance') return fail('wrong_phase', 'Insurance is not being offered.');
    const seat = this.byId.get(id);
    if (!seat) return fail('not_allowed', 'You are not in this round.');
    if (seat.insuranceState !== 'offered') return fail('not_allowed', 'You have already decided on insurance.');
    if (!take) {
      seat.insuranceState = 'declined';
      return { ok: true };
    }
    if (isNatural(seat.hands[0]!.cards)) {
      // Even money: the natural is paid exactly 1:1 whatever the hole card (no side stake).
      seat.insuranceState = 'even';
      return { ok: true };
    }
    const cost = insuranceCost(seat.bet);
    if (seat.balance < cost) return fail('insufficient_chips', 'Not enough chips for insurance.');
    seat.balance -= cost;
    seat.insurance = cost;
    seat.insuranceState = 'taken';
    return { ok: true };
  }

  /** End the insurance window; undecided seats decline. */
  closeInsurance(): void {
    if (this.stage !== 'insurance') return;
    for (const seat of this.seats) if (seat.insuranceState === 'offered') seat.insuranceState = 'declined';
    this.stage = 'peek';
  }

  // -------------------------------------------------------------------------
  // Peek
  // -------------------------------------------------------------------------

  /**
   * US peek: under an Ace or 10-value up card the dealer checks for blackjack.
   * A dealer blackjack is revealed and the round goes straight to showdown;
   * otherwise insurance is lost and players act.
   */
  resolvePeek(): PeekOutcome {
    if (this.stage === 'insurance') this.closeInsurance();
    if (this.stage !== 'peek') throw new Error(`resolvePeek in stage ${this.stage}`);
    const peeks = this.up !== null && dealerPeeksWith(this.up, this.rules);
    if (peeks) {
      const bj = dealerHasBlackjack([this.up!, this.hole!]);
      if (bj) {
        this.holeRevealed = true;
        for (const seat of this.seats) {
          const hand = seat.hands[0]!;
          hand.status = isNatural(hand.cards) ? 'blackjack' : 'stood';
          seat.active = -1;
          seat.done = true;
        }
        this.stage = 'showdown';
        return { peeked: true, dealerBlackjack: true };
      }
      this.peeked = true;
      for (const seat of this.seats) if (seat.insuranceState === 'taken') seat.insuranceState = 'lost';
    }
    this.beginPlayers();
    return { peeked: peeks, dealerBlackjack: false };
  }

  private beginPlayers(): void {
    this.stage = 'players';
    for (const seat of this.seats) {
      const hand = seat.hands[0]!;
      if (isNatural(hand.cards)) {
        hand.status = 'blackjack';
        seat.active = -1;
        seat.done = true;
      } else {
        hand.status = 'active';
        seat.active = 0;
        seat.done = false;
        this.resolveAutomatic(seat);
      }
    }
    this.maybeFinishPlayers();
  }

  // -------------------------------------------------------------------------
  // Player decisions (simultaneous)
  // -------------------------------------------------------------------------

  legalActions(id: string): BlackjackAction[] {
    const seat = this.byId.get(id);
    if (!seat || this.stage !== 'players') return [];
    return legalActions(seat, this.rules);
  }

  act(id: string, handIndex: number, action: BlackjackAction): ActionOutcome {
    const seat = this.byId.get(id);
    if (!seat) return fail('not_allowed', 'You are not in this round.');
    if (this.stage !== 'players') return fail('wrong_phase', 'Player decisions are closed.');
    if (seat.done || seat.active < 0) return fail('not_your_turn', 'You have no hand left to play.');
    const blocked = actionBlocker(seat, handIndex, action, this.rules);
    if (blocked) return blocked;

    const drawn: Card[] = [];
    const hand = seat.hands[handIndex]!;
    switch (action) {
      case 'hit': {
        hand.cards.push(this.draw(drawn));
        const v = handValue(hand.cards);
        if (v.bust) hand.status = 'bust';
        else if (v.total === 21) hand.status = 'stood';
        break;
      }
      case 'stand':
        hand.status = 'stood';
        break;
      case 'double': {
        seat.balance -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(this.draw(drawn));
        hand.status = handValue(hand.cards).bust ? 'bust' : 'stood';
        break;
      }
      case 'split': {
        seat.balance -= hand.bet;
        const [first, second] = hand.cards as [Card, Card];
        const aces = isAce(first);
        hand.cards = [first];
        hand.fromSplit = true;
        hand.splitAces = aces;
        seat.hands.splice(handIndex + 1, 0, newHand([second], hand.bet, true, aces));
        break;
      }
      case 'surrender':
        hand.status = 'surrendered';
        break;
    }
    this.resolveAutomatic(seat, drawn);
    this.maybeFinishPlayers();
    return { ok: true, drawn };
  }

  /**
   * Timeout / disconnect: stand every remaining hand of this seat. Split hands
   * still waiting for their second card receive it first, as the rules require.
   */
  standAll(id: string): Card[] {
    const seat = this.byId.get(id);
    const drawn: Card[] = [];
    if (!seat || this.stage !== 'players' || seat.done) return drawn;
    for (const hand of seat.hands) {
      if (hand.status !== 'active' && hand.status !== 'waiting') continue;
      if (hand.cards.length < 2) hand.cards.push(this.draw(drawn));
      hand.status = handValue(hand.cards).bust ? 'bust' : 'stood';
    }
    seat.active = -1;
    seat.done = true;
    this.maybeFinishPlayers();
    return drawn;
  }

  /**
   * Make sure the seat's active hand genuinely needs a decision: deal the second
   * card to a fresh split hand, auto-stand 21s and one-card split aces, and move
   * on to the next hand (or finish the seat) when the current one is resolved.
   */
  private resolveAutomatic(seat: RoundSeat, drawn?: Card[]): void {
    for (;;) {
      let hand = seat.active >= 0 ? seat.hands[seat.active] : undefined;
      if (!hand || hand.status !== 'active') {
        const next = seat.hands.findIndex((h) => h.status === 'waiting');
        if (next < 0) {
          seat.active = -1;
          seat.done = true;
          return;
        }
        seat.active = next;
        hand = seat.hands[next]!;
        hand.status = 'active';
      }
      if (hand.cards.length < 2) hand.cards.push(this.draw(drawn));
      const v = handValue(hand.cards);
      if (v.bust) {
        hand.status = 'bust';
        continue;
      }
      if (v.total === 21) {
        hand.status = 'stood';
        continue;
      }
      if (hand.splitAces && !this.rules.hitSplitAces && actionBlocker(seat, seat.active, 'split', this.rules) !== null) {
        hand.status = 'stood';
        continue;
      }
      return;
    }
  }

  get allPlayersDone(): boolean {
    return this.seats.every((s) => s.done);
  }

  private maybeFinishPlayers(): void {
    if (this.stage === 'players' && this.allPlayersDone) this.stage = 'dealer';
  }

  // -------------------------------------------------------------------------
  // Dealer
  // -------------------------------------------------------------------------

  /** Does any hand still need the dealer's final total? */
  get dealerMustDraw(): boolean {
    if (!this.hole || !this.up) return false;
    if (dealerHasBlackjack([this.up, this.hole])) return false;
    return this.seats.some((s) => s.hands.some((h) => h.status === 'stood'));
  }

  /** Reveal the hole card and draw to the table rule (H17/S17). */
  playDealer(): DealerOutcome {
    if (this.stage !== 'dealer') throw new Error(`playDealer in stage ${this.stage}`);
    const mustDraw = this.dealerMustDraw;
    this.holeRevealed = true;
    if (mustDraw) {
      while (dealerShouldHit([this.up!, this.hole!, ...this.draws], this.rules.dealerHitsSoft17)) {
        this.draws.push(this.draw());
      }
    }
    this.stage = 'showdown';
    return { hole: this.hole!, draws: [...this.draws] };
  }

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  settle(): RoundSettlement {
    if (this.stage !== 'showdown') throw new Error(`settle in stage ${this.stage}`);
    const dealerCards = this.visibleDealerCards();
    const dv = handValue(dealerCards);
    const dealerBJ = dealerHasBlackjack(dealerCards);
    const out: SeatSettlement[] = [];
    for (const seat of this.seats) {
      let net = 0;
      for (const hand of seat.hands) {
        if (hand.status === 'active' || hand.status === 'waiting') hand.status = 'stood';
        let payout = 0;
        let result: HandResult;
        if (hand.status === 'bust') {
          result = 'bust';
        } else if (hand.status === 'blackjack') {
          if (seat.insuranceState === 'even') {
            payout = hand.bet * 2;
            result = 'blackjack';
          } else if (dealerBJ) {
            payout = hand.bet;
            result = 'push';
          } else {
            payout = hand.bet + blackjackWinnings(hand.bet, this.rules.blackjackPayout);
            result = 'blackjack';
          }
        } else if (dealerBJ) {
          // Late surrender cannot save a hand from a dealer blackjack (only reachable without the peek).
          result = 'lose';
        } else if (hand.status === 'surrendered') {
          payout = surrenderRefund(hand.bet);
          result = 'surrender';
        } else {
          const pv = handValue(hand.cards).total;
          if (dv.bust || pv > dv.total) {
            payout = hand.bet * 2;
            result = 'win';
          } else if (pv === dv.total) {
            payout = hand.bet;
            result = 'push';
          } else {
            result = 'lose';
          }
        }
        hand.payout = payout;
        hand.result = result;
        hand.net = payout - hand.bet;
        seat.balance += payout;
        net += hand.net;
      }
      if (seat.insuranceState === 'taken') {
        if (dealerBJ) {
          seat.balance += seat.insurance * 3;
          seat.insuranceState = 'won';
          net += seat.insurance * 2;
        } else {
          seat.insuranceState = 'lost';
          net -= seat.insurance;
        }
      } else if (seat.insuranceState === 'lost') {
        net -= seat.insurance;
      }
      seat.net = net;
      out.push({
        id: seat.id,
        net,
        balance: seat.balance,
        hands: seat.hands.map((h) => ({ result: h.result, bet: h.bet, payout: h.payout, net: h.net })),
        insurance: { stake: seat.insurance, result: seat.insuranceState },
      });
    }
    this.stage = 'settled';
    return { dealerTotal: dv.total, dealerBlackjack: dealerBJ, dealerBust: dv.bust, seats: out };
  }
}
