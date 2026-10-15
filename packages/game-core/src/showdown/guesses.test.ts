import { describe, expect, it } from 'vitest';
import type { ShowdownRoundDef } from '@dascade/shared/games/showdown';
import { GuessBook, matchSlot } from './guesses.ts';

const ROUND: ShowdownRoundDef = {
  id: 't',
  prompt: 'Name something on a messy desk.',
  answers: [
    { text: 'Coffee mugs', points: 26, aliases: ['mug', 'coffee cup'] },
    { text: 'Papers', points: 22, aliases: ['documents'] },
    { text: 'Sticky notes', points: 15, aliases: ['post-its'] },
  ],
};
const OTHER: ShowdownRoundDef = {
  id: 'u',
  prompt: 'Name a pizza topping.',
  answers: [
    { text: 'Pepperoni', points: 39, aliases: [] },
    { text: 'Mushrooms', points: 14, aliases: ['mushroom'] },
    { text: 'Pineapple', points: 9, aliases: [] },
  ],
};

const none = [false, false, false];

describe('matchSlot', () => {
  it('matches answers, aliases and small typos; never unrelated words', () => {
    expect(matchSlot(ROUND, 'coffee mugs')).toBe(0);
    expect(matchSlot(ROUND, 'MUG')).toBe(0);
    expect(matchSlot(ROUND, 'Post its')).toBe(2);
    expect(matchSlot(ROUND, 'paperss')).toBe(1);
    expect(matchSlot(ROUND, 'Stapler')).toBe(-1);
    expect(matchSlot(ROUND, '')).toBe(-1);
  });
});

describe('GuessBook', () => {
  it('accepts up to three distinct guesses per round', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, ROUND, 'Stapler', none)).toEqual({ ok: true, slot: -1 });
    expect(book.submit('a', 0, ROUND, 'stapler!', none)).toEqual({ ok: false, reason: 'duplicate' });
    expect(book.submit('a', 0, ROUND, 'mug', none)).toEqual({ ok: true, slot: 0 });
    expect(book.submit('a', 0, ROUND, 'Lamp', none)).toEqual({ ok: true, slot: -1 });
    expect(book.submit('a', 0, ROUND, 'Papers', none)).toEqual({ ok: false, reason: 'limit' });
    expect(book.submit('a', 0, ROUND, '   ', none)).toEqual({ ok: false, reason: 'empty' });
    expect(book.count(0)).toBe(3);
    // A new round has a fresh allowance.
    expect(book.submit('a', 1, OTHER, 'Pepperoni', none)).toEqual({ ok: true, slot: 0 });
  });

  it('locks in a second spelling of the same hidden answer (no leak) but never scores or counts it twice', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, ROUND, 'mug', none)).toEqual({ ok: true, slot: 0 });
    // Answered exactly like a guess that isn't on the board: refusing it would reveal that "mug" is.
    expect(book.submit('a', 0, ROUND, 'coffee cup', none)).toEqual({ ok: true, slot: 0 });
    expect(book.submit('b', 0, ROUND, 'coffee mugs', none)).toEqual({ ok: true, slot: 0 });
    expect(book.count(0)).toBe(3);
    expect(book.matchesPerSlot(0, 3)).toEqual([2, 0, 0]);
    expect(book.cloud(0, ROUND)).toEqual([{ text: 'Coffee mugs', count: 2, slot: 0 }]);
    const after = book.me('a', 0, [ROUND], () => [true, false, false]);
    expect(after.guesses).toEqual([
      { text: 'mug', slot: 0, points: 26 },
      { text: 'coffee cup', slot: 0, points: 0 },
    ]);
    expect(after).toMatchObject({ points: 26, calls: 1 });
  });

  it('refuses a guess for an answer that is already on the board', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, ROUND, 'papers', [false, true, false])).toEqual({ ok: false, reason: 'revealed' });
  });

  it('keeps matches secret until the answer is revealed', () => {
    const book = new GuessBook();
    book.submit('a', 0, ROUND, 'Papers', none);
    const before = book.me('a', 0, [ROUND], () => none);
    expect(before.guesses).toEqual([{ text: 'Papers', slot: -1, points: 0 }]);
    expect(before.points).toBe(0);
    const after = book.me('a', 0, [ROUND], () => [false, true, false]);
    expect(after.guesses).toEqual([{ text: 'Papers', slot: 1, points: 22 }]);
    expect(after).toMatchObject({ points: 22, calls: 1 });
  });

  it('derives totals across rounds (an undone reveal takes its points back)', () => {
    const book = new GuessBook();
    book.submit('a', 0, ROUND, 'post its', none);
    book.submit('a', 1, OTHER, 'mushroom', none);
    book.submit('a', 1, OTHER, 'olives', none);
    const revealed: Record<number, boolean[]> = { 0: [false, false, true], 1: [true, true, false] };
    const me = book.me('a', 1, [ROUND, OTHER], (r) => revealed[r] ?? []);
    expect(me).toMatchObject({ round: 1, points: 15 + 14, calls: 2 });
    expect(me.guesses).toEqual([
      { text: 'mushroom', slot: 1, points: 14 },
      { text: 'olives', slot: -1, points: 0 },
    ]);
    revealed[1] = [true, false, false]; // undo
    expect(book.me('a', 1, [ROUND, OTHER], (r) => revealed[r] ?? []).points).toBe(15);
  });

  it('counts callers per slot only for revealed answers, and builds the presenter cloud', () => {
    const book = new GuessBook();
    book.submit('a', 0, ROUND, 'mug', none);
    book.submit('b', 0, ROUND, 'Coffee mugs', none);
    book.submit('c', 0, ROUND, 'papers', none);
    book.submit('c', 0, ROUND, 'Stapler', none);
    book.submit('d', 0, ROUND, 'stapler', none);
    book.submit('e', 0, ROUND, 'Lamp', none);
    expect(book.matchesPerSlot(0, 3)).toEqual([2, 1, 0]);
    expect(book.callers(0, [true, false, false])).toEqual([2, 0, 0]);
    expect(book.cloud(0, ROUND)).toEqual([
      { text: 'Coffee mugs', count: 2, slot: 0 },
      { text: 'Stapler', count: 2, slot: -1 },
      { text: 'Papers', count: 1, slot: 1 },
      { text: 'Lamp', count: 1, slot: -1 },
    ]);
    expect(book.cloud(0, ROUND, 2)).toHaveLength(2);
    expect(book.players()).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
    book.clear();
    expect(book.count(0)).toBe(0);
  });

  it('cleans and bounds guess text', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, ROUND, `  ${'x'.repeat(100)}\u0000  `, none)).toEqual({ ok: true, slot: -1 });
    expect(book.me('a', 0, [ROUND], () => none).guesses[0]!.text).toBe('x'.repeat(40));
  });
});
