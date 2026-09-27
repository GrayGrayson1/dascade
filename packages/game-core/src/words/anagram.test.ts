import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { ANAGRAM_BONUS, lengthPoints } from '@dascade/shared/games/words';
import { WordDictionary } from './dictionary.ts';
import { anagramFinalPoints, anagramWordScore, canFormFromRack, checkAnagramWord, letterCounts, pickRack, scrambleRack, solveRack } from './anagram.ts';
import { spellsBlockedWord } from './blocklist.ts';

const COMMON = ['garden', 'danger', 'ranged', 'gander', 'grand', 'range', 'anger', 'rage', 'dare', 'read', 'dear', 'near', 'earn', 'grade', 'nerd', 'rend', 'den', 'end', 'and', 'ran', 'red', 'age', 'ear', 'era', 'are', 'dag', 'rag', 'nag', 'gad', 'drag', 'darn', 'dean', 'aged', 'edgar'];
const RARE = ['grana', 'dreg', 'nard', 'rand', 'gnar', 'darg', 'gaen'];
const DICT = WordDictionary.fromWords([...COMMON, ...RARE], COMMON);

describe('rack letters', () => {
  it('counts letters and checks multiset containment', () => {
    const c = letterCounts('garden');
    expect(c[0]).toBe(1); // a
    expect(c[6]).toBe(1); // g
    expect(canFormFromRack('grand', 'garden')).toBe(true);
    expect(canFormFromRack('dread', 'garden')).toBe(false); // needs two d
    expect(canFormFromRack('added', 'garden')).toBe(false);
    expect(canFormFromRack('', 'garden')).toBe(true);
    expect(canFormFromRack('Gr', 'garden')).toBe(false); // uppercase is not normalized here
    expect(canFormFromRack('nag', c)).toBe(true);
  });

  it('solves a rack: every word is formable, longest first', () => {
    const words = solveRack('garden', DICT, 3);
    expect(words.slice(0, 4).sort()).toEqual(['danger', 'gander', 'garden', 'ranged']);
    for (const w of words) expect(canFormFromRack(w, 'garden')).toBe(true);
    for (let i = 1; i < words.length; i++) expect(words[i - 1]!.length).toBeGreaterThanOrEqual(words[i]!.length);
    expect(solveRack('garden', DICT, 5).every((w) => w.length >= 5)).toBe(true);
  });
});

describe('scrambleRack', () => {
  it('never shows the seed or any dictionary word, and never spells a blocked word', () => {
    for (let s = 0; s < 100; s++) {
      const out = scrambleRack('garden', DICT, createSeededRng(s));
      expect(out).not.toBe('garden');
      expect(DICT.has(out)).toBe(false);
      expect(out.split('').sort().join('')).toBe('adegnr');
      expect(spellsBlockedWord(out)).toBe(false);
    }
  });
});

describe('pickRack', () => {
  it('builds on an everyday seed so a full-length word always exists', () => {
    const rack = pickRack(DICT, 6, createSeededRng('r1'));
    expect(rack.letters).toHaveLength(6);
    expect(rack.seeds.length).toBeGreaterThan(0);
    for (const s of rack.seeds) {
      expect(s).toHaveLength(6);
      expect(s.split('').sort().join('')).toBe(rack.letters.split('').sort().join(''));
    }
    expect(DICT.isCommon(rack.seeds[0]!)).toBe(true);
    for (const w of rack.solutions) expect(canFormFromRack(w, rack.letters)).toBe(true);
    expect(rack.solutions).toEqual(expect.arrayContaining(rack.seeds));
  });

  it('skips seeds already used this match when possible', () => {
    const avoid = new Set(['garden', 'danger', 'ranged']);
    const rack = pickRack(DICT, 6, createSeededRng('r2'), avoid);
    expect(rack.seeds[0]).toBe('gander');
  });

  it('is deterministic under a seeded rng', () => {
    expect(pickRack(DICT, 6, createSeededRng('same'))).toEqual(pickRack(DICT, 6, createSeededRng('same')));
  });

  it('throws when the dictionary has no everyday word of that length', () => {
    expect(() => pickRack(DICT, 8, createSeededRng(1))).toThrow();
  });
});

describe('checkAnagramWord', () => {
  it('accepts formable dictionary words', () => {
    const r = checkAnagramWord('Grand', 'nrdgae', DICT);
    expect(r).toMatchObject({ ok: true, word: 'grand' });
  });
  it('rejects letters not on the rack, reused letters, short, unknown and blocked words', () => {
    expect(checkAnagramWord('dread', 'nrdgae', DICT)).toMatchObject({ ok: false, reason: 'letters' });
    expect(checkAnagramWord('zebra', 'nrdgae', DICT)).toMatchObject({ ok: false, reason: 'letters' });
    expect(checkAnagramWord('gardens', 'nrdgae', DICT)).toMatchObject({ ok: false, reason: 'letters' });
    expect(checkAnagramWord('an', 'nrdgae', DICT)).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkAnagramWord('dang', 'nrdgae', DICT)).toMatchObject({ ok: false, reason: 'not_word' });
    expect(checkAnagramWord('rape', 'rapexy', DICT)).toEqual({ ok: false, reason: 'blocked', word: 'r***' });
  });
});

describe('anagram scoring', () => {
  it('length points + rare bonus + full-rack bonus; unique doubles the base', () => {
    const grand = anagramWordScore('grand', 6, DICT);
    expect(grand).toEqual({ base: lengthPoints(5), rare: false, full: false, points: lengthPoints(5) });
    const nard = anagramWordScore('nard', 6, DICT);
    expect(nard.rare).toBe(true);
    expect(nard.points).toBe(lengthPoints(4) + ANAGRAM_BONUS.rare);
    const garden = anagramWordScore('garden', 6, DICT);
    expect(garden.full).toBe(true);
    expect(garden.points).toBe(lengthPoints(6) + ANAGRAM_BONUS.fullRack);
    expect(anagramFinalPoints(garden, false)).toBe(garden.points);
    expect(anagramFinalPoints(garden, true)).toBe(garden.points + garden.base);
    expect(anagramFinalPoints(nard, true)).toBe(lengthPoints(4) * 2 + ANAGRAM_BONUS.rare);
  });
  it('longer words always score more than shorter ones', () => {
    expect(anagramWordScore('grade', 6, DICT).points).toBeGreaterThan(anagramWordScore('rage', 6, DICT).points);
  });
});
