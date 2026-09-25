import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { cardToCode } from '../cards/index.ts';
import { Shoe } from './index.ts';

function drawCodes(shoe: Shoe, n: number): string[] {
  return Array.from({ length: n }, () => cardToCode(shoe.draw()));
}

describe('Shoe', () => {
  it('holds every card once per deck', () => {
    for (const decks of [1, 2, 6, 8]) {
      const shoe = new Shoe(decks, 75, createSeededRng(`comp-${decks}`));
      expect(shoe.size).toBe(52 * decks);
      expect(shoe.remaining).toBe(52 * decks);
      const counts = new Map<string, number>();
      for (const c of drawCodes(shoe, 52 * decks)) counts.set(c, (counts.get(c) ?? 0) + 1);
      expect(counts.size).toBe(52);
      for (const n of counts.values()) expect(n).toBe(decks);
    }
  });

  it('rejects impossible deck counts', () => {
    expect(() => new Shoe(0, 75, createSeededRng(1))).toThrow();
    expect(() => new Shoe(9, 75, createSeededRng(1))).toThrow();
    expect(() => new Shoe(2.5, 75, createSeededRng(1))).toThrow();
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = drawCodes(new Shoe(2, 75, createSeededRng('same')), 30);
    const b = drawCodes(new Shoe(2, 75, createSeededRng('same')), 30);
    const c = drawCodes(new Shoe(2, 75, createSeededRng('other')), 30);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('places the cut card at the configured penetration', () => {
    const shoe = new Shoe(1, 75, createSeededRng('cut'));
    expect(shoe.cutRemaining).toBe(13);
    drawCodes(shoe, 38);
    expect(shoe.needsShuffle).toBe(false);
    drawCodes(shoe, 1);
    expect(shoe.needsShuffle).toBe(true);
    expect(shoe.remaining).toBe(13);
    const six = new Shoe(6, 80, createSeededRng('cut6'));
    expect(six.cutRemaining).toBe(312 - Math.floor(312 * 0.8));
  });

  it('moves finished rounds to the discard tray and reshuffles everything', () => {
    const shoe = new Shoe(1, 75, createSeededRng('discard'));
    drawCodes(shoe, 10);
    expect(shoe.discards).toBe(0);
    shoe.endRound();
    expect(shoe.discards).toBe(10);
    drawCodes(shoe, 5);
    shoe.endRound();
    expect(shoe.discards).toBe(15);
    shoe.shuffle();
    expect(shoe.discards).toBe(0);
    expect(shoe.remaining).toBe(52);
    expect(shoe.needsShuffle).toBe(false);
    expect(shoe.shuffles).toBe(2);
  });

  it('refills from the discard tray (never the table) when a round drains the shoe', () => {
    const shoe = new Shoe(1, 90, createSeededRng('drain'));
    const first = drawCodes(shoe, 40);
    shoe.endRound();
    const onTable = drawCodes(shoe, 12);
    expect(shoe.remaining).toBe(0);
    const more = drawCodes(shoe, 5);
    for (const c of more) {
      expect(first).toContain(c);
      expect(onTable).not.toContain(c);
    }
    expect(shoe.needsShuffle).toBe(true);
    shoe.endRound();
    shoe.shuffle();
    expect(shoe.remaining).toBe(52);
  });

  it('can stack upcoming cards for tests without changing the composition', () => {
    const shoe = new Shoe(1, 75, createSeededRng('stack'));
    shoe.stackTop(['As', 'Kd', '8c', '8h']);
    expect(shoe.peekCodes(4)).toEqual(['As', 'Kd', '8c', '8h']);
    const all = drawCodes(shoe, 52);
    expect(all.slice(0, 4)).toEqual(['As', 'Kd', '8c', '8h']);
    expect(new Set(all).size).toBe(52);
  });
});
