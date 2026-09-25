import { describe, expect, it } from 'vitest';
import { createDeck } from '../cards/index.ts';
import { HandCategory, compareHands, evaluate5, evaluate7, evaluateBest, kickerNote } from './evaluator.ts';

const ev = (cards: string) => evaluateBest(cards.split(' '));
/** Compare two card strings: >0 when a wins. */
const cmp = (a: string, b: string) => compareHands(ev(a), ev(b));

describe('hand categories and descriptions', () => {
  const cases: Array<[string, HandCategory, string]> = [
    ['As Ks Qs Js Ts', HandCategory.StraightFlush, 'Royal Flush'],
    ['9h 8h 7h 6h 5h', HandCategory.StraightFlush, 'Straight Flush, Nine-high'],
    ['5d 4d 3d 2d Ad', HandCategory.StraightFlush, 'Straight Flush, Five-high'],
    ['Qc Qd Qh Qs 2c', HandCategory.FourOfAKind, 'Four of a Kind, Queens'],
    ['Kc Kd Kh 7s 7c', HandCategory.FullHouse, 'Full House, Kings over Sevens'],
    ['Ah Jh 8h 4h 2h', HandCategory.Flush, 'Flush, Ace-high'],
    ['Ts 9h 8d 7c 6s', HandCategory.Straight, 'Straight, Ten-high'],
    ['Ad Ks Qh Jc Td', HandCategory.Straight, 'Straight, Ace-high'],
    ['Ac 2d 3h 4s 5c', HandCategory.Straight, 'Straight, Five-high'],
    ['8c 8d 8h Ks 2c', HandCategory.ThreeOfAKind, 'Three of a Kind, Eights'],
    ['Ac Ad 4h 4s 9c', HandCategory.TwoPair, 'Two Pair, Aces and Fours'],
    ['Jc Jd 9h 5s 2c', HandCategory.Pair, 'Pair of Jacks'],
    ['Ac Jd 9h 5s 2c', HandCategory.HighCard, 'High Card, Ace'],
  ];
  for (const [cards, category, description] of cases) {
    it(`${cards} → ${description}`, () => {
      const hand = ev(cards);
      expect(hand.category).toBe(category);
      expect(hand.description).toBe(description);
    });
  }

  it('orders categories correctly', () => {
    const ladder = [
      'Ac Jd 9h 5s 2c',
      'Jc Jd 9h 5s 2c',
      'Ac Ad 4h 4s 9c',
      '8c 8d 8h Ks 2c',
      'Ac 2d 3h 4s 5c',
      'Ah Jh 8h 4h 2h',
      'Kc Kd Kh 7s 7c',
      'Qc Qd Qh Qs 2c',
      '5d 4d 3d 2d Ad',
      'As Ks Qs Js Ts',
    ];
    for (let i = 1; i < ladder.length; i++) expect(cmp(ladder[i]!, ladder[i - 1]!)).toBeGreaterThan(0);
  });

  it('names the royal flush', () => {
    expect(ev('Th Jh Qh Kh Ah').name).toBe('Royal Flush');
    expect(ev('9h Th Jh Qh Kh').name).toBe('Straight Flush');
  });
});

describe('wheel straight A-2-3-4-5', () => {
  it('counts the ace low', () => {
    const hand = ev('Ah 2c 3d 4s 5h');
    expect(hand.category).toBe(HandCategory.Straight);
    expect(hand.ranks).toEqual([5]);
    expect(hand.cards).toEqual(['5h', '4s', '3d', '2c', 'Ah']);
  });
  it('loses to a six-high straight', () => {
    expect(cmp('2c 3d 4s 5h 6c', 'Ah 2c 3d 4s 5h')).toBeGreaterThan(0);
  });
  it('beats three of a kind', () => {
    expect(cmp('Ah 2c 3d 4s 5h', 'Ac Ad As Ks Qh')).toBeGreaterThan(0);
  });
  it('does not wrap around the ace (Q-K-A-2-3 is not a straight)', () => {
    expect(ev('Qh Kd Ac 2s 3h').category).toBe(HandCategory.HighCard);
  });
  it('finds the wheel inside seven cards and prefers a higher straight when present', () => {
    expect(ev('Ah 2c 3d 4s 5h Kc Kd').description).toBe('Straight, Five-high');
    expect(ev('Ah 2c 3d 4s 5h 6d Kd').description).toBe('Straight, Six-high');
  });
  it('steel wheel is a straight flush', () => {
    expect(ev('As 2s 3s 4s 5s Ks Qs').description).toBe('Straight Flush, Five-high');
  });
});

