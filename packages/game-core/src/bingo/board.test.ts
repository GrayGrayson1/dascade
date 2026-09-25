import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { DEFAULT_BINGO_SETTINGS, type BingoSettings } from '@dascade/shared/games/bingo';
import {
  FREE,
  allTokens,
  boardSpec,
  callLabel,
  cardKey,
  centerIndex,
  columnForNumber,
  columnRange,
  dealCard,
  dealCards,
  drawToken,
  generateCard,
  isCallable,
  isValidCard,
  itemsPerCard,
  letterForNumber,
  remainingTokens,
  verifyCard,
  type BoardSpec,
} from './index.ts';

const numbers: BoardSpec = { mode: 'numbers', size: 5, free: true, poolSize: 75 };
const text = (size: number, poolSize: number, free = true): BoardSpec => ({ mode: 'text', size, free: free && size % 2 === 1, poolSize });

describe('board spec', () => {
  it('forces 5×5 in numbers mode and only allows a free square on odd sizes', () => {
    const s: BingoSettings = { ...DEFAULT_BINGO_SETTINGS, mode: 'numbers', size: 3 };
    expect(boardSpec(s)).toEqual({ mode: 'numbers', size: 5, free: true, poolSize: 75 });
    expect(boardSpec({ ...s, mode: 'text', size: 4, items: ['a', 'b'] })).toEqual({ mode: 'text', size: 4, free: false, poolSize: 2 });
    expect(boardSpec({ ...s, mode: 'text', size: 3, freeCenter: false, items: [] }).free).toBe(false);
  });

  it('computes centers and item counts', () => {
    expect(centerIndex(5)).toBe(12);
    expect(centerIndex(3)).toBe(4);
    expect(centerIndex(7)).toBe(24);
    expect(centerIndex(4)).toBeNull();
    expect(itemsPerCard({ size: 5, free: true })).toBe(24);
    expect(itemsPerCard({ size: 4, free: false })).toBe(16);
  });
});

describe('75-ball numbers', () => {
  it('maps columns to B I N G O ranges', () => {
    expect(columnRange(0)).toEqual({ min: 1, max: 15 });
    expect(columnRange(2)).toEqual({ min: 31, max: 45 });
    expect(columnRange(4)).toEqual({ min: 61, max: 75 });
    expect(columnForNumber(1)).toBe(0);
    expect(columnForNumber(15)).toBe(0);
    expect(columnForNumber(16)).toBe(1);
    expect(columnForNumber(75)).toBe(4);
    expect(letterForNumber(44)).toBe('N');
    expect(letterForNumber(60)).toBe('G');
    expect(() => columnForNumber(0)).toThrow();
    expect(() => columnForNumber(76)).toThrow();
    expect(() => columnRange(5)).toThrow();
  });

  it('labels calls', () => {
    expect(callLabel(numbers, 7)).toBe('B 7');
    expect(callLabel(numbers, 70)).toBe('O 70');
    expect(callLabel(text(3, 3), 1, ['a', 'b', 'c'])).toBe('b');
    expect(callLabel(text(3, 3), 9, ['a'])).toBe('#10');
  });

  it('generates legal cards: column ranges, unique numbers, free center', () => {
    const rng = createSeededRng('numbers');
    for (let i = 0; i < 300; i++) {
      const cells = generateCard(numbers, rng);
      expect(cells).toHaveLength(25);
      expect(cells[12]).toBe(FREE);
      expect(isValidCard(numbers, cells)).toBe(true);
      for (let idx = 0; idx < 25; idx++) {
        if (idx === 12) continue;
        const { min, max } = columnRange(idx % 5);
        expect(cells[idx]).toBeGreaterThanOrEqual(min);
        expect(cells[idx]).toBeLessThanOrEqual(max);
      }
      expect(new Set(cells).size).toBe(25);
    }
  });

  it('fills the center with an N number when the free square is off', () => {
    const spec = { ...numbers, free: false };
    const cells = generateCard(spec, createSeededRng('nofree'));
    expect(cells.includes(FREE)).toBe(false);
    expect(cells[12]).toBeGreaterThanOrEqual(31);
    expect(cells[12]).toBeLessThanOrEqual(45);
    expect(isValidCard(spec, cells)).toBe(true);
  });

  it('uses every number of a column over many cards (randomized, not fixed)', () => {
    const rng = createSeededRng('coverage');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) for (const v of generateCard(numbers, rng)) seen.add(v);
    seen.delete(FREE);
    expect(seen.size).toBe(75);
  });

  it('rejects invalid cards', () => {
    const good = generateCard(numbers, createSeededRng('v'));
    expect(isValidCard(numbers, good)).toBe(true);
    const wrongColumn = [...good];
    wrongColumn[0] = 70;
    expect(isValidCard(numbers, wrongColumn)).toBe(false);
    const dup = [...good];
    dup[5] = dup[0]!;
    expect(isValidCard(numbers, dup)).toBe(false);
    const noFree = [...good];
    noFree[12] = 40;
    expect(isValidCard(numbers, noFree)).toBe(false);
    expect(isValidCard(numbers, good.slice(0, 24))).toBe(false);
  });
});

