/** The hand-rankings reference: every Hold'em hand, best first, with an example. */
import { CATEGORY_NAMES, HandCategory, evaluateBest } from '@dascade/game-core/holdem';
import { parseCard } from '@dascade/game-core/cards';

export interface HandRankingRow {
  key: string;
  category: HandCategory;
  name: string;
  /** One plain line on what makes the hand. */
  blurb: string;
  /** An example five, the cards that make the hand first. */
  cards: readonly string[];
  /** How many of `cards` make the hand; the rest are kickers. */
  made: number;
}

export const HAND_RANKINGS: readonly HandRankingRow[] = [
  { key: 'royal', category: HandCategory.StraightFlush, name: 'Royal Flush', blurb: 'A, K, Q, J and 10, all one suit', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], made: 5 },
  {
    key: 'straight-flush',
    category: HandCategory.StraightFlush,
    name: CATEGORY_NAMES[HandCategory.StraightFlush],
    blurb: 'Five in a row, all one suit',
    cards: ['9h', '8h', '7h', '6h', '5h'],
    made: 5,
  },
  { key: 'quads', category: HandCategory.FourOfAKind, name: CATEGORY_NAMES[HandCategory.FourOfAKind], blurb: 'Four cards of one rank', cards: ['Qc', 'Qd', 'Qh', 'Qs', '7d'], made: 4 },
  {
    key: 'full-house',
    category: HandCategory.FullHouse,
    name: CATEGORY_NAMES[HandCategory.FullHouse],
    blurb: 'Three of a kind plus a pair',
    cards: ['Kc', 'Kd', 'Kh', '7s', '7h'],
    made: 5,
  },
  { key: 'flush', category: HandCategory.Flush, name: CATEGORY_NAMES[HandCategory.Flush], blurb: 'Any five cards of one suit', cards: ['Ad', 'Jd', '8d', '6d', '3d'], made: 5 },
  {
    key: 'straight',
    category: HandCategory.Straight,
    name: CATEGORY_NAMES[HandCategory.Straight],
    blurb: 'Five in a row, any suits (A-2-3-4-5 counts)',
    cards: ['Tc', '9d', '8s', '7h', '6c'],
    made: 5,
  },
  {
    key: 'trips',
    category: HandCategory.ThreeOfAKind,
    name: CATEGORY_NAMES[HandCategory.ThreeOfAKind],
    blurb: 'Three cards of one rank',
    cards: ['8c', '8d', '8s', 'Kh', '4c'],
    made: 3,
  },
  { key: 'two-pair', category: HandCategory.TwoPair, name: CATEGORY_NAMES[HandCategory.TwoPair], blurb: 'Two different pairs', cards: ['Jh', 'Js', '4c', '4d', 'Ac'], made: 4 },
  { key: 'pair', category: HandCategory.Pair, name: CATEGORY_NAMES[HandCategory.Pair], blurb: 'Two cards of one rank', cards: ['Ah', 'Ad', 'Kc', '9s', '5h'], made: 2 },
  {
    key: 'high-card',
    category: HandCategory.HighCard,
    name: CATEGORY_NAMES[HandCategory.HighCard],
    blurb: 'None of the above: the highest card plays',
    cards: ['Ac', 'Qd', '9h', '6s', '3c'],
    made: 1,
  },
];

/**
 * Which row the hero's hand is on right now (their own two cards plus the board), or null with no
 * cards. Pre-flop that's a pocket pair or a high card. Uses only cards this client may see.
 */
export function heroRankingKey(hole: readonly string[], board: readonly string[]): string | null {
  if (hole.length !== 2) return null;
  try {
    if (board.length < 3) return parseCard(hole[0]!).rank === parseCard(hole[1]!).rank ? 'pair' : 'high-card';
    const best = evaluateBest([...hole, ...board]);
    if (best.category === HandCategory.StraightFlush && best.ranks[0] === 14) return 'royal';
    return HAND_RANKINGS.find((r) => r.key !== 'royal' && r.category === best.category)?.key ?? null;
  } catch {
    return null;
  }
}

const RANK_WORDS: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };
const SUIT_WORDS: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

/** "Ace of spades, King of spades, …" for screen readers. */
export function cardsLabel(cards: readonly string[]): string {
  return cards.map((c) => `${RANK_WORDS[c[0]!] ?? c[0]} of ${SUIT_WORDS[c[1]!] ?? ''}`).join(', ');
}
