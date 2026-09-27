import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { WORD_LENGTH_POINTS, lengthPoints, tilesTouch } from '@dascade/shared/games/words';
import { WordDictionary } from './dictionary.ts';
import {
  DICE_4X4,
  DICE_5X5,
  areAdjacent,
  checkGridWord,
  faceToTile,
  findPath,
  gridQuality,
  gridSpellsBlockedWord,
  gridWordPoints,
  neighbourTable,
  pathWord,
  rollGrid,
  rollPlayableGrid,
  solveGrid,
  validatePath,
} from './grid.ts';

// 4×4 board (row-major):
//   c a t s
//   o qu i z
//   d e n t
//   r a p e
const BOARD = ['c', 'a', 't', 's', 'o', 'qu', 'i', 'z', 'd', 'e', 'n', 't', 'r', 'a', 'p', 'e'];
const DICT = WordDictionary.fromWords(
  ['cat', 'cats', 'coat', 'code', 'coder', 'quiz', 'quit', 'quits', 'quint', 'equip', 'tent', 'dent', 'net', 'nets', 'tin', 'tint', 'qat', 'qi', 'sat', 'tact', 'aqua', 'cad', 'cod', 'ode', 'den', 'ten', 'tap', 'pan', 'nap', 'ape', 'reap'],
  ['cat', 'cats', 'coat', 'code', 'quiz', 'quit', 'tent', 'dent', 'net', 'ten'],
);

describe('dice', () => {
  it('4×4 and 5×5 sets have six A–Z faces per die and exactly one Qu face', () => {
    for (const [dice, n] of [
      [DICE_4X4, 16],
      [DICE_5X5, 25],
    ] as const) {
      expect(dice).toHaveLength(n);
      for (const die of dice) expect(die).toMatch(/^[A-Z]{6}$/);
      expect(dice.join('').split('').filter((c) => c === 'Q')).toHaveLength(1);
      // ≈ 35–42% vowels, like English text.
      const faces = dice.join('');
      const vowels = faces.split('').filter((c) => 'AEIOU'.includes(c)).length / faces.length;
      expect(vowels).toBeGreaterThan(0.33);
      expect(vowels).toBeLessThan(0.43);
      for (const die of dice) expect(die.split('').some((c) => 'AEIOU'.includes(c)), die).toBe(true);
    }
  });

  it('the Q face becomes a two-letter "qu" tile; others are lowercase letters', () => {
    expect(faceToTile('Q')).toBe('qu');
    expect(faceToTile('E')).toBe('e');
  });

  it('rolls deterministically with a seeded rng and uses every die once', () => {
    const a = rollGrid(4, createSeededRng('x'));
    const b = rollGrid(4, createSeededRng('x'));
    expect(a).toEqual(b);
    expect(a).toHaveLength(16);
    expect(rollGrid(5, createSeededRng('y'))).toHaveLength(25);
    for (let s = 0; s < 50; s++) {
      const tiles = rollGrid(4, createSeededRng(s));
      expect(tiles.every((t) => /^[a-z]$/.test(t) || t === 'qu')).toBe(true);
      expect(tiles.filter((t) => t === 'q')).toHaveLength(0);
    }
  });
});

describe('adjacency', () => {
  it('8-way neighbours: corners 3, edges 5, middle 8', () => {
    const t4 = neighbourTable(4);
    expect(t4[0]).toHaveLength(3);
    expect(t4[1]).toHaveLength(5);
    expect(t4[5]).toHaveLength(8);
    const t5 = neighbourTable(5);
    expect(t5[12]).toHaveLength(8);
    expect(t5[24]).toHaveLength(3);
  });

  it('areAdjacent / tilesTouch agree and never wrap around rows', () => {
    for (let a = 0; a < 25; a++) {
      for (let b = 0; b < 25; b++) expect(areAdjacent(a, b, 5)).toBe(tilesTouch(a, b, 5));
    }
    expect(areAdjacent(3, 4, 4)).toBe(false); // end of row 0 → start of row 1
    expect(areAdjacent(0, 5, 4)).toBe(true); // diagonal
    expect(areAdjacent(5, 5, 4)).toBe(false);
  });
});

