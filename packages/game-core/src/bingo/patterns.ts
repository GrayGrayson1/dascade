/**
 * Winning patterns: square boolean masks (row-major), the built-in library,
 * explicit transformations and resolution of a round's pattern set.
 */
import type { BingoPatternRef, BingoPresetId, BingoRound } from '@dascade/shared/games/bingo';

export type Mask = boolean[];

// ---------------------------------------------------------------------------
// Mask primitives
// ---------------------------------------------------------------------------

export function emptyMask(size: number): Mask {
  return new Array<boolean>(size * size).fill(false);
}

export function fullMask(size: number): Mask {
  return new Array<boolean>(size * size).fill(true);
}

export function maskFromString(s: string): Mask {
  return Array.from(s, (ch) => ch === '1');
}

export function maskToString(mask: readonly boolean[]): string {
  return mask.map((b) => (b ? '1' : '0')).join('');
}

/** Edge length of a square mask (throws when not square). */
export function maskSize(mask: readonly boolean[]): number {
  const n = Math.round(Math.sqrt(mask.length));
  if (n * n !== mask.length) throw new RangeError(`mask of length ${mask.length} is not square`);
  return n;
}

export function maskCount(mask: readonly boolean[]): number {
  let n = 0;
  for (const b of mask) if (b) n++;
  return n;
}

export function maskUnion(...masks: ReadonlyArray<readonly boolean[]>): Mask {
  const first = masks[0];
  if (!first) return [];
  return first.map((_, i) => masks.some((m) => m[i]));
}

function fromCells(size: number, pred: (r: number, c: number) => boolean): Mask {
  const m = emptyMask(size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) m[r * size + c] = pred(r, c);
  return m;
}

function fromArt(rows: readonly string[]): Mask {
  return rows.join('').split('').map((ch) => ch === '#');
}

// ---------------------------------------------------------------------------
// Explicit transformations (only applied when the host opts in)
// ---------------------------------------------------------------------------

/** Rotate 90° clockwise. */
export function rotate90(mask: readonly boolean[], size = maskSize(mask)): Mask {
  return fromCells(size, (r, c) => Boolean(mask[(size - 1 - c) * size + r]));
}

export function rotate180(mask: readonly boolean[], size = maskSize(mask)): Mask {
  return rotate90(rotate90(mask, size), size);
}

export function rotate270(mask: readonly boolean[], size = maskSize(mask)): Mask {
  return rotate90(rotate180(mask, size), size);
}

/** Mirror left ↔ right. */
export function mirrorHorizontal(mask: readonly boolean[], size = maskSize(mask)): Mask {
  return fromCells(size, (r, c) => Boolean(mask[r * size + (size - 1 - c)]));
}

/** Mirror top ↕ bottom. */
export function mirrorVertical(mask: readonly boolean[], size = maskSize(mask)): Mask {
  return fromCells(size, (r, c) => Boolean(mask[(size - 1 - r) * size + c]));
}

export function invertMask(mask: readonly boolean[]): Mask {
  return mask.map((b) => !b);
}

/** Nearest-neighbour rescale (used by the explicit "fit to board" action). Never returns an empty mask. */
export function resizeMask(mask: readonly boolean[], to: number): Mask {
  const from = maskSize(mask);
  if (from === to) return [...mask];
  const out = fromCells(to, (r, c) => {
    const sr = Math.min(from - 1, Math.floor(((r + 0.5) * from) / to));
    const sc = Math.min(from - 1, Math.floor(((c + 0.5) * from) / to));
    return Boolean(mask[sr * from + sc]);
  });
  if (!out.includes(true) && mask.includes(true)) out[Math.floor((to * to) / 2)] = true;
  return out;
}