describe('kickers', () => {
  it('pair: kickers decide in order', () => {
    expect(cmp('Jc Jd Ah 5s 2c', 'Jh Js Kh 5d 2d')).toBeGreaterThan(0);
    expect(cmp('Jc Jd Ah 9s 2c', 'Jh Js Ad 8d 7d')).toBeGreaterThan(0);
    expect(cmp('Jc Jd Ah 9s 3c', 'Jh Js Ad 9d 2d')).toBeGreaterThan(0);
  });
  it('higher pair beats better kickers', () => {
    expect(cmp('Qc Qd 4h 3s 2c', 'Jh Js Ad Kd Qh')).toBeGreaterThan(0);
  });
  it('two pair: top pair, then second pair, then kicker', () => {
    expect(cmp('Kc Kd 3h 3s 2c', 'Qh Qs Jd Jc Ah')).toBeGreaterThan(0);
    expect(cmp('Kc Kd 5h 5s 2c', 'Kh Ks 4d 4c Ah')).toBeGreaterThan(0);
    expect(cmp('Kc Kd 5h 5s Qc', 'Kh Ks 5d 5c Jh')).toBeGreaterThan(0);
  });
  it('trips: kickers decide', () => {
    expect(cmp('8c 8d 8h As 2c', '8c 8d 8h Ks Qc')).toBeGreaterThan(0);
    expect(cmp('8c 8d 8h As 3c', '8c 8d 8h Ad 2c')).toBeGreaterThan(0);
  });
  it('quads: kicker decides when the quads are shared', () => {
    expect(cmp('9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc')).toBeGreaterThan(0);
  });
  it('high card compares all five cards', () => {
    expect(cmp('Ac Qd 9h 5s 3c', 'Ah Qs 9d 5c 2h')).toBeGreaterThan(0);
    expect(cmp('Ac Kd 4h 3s 2c', 'Ah Qs Jd Tc 8h')).toBeGreaterThan(0);
  });
  it('only the best five cards play: a sixth/seventh card never kicks', () => {
    // Board A K Q J 9; both players' best five are the board's A-K-Q-J + their best other card.
    expect(cmp('2c 3d Ah Kd Qs Jc 9h', '4c 5d Ah Kd Qs Jc 9h')).toBe(0);
  });
  it('kickerNote names the deciding kicker', () => {
    expect(kickerNote(ev('Jc Jd Ah 9s 3c'), ev('Jh Js Kd 9d 2d'))).toBe('Ace kicker');
    expect(kickerNote(ev('Kc Kd 5h 5s Qc'), ev('Kh Ks 5d 5c Jh'))).toBe('Queen kicker');
    expect(kickerNote(ev('Qc Qd 4h 3s 2c'), ev('Jh Js Ad Kd Qh'))).toBeNull();
    expect(kickerNote(ev('Kc Kd Kh 7s 7c'), ev('Kc Kd Kh 6s 6c'))).toBeNull();
    expect(kickerNote(ev('Jh Js Kd 9d 2d'), ev('Jc Jd Ah 9s 3c'))).toBeNull();
  });
});

describe('full house comparisons', () => {
  it('trips rank decides first', () => {
    expect(cmp('Kc Kd Kh 2s 2c', 'Qc Qd Qh As Ac')).toBeGreaterThan(0);
  });
  it('pair rank decides when trips match', () => {
    expect(cmp('Kc Kd Kh 9s 9c', 'Kc Kd Kh 7s 7c')).toBeGreaterThan(0);
  });
  it('picks the best full house from two sets of trips', () => {
    const hand = ev('7c 7d 7h Ks Kc Kd 2h');
    expect(hand.description).toBe('Full House, Kings over Sevens');
  });
  it('picks the best pair for the full house', () => {
    expect(ev('7c 7d 7h Ks Kc 2d 2h').description).toBe('Full House, Sevens over Kings');
  });
  it('full house beats a flush in the same seven cards', () => {
    expect(ev('Ah Kh 9h 2h 9c 9d Ac').category).toBe(HandCategory.FullHouse);
  });
});

