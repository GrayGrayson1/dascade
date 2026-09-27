/**
 * The shipped DASwords dictionary (apps/game-server/src/rooms/words/data/dascade-words.txt):
 * acceptance, blocklist, category coverage and puzzle quality with the real word list.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  BLOCKED_WORDS,
  FORBIDDEN_CATEGORIES,
  checkForbiddenAnswer,
  gridSpellsBlockedWord,
  isBlockedWord,
  isViableLink,
  normalizePhrase,
  pickRack,
  pickStarter,
  rollPlayableGrid,
  solveRack,
  spellsBlockedWord,
  validatePath,
} from '@dascade/game-core/words';
import { dictionaryCandidates, wordsDictionary } from '../src/rooms/words/dictionary.ts';

const dict = wordsDictionary();

describe('shipped dictionary', () => {
  it('loads a large local list (no network) and caches it', () => {
    expect(dict.size).toBeGreaterThan(150_000);
    expect(wordsDictionary()).toBe(dict);
    expect(dictionaryCandidates().some((p) => p.endsWith('words-data/dascade-words.txt'))).toBe(true);
  });

  it('accepts everyday, inflected, British and modern words', () => {
    for (const w of ['cat', 'cats', 'running', 'quiz', 'queen', 'colour', 'color', 'realise', 'email', 'blog', 'wifi', 'selfie', 'whiteboard', 'therapist', 'swanky', 'saltwater', 'jukebox', 'zebra', 'rhythm']) {
      expect(dict.has(w), w).toBe(true);
    }
    expect(dict.isCommon('garden')).toBe(true);
    expect(dict.tier('qat')).toBe(3);
  });

  it('rejects non-words, proper-noun-only entries, too-short and too-long entries', () => {
    for (const w of ['zzxq', 'asdfgh', 'xkcdz', 'london', 'microsoft', 'ab', 'a', 'pneumonoultramicroscopicsilicovolcanoconiosis']) {
      expect(dict.has(w), w).toBe(false);
    }
  });

  it('contains no blocked word (office-safe), and the file itself is lowercase a–z only', () => {
    for (const w of BLOCKED_WORDS) expect(dict.has(w), w).toBe(false);
    for (const w of dict.all()) {
      if (isBlockedWord(w)) throw new Error(`blocked word shipped: ${w}`);
    }
    const text = readFileSync(new URL('../src/rooms/words/data/dascade-words.txt', import.meta.url), 'utf8');
    const body = text.split('\n').filter((l) => l && !l.startsWith('#') && !/^\[\d\]$/.test(l));
    expect(body.every((l) => /^[a-z]{3,15}$/.test(l))).toBe(true);
  });

  it('every Forbidden Letter category member is made of dictionary words and is auto-approved', () => {
    for (const c of FORBIDDEN_CATEGORIES) {
      for (const m of c.members) {
        for (const w of normalizePhrase(m).split(' ')) expect(dict.has(w), `${c.id}: ${m}`).toBe(true);
        expect(isBlockedWord(m)).toBe(false);
        const letter = 'q'; // never in the pool, so the letter rule can't interfere here
        const r = checkForbiddenAnswer(m, { category: c, letter }, dict);
        if (m.includes('q')) continue;
        expect(r, `${c.id}: ${m}`).toMatchObject({ ok: true, known: true });
      }
    }
  });
});

describe('puzzles with the real dictionary', () => {
  it('Letter Grid boards are lively and never spell a 4+ letter blocked word', () => {
    for (const [size, min] of [
      [4, 3],
      [5, 4],
    ] as const) {
      for (let s = 0; s < 12; s++) {
        const g = rollPlayableGrid(size, min, dict, createSeededRng(`board-${size}-${s}`));
        expect(g.quality.common).toBeGreaterThanOrEqual(size === 4 ? 30 : 45);
        expect(g.quality.longest).toBeGreaterThanOrEqual(6);
        expect(gridSpellsBlockedWord(g.tiles)).toBe(false);
        for (const [w, p] of g.solutions) {
          expect(w.length).toBeGreaterThanOrEqual(min);
          expect(validatePath(g.tiles, p, w).ok).toBe(true);
        }
      }
    }
  });

  it('Anagram racks always hide an everyday full-length word and plenty of shorter ones', () => {
    for (const size of [6, 7, 8]) {
      for (let s = 0; s < 8; s++) {
        const rack = pickRack(dict, size, createSeededRng(`rack-${size}-${s}`));
        expect(rack.letters).toHaveLength(size);
        expect(dict.isCommon(rack.seeds[0]!)).toBe(true);
        expect(rack.solutions.length).toBeGreaterThanOrEqual(size === 6 ? 18 : size === 7 ? 30 : 40);
        expect(dict.has(rack.letters)).toBe(false);
        expect(spellsBlockedWord(rack.letters)).toBe(false);
        expect(solveRack(rack.letters, dict)).toEqual(rack.solutions);
      }
    }
  });

  it('Word Chain starters are everyday words that link well under both rules', () => {
    for (const rule of ['last', 'last2'] as const) {
      for (let s = 0; s < 10; s++) {
        const w = pickStarter(dict, rule, createSeededRng(`start-${rule}-${s}`), new Set(), 3);
        expect(dict.isCommon(w)).toBe(true);
        expect(isViableLink(w, rule, dict, new Set(), 3)).toBe(true);
      }
    }
  });
});
