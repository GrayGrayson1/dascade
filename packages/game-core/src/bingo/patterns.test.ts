import { describe, expect, it } from 'vitest';
import { BINGO_PRESET_IDS, BingoPatternRefSchema, type BingoPatternRef, type BingoPresetId } from '@dascade/shared/games/bingo';
import {
  PATTERN_PRESETS,
  PRESET_ORDER,
  allLines,
  dedupeMasks,
  invertMask,
  maskCount,
  maskFromString,
  maskSize,
  maskToString,
  mirrorHorizontal,
  mirrorVertical,
  patternProblem,
  presetMasks,
  resizeMask,
  resolvePattern,
  resolveRound,
  rotate180,
  rotate270,
  rotate90,
  roundTitle,
  transformVariants,
  type Mask,
} from './index.ts';

/** Parse a picture ('#' = in the pattern) into a mask. */
const art = (...rows: string[]): Mask => rows.join('').split('').map((c) => c === '#');
const show = (m: Mask): string[] => {
  const n = maskSize(m);
  return Array.from({ length: n }, (_, r) => m.slice(r * n, r * n + n).map((b) => (b ? '#' : '.')).join(''));
};
const one = (id: BingoPresetId, size = 5): string[] => {
  const masks = presetMasks(id, size);
  expect(masks).toHaveLength(1);
  return show(masks[0]!);
};

describe('library coverage', () => {
  it('defines every preset id exactly once and orders them all', () => {
    expect(Object.keys(PATTERN_PRESETS).sort()).toEqual([...BINGO_PRESET_IDS].sort());
    expect([...PRESET_ORDER].sort()).toEqual([...BINGO_PRESET_IDS].sort());
    for (const id of BINGO_PRESET_IDS) {
      expect(PATTERN_PRESETS[id].id).toBe(id);
      expect(PATTERN_PRESETS[id].name.length).toBeGreaterThan(2);
      expect(PATTERN_PRESETS[id].description.length).toBeGreaterThan(5);
    }
  });

  it('every preset builds square, non-empty, de-duplicated masks on every supported size', () => {
    for (const id of BINGO_PRESET_IDS) {
      for (let size = 3; size <= 7; size++) {
        const masks = presetMasks(id, size);
        if (!PATTERN_PRESETS[id].supports(size)) {
          expect(masks).toEqual([]);
          continue;
        }
        expect(masks.length).toBeGreaterThan(0);
        expect(dedupeMasks(masks)).toHaveLength(masks.length);
        for (const m of masks) {
          expect(m).toHaveLength(size * size);
          expect(maskCount(m)).toBeGreaterThan(0);
        }
        expect(masks.length > 1).toBe(PATTERN_PRESETS[id].family);
      }
    }
  });

  it('classic 5×5 is supported by every preset', () => {
    for (const id of BINGO_PRESET_IDS) expect(PATTERN_PRESETS[id].supports(5)).toBe(true);
  });
});

describe('line families', () => {
  it('any row / any column / any diagonal expand into the right masks', () => {
    const rows = presetMasks('any-row', 5).map(show);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(['#####', '.....', '.....', '.....', '.....']);
    expect(rows[4]).toEqual(['.....', '.....', '.....', '.....', '#####']);
    const cols = presetMasks('any-column', 4).map(show);
    expect(cols).toHaveLength(4);
    expect(cols[1]).toEqual(['.#..', '.#..', '.#..', '.#..']);
    const diags = presetMasks('any-diagonal', 3).map(show);
    expect(diags).toEqual([
      ['#..', '.#.', '..#'],
      ['..#', '.#.', '#..'],
    ]);
  });

  it('any line = rows + columns + both diagonals (2n + 2 masks)', () => {
    for (let n = 3; n <= 7; n++) {
      expect(presetMasks('any-line', n)).toHaveLength(2 * n + 2);
      expect(allLines(n).every((m) => maskCount(m) === n)).toBe(true);
    }
  });

  it('two lines = every pair of distinct lines', () => {
    const lines = 2 * 5 + 2;
    const masks = presetMasks('two-lines', 5);
    expect(masks).toHaveLength((lines * (lines - 1)) / 2);
    // Row 0 + column 0 share a corner: 9 squares. Two rows: 10 squares.
    const counts = new Set(masks.map(maskCount));
    expect(counts.has(9)).toBe(true);
    expect(counts.has(10)).toBe(true);
    expect(Math.max(...counts)).toBe(10);
  });
});

