import { describe, expect, it } from 'vitest';
import { WordDictionary, normalizePhrase, normalizeWord } from './dictionary.ts';
import { BLOCKED_STEMS, BLOCKED_WORDS, containsBlockedWord, isBlockedWord, maskBlocked, spellsBlockedWord } from './blocklist.ts';

const TEXT = `# comment
[1]
cat
dog
tea
[2]
catalog
teapot
[3]
qat
zax
cats
`;

describe('normalizeWord / normalizePhrase', () => {
  it('lowercases, folds accents and full-width forms, keeps a–z only', () => {
    expect(normalizeWord('Café')).toBe('cafe');
    expect(normalizeWord('  NAÏVE! ')).toBe('naive');
    expect(normalizeWord('ｃａｔ')).toBe('cat');
    expect(normalizeWord("don't")).toBe('dont');
    expect(normalizeWord('a b-c 1')).toBe('abc');
  });
  it('phrases keep single spaces; hyphens and slashes split words', () => {
    expect(normalizePhrase('  Ice-Cream   Sundae ')).toBe('ice cream sundae');
    expect(normalizePhrase('Hot/Dog')).toBe('hot dog');
    expect(normalizePhrase('Crème brûlée!')).toBe('creme brulee');
  });
});

describe('WordDictionary', () => {
  const dict = WordDictionary.fromText(TEXT);

  it('parses tiers and comments', () => {
    expect(dict.size).toBe(8);
    expect(dict.tier('cat')).toBe(1);
    expect(dict.tier('catalog')).toBe(2);
    expect(dict.tier('qat')).toBe(3);
    expect(dict.tier('nope')).toBe(0);
    expect(dict.isCommon('dog')).toBe(true);
    expect(dict.isCommon('zax')).toBe(false);
  });

  it('accepts dictionary words and rejects everything else', () => {
    expect(dict.has('cat')).toBe(true);
    expect(dict.has('cats')).toBe(true);
    expect(dict.has('CAT')).toBe(false); // callers normalize first
    expect(dict.has('ca')).toBe(false);
    expect(dict.has('')).toBe(false);
  });

  it('answers prefix queries with a binary search', () => {
    expect(dict.hasPrefix('ca')).toBe(true);
    expect(dict.hasPrefix('cata')).toBe(true);
    expect(dict.hasPrefix('cb')).toBe(false);
    expect(dict.hasPrefix('zz')).toBe(false);
    expect(dict.wordsWithPrefix('cat')).toEqual(['cat', 'catalog', 'cats']);
    expect(dict.wordsWithPrefix('te', (w) => w.length > 3)).toEqual(['teapot']);
    const [a, b] = dict.prefixRange('d');
    expect(dict.all().slice(a, b)).toEqual(['dog']);
  });

  it('groups words by length', () => {
    expect(dict.ofLength(3)).toEqual(['cat', 'dog', 'qat', 'tea', 'zax']);
    expect(dict.ofLength(7)).toEqual(['catalog']);
    expect(dict.ofLength(12)).toEqual([]);
  });

  it('drops bad shapes, out-of-range lengths and blocked words; keeps the best tier', () => {
    const d = WordDictionary.fromEntries([
      ['ok', 1],
      ['fine', 3],
      ['fine', 1],
      ['Mixed', 1],
      ['has space', 1],
      ['abcdefghijklmnop', 1],
      ['shit', 1],
      ['bastard', 2],
      ['therapist', 2],
    ]);
    expect(d.has('ok')).toBe(false);
    expect(d.tier('fine')).toBe(1);
    expect(d.has('mixed')).toBe(true);
    expect(d.has('abcdefghijklmnop')).toBe(false);
    expect(d.has('shit')).toBe(false);
    expect(d.has('bastard')).toBe(false);
    expect(d.has('therapist')).toBe(true);
  });

  it('fromWords marks common words tier 1', () => {
    const d = WordDictionary.fromWords(['alpha', 'beta'], ['gamma', 'alpha']);
    expect(d.tier('alpha')).toBe(1);
    expect(d.tier('beta')).toBe(3);
    expect(d.tier('gamma')).toBe(1);
  });
});

describe('office-safe blocklist', () => {
  it('blocks exact words and every carrier of a blocked stem', () => {
    for (const w of BLOCKED_WORDS) expect(isBlockedWord(w)).toBe(true);
    for (const s of BLOCKED_STEMS) expect(isBlockedWord(`${s}ing`)).toBe(true);
    expect(isBlockedWord('Bullshit')).toBe(true);
    expect(isBlockedWord('motherfucker')).toBe(true);
  });

  it('does not block innocent words that merely contain a short blocked word', () => {
    for (const w of ['therapist', 'swanky', 'saltwater', 'wristwatch', 'snigger', 'niggle', 'mishit', 'class', 'bass', 'grape', 'cocktail', 'peacock', 'title', 'scrape', 'analysis', 'dickens', 'hello', 'cucumber', 'passion']) {
      expect(isBlockedWord(w), w).toBe(false);
    }
  });

  it('masks blocked words for display', () => {
    expect(maskBlocked('shit')).toBe('s***');
    expect(maskBlocked('x')).toBe('*');
    expect(containsBlockedWord('big ass cake')).toBe(true);
    expect(containsBlockedWord('glass cake')).toBe(false);
  });

  it('detects blocked words spelled inside a letter string (displayed racks)', () => {
    expect(spellsBlockedWord('xshitq')).toBe(true);
    expect(spellsBlockedWord('abcdrape')).toBe(true);
    expect(spellsBlockedWord('tpslio')).toBe(false);
  });
});
