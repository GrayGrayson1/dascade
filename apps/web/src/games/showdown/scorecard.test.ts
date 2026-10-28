import { describe, expect, it } from 'vitest';
import type { ShowdownMyGuess } from '@dascade/shared/games/showdown';
import { flashText, medalList, newlyPaid, ordinal, rankWords, scorecardRows, summaryWords } from './scorecard.ts';

const hidden = (n: number) => Array.from({ length: n }, () => ({ revealed: false }));
const guess = (text: string, pos: number, over: Partial<ShowdownMyGuess> = {}): ShowdownMyGuess => ({
  text,
  slot: -1,
  points: 0,
  pos,
  ...over,
});

describe('scorecardRows — the Top 10', () => {
  it('numbers one row per answer on the board; free rows are open while the question is up', () => {
    const m = scorecardRows({ slots: hidden(10), guesses: [], limit: 10, live: true });
    expect(m.rows).toHaveLength(10);
    expect(m.rows.map((r) => r.pos)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.rows.every((r) => r.state === 'open')).toBe(true);
    expect(m).toMatchObject({ used: 0, limit: 10, left: 10, open: true, loose: [] });
  });

  it('locks a guess into its spot; the rest close once the limit is reached or the question is down', () => {
    const guesses = [guess('Ghost', 1), guess('Witch', 4)];
    const m = scorecardRows({ slots: hidden(6), guesses, limit: 2, live: true });
    expect(m.rows.map((r) => r.state)).toEqual(['closed', 'locked', 'closed', 'closed', 'locked', 'closed']);
    expect(m.rows[1]).toMatchObject({ text: 'Ghost', called: false, points: 0 });
    expect(m).toMatchObject({ used: 2, left: 0, open: false });
    const down = scorecardRows({ slots: hidden(6), guesses: [], limit: 10, live: false });
    expect(down.rows.every((r) => r.state === 'closed')).toBe(true);
    expect(down.open).toBe(false);
  });

  it('a spot whose answer flipped (and holds no guess of yours) is filled in by the board', () => {
    const slots = [{ revealed: true, text: 'Candy corn' }, { revealed: false }, { revealed: true, text: 'Bats' }];
    const m = scorecardRows({ slots, guesses: [guess('Bats', 2, { slot: 2, points: 8, bonus: 1 })], limit: 10, live: true });
    expect(m.rows[0]).toMatchObject({ state: 'board', text: 'Candy corn', called: false });
    expect(m.rows[1]!.state).toBe('open');
    expect(m.rows[2]).toMatchObject({ state: 'locked', text: 'Bats', called: true, points: 8, bonus: 1, spotAnswer: '' });
  });

  it('shows what you called once it flips: points, the spot bonus, a hidden gem', () => {
    const slots = hidden(10).map((s, i) => (i === 9 ? { revealed: true, text: 'Mummy' } : s));
    const m = scorecardRows({ slots, guesses: [guess('mummies', 9, { slot: 9, points: 2, bonus: 1, gem: true })], limit: 10, live: false });
    expect(m.rows[9]).toMatchObject({ state: 'locked', called: true, points: 2, bonus: 1, gem: true });
  });

  it('a locked guess that missed its spot shows the answer that belongs there (it may still call another)', () => {
    const slots = [{ revealed: true, text: 'Ghost' }, { revealed: false }];
    const m = scorecardRows({ slots, guesses: [guess('Witch', 0)], limit: 3, live: true });
    expect(m.rows[0]).toMatchObject({ state: 'locked', text: 'Witch', called: false, spotAnswer: 'Ghost' });
  });

  it('a repeat spelling is on the board but never scores', () => {
    const slots = [{ revealed: true, text: 'Ghost' }, { revealed: false }];
    const m = scorecardRows({
      slots,
      guesses: [guess('ghost', 1, { slot: 0, points: 10 }), guess('ghosts', 0, { slot: 0, points: 0 })],
      limit: 3,
      live: true,
    });
    expect(m.rows[0]).toMatchObject({ called: false, repeat: true, points: 0 });
    expect(m.rows[1]).toMatchObject({ called: true, points: 10 });
  });

  it('never invents an answer: an unrevealed slot has no text, and no guess shows a match before its flip', () => {
    const m = scorecardRows({ slots: hidden(3), guesses: [guess('Secret', 0)], limit: 3, live: true });
    expect(m.rows.map((r) => r.spotAnswer)).toEqual(['', '', '']);
    expect(m.rows.filter((r) => r.state !== 'locked').every((r) => r.text === '')).toBe(true);
  });

  it('keeps guesses without a spot (an older phone) and never drops a second guess for the same spot', () => {
    const m = scorecardRows({
      slots: hidden(3),
      guesses: [guess('A', -1), guess('B', 1), guess('C', 1), guess('D', 7)],
      limit: 10,
      live: true,
    });
    expect(m.rows[1]!.text).toBe('B');
    expect(m.loose.map((g) => g.text)).toEqual(['A', 'C', 'D']);
    expect(m.used).toBe(4);
  });

  it('an empty board (before the question) has no rows', () => {
    expect(scorecardRows({ slots: [], guesses: [], limit: 10, live: false }).rows).toEqual([]);
  });
});

