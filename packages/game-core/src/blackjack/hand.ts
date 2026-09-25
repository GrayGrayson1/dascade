/**
 * Blackjack hand evaluation: point values, hard/soft totals with any number of
 * aces, naturals and human-readable labels.
 */
import { parseCard, type Card, type CardCode } from '../cards/index.ts';

export type CardLike = Card | CardCode;

function toCard(card: CardLike): Card {
  return typeof card === 'string' ? parseCard(card) : card;
}

/** Point value with aces counted as 1 (J/Q/K = 10). */
export function cardPoints(card: CardLike): number {
  const { rank } = toCard(card);
  if (rank === 14) return 1;
  if (rank >= 10) return 10;
  return rank;
}

export function isAce(card: CardLike): boolean {
  return toCard(card).rank === 14;
}

/** Ten, Jack, Queen or King. */
export function isTenValue(card: CardLike): boolean {
  const { rank } = toCard(card);
  return rank >= 10 && rank <= 13;
}

export interface HandValue {
  /** Best total: one ace counts as 11 when that does not bust the hand. */
  total: number;
  /** An ace is currently counted as 11. */
  soft: boolean;
  /** Total with every ace counted as 1. */
  hard: number;
  bust: boolean;
  aces: number;
}

export function handValue(cards: readonly CardLike[]): HandValue {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    const pts = cardPoints(c);
    hard += pts;
    if (pts === 1) aces++;
  }
  // At most one ace can ever count as 11 (two would be 22).
  const soft = aces > 0 && hard + 10 <= 21;
  const total = soft ? hard + 10 : hard;
  return { total, soft, hard, bust: total > 21, aces };
}

/**
 * A natural ("blackjack"): exactly two cards totalling 21 on a hand that did not
 * come from a split. 21 after a split is an ordinary 21.
 */
export function isNatural(cards: readonly CardLike[], fromSplit = false): boolean {
  if (fromSplit || cards.length !== 2) return false;
  return handValue(cards).total === 21;
}

/** Split eligibility by point value: any two 10-value cards (e.g. K + Q) may be split. */
export function isPair(cards: readonly CardLike[]): boolean {
  if (cards.length !== 2) return false;
  return cardPoints(cards[0]!) === cardPoints(cards[1]!);
}

/** "Blackjack", "Bust", "Soft 17", "12", "21". */
export function handLabel(cards: readonly CardLike[], fromSplit = false): string {
  if (cards.length === 0) return '';
  if (isNatural(cards, fromSplit)) return 'Blackjack';
  const v = handValue(cards);
  if (v.bust) return 'Bust';
  if (v.soft && v.total !== 21) return `Soft ${v.total}`;
  return String(v.total);
}

/** Label for the dealer's single visible card before the reveal. */
export function upCardLabel(card: CardLike): string {
  return isAce(card) ? 'Showing A' : `Showing ${cardPoints(card)}`;
}
