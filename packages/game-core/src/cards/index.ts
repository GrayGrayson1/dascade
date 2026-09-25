/**
 * Standard 52-card primitives shared by DAS Hold'em and DASjack 21.
 * Cards travel over the network as compact 2-char codes: rank + suit, e.g. "As", "Td", "9c".
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type CardCode = string;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const RANK_CHARS = '23456789TJQKA';

export const SUIT_NAMES: Record<Suit, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RANK_NAMES: Record<Rank, string> = {
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
};
export const RANK_PLURALS: Record<Rank, string> = {
  2: 'Twos',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};

export function rankChar(rank: Rank): string {
  return RANK_CHARS[rank - 2] as string;
}

export function cardToCode(card: Card): CardCode {
  return `${rankChar(card.rank)}${card.suit}`;
}

export function parseCard(code: CardCode): Card {
  if (typeof code !== 'string' || code.length !== 2) throw new Error(`Invalid card code: ${String(code)}`);
  const idx = RANK_CHARS.indexOf(code[0] as string);
  const suit = code[1] as Suit;
  if (idx < 0 || !SUITS.includes(suit)) throw new Error(`Invalid card code: ${code}`);
  return { rank: (idx + 2) as Rank, suit };
}

export function isCardCode(code: unknown): code is CardCode {
  if (typeof code !== 'string' || code.length !== 2) return false;
  return RANK_CHARS.includes(code[0] as string) && SUITS.includes(code[1] as Suit);
}

export function isRed(card: Card | CardCode): boolean {
  const suit = typeof card === 'string' ? card[1] : card.suit;
  return suit === 'h' || suit === 'd';
}

/** "Ace of Spades" */
export function cardName(card: Card | CardCode): string {
  const c = typeof card === 'string' ? parseCard(card) : card;
  return `${RANK_NAMES[c.rank]} of ${SUIT_NAMES[c.suit][0]?.toUpperCase()}${SUIT_NAMES[c.suit].slice(1)}`;
}

/** Fresh ordered 52-card deck. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Ordered multi-deck shoe. */
export function createShoe(decks: number): Card[] {
  const shoe: Card[] = [];
  for (let i = 0; i < decks; i++) shoe.push(...createDeck());
  return shoe;
}

/** A shuffled deck that deals from the top. Keep it server-side only. */
export class Deck {
  private cards: Card[];
  private dealt = 0;

  constructor(cards: Card[], rng: Rng) {
    this.cards = shuffleInPlace(cards.slice(), rng);
  }

  static standard(rng: Rng): Deck {
    return new Deck(createDeck(), rng);
  }

  get remaining(): number {
    return this.cards.length - this.dealt;
  }

  get size(): number {
    return this.cards.length;
  }

  draw(): Card {
    const card = this.cards[this.dealt];
    if (!card) throw new Error('Deck exhausted');
    this.dealt++;
    return card;
  }

  drawMany(n: number): Card[] {
    const out: Card[] = [];
    for (let i = 0; i < n; i++) out.push(this.draw());
    return out;
  }
}
