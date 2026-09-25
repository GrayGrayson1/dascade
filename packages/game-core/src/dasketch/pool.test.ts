import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import {
  DEFAULT_DASKETCH_SETTINGS,
  DasketchSettingsSchema,
  SketchWordsSchema,
  SKETCH_CATEGORY_IDS,
  SKETCH_CUSTOM_MAX,
  cleanCustomWords,
  sanitizeSketchWord,
  sketchWordKey,
  splitWordList,
} from '@dascade/shared/games/dasketch';
import { WORD_BANK } from './words.ts';
import { WordPicker, buildWordPool, wordPoolSize } from './pool.ts';

const base = { categories: [...SKETCH_CATEGORY_IDS], customWords: [] as string[], customOnly: false, filterProfanity: true };

describe('custom word sanitation (shared contract)', () => {
  it('sanitizes words: case, whitespace, punctuation, apostrophes', () => {
    expect(sanitizeSketchWord('  Hot   DOG!! ')).toBe('hot dog');
    expect(sanitizeSketchWord('Rock’n’Roll')).toBe("rock'n'roll");
    expect(sanitizeSketchWord('T-Shirt')).toBe('t-shirt');
    expect(sanitizeSketchWord('Crème brûlée')).toBe('crème brûlée');
    expect(sanitizeSketchWord('<b>cake</b>')).toBe('b cake b');
    expect(sanitizeSketchWord('--pizza--')).toBe('pizza');
  });

  it('rejects unusable entries', () => {
    expect(sanitizeSketchWord('a')).toBe('');
    expect(sanitizeSketchWord('!!!')).toBe('');
    expect(sanitizeSketchWord('42')).toBe('');
    expect(sanitizeSketchWord('x'.repeat(40))).toBe('');
    expect(sanitizeSketchWord(null)).toBe('');
    expect(sanitizeSketchWord('\u0000​ab')).toBe('ab');
  });

  it('comparison keys ignore case, accents, spaces and punctuation', () => {
    expect(sketchWordKey('Hot-Dog')).toBe('hotdog');
    expect(sketchWordKey('hot dog')).toBe('hotdog');
    expect(sketchWordKey('Café')).toBe('cafe');
  });

  it('cleans, de-duplicates, filters and caps a custom list with a report', () => {
    const r = cleanCustomWords(['Cat', 'cat', 'CAT!', 'shit', 'a', '', 'Space Ship', 'spaceship'], true);
    expect(r.words).toEqual(['cat', 'space ship']);
    expect(r.duplicates).toBe(3);
    expect(r.filtered).toBe(1);
    expect(r.invalid).toBe(1);
    const unfiltered = cleanCustomWords(['shit'], false);
    expect(unfiltered.words).toEqual(['shit']);
    const many = cleanCustomWords(
      Array.from({ length: SKETCH_CUSTOM_MAX + 25 }, (_, i) => `word ${i}`),
      true,
    );
    expect(many.words).toHaveLength(SKETCH_CUSTOM_MAX);
    expect(many.overflow).toBe(25);
  });

  it('bounds the custom word message', () => {
    expect(SketchWordsSchema.safeParse({ words: ['a', 'b'] }).success).toBe(true);
    expect(SketchWordsSchema.safeParse({ words: ['x'.repeat(65)] }).success).toBe(false);
    expect(SketchWordsSchema.safeParse({ words: Array.from({ length: SKETCH_CUSTOM_MAX * 2 + 1 }, () => 'w') }).success).toBe(false);
    expect(SketchWordsSchema.safeParse({ words: 'cat' }).success).toBe(false);
  });

  it('splits bulk pastes on newlines, commas, semicolons and tabs', () => {
    expect(splitWordList('apple, banana\ncherry;date\tfig\r\n\n , ')).toEqual(['apple', 'banana', 'cherry', 'date', 'fig']);
  });
});

