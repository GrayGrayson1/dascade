import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { hintRevealCount, hintSchedule, letterIndices, maskWord, pickRevealIndex, wordLengths } from './hints.ts';

describe('maskWord', () => {
  it('hides letters, keeps gaps and punctuation', () => {
    expect(maskWord('cat')).toBe('___');
    expect(maskWord('ice cream')).toBe('___ _____');
    expect(maskWord('t-shirt')).toBe('_-_____');
    expect(maskWord("rock'n'roll")).toBe("____'_'____");
    expect(maskWord('4x4 truck')).toBe('___ _____');
  });

  it('reveals chosen indices', () => {
    expect(maskWord('ice cream', new Set([0, 6]))).toBe('i__ __e__');
  });

  it('counts letters per word for length labels', () => {
    expect(wordLengths(maskWord('ice cream'))).toEqual([3, 5]);
    expect(wordLengths('i__ __e__')).toEqual([3, 5]);
    expect(wordLengths(maskWord('t-shirt'))).toEqual([6]);
  });

  it('handles accented letters as single characters', () => {
    expect(maskWord('crème')).toBe('_____');
    expect(letterIndices('crème')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('hints', () => {
  it('reveal count depends on mode and always keeps two letters hidden', () => {
    expect(hintRevealCount(10, 'off')).toBe(0);
    expect(hintRevealCount(10, 'slow')).toBe(2);
    expect(hintRevealCount(10, 'normal')).toBe(4);
    expect(hintRevealCount(10, 'fast')).toBe(5);
    expect(hintRevealCount(3, 'fast')).toBe(1);
    expect(hintRevealCount(2, 'fast')).toBe(0);
    for (let n = 3; n < 30; n++) {
      for (const mode of ['slow', 'normal', 'fast'] as const) {
        expect(hintRevealCount(n, mode)).toBeLessThanOrEqual(n - 2);
        expect(hintRevealCount(n, mode)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('schedules reveals inside the turn in ascending order', () => {
    const drawMs = 80_000;
    for (const mode of ['slow', 'normal', 'fast'] as const) {
      const times = hintSchedule(12, mode, drawMs);
      expect(times).toHaveLength(hintRevealCount(12, mode));
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
      expect(times[0]!).toBeGreaterThan(drawMs * 0.15);
      expect(times.at(-1)!).toBeLessThanOrEqual(drawMs * 0.85);
    }
    expect(hintSchedule(12, 'fast', drawMs)[0]!).toBeLessThan(hintSchedule(12, 'slow', drawMs)[0]!);
    expect(hintSchedule(12, 'off', drawMs)).toEqual([]);
    expect(hintSchedule(12, 'normal', 0)).toEqual([]);
  });

  it('picks only hidden letters and never the last hidden one', () => {
    const rng = createSeededRng('hints');
    const word = 'pineapple';
    const revealed = new Set<number>();
    for (;;) {
      const idx = pickRevealIndex(word, revealed, rng);
      if (idx === null) break;
      expect(revealed.has(idx)).toBe(false);
      expect(letterIndices(word)).toContain(idx);
      revealed.add(idx);
    }
    expect(revealed.size).toBe(word.length - 1);
    expect(pickRevealIndex('ice cream', new Set(), rng)).not.toBe(3);
  });
});
