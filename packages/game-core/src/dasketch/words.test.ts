import { describe, expect, it } from 'vitest';
import { containsProfanity } from '@dascade/shared';
import { SKETCH_CATEGORY_IDS, sanitizeSketchWord, sketchWordKey } from '@dascade/shared/games/dasketch';
import { WORD_BANK } from './words.ts';

describe('built-in word bank', () => {
  it('has every category with at least 60 words', () => {
    expect(Object.keys(WORD_BANK).sort()).toEqual([...SKETCH_CATEGORY_IDS].sort());
    for (const id of SKETCH_CATEGORY_IDS) {
      expect(WORD_BANK[id].length, id).toBeGreaterThanOrEqual(60);
    }
  });

  it('contains only clean, already-sanitized words', () => {
    for (const id of SKETCH_CATEGORY_IDS) {
      for (const word of WORD_BANK[id]) {
        expect(sanitizeSketchWord(word), `${id}: ${word}`).toBe(word);
        expect(containsProfanity(word), word).toBe(false);
        expect(word.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it('has no duplicate words anywhere (by comparison key)', () => {
    const seen = new Map<string, string>();
    for (const id of SKETCH_CATEGORY_IDS) {
      for (const word of WORD_BANK[id]) {
        const key = sketchWordKey(word);
        expect(seen.has(key), `${word} (${id}) duplicates ${seen.get(key)}`).toBe(false);
        seen.set(key, `${word} (${id})`);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(480);
  });
});
