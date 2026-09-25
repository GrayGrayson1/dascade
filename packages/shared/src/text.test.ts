import { describe, expect, it } from 'vitest';
import { cleanText, cleanNickname, containsProfanity, editDistance, maskProfanity, normalizeForCompare, parseBulkList, splitCsvLine } from './text.ts';
import { isValidRoomCode, normalizeRoomCode, generateRoomCode } from './roomCode.ts';
import { createSeededRng, createCryptoRng, shuffleInPlace } from './random.ts';
import { KeyedRateLimiter, TokenBucket } from './rateLimit.ts';

describe('text', () => {
  it('strips control, invisible and bidi characters and collapses whitespace', () => {
    const zw = String.fromCharCode(0x200b);
    const rlo = String.fromCharCode(0x202e);
    const nbsp = String.fromCharCode(0xa0);
    expect(cleanText(`  hi${zw}${rlo} there${nbsp}${nbsp}you\n\t`, 50)).toBe('hi there you');
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(cleanText(null, 5)).toBe('');
    expect(cleanText('<script>alert(1)</script>', 100)).toBe('<script>alert(1)</script>'); // rendered escaped by React
  });
  it('strips every format char and blank-rendering filler used for invisible or spoofed names', () => {
    const cp = (...codes: number[]) => String.fromCodePoint(...codes);
    // Arabic letter mark, soft hyphen, Mongolian vowel separator, LRI/PDI isolates, tag chars.
    expect(cleanText(`a${cp(0x061c)}b${cp(0xad)}c${cp(0x180e)}d${cp(0x2066)}e${cp(0x2069)}f${cp(0xe0041)}`, 50)).toBe('abcdef');
    // Hangul fillers and the Braille blank render as empty space: an all-filler name falls back.
    for (const filler of [0x3164, 0x115f, 0x1160, 0xffa0, 0x2800]) {
      expect(cleanText(cp(filler, filler, filler), 20)).toBe('');
      expect(['Player', 'Guest', 'Challenger', 'Rookie']).toContain(cleanNickname(cp(filler, filler)));
    }
    // Zalgo is capped at two combining marks; truncation never splits an emoji surrogate pair.
    expect(Array.from(cleanText(`e${cp(0x301, 0x302, 0x303, 0x304, 0x305)}`, 10))).toHaveLength(3);
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
  });
  it('nickname never empty', () => {
    expect(cleanNickname('   ').length).toBeGreaterThan(0);
    expect(cleanNickname('A very long nickname that goes on').length).toBeLessThanOrEqual(20);
  });
  it('compares case/diacritic-insensitively', () => {
    expect(normalizeForCompare('Crème Brûlée!')).toBe('creme brulee');
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
  it('filters profanity', () => {
    expect(containsProfanity('what the shit')).toBe(true);
    expect(containsProfanity('Scunthorpe classic')).toBe(false);
    expect(maskProfanity('oh shit')).toBe('oh s***');
  });
  it('parses bulk lists and CSV', () => {
    expect(parseBulkList('a\n b \n\n c', 10, 10)).toEqual(['a', 'b', 'c']);
    expect(parseBulkList('red, green,"blue, dark"', 20, 10)).toEqual(['red', 'green', 'blue, dark']);
    expect(splitCsvLine('"a ""q""",b')).toEqual(['a "q"', 'b']);
  });
});

describe('room codes', () => {
  it('generates valid, unambiguous codes', () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(rng);
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[01OIL]/);
    }
    expect(normalizeRoomCode(' ab-cd e')).toBe('ABCDE');
    expect(isValidRoomCode('ABCD0')).toBe(false);
  });
});

describe('rng', () => {
  it('seeded rng is deterministic and ints are in range', () => {
    const a = createSeededRng('x');
    const b = createSeededRng('x');
    for (let i = 0; i < 50; i++) expect(a.int(7)).toBe(b.int(7));
    const c = createCryptoRng();
    for (let i = 0; i < 1000; i++) {
      const v = c.int(3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      const f = c.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
  it('shuffle is a permutation and roughly uniform', () => {
    const rng = createSeededRng(42);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[shuffleInPlace([0, 1, 2, 3], rng)[0]!]!++;
    for (const n of counts) expect(n).toBeGreaterThan(850);
  });
});

describe('rate limit', () => {
  it('token bucket limits bursts and refills', () => {
    const b = new TokenBucket({ burst: 2, perSecond: 1 }, 0);
    expect(b.take(1, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.take(1, 1000)).toBe(true);
  });
  it('keyed limiter evicts least-recently-used keys instead of resetting everyone when full', () => {
    const lim = new KeyedRateLimiter({ burst: 1, perSecond: 0.001 }, 10);
    expect(lim.take('abuser', 1, 0)).toBe(true);
    expect(lim.take('abuser', 1, 0)).toBe(false);
    // A flood of fresh keys (e.g. rotating IPv6 addresses) while the abuser stays active.
    for (let i = 0; i < 100; i++) {
      lim.take(`k${i}`, 1, 1);
      expect(lim.take('abuser', 1, 1)).toBe(false);
    }
    expect(lim.size).toBeLessThanOrEqual(10);
  });
});
