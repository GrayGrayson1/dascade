import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import type { BingoPatternRef, BingoPresetId } from '@dascade/shared/games/bingo';
import {
  FREE,
  coverage,
  dealCards,
  drawToken,
  findMatch,
  generateCard,
  maskCovered,
  maskToString,
  missingCount,
  presetMasks,
  resolvePattern,
  squaresToGo,
  trivialMask,
  validateClaim,
  type BoardSpec,
  type ResolvedPattern,
} from './index.ts';

const numbers: BoardSpec = { mode: 'numbers', size: 5, free: true, poolSize: 75 };
const preset = (id: BingoPresetId, size = 5, extra: Partial<{ rotate: boolean; mirror: boolean }> = {}): ResolvedPattern =>
  resolvePattern({ type: 'preset', id, rotate: false, mirror: false, ...extra } as BingoPatternRef, size)!;

/** A fixed, readable 75-ball card. */
const CARD = [
  1, 16, 31, 46, 61, //
  2, 17, 32, 47, 62,
  3, 18, FREE, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];
const row = (r: number) => CARD.slice(r * 5, r * 5 + 5).filter((v) => v !== FREE);
const col = (c: number) => [0, 1, 2, 3, 4].map((r) => CARD[r * 5 + c]!).filter((v) => v !== FREE);

describe('coverage', () => {
  it('covers called squares and the free square only', () => {
    const cov = coverage(CARD, [1, 2, 99]);
    expect(cov[0]).toBe(true);
    expect(cov[5]).toBe(true);
    expect(cov[12]).toBe(true);
    expect(cov.filter(Boolean)).toHaveLength(3);
    expect(coverage(CARD, new Set([1]))[0]).toBe(true);
  });

  it('counts missing squares and covered masks', () => {
    const mask = presetMasks('four-corners', 5)[0]!;
    const cov = coverage(CARD, [1, 61, 5]);
    expect(missingCount(mask, cov)).toBe(1);
    expect(maskCovered(mask, cov)).toBe(false);
    expect(maskCovered(mask, coverage(CARD, [1, 61, 5, 65]))).toBe(true);
    expect(maskCovered([true], cov)).toBe(false);
  });
});