describe('shape presets on 5×5', () => {
  it('four corners', () => expect(one('four-corners')).toEqual(['#...#', '.....', '.....', '.....', '#...#']));
  it('postage stamp is a family of 2×2 corner blocks', () => {
    const stamps = presetMasks('postage-stamp', 5).map(show);
    expect(stamps).toHaveLength(4);
    expect(stamps[0]).toEqual(['##...', '##...', '.....', '.....', '.....']);
    expect(stamps[3]).toEqual(['.....', '.....', '.....', '...##', '...##']);
  });
  it('big X', () => expect(one('x')).toEqual(['#...#', '.#.#.', '..#..', '.#.#.', '#...#']));
  it('plus', () => expect(one('plus')).toEqual(['..#..', '..#..', '#####', '..#..', '..#..']));
  it('picture frame', () => expect(one('frame')).toEqual(['#####', '#...#', '#...#', '#...#', '#####']));
  it('inner frame', () => expect(one('inner-frame')).toEqual(['.....', '.###.', '.#.#.', '.###.', '.....']));
  it('center block', () => expect(one('center-block')).toEqual(['.....', '.###.', '.###.', '.###.', '.....']));
  it('diamond', () => expect(one('diamond')).toEqual(['..#..', '.#.#.', '#...#', '.#.#.', '..#..']));
  it('hourglass', () => expect(one('hourglass')).toEqual(['#####', '.###.', '..#..', '.###.', '#####']));
  it('pyramid', () => expect(one('pyramid')).toEqual(['.....', '.....', '..#..', '.###.', '#####']));
  it('letter T', () => expect(one('letter-t')).toEqual(['#####', '..#..', '..#..', '..#..', '..#..']));
  it('letter L', () => expect(one('letter-l')).toEqual(['#....', '#....', '#....', '#....', '#####']));
  it('letter U', () => expect(one('letter-u')).toEqual(['#...#', '#...#', '#...#', '#...#', '#####']));
  it('letter H', () => expect(one('letter-h')).toEqual(['#...#', '#...#', '#####', '#...#', '#...#']));
  it('letter Z', () => expect(one('letter-z')).toEqual(['#####', '...#.', '..#..', '.#...', '#####']));
  it('checkerboard', () => expect(one('checkerboard')).toEqual(['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#']));
  it('heart', () => expect(one('heart')).toEqual(['.#.#.', '#####', '#####', '.###.', '..#..']));
  it('smiley', () => expect(one('smiley')).toEqual(['.#.#.', '.#.#.', '.....', '#...#', '.###.']));
  it('blackout', () => expect(one('blackout')).toEqual(['#####', '#####', '#####', '#####', '#####']));
});

