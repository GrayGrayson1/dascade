import { describe, expect, it } from 'vitest';
import { TurnOrder } from './turns.ts';

const all = () => true;

describe('TurnOrder', () => {
  it('gives every player one turn per round in order', () => {
    const order = new TurnOrder();
    expect(order.startRound(['a', 'b', 'c'])).toBe(1);
    expect(order.next(all)).toBe('a');
    expect(order.next(all)).toBe('b');
    expect(order.next(all)).toBe('c');
    expect(order.next(all)).toBeNull();
    expect(order.startRound(['a', 'b', 'c'])).toBe(2);
    expect(order.next(all)).toBe('a');
    expect(order.round).toBe(2);
  });

  it('adds late joiners to the current round once', () => {
    const order = new TurnOrder();
    order.add('z'); // before any round: ignored
    order.startRound(['a', 'b']);
    order.next(all);
    order.add('c');
    order.add('c');
    order.add('a'); // already drew this round
    expect(order.pending).toEqual(['b', 'c']);
    expect(order.turnsThisRound).toBe(3);
  });

  it('drops players who leave and skips players who cannot draw', () => {
    const order = new TurnOrder();
    order.startRound(['a', 'b', 'c', 'd']);
    order.remove('b');
    const offline = new Set(['c']);
    expect(order.next((id) => !offline.has(id))).toBe('a');
    expect(order.next((id) => !offline.has(id))).toBe('d');
    expect(order.done).toEqual(['a', 'c', 'd']);
    expect(order.next(all)).toBeNull();
  });

  it('dedupes the starting list and resets cleanly', () => {
    const order = new TurnOrder();
    order.startRound(['a', 'a', 'b']);
    expect(order.pending).toEqual(['a', 'b']);
    order.reset();
    expect(order.round).toBe(0);
    expect(order.pending).toEqual([]);
    expect(order.next(all)).toBeNull();
  });
});