describe('claim validation', () => {
  it('a completed row wins; the matched mask is reported', () => {
    const verdict = validateClaim({ cells: CARD, calls: row(0), patterns: [preset('any-line')], size: 5 });
    expect(verdict.valid).toBe(true);
    if (verdict.valid) {
      expect(verdict.match.patternName).toBe('Any line');
      expect(verdict.match.maskString).toBe('1111100000000000000000000');
    }
  });

  it('the N column only needs four calls thanks to the free square', () => {
    const verdict = validateClaim({ cells: CARD, calls: col(2), patterns: [preset('any-column')], size: 5 });
    expect(col(2)).toHaveLength(4);
    expect(verdict.valid).toBe(true);
  });

  it('diagonals go through the free square', () => {
    const diag = [1, 17, 49, 65];
    expect(validateClaim({ cells: CARD, calls: diag, patterns: [preset('any-diagonal')], size: 5 }).valid).toBe(true);
    expect(validateClaim({ cells: CARD, calls: diag.slice(1), patterns: [preset('any-diagonal')], size: 5 }).valid).toBe(false);
  });

  it('a false claim before the winning call is rejected, and valid right after it', () => {
    const calls = [1, 61, 5];
    const patterns = [preset('four-corners')];
    expect(validateClaim({ cells: CARD, calls, patterns, size: 5 })).toEqual({ valid: false, reason: 'no_pattern' });
    expect(validateClaim({ cells: CARD, calls: [...calls, 65], patterns, size: 5 }).valid).toBe(true);
  });

  it('calls that are not on the card never help', () => {
    const calls = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25];
    expect(validateClaim({ cells: CARD, calls, patterns: [preset('any-line')], size: 5 }).valid).toBe(false);
  });

  it('client marks are irrelevant: validation depends only on the calls', () => {
    // The API has no marks input at all; a player "marking" the whole card cannot change the verdict.
    const verdictA = validateClaim({ cells: CARD, calls: [1, 2, 3], patterns: [preset('blackout')], size: 5 });
    expect(verdictA.valid).toBe(false);
    const all = CARD.filter((v) => v !== FREE);
    expect(validateClaim({ cells: CARD, calls: all, patterns: [preset('blackout')], size: 5 }).valid).toBe(true);
  });

  it('any pattern of the set wins, reported in set order', () => {
    const patterns = [preset('blackout'), preset('four-corners'), preset('any-row')];
    const verdict = validateClaim({ cells: CARD, calls: [1, 61, 5, 65, ...row(4)], patterns, size: 5 });
    expect(verdict.valid && verdict.match.patternName).toBe('Four corners');
    expect(verdict.valid && verdict.match.patternIndex).toBe(1);
  });

  it('only accepts transformed orientations when the pattern opts in', () => {
    // L drawn on the left; the card completes the mirrored L (right column + bottom row).
    const L = maskToString([0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2, 3, 4].map((c) => c === 0 || r === 4)));
    const calls = [...col(4), ...row(4)];
    const plain = resolvePattern({ type: 'custom', name: 'L', size: 5, mask: L, rotate: false, mirror: false }, 5)!;
    const mirrored = resolvePattern({ type: 'custom', name: 'L', size: 5, mask: L, rotate: false, mirror: true }, 5)!;
    const rotated = resolvePattern({ type: 'custom', name: 'L', size: 5, mask: L, rotate: true, mirror: false }, 5)!;
    expect(validateClaim({ cells: CARD, calls, patterns: [plain], size: 5 }).valid).toBe(false);
    expect(validateClaim({ cells: CARD, calls, patterns: [mirrored], size: 5 }).valid).toBe(true);
    // Right column + bottom row is also the L rotated 270°.
    expect(validateClaim({ cells: CARD, calls, patterns: [rotated], size: 5 }).valid).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(validateClaim({ cells: CARD.slice(1), calls: [], patterns: [preset('x')], size: 5 })).toEqual({ valid: false, reason: 'bad_card' });
    expect(validateClaim({ cells: CARD, calls: [], patterns: [], size: 5 })).toEqual({ valid: false, reason: 'no_patterns' });
  });

  it('works for text cards without a free square', () => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const patterns = [preset('four-corners', 4)];
    expect(validateClaim({ cells, calls: [0, 3, 12], patterns, size: 4 }).valid).toBe(false);
    expect(validateClaim({ cells, calls: [0, 3, 12, 15], patterns, size: 4 }).valid).toBe(true);
  });
});

describe('squares to go', () => {
  it('reports the closest pattern', () => {
    const patterns = [preset('any-line')];
    expect(squaresToGo(CARD, [], patterns)).toBe(4); // N column / diagonals through FREE
    expect(squaresToGo(CARD, [1, 2], patterns)).toBe(3);
    expect(squaresToGo(CARD, row(0), patterns)).toBe(0);
    expect(squaresToGo(CARD, [], [preset('blackout')])).toBe(24);
    expect(squaresToGo(CARD, [], [])).toBe(25);
  });

  it('findMatch agrees with squaresToGo over random games', () => {
    const rng = createSeededRng('agree');
    const patterns = [preset('any-line'), preset('four-corners')];
    for (let g = 0; g < 50; g++) {
      const cells = generateCard(numbers, rng);
      const calls: number[] = [];
      while (true) {
        const t = drawToken(numbers, calls, rng);
        if (t === null) break;
        calls.push(t);
        const togo = squaresToGo(cells, calls, patterns);
        expect(findMatch(cells, calls, patterns) !== null).toBe(togo === 0);
        if (togo === 0) break;
      }
      expect(squaresToGo(cells, calls, patterns)).toBe(0);
    }
  });

  it('with enough calls every one of 60 unique cards eventually wins blackout', () => {
    const cards = dealCards(numbers, 'blackout', 1, 60);
    const everything = Array.from({ length: 75 }, (_, i) => i + 1);
    for (const cells of cards) expect(validateClaim({ cells, calls: everything, patterns: [preset('blackout')], size: 5 }).valid).toBe(true);
  });
});

describe('trivial masks', () => {
  it('detects patterns satisfied by the free square alone', () => {
    const onlyCenter = Array.from({ length: 25 }, (_, i) => i === 12);
    expect(trivialMask(onlyCenter, 12)).toBe(true);
    expect(trivialMask(onlyCenter, null)).toBe(false);
    expect(trivialMask(presetMasks('x', 5)[0]!, 12)).toBe(false);
  });
});