describe('path validation', () => {
  it('accepts a legal path and returns the spelled word', () => {
    expect(validatePath(BOARD, [0, 1, 2])).toEqual({ ok: true, word: 'cat' });
    expect(validatePath(BOARD, [0, 1, 2, 3], 'cats')).toEqual({ ok: true, word: 'cats' });
  });

  it('rejects empty, out-of-bounds, non-adjacent, reused and mismatching paths', () => {
    expect(validatePath(BOARD, [])).toEqual({ ok: false, reason: 'empty' });
    expect(validatePath(BOARD, [0, 16])).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(validatePath(BOARD, [0, -1])).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(validatePath(BOARD, [0, 1.5])).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(validatePath(BOARD, [0, 2])).toEqual({ ok: false, reason: 'not_adjacent' });
    expect(validatePath(BOARD, [3, 4])).toEqual({ ok: false, reason: 'not_adjacent' }); // row wrap
    expect(validatePath(BOARD, [0, 1, 0])).toEqual({ ok: false, reason: 'reused_tile' });
    expect(validatePath(BOARD, [0, 1, 2], 'cot')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('pathWord joins tile text (Qu contributes two letters)', () => {
    expect(pathWord(BOARD, [5, 6, 7])).toBe('quiz');
  });
});

describe('findPath + Qu handling', () => {
  it('finds words through the Qu tile, counting it as "qu"', () => {
    const quiz = findPath(BOARD, 'quiz');
    expect(quiz).toEqual([5, 6, 7]);
    expect(validatePath(BOARD, quiz!, 'quiz').ok).toBe(true);
    expect(findPath(BOARD, 'quit')).not.toBeNull();
  });

  it('cannot use a lone Q or a lone U from the Qu tile', () => {
    expect(findPath(BOARD, 'qat')).toBeNull(); // Q without U
    expect(findPath(BOARD, 'qi')).toBeNull();
    expect(findPath(BOARD, 'aqua')).toBeNull(); // needs "a" + "qu" + "a": qu (5) touches a (1) but not another a
  });

  it('never reuses a tile', () => {
    expect(findPath(BOARD, 'tact')).toBeNull(); // only one c
    expect(findPath(BOARD, 'dent')).toEqual([8, 9, 10, 11]);
    expect(findPath(BOARD, 'tent')).toBeNull(); // the two t tiles are too far apart
  });

  it('returns null for words not on the board', () => {
    expect(findPath(BOARD, 'zebra')).toBeNull();
    expect(findPath(BOARD, '')).toBeNull();
  });
});

describe('solveGrid', () => {
  it('finds every dictionary word with a valid path, respecting the minimum length', () => {
    const found = solveGrid(BOARD, DICT, 3);
    for (const [word, path] of found) expect(validatePath(BOARD, path, word).ok).toBe(true);
    expect(found.has('cat')).toBe(true);
    expect(found.has('cats')).toBe(true);
    expect(found.has('quiz')).toBe(true);
    expect(found.get('coder')).toEqual([0, 4, 8, 9, 12]);
    expect(found.has('qat')).toBe(false);
    const four = solveGrid(BOARD, DICT, 4);
    expect([...four.keys()].every((w) => w.length >= 4)).toBe(true);
    expect(four.has('cat')).toBe(false);
  });

  it('agrees with findPath on random boards (property)', () => {
    const words = ['stone', 'notes', 'tones', 'onset', 'rate', 'tear', 'tare', 'earn', 'near', 'rain', 'train', 'quite', 'quiet', 'seat', 'east', 'eats', 'teas', 'tease', 'lane', 'lean'];
    const dict = WordDictionary.fromWords(words);
    for (let seed = 0; seed < 150; seed++) {
      const tiles = rollGrid(4, createSeededRng(`prop-${seed}`));
      const solved = solveGrid(tiles, dict, 3);
      for (const w of words) expect(solved.has(w), `${w} on ${tiles.join('')}`).toBe(findPath(tiles, w) !== null);
      for (const [w, p] of solved) expect(validatePath(tiles, p, w).ok).toBe(true);
    }
  });

  it('gridQuality counts everyday words and the longest word', () => {
    const q = gridQuality(solveGrid(BOARD, DICT, 3), DICT);
    expect(q.words).toBeGreaterThan(q.common);
    expect(q.common).toBeGreaterThan(0);
    expect(q.longest).toBeGreaterThanOrEqual(4);
  });
});

describe('checkGridWord (server validation)', () => {
  it('accepts a typed word by searching the board itself', () => {
    const r = checkGridWord('QUIZ', BOARD, DICT, 3);
    expect(r).toEqual({ ok: true, word: 'quiz', path: [5, 6, 7], points: lengthPoints(4) });
  });

  it('uses a valid traced path, and ignores a garbled one', () => {
    expect(checkGridWord('cat', BOARD, DICT, 3, [0, 1, 2])).toMatchObject({ ok: true, path: [0, 1, 2] });
    // A forged path that doesn't spell the word is ignored — the server finds the real one.
    expect(checkGridWord('cat', BOARD, DICT, 3, [15, 14, 13])).toMatchObject({ ok: true, path: [0, 1, 2] });
  });

  it('rejects short, untraceable, unknown and blocked words with a reason', () => {
    expect(checkGridWord('ca', BOARD, DICT, 3)).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkGridWord('cats', BOARD, DICT, 5)).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkGridWord('zebra', BOARD, DICT, 3)).toMatchObject({ ok: false, reason: 'not_on_grid' });
    expect(checkGridWord('tine', BOARD, DICT, 3)).toMatchObject({ ok: false }); // on the board? not in DICT either way
    expect(checkGridWord('tinep', BOARD, DICT, 3)).toMatchObject({ ok: false });
    expect(checkGridWord('nit', BOARD, DICT, 3)).toMatchObject({ ok: false, reason: 'not_word' });
    expect(checkGridWord('rape', BOARD, DICT, 3)).toEqual({ ok: false, reason: 'blocked', word: 'r***' });
    expect(checkGridWord('abcdefghijklmnopq', BOARD, DICT, 3)).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('flags boards that can spell a blocked word', () => {
    expect(gridSpellsBlockedWord(BOARD)).toBe(true); // r-a-p-e on the bottom row
    // Three-letter blocked words ("tit" here) are refused when played but don't force a re-roll.
    expect(gridSpellsBlockedWord(['c', 'a', 't', 'r', 'o', 'qu', 'i', 'z', 'd', 'e', 'n', 't', 'b', 'o', 'l', 'm'])).toBe(false);
  });
});

describe('scoring', () => {
  it('uses the displayed length table (Qu counts as two letters)', () => {
    expect(WORD_LENGTH_POINTS.map((r) => gridWordPoints(r.length))).toEqual(WORD_LENGTH_POINTS.map((r) => r.points));
    expect(gridWordPoints(2)).toBe(0);
    expect(gridWordPoints(3)).toBe(1);
    expect(gridWordPoints(4)).toBe(2);
    expect(gridWordPoints(5)).toBe(3);
    expect(gridWordPoints(6)).toBe(5);
    expect(gridWordPoints(7)).toBe(8);
    expect(gridWordPoints(8)).toBe(11);
    expect(gridWordPoints(9)).toBe(15);
    expect(gridWordPoints(14)).toBe(15);
    // longer is always worth at least as much
    for (let n = 3; n < 15; n++) expect(gridWordPoints(n + 1)).toBeGreaterThanOrEqual(gridWordPoints(n));
  });
});

describe('rollPlayableGrid', () => {
  it('returns the liveliest board when nothing reaches the bar (tiny dictionary)', () => {
    const rolled = rollPlayableGrid(4, 3, DICT, createSeededRng('tiny'), 8);
    expect(rolled.tiles).toHaveLength(16);
    expect(rolled.attempts).toBe(8);
    for (const [w, p] of rolled.solutions) expect(validatePath(rolled.tiles, p, w).ok).toBe(true);
    expect(gridSpellsBlockedWord(rolled.tiles)).toBe(false);
  });
});
