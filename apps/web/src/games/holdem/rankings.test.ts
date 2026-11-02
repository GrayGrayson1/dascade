import { describe, expect, it } from 'vitest';
import { evaluateBest } from '@dascade/game-core/holdem';
import { HAND_RANKINGS, cardsLabel, heroRankingKey } from './rankings.ts';

describe('HAND_RANKINGS', () => {
  it('lists all ten hands, each example evaluating to the hand it illustrates', () => {
    expect(HAND_RANKINGS).toHaveLength(10);
    for (const row of HAND_RANKINGS) {
      const best = evaluateBest([...row.cards]);
      expect(best.category, row.name).toBe(row.category);
      expect(best.name, row.key).toBe(row.name);
      expect(new Set(row.cards).size).toBe(5);
    }
  });

  it('is ordered best first, every example beating the next one', () => {
    const scores = HAND_RANKINGS.map((r) => evaluateBest([...r.cards]).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThan(scores[i]!);
  });

  it('the cards that make each hand come first; the dimmed rest are kickers', () => {
    for (const row of HAND_RANKINGS) {
      expect(row.made).toBeGreaterThanOrEqual(1);
      expect(row.made).toBeLessThanOrEqual(5);
      // Swapping a kicker for another card of a fresh rank never changes the hand.
      if (row.made < 5) expect(evaluateBest([...row.cards.slice(0, row.made), ...['2c', '3h', '5s', '6d'].slice(0, 5 - row.made)]).category).toBe(row.category);
    }
  });
});

describe('heroRankingKey', () => {
  it('no cards, no row', () => {
    expect(heroRankingKey([], [])).toBeNull();
    expect(heroRankingKey(['As'], ['Kd', 'Qd', 'Jd'])).toBeNull();
  });

  it('pre-flop: a pocket pair is a Pair, anything else a High Card', () => {
    expect(heroRankingKey(['9s', '9d'], [])).toBe('pair');
    expect(heroRankingKey(['As', 'Kd'], [])).toBe('high-card');
  });

  it('after the flop it follows the best five of hole cards plus board', () => {
    expect(heroRankingKey(['9s', '9d'], ['9h', '2c', '2d'])).toBe('full-house');
    expect(heroRankingKey(['Ah', 'Kd'], ['Qc', 'Js', 'Th', '2d'])).toBe('straight');
    expect(heroRankingKey(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2d', '3c'])).toBe('royal');
    expect(heroRankingKey(['9s', '8s'], ['7s', '6s', '5s'])).toBe('straight-flush');
    expect(heroRankingKey(['Ah', '4d'], ['Qc', '9s', '7h'])).toBe('high-card');
  });

  it('never throws on a malformed payload', () => {
    expect(heroRankingKey(['??', 'Xx'], ['Qc', '9s', '7h'])).toBeNull();
  });
});

describe('cardsLabel', () => {
  it('reads cards out in words', () => {
    expect(cardsLabel(['As', 'Td', '7h'])).toBe('Ace of spades, 10 of diamonds, 7 of hearts');
  });
});
