/**
 * Table rules, dealer strategy and payout math.
 *
 * Money is always integer chips. Fractional payouts (3:2 or 6:5 on odd bets,
 * half-bet surrender refunds, insurance stakes on odd bets) round DOWN.
 */
import type { BlackjackPayout, DoubleRule } from '@dascade/shared/games/blackjack';
import { handValue, isAce, isNatural, isTenValue, type CardLike } from './hand.ts';

export type { BlackjackPayout, DoubleRule };

export interface TableRules {
  decks: number;
  /** H17 when true, S17 when false. */
  dealerHitsSoft17: boolean;
  blackjackPayout: BlackjackPayout;
  doubleRule: DoubleRule;
  doubleAfterSplit: boolean;
  /** Max hands per player after splits (1 disables splitting). */
  maxHands: number;
  resplitAces: boolean;
  hitSplitAces: boolean;
  /** Late surrender. */
  surrender: boolean;
  insurance: boolean;
  /** US peek for blackjack under an Ace or 10-value up card. */
  dealerPeek: boolean;
}

export const DEFAULT_TABLE_RULES: TableRules = {
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
};

const PAYOUT_RATIOS: Record<BlackjackPayout, [number, number]> = {
  '3:2': [3, 2],
  '6:5': [6, 5],
  '1:1': [1, 1],
};

/** Winnings (excluding the returned stake) for a natural. Rounds down. */
export function blackjackWinnings(bet: number, payout: BlackjackPayout): number {
  const [num, den] = PAYOUT_RATIOS[payout];
  return Math.floor((bet * num) / den);
}

/** Chips returned for a late surrender (half the bet, rounded down). */
export function surrenderRefund(bet: number): number {
  return Math.floor(bet / 2);
}

/** Insurance costs half the original bet, rounded down (0 = not available). */
export function insuranceCost(bet: number): number {
  return Math.floor(bet / 2);
}

/** Should the dealer draw to these cards? */
export function dealerShouldHit(cards: readonly CardLike[], hitSoft17: boolean): boolean {
  const v = handValue(cards);
  if (v.total < 17) return true;
  return v.total === 17 && v.soft && hitSoft17;
}

/** Whether the dealer checks the hole card for blackjack with this up card. */
export function dealerPeeksWith(upCard: CardLike, rules: Pick<TableRules, 'dealerPeek'>): boolean {
  return rules.dealerPeek && (isAce(upCard) || isTenValue(upCard));
}

export function dealerHasBlackjack(cards: readonly CardLike[]): boolean {
  return isNatural(cards, false);
}

/** Double eligibility by the table's double rule (hard totals for 9–11 / 10–11). */
export function doubleRuleAllows(cards: readonly CardLike[], rule: DoubleRule): boolean {
  if (cards.length !== 2) return false;
  if (rule === 'any') return true;
  const v = handValue(cards);
  if (v.soft) return false;
  const min = rule === '9-11' ? 9 : 10;
  return v.total >= min && v.total <= 11;
}

export function doubleRuleText(rule: DoubleRule): string {
  return rule === 'any' ? 'any two cards' : rule === '9-11' ? 'hard 9–11 only' : 'hard 10–11 only';
}
