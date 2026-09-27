import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { FORBIDDEN_POINTS } from '@dascade/shared/games/words';
import { WordDictionary } from './dictionary.ts';
import { FORBIDDEN_CATEGORIES, forbiddenCategory, type ForbiddenCategory } from './categories.ts';
import { FORBIDDEN_LETTER_POOL, categoryKeys, checkForbiddenAnswer, fairLetters, foldPlural, forbiddenFinalPoints, letterShare, phraseKey, pickForbiddenRound } from './forbidden.ts';

const FRUIT: ForbiddenCategory = {
  id: 'fruit',
  label: 'Fruit',
  hint: 'Fruit',
  members: ['apple', 'banana', 'cherry', 'kiwi', 'plum', 'fig', 'lime', 'lemon', 'mango', 'melon', 'grape', 'peach', 'pear', 'date', 'berry', 'ice cream'],
};
const DICT = WordDictionary.fromWords([
  'apple', 'apples', 'banana', 'cherry', 'cherries', 'kiwi', 'plum', 'plums', 'fig', 'figs', 'lime', 'lemon', 'mango', 'melon', 'grape', 'grapes',
  'peach', 'peaches', 'pear', 'date', 'berry', 'berries', 'ice', 'cream', 'durian', 'lychee', 'box', 'boxes', 'glass', 'shit', 'star', 'fruit',
]);

describe('plural folding + keys', () => {
  it('folds regular plurals only when the singular is a word', () => {
    expect(foldPlural('apples', DICT)).toBe('apple');
    expect(foldPlural('berries', DICT)).toBe('berry');
    expect(foldPlural('peaches', DICT)).toBe('peach');
    expect(foldPlural('boxes', DICT)).toBe('box');
    expect(foldPlural('glass', DICT)).toBe('glass');
    expect(foldPlural('kiwi', DICT)).toBe('kiwi');
    expect(foldPlural('bus')).toBe('bus');
  });
  it('phraseKey normalizes case, punctuation and plurals word by word', () => {
    expect(phraseKey('  Ice-Creams ', DICT)).toBe('ice cream');
    expect(phraseKey('CHERRIES', DICT)).toBe('cherry');
  });
});

describe('checkForbiddenAnswer', () => {
  const spec = { category: FRUIT, letter: 'e' };

  it('refuses answers that use the forbidden letter (any case, accents folded)', () => {
    expect(checkForbiddenAnswer('Lemon', spec, DICT)).toMatchObject({ ok: false, reason: 'forbidden_letter' });
    expect(checkForbiddenAnswer('PÉAR', spec, DICT)).toMatchObject({ ok: false, reason: 'forbidden_letter' });
  });

  it('approves known category members instantly (plurals fold)', () => {
    expect(checkForbiddenAnswer('Kiwi', spec, DICT)).toEqual({ ok: true, key: 'kiwi', display: 'kiwi', known: true, points: FORBIDDEN_POINTS.answer });
    expect(checkForbiddenAnswer('plums', spec, DICT)).toMatchObject({ ok: true, key: 'plum', known: true });
    expect(checkForbiddenAnswer('figs', spec, DICT)).toMatchObject({ ok: true, known: true });
  });

  it('dictionary-valid but unknown answers need a host decision', () => {
    expect(checkForbiddenAnswer('durian', { category: FRUIT, letter: 'e' }, DICT)).toMatchObject({ ok: true, known: false });
  });

  it('checks every word of multi-word answers against the dictionary', () => {
    const noX = { category: FRUIT, letter: 'x' };
    expect(checkForbiddenAnswer('ice cream', noX, DICT)).toMatchObject({ ok: true, key: 'ice cream', known: true });
    expect(checkForbiddenAnswer('ice-cream', noX, DICT)).toMatchObject({ ok: true, known: true });
    expect(checkForbiddenAnswer('icecream', noX, DICT)).toMatchObject({ ok: true, known: true }); // joined form of a member
    expect(checkForbiddenAnswer('ice qwrty', noX, DICT)).toMatchObject({ ok: false, reason: 'not_word' });
    expect(checkForbiddenAnswer('star fruit', noX, DICT)).toMatchObject({ ok: true, known: false });
  });

  it('rejects too short, too long, non-words and blocked words (masked)', () => {
    const noX = { category: FRUIT, letter: 'x' };
    expect(checkForbiddenAnswer('fi', noX, DICT)).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkForbiddenAnswer('fig fig fig fig', noX, DICT)).toMatchObject({ ok: false, reason: 'too_long' });
    expect(checkForbiddenAnswer('zzzzz', noX, DICT)).toMatchObject({ ok: false, reason: 'not_word' });
    expect(checkForbiddenAnswer('shit', noX, DICT)).toEqual({ ok: false, reason: 'blocked', display: 's***' });
  });

  it('scores approved answers; unique answers score extra', () => {
    expect(forbiddenFinalPoints(false)).toBe(FORBIDDEN_POINTS.answer);
    expect(forbiddenFinalPoints(true)).toBe(FORBIDDEN_POINTS.answer + FORBIDDEN_POINTS.unique);
  });
});

describe('letter choice', () => {
  it('fair letters bite (25–75% of members) but leave at least 12 answers', () => {
    for (const c of FORBIDDEN_CATEGORIES) {
      for (const l of fairLetters(c)) {
        const share = letterShare(c, l);
        expect(share).toBeGreaterThanOrEqual(0.25);
        expect(share).toBeLessThanOrEqual(0.75);
        expect(c.members.filter((m) => !m.includes(l)).length).toBeGreaterThanOrEqual(12);
        expect(FORBIDDEN_LETTER_POOL).toContain(l);
      }
    }
  });

  it('every shipped category has at least two fair letters, a label, a hint and unique id', () => {
    const ids = new Set<string>();
    for (const c of FORBIDDEN_CATEGORIES) {
      expect(fairLetters(c).length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.hint.length).toBeGreaterThan(2);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.members.length, c.id).toBeGreaterThanOrEqual(45);
      expect(new Set(c.members).size, `${c.id} has duplicate members`).toBe(c.members.length);
    }
    expect(FORBIDDEN_CATEGORIES.length).toBeGreaterThanOrEqual(30);
    expect(forbiddenCategory('fruit')?.label).toBe('Fruit');
  });

  it('picks unused categories first and a fair letter', () => {
    const rng = createSeededRng('forbid');
    const used = new Set<string>();
    for (let i = 0; i < FORBIDDEN_CATEGORIES.length; i++) {
      const spec = pickForbiddenRound(rng, used);
      expect(used.has(spec.category.id)).toBe(false);
      expect(fairLetters(spec.category)).toContain(spec.letter);
      used.add(spec.category.id);
    }
    // All used: falls back to any category.
    expect(pickForbiddenRound(rng, used).category).toBeDefined();
  });

  it('member keys include spaced, joined and plural-folded forms', () => {
    const keys = categoryKeys(FRUIT);
    expect(keys.has('ice cream')).toBe(true);
    expect(keys.has('icecream')).toBe(true);
  });
});