describe('size-dependent presets', () => {
  it('even boards use the two middle lines for plus / T / H', () => {
    expect(one('plus', 4)).toEqual(['.##.', '####', '####', '.##.']);
    expect(one('letter-t', 4)).toEqual(['####', '.##.', '.##.', '.##.']);
    expect(one('letter-h', 4)).toEqual(['#..#', '####', '####', '#..#']);
    expect(one('center-block', 4)).toEqual(['....', '.##.', '.##.', '....']);
    expect(one('center-block', 6)).toEqual(['......', '......', '..##..', '..##..', '......', '......']);
  });

  it('odd-only shapes are unavailable on even boards', () => {
    for (const id of ['diamond', 'hourglass', 'pyramid'] as const) {
      expect(PATTERN_PRESETS[id].supports(4)).toBe(false);
      expect(PATTERN_PRESETS[id].supports(6)).toBe(false);
      expect(PATTERN_PRESETS[id].supports(3)).toBe(true);
      expect(PATTERN_PRESETS[id].supports(7)).toBe(true);
    }
    expect(PATTERN_PRESETS['inner-frame'].supports(4)).toBe(false);
    expect(PATTERN_PRESETS['center-block'].supports(3)).toBe(false);
    expect(PATTERN_PRESETS.heart.supports(7)).toBe(true);
    expect(PATTERN_PRESETS.heart.supports(6)).toBe(false);
  });

  it('7×7 art and 3×3 shapes', () => {
    expect(one('heart', 7)).toEqual(['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...']);
    expect(one('diamond', 3)).toEqual(['.#.', '#.#', '.#.']);
    expect(one('inner-frame', 7)).toEqual(['.......', '.#####.', '.#...#.', '.#...#.', '.#...#.', '.#####.', '.......']);
  });
});

describe('explicit transformations', () => {
  const L = art('#....', '#....', '#....', '#....', '#####');

  it('rotates clockwise and back', () => {
    expect(show(rotate90(L))).toEqual(['#####', '#....', '#....', '#....', '#....']);
    expect(show(rotate180(L))).toEqual(['#####', '....#', '....#', '....#', '....#']);
    expect(show(rotate270(L))).toEqual(['....#', '....#', '....#', '....#', '#####']);
    expect(rotate90(rotate270(L))).toEqual(L);
    expect(rotate90(rotate90(rotate90(rotate90(L))))).toEqual(L);
  });

  it('mirrors horizontally and vertically', () => {
    expect(show(mirrorHorizontal(L))).toEqual(['....#', '....#', '....#', '....#', '#####']);
    expect(show(mirrorVertical(L))).toEqual(['#####', '#....', '#....', '#....', '#....']);
    expect(mirrorHorizontal(mirrorHorizontal(L))).toEqual(L);
  });

  it('inverts', () => {
    expect(maskCount(invertMask(L))).toBe(25 - 9);
  });

  it('variants: none, rotations, mirrors, all 8 symmetries — deduplicated', () => {
    expect(transformVariants(L, {})).toEqual([L]);
    expect(transformVariants(L, { rotate: true })).toHaveLength(4);
    expect(transformVariants(L, { mirror: true })).toHaveLength(3); // L, mirror left-right, mirror top-bottom
    const all = transformVariants(L, { rotate: true, mirror: true });
    expect(all).toHaveLength(4); // an L is symmetric about its diagonal, so its 8 images collapse to 4
    const T = art('#####', '..#..', '..#..', '.....', '.....');
    expect(transformVariants(T, { rotate: true, mirror: true })).toHaveLength(4);
    const skew = art('##...', '#....', '.....', '.....', '.....');
    const asym = art('###..', '#....', '.....', '.....', '.....');
    expect(transformVariants(asym, { rotate: true, mirror: true })).toHaveLength(8);
    expect(transformVariants(skew, { rotate: true })).toHaveLength(4);
    // A symmetric shape has a single orientation.
    expect(transformVariants(presetMasks('x', 5)[0]!, { rotate: true, mirror: true })).toHaveLength(1);
  });

  it('transforms are never applied unless the pattern opts in', () => {
    const ref: BingoPatternRef = { type: 'custom', name: 'L', size: 5, mask: maskToString(L), rotate: false, mirror: false };
    expect(resolvePattern(ref, 5)!.masks).toEqual([L]);
    const rotating = resolvePattern({ ...ref, rotate: true }, 5)!;
    expect(rotating.masks).toHaveLength(4);
    expect(rotating.rotate).toBe(true);
    expect(rotating.masks[0]).toEqual(L);
    expect(resolvePattern({ type: 'preset', id: 'letter-l', rotate: true, mirror: false }, 5)!.masks).toHaveLength(4);
  });

  it('resizes explicitly, never to an empty mask', () => {
    const big = resizeMask(presetMasks('frame', 5)[0]!, 7);
    expect(big).toHaveLength(49);
    expect(show(big)[0]).toBe('#######');
    const dot = art('...', '.#.', '...');
    const shrunk = resizeMask(dot, 4);
    expect(maskCount(shrunk)).toBeGreaterThan(0);
    expect(resizeMask(dot, 3)).toEqual(dot);
  });

  it('round-trips strings', () => {
    expect(maskFromString(maskToString(L))).toEqual(L);
    expect(maskToString(L)).toMatch(/^[01]{25}$/);
    expect(() => maskSize([true, false])).toThrow();
  });
});

