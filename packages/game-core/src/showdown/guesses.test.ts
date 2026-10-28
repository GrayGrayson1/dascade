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

  it('takes the limit from the show’s setting (1–10 guesses per board)', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, ROUND, 'Lamp', none, 1)).toEqual({ ok: true, slot: -1 });
    expect(book.submit('a', 0, ROUND, 'mug', none, 1)).toEqual({ ok: false, reason: 'limit' });
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    for (const w of words) expect(book.submit('b', 0, ROUND, w, none, 10)).toMatchObject({ ok: true });
    expect(book.submit('b', 0, ROUND, 'eleven', none, 10)).toEqual({ ok: false, reason: 'limit' });
    expect(book.count(0)).toBe(11);
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

describe('GuessBook: the Top 10 scorecard', () => {
  const TEN: ShowdownRoundDef = {
    id: 'ten',
    prompt: 'Name a thing.',
    answers: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'].map((text) => ({
      text,
      points: 0,
      aliases: [],
    })),
  };
  const hidden = Array.from({ length: 10 }, () => false);

  it('locks each guess into a spot: a used spot, a spot whose answer is showing and a spot off the board are refused', () => {
    const book = new GuessBook();
    expect(book.submit('a', 0, TEN, 'Bravo', hidden, 10, 1)).toEqual({ ok: true, slot: 1 });
    expect(book.submit('a', 0, TEN, 'Echo', hidden, 10, 1)).toEqual({ ok: false, reason: 'spot' });
    const shown = hidden.map((_, i) => i === 3);
    expect(book.submit('a', 0, TEN, 'Echo', shown, 10, 3)).toEqual({ ok: false, reason: 'spotRevealed' });
    expect(book.submit('a', 0, ROUND, 'Lamp', none, 10, 5)).toEqual({ ok: false, reason: 'spotRange' });
    expect(book.mine('a', 0)).toEqual([expect.objectContaining({ text: 'Bravo', slot: 1, pos: 1, repeat: false })]);
    expect(book.me('a', 0, [TEN], () => hidden).guesses).toEqual([{ text: 'Bravo', slot: -1, points: 0, pos: 1 }]);
  });

  it('exports and imports for the black box (matches included, nothing re-matched)', () => {
    const book = new GuessBook();
    book.submit('a', 0, TEN, 'Bravo', hidden, 10, 0);
    book.submit('a', 0, TEN, 'bravoo', hidden, 10, 2);
    book.submit('b', 1, TEN, 'Zulu', hidden, 10, 9);
    const copy = new GuessBook();
    copy.import(JSON.parse(JSON.stringify(book.export())));
    expect(copy.round(0).get('a')).toEqual([
      expect.objectContaining({ slot: 1, pos: 0, repeat: false }),
      expect.objectContaining({ slot: 1, pos: 2, repeat: true }),
    ]);
    expect(copy.mine('b', 1)).toEqual([expect.objectContaining({ text: 'Zulu', slot: -1, pos: 9 })]);
    expect(copy.count(0)).toBe(2);
    // A repeat locked after the restore is still caught.
    expect(copy.submit('a', 0, TEN, 'Bravo', hidden, 10, 5)).toEqual({ ok: false, reason: 'duplicate' });
    // Junk is skipped, never thrown.
    copy.import([[0, [['x', [['ok', 1, 1, 0], 'junk', [1, 2]]]]], 'junk', null]);
    expect(copy.mine('x', 0)).toHaveLength(1);
    copy.import('nope');
    expect(copy.count(0)).toBe(0);
  });
});
