/**
 * Poker hand evaluation: best five of five to seven cards, with a comparable
 * integer score, a tiebreak rank vector and a human description.
 */
import { RANK_NAMES, RANK_PLURALS, cardToCode, parseCard, type Card, type CardCode, type Rank } from '../cards/index.ts';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
};

export interface EvaluatedHand {
  category: HandCategory;
  /** Category name ("Royal Flush" for the ace-high straight flush). */
  name: string;
  /** Tiebreak ranks, most significant first (2–14; a wheel straight's high card is 5). */
  ranks: number[];
  /** Higher is better; equal scores tie. */
  score: number;
  /** The best five cards, ordered for display (made part first). */
  cards: CardCode[];
  /** e.g. "Full House, Kings over Sevens". */
  description: string;
}

const rankName = (r: number) => RANK_NAMES[r as Rank];
const rankPlural = (r: number) => RANK_PLURALS[r as Rank];

function scoreOf(category: number, ranks: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return s;
}

function describe(category: HandCategory, ranks: number[]): string {
  const [a = 0, b = 0] = ranks;
  switch (category) {
    case HandCategory.StraightFlush:
      return a === 14 ? 'Royal Flush' : `Straight Flush, ${rankName(a)}-high`;
    case HandCategory.FourOfAKind:
      return `Four of a Kind, ${rankPlural(a)}`;
    case HandCategory.FullHouse:
      return `Full House, ${rankPlural(a)} over ${rankPlural(b)}`;
    case HandCategory.Flush:
      return `Flush, ${rankName(a)}-high`;
    case HandCategory.Straight:
      return `Straight, ${rankName(a)}-high`;
    case HandCategory.ThreeOfAKind:
      return `Three of a Kind, ${rankPlural(a)}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${rankPlural(a)} and ${rankPlural(b)}`;
    case HandCategory.Pair:
      return `Pair of ${rankPlural(a)}`;
    default:
      return `High Card, ${rankName(a)}`;
  }
}

/** Evaluates exactly five cards. */
export function evaluate5(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error(`evaluate5 needs 5 cards, got ${cards.length}`);
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // Groups ordered by size, then rank (e.g. full house: trips first).
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const distinct = groups.map(([r]) => r).sort((x, y) => y - x);
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) straightHigh = distinct[0]!;
    else if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) straightHigh = 5; // A-2-3-4-5 "wheel"
  }

  let category: HandCategory;
  let ranks: number[];
  if (straightHigh && flush) {
    category = HandCategory.StraightFlush;
    ranks = [straightHigh];
  } else if (groups[0]![1] === 4) {
    category = HandCategory.FourOfAKind;
    ranks = [groups[0]![0], groups[1]![0]];
  } else if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    category = HandCategory.FullHouse;
    ranks = [groups[0]![0], groups[1]![0]];
  } else if (flush) {
    category = HandCategory.Flush;
    ranks = distinct;
  } else if (straightHigh) {
    category = HandCategory.Straight;
    ranks = [straightHigh];
  } else if (groups[0]![1] === 3) {
    category = HandCategory.ThreeOfAKind;
    ranks = groups.map(([r]) => r);
  } else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    category = HandCategory.TwoPair;
    ranks = groups.map(([r]) => r);
  } else if (groups[0]![1] === 2) {
    category = HandCategory.Pair;
    ranks = groups.map(([r]) => r);
  } else {
    category = HandCategory.HighCard;
    ranks = distinct;
  }

  // Display order: made part first (bigger groups, higher ranks); straights run high → low with a wheel's ace last.
  const ordered = [...cards].sort((x, y) => {
    if (straightHigh) {
      const vx = straightHigh === 5 && x.rank === 14 ? 1 : x.rank;
      const vy = straightHigh === 5 && y.rank === 14 ? 1 : y.rank;
      return vy - vx;
    }
    return (counts.get(y.rank)! - counts.get(x.rank)!) || y.rank - x.rank;
  });

  const name = category === HandCategory.StraightFlush && straightHigh === 14 ? 'Royal Flush' : CATEGORY_NAMES[category];
  return {
    category,
    name,
    ranks,
    score: scoreOf(category, ranks),
    cards: ordered.map(cardToCode),
    description: describe(category, ranks),
  };
}

function toCards(cards: readonly (Card | CardCode)[]): Card[] {
  return cards.map((c) => (typeof c === 'string' ? parseCard(c) : c));
}

/** Best five-card hand from 5–7 cards (hole cards + board). Throws on duplicates. */
export function evaluateBest(input: readonly (Card | CardCode)[]): EvaluatedHand {
  const cards = toCards(input);
  if (cards.length < 5 || cards.length > 7) throw new Error(`Need 5–7 cards to evaluate, got ${cards.length}`);
  const seen = new Set<string>();
  for (const c of cards) {
    const code = cardToCode(c);
    if (seen.has(code)) throw new Error(`Duplicate card ${code}`);
    seen.add(code);
  }
  let best: EvaluatedHand | null = null;
  const n = cards.length;
  const pick: Card[] = [];
  const choose = (start: number) => {
    if (pick.length === 5) {
      const hand = evaluate5(pick);
      if (!best || hand.score > best.score) best = hand;
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]!);
      choose(i + 1);
      pick.pop();
    }
  };
  choose(0);
  return best!;
}

/** Alias matching the design notes: best hand from seven cards (also accepts 5 or 6). */
export const evaluate7 = evaluateBest;

/** >0 when a beats b, <0 when b beats a, 0 for a tie. */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.score - b.score;
}

/** How many leading ranks form the "made" part of a category (the rest are kickers). */
const MADE_RANKS: Record<HandCategory, number> = { 0: 1, 1: 1, 2: 2, 3: 1, 4: 1, 5: 1, 6: 2, 7: 1, 8: 1 };

/**
 * When `winner` beats `loser` inside the same category and made ranks, names the
 * deciding kicker ("Queen kicker"); otherwise null.
 */
export function kickerNote(winner: EvaluatedHand, loser: EvaluatedHand): string | null {
  if (winner.category !== loser.category || winner.score <= loser.score) return null;
  const made = MADE_RANKS[winner.category];
  for (let i = 0; i < winner.ranks.length; i++) {
    if (winner.ranks[i] !== loser.ranks[i]) {
      if (i < made) return null;
      return `${rankName(winner.ranks[i]!)} kicker`;
    }
  }
  return null;
}