describe('resolution', () => {
  it('reports patterns that do not fit the board instead of changing them', () => {
    const drawn5: BingoPatternRef = { type: 'custom', name: 'Mine', size: 5, mask: '1'.repeat(25), rotate: false, mirror: false };
    expect(patternProblem(drawn5, 5)).toBeNull();
    expect(patternProblem(drawn5, 4)).toMatch(/5×5/);
    expect(resolvePattern(drawn5, 4)).toBeNull();
    expect(patternProblem({ type: 'preset', id: 'diamond', rotate: false, mirror: false }, 4)).toMatch(/isn't available/);
    const { patterns, problems } = resolveRound(
      {
        patterns: [
          { type: 'preset', id: 'four-corners', rotate: false, mirror: false },
          { type: 'preset', id: 'diamond', rotate: false, mirror: false },
          drawn5,
        ],
      },
      4,
    );
    expect(patterns.map((p) => p.name)).toEqual(['Four corners']);
    expect(problems).toHaveLength(2);
  });

  it('flags families and titles rounds', () => {
    expect(resolvePattern({ type: 'preset', id: 'any-line', rotate: false, mirror: false }, 5)!.family).toBe(true);
    expect(resolvePattern({ type: 'preset', id: 'blackout', rotate: false, mirror: false }, 5)!.family).toBe(false);
    const fc = { type: 'preset', id: 'four-corners', rotate: false, mirror: false } as const;
    const x = { type: 'preset', id: 'x', rotate: false, mirror: false } as const;
    expect(roundTitle({ patterns: [fc] })).toBe('Four corners');
    expect(roundTitle({ patterns: [fc, x] })).toBe('Four corners or Big X');
    expect(roundTitle({ patterns: [fc, x, fc, x] })).toBe('Four corners, Big X +2 more');
  });

  it('the settings schema validates custom masks against their size', () => {
    const ok = BingoPatternRefSchema.safeParse({ type: 'custom', name: '  Rocket  ', size: 3, mask: '010111010' });
    expect(ok.success).toBe(true);
    if (ok.success && ok.data.type === 'custom') {
      expect(ok.data.name).toBe('Rocket');
      expect(ok.data.rotate).toBe(false);
    }
    expect(BingoPatternRefSchema.safeParse({ type: 'custom', name: 'x', size: 3, mask: '0101' }).success).toBe(false);
    expect(BingoPatternRefSchema.safeParse({ type: 'custom', name: 'x', size: 3, mask: '000000000' }).success).toBe(false);
    expect(BingoPatternRefSchema.safeParse({ type: 'custom', name: 'x', size: 3, mask: '01011101x' }).success).toBe(false);
    expect(BingoPatternRefSchema.safeParse({ type: 'preset', id: 'nope' }).success).toBe(false);
    const blank = BingoPatternRefSchema.safeParse({ type: 'custom', name: '   ', size: 3, mask: '100000000' });
    expect(blank.success && blank.data.type === 'custom' && blank.data.name).toBe('Custom pattern');
  });
});