describe('text cards', () => {
  it('samples unique items from the pool with a free center', () => {
    const spec = text(5, 40);
    const rng = createSeededRng('text');
    for (let i = 0; i < 100; i++) {
      const cells = generateCard(spec, rng);
      expect(cells[12]).toBe(FREE);
      const items = cells.filter((c) => c !== FREE);
      expect(items).toHaveLength(24);
      expect(new Set(items).size).toBe(24);
      for (const v of items) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(40);
      }
      expect(isValidCard(spec, cells)).toBe(true);
    }
  });

  it('supports every board size 3–7 with and without the free square', () => {
    for (const size of [3, 4, 5, 6, 7]) {
      for (const free of [true, false]) {
        const spec = text(size, size * size);
        spec.free = free && size % 2 === 1;
        const cells = generateCard(spec, createSeededRng(`s${size}${free}`));
        expect(cells).toHaveLength(size * size);
        expect(cells.filter((c) => c === FREE)).toHaveLength(spec.free ? 1 : 0);
        expect(isValidCard(spec, cells)).toBe(true);
      }
    }
  });

  it('requires a pool at least as large as the card', () => {
    expect(() => generateCard(text(5, 23), createSeededRng('x'))).toThrow(/at least 24/);
    expect(() => generateCard(text(4, 16), createSeededRng('x'))).not.toThrow();
    expect(() => generateCard(text(4, 15), createSeededRng('x'))).toThrow();
  });

  it('draws from the whole pool across many cards', () => {
    const spec = text(3, 30);
    const rng = createSeededRng('pool');
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) for (const v of generateCard(spec, rng)) seen.add(v);
    seen.delete(FREE);
    expect(seen.size).toBe(30);
  });
});

describe('reproducible, unique dealing', () => {
  it('the same seed deals the same cards; a different seed deals different ones', () => {
    const a = dealCards(numbers, 'SEED-1', 1, 10);
    const b = dealCards(numbers, 'SEED-1', 1, 10);
    const c = dealCards(numbers, 'SEED-2', 1, 10);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(dealCards(numbers, 'SEED-1', 2, 10)).not.toEqual(a);
  });

  it('never deals two identical cards, even from a tiny pool', () => {
    const cards = dealCards(numbers, 'uniq', 1, 60);
    expect(new Set(cards.map(cardKey)).size).toBe(60);
    // 3×3 with exactly 8 items + free: every card holds the same items, only the layout differs.
    const tiny = text(3, 8);
    const tinyCards = dealCards(tiny, 'tiny', 1, 60);
    expect(new Set(tinyCards.map(cardKey)).size).toBe(60);
    for (const cells of tinyCards) expect(isValidCard(tiny, cells)).toBe(true);
  });

  it('re-rolls deterministically on a collision', () => {
    const taken = new Set<string>();
    const first = dealCard(numbers, 's', 1, 1, taken);
    expect(first.attempt).toBe(0);
    // Pretend card 2's first layout is already taken: it must re-roll to attempt 1.
    const blocker = dealCard(numbers, 's', 1, 2, new Set()).cells;
    const taken2 = new Set([cardKey(blocker)]);
    const second = dealCard(numbers, 's', 1, 2, taken2);
    expect(second.attempt).toBe(1);
    expect(cardKey(second.cells)).not.toBe(cardKey(blocker));
    expect(taken2.has(cardKey(second.cells))).toBe(true);
  });

  it('verifies a card against the revealed seed', () => {
    const cards = dealCards(text(4, 20, false), 'verify', 3, 5);
    cards.forEach((cells, i) => expect(verifyCard(text(4, 20, false), 'verify', 3, i + 1, cells)).toBe(true));
    expect(verifyCard(text(4, 20, false), 'other', 3, 1, cards[0]!)).toBe(false);
    expect(verifyCard(text(4, 20, false), 'verify', 3, 2, cards[0]!)).toBe(false);
  });
});

describe('caller bag', () => {
  it('lists every token and what is left', () => {
    expect(allTokens(numbers)).toHaveLength(75);
    expect(allTokens(numbers)[0]).toBe(1);
    expect(allTokens(text(3, 12))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(remainingTokens(numbers, [1, 2, 75])).toHaveLength(72);
    expect(remainingTokens(numbers, [1, 2, 75]).includes(2)).toBe(false);
  });

  it('draws uniformly without repeats until the bag is empty', () => {
    const rng = createSeededRng('bag');
    const calls: number[] = [];
    for (let i = 0; i < 75; i++) {
      const t = drawToken(numbers, calls, rng);
      expect(t).not.toBeNull();
      expect(calls.includes(t!)).toBe(false);
      calls.push(t!);
    }
    expect(new Set(calls).size).toBe(75);
    expect(drawToken(numbers, calls, rng)).toBeNull();
  });

  it('validates manual calls', () => {
    expect(isCallable(numbers, [], 1)).toBe(true);
    expect(isCallable(numbers, [1], 1)).toBe(false);
    expect(isCallable(numbers, [], 0)).toBe(false);
    expect(isCallable(numbers, [], 76)).toBe(false);
    expect(isCallable(text(3, 10), [], 0)).toBe(true);
    expect(isCallable(text(3, 10), [], 10)).toBe(false);
    expect(isCallable(text(3, 10), [], 1.5)).toBe(false);
  });
});