describe('flush comparisons', () => {
  it('compares the highest card first', () => {
    expect(cmp('Ah 9h 7h 4h 2h', 'Kd Qd Jd 9d 7d')).toBeGreaterThan(0);
  });
  it('then every lower card', () => {
    expect(cmp('Ah Kh 7h 4h 2h', 'Ad Qd Jd 9d 7d')).toBeGreaterThan(0);
    expect(cmp('Ah Kh Qh 4h 3h', 'Ad Kd Qd 4d 2d')).toBeGreaterThan(0);
  });
  it('uses the best five suited cards out of six', () => {
    const hand = ev('Ah Kh 9h 5h 3h 2h 2c');
    expect(hand.description).toBe('Flush, Ace-high');
    expect(hand.cards).toEqual(['Ah', 'Kh', '9h', '5h', '3h']);
  });
  it('identical flush ranks in different suits tie', () => {
    expect(cmp('Ah Kh 7h 4h 2h', 'Ad Kd 7d 4d 2d')).toBe(0);
  });
  it('straight flush beats a higher plain flush in seven cards', () => {
    expect(ev('5h 6h 7h 8h 9h Ah Kh').description).toBe('Straight Flush, Nine-high');
  });
});

describe('ties and best-five selection', () => {
  it('suits never break ties', () => {
    expect(cmp('Ac Kd Qh Js 9c', 'Ad Kc Qs Jh 9d')).toBe(0);
    expect(cmp('Ts 9h 8d 7c 6s', 'Th 9s 8c 7d 6h')).toBe(0);
  });
  it('board plays for both players', () => {
    const board = 'As Ks Qd Jh Tc';
    expect(cmp(`2c 3d ${board}`, `4h 5h ${board}`)).toBe(0);
  });
  it('picks the highest straight among six connected cards', () => {
    expect(ev('4c 5d 6h 7s 8c 9d 2h').description).toBe('Straight, Nine-high');
  });
  it('picks the best two pair out of three pairs, with the best kicker', () => {
    const hand = ev('Ac Ad Kh Ks 2c 2d Qh');
    expect(hand.description).toBe('Two Pair, Aces and Kings');
    expect(hand.ranks).toEqual([14, 13, 12]);
  });
  it('quads take the best kicker', () => {
    expect(ev('9c 9d 9h 9s 2c Ac Kd').ranks).toEqual([9, 14]);
  });
  it('display order puts the made part first', () => {
    expect(ev('2c Kd Kh 7s 7c').cards).toEqual(['Kd', 'Kh', '7s', '7c', '2c']);
    expect(ev('Kc Kd Kh 7s 7c').cards).toEqual(['Kc', 'Kd', 'Kh', '7s', '7c']);
  });
});

describe('input validation', () => {
  it('rejects duplicate cards and wrong counts', () => {
    expect(() => ev('As As Kd Qh Jc')).toThrow(/Duplicate/);
    expect(() => ev('As Kd Qh Jc')).toThrow();
    expect(() => ev('As Kd Qh Jc Tc 9c 8c 7c')).toThrow();
    expect(() => evaluate5([])).toThrow();
  });
  it('evaluate7 is the seven-card entry point', () => {
    expect(evaluate7(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']).name).toBe('Royal Flush');
  });
});

describe('exhaustive five-card enumeration', () => {
  it('matches the known category frequencies of all 2,598,960 hands', () => {
    const deck = createDeck();
    const counts = new Array(9).fill(0);
    const n = deck.length;
    const hand = new Array(5);
    for (let a = 0; a < n; a++) {
      hand[0] = deck[a];
      for (let b = a + 1; b < n; b++) {
        hand[1] = deck[b];
        for (let c = b + 1; c < n; c++) {
          hand[2] = deck[c];
          for (let d = c + 1; d < n; d++) {
            hand[3] = deck[d];
            for (let e = d + 1; e < n; e++) {
              hand[4] = deck[e];
              counts[evaluate5(hand).category]++;
            }
          }
        }
      }
    }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  }, 120_000);
});