export function dedupeMasks(masks: readonly Mask[]): Mask[] {
  const seen = new Set<string>();
  const out: Mask[] = [];
  for (const m of masks) {
    const key = maskToString(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Every accepted orientation of a mask:
 *  - rotate: the 90°/180°/270° rotations
 *  - mirror: the left↔right and top↕bottom mirror images
 *  - both: the full set of 8 symmetries
 */
export function transformVariants(mask: readonly boolean[], opts: { rotate?: boolean; mirror?: boolean }, size = maskSize(mask)): Mask[] {
  let set: Mask[] = [[...mask]];
  if (opts.rotate) set = [...set, rotate90(mask, size), rotate180(mask, size), rotate270(mask, size)];
  if (opts.mirror) {
    const mirrored = set.flatMap((m) => [mirrorHorizontal(m, size), mirrorVertical(m, size)]);
    set = [...set, ...mirrored];
  }
  return dedupeMasks(set);
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export function rowMask(size: number, row: number): Mask {
  return fromCells(size, (r) => r === row);
}

export function columnMask(size: number, col: number): Mask {
  return fromCells(size, (_r, c) => c === col);
}

export function diagonalMasks(size: number): [Mask, Mask] {
  return [fromCells(size, (r, c) => r === c), fromCells(size, (r, c) => r + c === size - 1)];
}

/** Every straight line: rows, then columns, then the two diagonals. */
export function allLines(size: number): Mask[] {
  const out: Mask[] = [];
  for (let i = 0; i < size; i++) out.push(rowMask(size, i));
  for (let i = 0; i < size; i++) out.push(columnMask(size, i));
  out.push(...diagonalMasks(size));
  return out;
}

/** The middle row/column index (odd) or the two middle indices (even). */
function middles(size: number): number[] {
  return size % 2 === 1 ? [(size - 1) / 2] : [size / 2 - 1, size / 2];
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface PatternPreset {
  id: BingoPresetId;
  name: string;
  description: string;
  /** Families ("any row") expand into several masks; any one of them wins. */
  family: boolean;
  /** Short group label used by the library picker. */
  group: 'Lines' | 'Shapes' | 'Letters' | 'Fun' | 'Full card';
  supports(size: number): boolean;
  build(size: number): Mask[];
}

const all = () => true;
const odd = (n: number) => n % 2 === 1;

const HEART: Record<number, string[]> = {
  5: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  7: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
};
const SMILEY: Record<number, string[]> = {
  5: ['.#.#.', '.#.#.', '.....', '#...#', '.###.'],
  7: ['.......', '.#...#.', '.#...#.', '.......', '#.....#', '.#...#.', '..###..'],
};

export const PATTERN_PRESETS: Record<BingoPresetId, PatternPreset> = {
  'any-line': {
    id: 'any-line',
    name: 'Any line',
    description: 'Any full row, column or diagonal.',
    family: true,
    group: 'Lines',
    supports: all,
    build: (n) => allLines(n),
  },
  'any-row': {
    id: 'any-row',
    name: 'Any row',
    description: 'Any full horizontal row.',
    family: true,
    group: 'Lines',
    supports: all,
    build: (n) => Array.from({ length: n }, (_, i) => rowMask(n, i)),
  },
  'any-column': {
    id: 'any-column',
    name: 'Any column',
    description: 'Any full vertical column.',
    family: true,
    group: 'Lines',
    supports: all,
    build: (n) => Array.from({ length: n }, (_, i) => columnMask(n, i)),
  },
  'any-diagonal': {
    id: 'any-diagonal',
    name: 'Any diagonal',
    description: 'Either corner-to-corner diagonal.',
    family: true,
    group: 'Lines',
    supports: all,
    build: (n) => diagonalMasks(n),
  },
  'two-lines': {
    id: 'two-lines',
    name: 'Two lines',
    description: 'Any two different lines (rows, columns or diagonals).',
    family: true,
    group: 'Lines',
    supports: all,
    build: (n) => {
      const lines = allLines(n);
      const out: Mask[] = [];
      for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) out.push(maskUnion(lines[i]!, lines[j]!));
      return dedupeMasks(out);
    },
  },
  'four-corners': {
    id: 'four-corners',
    name: 'Four corners',
    description: 'All four corner squares.',
    family: false,
    group: 'Shapes',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => (r === 0 || r === n - 1) && (c === 0 || c === n - 1))],
  },
  'postage-stamp': {
    id: 'postage-stamp',
    name: 'Postage stamp',
    description: 'A 2×2 block tucked into any corner.',
    family: true,
    group: 'Shapes',
    supports: all,
    build: (n) =>
      [
        [0, 0],
        [0, n - 2],
        [n - 2, 0],
        [n - 2, n - 2],
      ].map(([r0, c0]) => fromCells(n, (r, c) => r >= r0! && r < r0! + 2 && c >= c0! && c < c0! + 2)),
  },
  x: {
    id: 'x',
    name: 'Big X',
    description: 'Both diagonals at once.',
    family: false,
    group: 'Shapes',
    supports: all,
    build: (n) => [maskUnion(...diagonalMasks(n))],
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    description: 'The middle row and the middle column.',
    family: false,
    group: 'Shapes',
    supports: all,
    build: (n) => {
      const mid = middles(n);
      return [fromCells(n, (r, c) => mid.includes(r) || mid.includes(c))];
    },
  },
  frame: {
    id: 'frame',
    name: 'Picture frame',
    description: 'The entire outer border.',
    family: false,
    group: 'Shapes',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => r === 0 || c === 0 || r === n - 1 || c === n - 1)],
  },
  'inner-frame': {
    id: 'inner-frame',
    name: 'Inner frame',
    description: 'The ring just inside the border.',
    family: false,
    group: 'Shapes',
    supports: (n) => n >= 5,
    build: (n) => [fromCells(n, (r, c) => r >= 1 && c >= 1 && r <= n - 2 && c <= n - 2 && (r === 1 || c === 1 || r === n - 2 || c === n - 2))],
  },
  'center-block': {
    id: 'center-block',
    name: 'Center block',
    description: 'The solid block in the middle of the card.',
    family: false,
    group: 'Shapes',
    supports: (n) => n >= 4,
    build: (n) => {
      const edge = odd(n) ? 3 : 2;
      const start = (n - edge) / 2;
      return [fromCells(n, (r, c) => r >= start && r < start + edge && c >= start && c < start + edge)];
    },
  },
  diamond: {
    id: 'diamond',
    name: 'Diamond',
    description: 'A diamond touching the middle of each edge.',
    family: false,
    group: 'Shapes',
    supports: odd,
    build: (n) => {
      const m = (n - 1) / 2;
      return [fromCells(n, (r, c) => Math.abs(r - m) + Math.abs(c - m) === m)];
    },
  },
  hourglass: {
    id: 'hourglass',
    name: 'Hourglass',
    description: 'Top and bottom rows narrowing to the middle.',
    family: false,
    group: 'Fun',
    supports: odd,
    build: (n) => {
      const m = (n - 1) / 2;
      return [fromCells(n, (r, c) => Math.abs(c - m) <= Math.abs(r - m))];
    },
  },
  pyramid: {
    id: 'pyramid',
    name: 'Pyramid',
    description: 'A stepped triangle sitting on the bottom row.',
    family: false,
    group: 'Fun',
    supports: odd,
    build: (n) => {
      const m = (n - 1) / 2;
      return [fromCells(n, (r, c) => r >= m && Math.abs(c - m) <= r - m)];
    },
  },
  'letter-t': {
    id: 'letter-t',
    name: 'Letter T',
    description: 'The top row and the middle column.',
    family: false,
    group: 'Letters',
    supports: all,
    build: (n) => {
      const mid = middles(n);
      return [fromCells(n, (r, c) => r === 0 || mid.includes(c))];
    },
  },
  'letter-l': {
    id: 'letter-l',
    name: 'Letter L',
    description: 'The left column and the bottom row.',
    family: false,
    group: 'Letters',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => c === 0 || r === n - 1)],
  },
  'letter-u': {
    id: 'letter-u',
    name: 'Letter U',
    description: 'Both side columns and the bottom row.',
    family: false,
    group: 'Letters',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => c === 0 || c === n - 1 || r === n - 1)],
  },
  'letter-h': {
    id: 'letter-h',
    name: 'Letter H',
    description: 'Both side columns and the middle row.',
    family: false,
    group: 'Letters',
    supports: all,
    build: (n) => {
      const mid = middles(n);
      return [fromCells(n, (r, c) => c === 0 || c === n - 1 || mid.includes(r))];
    },
  },
  'letter-z': {
    id: 'letter-z',
    name: 'Letter Z',
    description: 'Top row, bottom row and the rising diagonal.',
    family: false,
    group: 'Letters',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => r === 0 || r === n - 1 || r + c === n - 1)],
  },
  checkerboard: {
    id: 'checkerboard',
    name: 'Checkerboard',
    description: 'Every other square, starting in the corners.',
    family: false,
    group: 'Fun',
    supports: all,
    build: (n) => [fromCells(n, (r, c) => (r + c) % 2 === 0)],
  },
  heart: {
    id: 'heart',
    name: 'Heart',
    description: 'A big pixel heart.',
    family: false,
    group: 'Fun',
    supports: (n) => n in HEART,
    build: (n) => [fromArt(HEART[n] ?? [])],
  },
  smiley: {
    id: 'smiley',
    name: 'Smiley',
    description: 'Two eyes and a grin.',
    family: false,
    group: 'Fun',
    supports: (n) => n in SMILEY,
    build: (n) => [fromArt(SMILEY[n] ?? [])],
  },
  blackout: {
    id: 'blackout',
    name: 'Blackout',
    description: 'Cover every square on the card.',
    family: false,
    group: 'Full card',
    supports: all,
    build: (n) => [fullMask(n)],
  },
};