describe('words', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });

  it('rank words: "4th of 38", "Tied 2nd of 38", nothing without points', () => {
    expect(rankWords(4, 38)).toBe('4th of 38');
    expect(rankWords(2, 38, true)).toBe('Tied 2nd of 38');
    expect(rankWords(0, 38)).toBe('');
    expect(rankWords(1, 0)).toBe('1st');
  });

  it('the summary line', () => {
    expect(summaryWords({ points: 27, rank: 4, of: 38 })).toBe('27 pts · 4th of 38');
    expect(summaryWords({ points: 1, rank: 9, of: 9 })).toBe('1 pt · 9th of 9');
    expect(summaryWords({ points: 0, rank: 0, of: 12 })).toMatch(/^0 pts/);
    expect(summaryWords(null)).toMatch(/^0 pts/);
  });

  it('lists only the medals you hold, in medal order', () => {
    expect(medalList({ pumpkin: 0, gold: 2, silver: 0, bronze: 1, ribbon: 1 }).map((m) => [m.kind, m.n])).toEqual([
      ['gold', 2],
      ['bronze', 1],
      ['ribbon', 1],
    ]);
    expect(medalList(null)).toEqual([]);
  });
});

describe('the "Called it!" flash', () => {
  it('fires only for a guess that just started paying (never on load, never for Undo)', () => {
    const before = [guess('Ghost', 0), guess('Bats', 3)];
    const after = [guess('Ghost', 0, { slot: 0, points: 10, bonus: 1 }), guess('Bats', 3)];
    expect(newlyPaid(before, after).map((g) => g.text)).toEqual(['Ghost']);
    expect(newlyPaid([], after)).toEqual([]);
    expect(newlyPaid(after, before)).toEqual([]);
    expect(newlyPaid(after, after)).toEqual([]);
  });

  it('says what it paid', () => {
    expect(flashText([guess('Ghost', 1, { slot: 1, points: 9, bonus: 1 })])).toBe('Called it! +9, +1 spot on');
    expect(flashText([guess('Ghost', 4, { slot: 1, points: 9 })])).toBe('Called it! +9');
    expect(flashText([guess('Mummy', 9, { slot: 9, points: 2, gem: true })])).toBe('Called it! +2 (hidden gem)');
    expect(flashText([guess('A', 0, { slot: 0, points: 10, bonus: 1 }), guess('B', 5, { slot: 2, points: 8 })])).toBe(
      'Called 2! +18, +1 spot on',
    );
    expect(flashText([guess('J', 9, { slot: 9, points: 1, bonus: 1 })], 1)).toBe('Called it! +1, +1 spot on Perfect list! +20');
    expect(flashText([])).toBe('');
  });
});