describe('settings schema', () => {
  it('accepts the defaults', () => {
    expect(DasketchSettingsSchema.parse(DEFAULT_DASKETCH_SETTINGS)).toEqual(DEFAULT_DASKETCH_SETTINGS);
  });

  it('bounds every numeric field and enum', () => {
    const bad = [
      { rounds: 0 },
      { rounds: 11 },
      { drawSeconds: 10 },
      { drawSeconds: 999 },
      { choiceCount: 0 },
      { choiceCount: 6 },
      { hints: 'extreme' },
      { categories: ['animals', 'animals'] },
      { categories: ['nope'] },
      { customOnly: 'yes' },
      { filterProfanity: 1 },
      { closeGuesses: 'yes' },
      { rounds: 2.5 },
    ];
    for (const patch of bad) {
      expect(DasketchSettingsSchema.safeParse({ ...DEFAULT_DASKETCH_SETTINGS, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it('keeps custom words out of the public settings', () => {
    expect('customWords' in DEFAULT_DASKETCH_SETTINGS).toBe(false);
    const parsed = DasketchSettingsSchema.parse({ ...DEFAULT_DASKETCH_SETTINGS, customWords: ['secret'] });
    expect('customWords' in parsed).toBe(false);
  });
});

describe('buildWordPool', () => {
  it('includes every selected built-in category', () => {
    const total = SKETCH_CATEGORY_IDS.reduce((n, id) => n + WORD_BANK[id].length, 0);
    const pool = buildWordPool(base);
    expect(pool.entries).toHaveLength(total);
    expect(pool.builtIn).toBe(total);
    expect(pool.custom).toBe(0);
  });

  it('respects the category selection', () => {
    const pool = buildWordPool({ ...base, categories: ['animals', 'food'] });
    expect(pool.entries.every((e) => e.category === 'animals' || e.category === 'food')).toBe(true);
    expect(pool.entries).toHaveLength(WORD_BANK.animals.length + WORD_BANK.food.length);
    expect(wordPoolSize({ ...base, categories: [] })).toBe(0);
  });

  it('mixes custom words in, preferring the custom copy of duplicates', () => {
    const pool = buildWordPool({ ...base, categories: ['animals'], customWords: ['Cat', 'Quarterly Report'] });
    expect(pool.custom).toBe(2);
    expect(pool.entries.filter((e) => sketchWordKey(e.word) === 'cat')).toEqual([{ word: 'cat', category: 'custom' }]);
    expect(pool.entries).toHaveLength(WORD_BANK.animals.length + 1);
  });

  it('uses only custom words when customOnly is set', () => {
    const pool = buildWordPool({ ...base, customOnly: true, customWords: ['pineapple', 'rocket'] });
    expect(pool.entries.map((e) => e.word)).toEqual(['pineapple', 'rocket']);
    expect(wordPoolSize({ ...base, customOnly: true })).toBe(0);
  });

  it('applies the profanity filter to custom words', () => {
    expect(buildWordPool({ ...base, customOnly: true, customWords: ['shit', 'kitten'] }).entries).toHaveLength(1);
    expect(buildWordPool({ ...base, customOnly: true, filterProfanity: false, customWords: ['shit', 'kitten'] }).entries).toHaveLength(2);
  });
});

describe('WordPicker', () => {
  const entries = buildWordPool({ ...base, categories: ['animals'] }).entries;

  it('offers distinct choices and never repeats drawn words until exhausted', () => {
    const rng = createSeededRng('picker');
    const picker = new WordPicker(entries);
    const drawn = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const choices = picker.pick(3, rng);
      expect(new Set(choices.map((c) => c.word)).size).toBe(choices.length);
      for (const c of choices) expect(drawn.has(c.word)).toBe(false);
      const chosen = choices[0]!;
      picker.markUsed(chosen.word);
      drawn.add(chosen.word);
      if (entries.length - drawn.size < 3) break;
    }
    expect(picker.usedCount).toBe(drawn.size);
  });

  it('resets history once the pool is exhausted', () => {
    const rng = createSeededRng('tiny');
    const picker = new WordPicker([
      { word: 'one', category: 'custom' },
      { word: 'two', category: 'custom' },
    ]);
    picker.markUsed('one');
    expect(picker.pick(1, rng).map((c) => c.word)).toEqual(['two']);
    picker.markUsed('two');
    const again = picker.pick(2, rng);
    expect(again.map((c) => c.word).sort()).toEqual(['one', 'two']);
    expect(picker.usedCount).toBe(0);
  });

  it('handles single-word pools and bounds the count', () => {
    const rng = createSeededRng('single');
    const picker = new WordPicker([{ word: 'pineapple', category: 'custom' }]);
    expect(picker.pick(3, rng)).toEqual([{ word: 'pineapple', category: 'custom' }]);
    picker.markUsed('pineapple');
    expect(picker.pick(3, rng)).toEqual([{ word: 'pineapple', category: 'custom' }]);
    expect(new WordPicker([]).pick(3, rng)).toEqual([]);
    expect(picker.pick(0, rng)).toEqual([]);
  });

  it('always offers at least one custom word while custom words remain', () => {
    const mixed = buildWordPool({ ...base, customWords: ['alpha project', 'beta launch'] }).entries;
    const picker = new WordPicker(mixed);
    const rng = createSeededRng('mix');
    for (let i = 0; i < 20; i++) {
      expect(picker.pick(3, rng).some((c) => c.category === 'custom')).toBe(true);
    }
    picker.markUsed('alpha project');
    picker.markUsed('beta launch');
    expect(picker.pick(3, rng).some((c) => c.category === 'custom')).toBe(false);
  });

  it('is deterministic for a seeded RNG and returns copies', () => {
    const a = new WordPicker(entries).pick(5, createSeededRng(7));
    const b = new WordPicker(entries).pick(5, createSeededRng(7));
    expect(a).toEqual(b);
    a[0]!.word = 'mutated';
    expect(entries.some((e) => e.word === 'mutated')).toBe(false);
  });

  it('uses the RNG (different seeds give different offers)', () => {
    const offers = new Set<string>();
    for (let s = 0; s < 10; s++) {
      const rng: Rng = createSeededRng(`seed-${s}`);
      offers.add(
        new WordPicker(entries)
          .pick(3, rng)
          .map((c) => c.word)
          .join(','),
      );
    }
    expect(offers.size).toBeGreaterThan(5);
  });
});