/** Library display order. */
export const PRESET_ORDER: readonly BingoPresetId[] = [
  'any-line',
  'any-row',
  'any-column',
  'any-diagonal',
  'two-lines',
  'four-corners',
  'postage-stamp',
  'x',
  'plus',
  'frame',
  'inner-frame',
  'center-block',
  'diamond',
  'letter-t',
  'letter-l',
  'letter-u',
  'letter-h',
  'letter-z',
  'hourglass',
  'pyramid',
  'checkerboard',
  'heart',
  'smiley',
  'blackout',
];

export function presetSupports(id: BingoPresetId, size: number): boolean {
  return PATTERN_PRESETS[id].supports(size);
}

export function presetMasks(id: BingoPresetId, size: number): Mask[] {
  const preset = PATTERN_PRESETS[id];
  if (!preset.supports(size)) return [];
  return preset.build(size);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedPattern {
  name: string;
  /** Every mask that satisfies this pattern (family members × accepted transforms). */
  masks: Mask[];
  family: boolean;
  rotate: boolean;
  mirror: boolean;
}

export function patternName(ref: BingoPatternRef): string {
  return ref.type === 'preset' ? PATTERN_PRESETS[ref.id].name : ref.name;
}

/** Why a pattern can't be used on this board, or null when it can. */
export function patternProblem(ref: BingoPatternRef, size: number): string | null {
  if (ref.type === 'preset') {
    return presetSupports(ref.id, size) ? null : `“${PATTERN_PRESETS[ref.id].name}” isn't available on a ${size}×${size} card`;
  }
  if (ref.size !== size) return `“${ref.name}” was drawn for a ${ref.size}×${ref.size} card, but the card is ${size}×${size}`;
  return null;
}

/** Resolves a pattern for a board size; null when it doesn't fit the board. */
export function resolvePattern(ref: BingoPatternRef, size: number): ResolvedPattern | null {
  if (patternProblem(ref, size)) return null;
  const base = ref.type === 'preset' ? presetMasks(ref.id, size) : [ref.mask.split('').map((ch) => ch === '1')];
  const masks = dedupeMasks(base.flatMap((m) => transformVariants(m, { rotate: ref.rotate, mirror: ref.mirror }, size)));
  return {
    name: patternName(ref),
    masks,
    family: masks.length > 1,
    rotate: Boolean(ref.rotate),
    mirror: Boolean(ref.mirror),
  };
}

/**
 * Resolves every pattern of a round. Unusable patterns are reported, not silently changed.
 * A pattern that accepts exactly the same masks as an earlier one adds nothing, so it is
 * dropped (keeps the published plan and per-call checks bounded when a pattern is repeated).
 */
export function resolveRound(round: Pick<BingoRound, 'patterns'>, size: number): { patterns: ResolvedPattern[]; problems: string[] } {
  const patterns: ResolvedPattern[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const ref of round.patterns) {
    const problem = patternProblem(ref, size);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const resolved = resolvePattern(ref, size);
    if (!resolved) continue;
    const key = resolved.masks.map(maskToString).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push(resolved);
  }
  return { patterns, problems };
}

/** A short, human summary of a round's pattern set ("Any line", "Four corners or X"). */
export function roundTitle(round: Pick<BingoRound, 'patterns'>): string {
  const names = round.patterns.map(patternName);
  if (names.length <= 2) return names.join(' or ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}
