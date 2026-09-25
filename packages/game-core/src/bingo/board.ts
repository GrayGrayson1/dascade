/**
 * Board geometry, card generation, dealing and the caller bag.
 */
import { createSeededRng, shuffleInPlace, type Rng } from '@dascade/shared';
import { BINGO_BALLS, BINGO_FREE, BINGO_LETTERS, BINGO_NUMBER_SIZE, type BingoMode, type BingoSettings } from '@dascade/shared/games/bingo';

export const FREE = BINGO_FREE;

/** Everything needed to generate and evaluate cards. */
export interface BoardSpec {
  mode: BingoMode;
  /** Square board edge (numbers mode is always 5). */
  size: number;
  /** Free center square (only on odd sizes). */
  free: boolean;
  /** Number of distinct call tokens (75 balls, or the text pool size). */
  poolSize: number;
}

export function boardSpec(settings: Pick<BingoSettings, 'mode' | 'size' | 'freeCenter' | 'items'>): BoardSpec {
  const size = settings.mode === 'numbers' ? BINGO_NUMBER_SIZE : settings.size;
  return {
    mode: settings.mode,
    size,
    free: settings.freeCenter && size % 2 === 1,
    poolSize: settings.mode === 'numbers' ? BINGO_BALLS : settings.items.length,
  };
}

export function cellCount(size: number): number {
  return size * size;
}

/** Index of the center square (odd sizes), else null. */
export function centerIndex(size: number): number | null {
  if (size % 2 === 0) return null;
  const m = (size - 1) / 2;
  return m * size + m;
}

/** Distinct items a card needs (cells minus the free square). */
export function itemsPerCard(spec: Pick<BoardSpec, 'size' | 'free'>): number {
  return cellCount(spec.size) - (spec.free ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Numbers (75-ball)
// ---------------------------------------------------------------------------

/** Inclusive number range for a B/I/N/G/O column (0–4). */
export function columnRange(col: number): { min: number; max: number } {
  if (!Number.isInteger(col) || col < 0 || col > 4) throw new RangeError(`column ${col}`);
  return { min: col * 15 + 1, max: col * 15 + 15 };
}

/** Column (0–4) for a ball number (1–75). */
export function columnForNumber(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > BINGO_BALLS) throw new RangeError(`ball ${n}`);
  return Math.floor((n - 1) / 15);
}

export function letterForNumber(n: number): (typeof BINGO_LETTERS)[number] {
  return BINGO_LETTERS[columnForNumber(n)] as (typeof BINGO_LETTERS)[number];
}

/** "B 12" / "Coffee spill" — the human label of a call token. */
export function callLabel(spec: Pick<BoardSpec, 'mode'>, token: number, items: readonly string[] = []): string {
  if (spec.mode === 'numbers') return `${letterForNumber(token)} ${token}`;
  return items[token] ?? `#${token + 1}`;
}

// ---------------------------------------------------------------------------
// Card generation
// ---------------------------------------------------------------------------

function sampleDistinct(min: number, max: number, count: number, rng: Rng): number[] {
  const all: number[] = [];
  for (let v = min; v <= max; v++) all.push(v);
  // Partial Fisher–Yates: only the first `count` positions are needed.
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(all.length - i);
    const tmp = all[i] as number;
    all[i] = all[j] as number;
    all[j] = tmp;
  }
  return all.slice(0, count);
}

/** Generates one card (row-major call tokens, FREE at the center when enabled). */
export function generateCard(spec: BoardSpec, rng: Rng): number[] {
  const { size } = spec;
  const center = spec.free ? centerIndex(size) : null;
  if (spec.mode === 'numbers') {
    if (size !== BINGO_NUMBER_SIZE) throw new RangeError('75-ball cards are 5×5');
    const cells = new Array<number>(size * size).fill(0);
    for (let col = 0; col < size; col++) {
      const { min, max } = columnRange(col);
      const picks = sampleDistinct(min, max, size, rng);
      for (let row = 0; row < size; row++) cells[row * size + col] = picks[row] as number;
    }
    if (center !== null) cells[center] = FREE;
    return cells;
  }
  const need = itemsPerCard(spec);
  if (spec.poolSize < need) throw new RangeError(`Need at least ${need} items for a ${size}×${size} card (have ${spec.poolSize})`);
  const picks = sampleDistinct(0, spec.poolSize - 1, need, rng);
  shuffleInPlace(picks, rng);
  const cells: number[] = [];
  let k = 0;
  for (let i = 0; i < size * size; i++) cells.push(i === center ? FREE : (picks[k++] as number));
  return cells;
}

/** Canonical identity of a card layout. */
export function cardKey(cells: readonly number[]): string {
  return cells.join(',');
}

/** Structural check that a card is legal for the spec (used by tests and verification). */
export function isValidCard(spec: BoardSpec, cells: readonly number[]): boolean {
  const { size } = spec;
  if (cells.length !== size * size) return false;
  const center = spec.free ? centerIndex(size) : null;
  const seen = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i] as number;
    if (i === center) {
      if (v !== FREE) return false;
      continue;
    }
    if (v === FREE || !Number.isInteger(v) || seen.has(v)) return false;
    seen.add(v);
    if (spec.mode === 'numbers') {
      if (v < 1 || v > BINGO_BALLS || columnForNumber(v) !== i % size) return false;
    } else if (v < 0 || v >= spec.poolSize) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reproducible dealing
// ---------------------------------------------------------------------------

/** Seed string for one card. Anyone with the revealed match seed can regenerate every card. */
export function cardSeed(seed: string, deal: number, serial: number, attempt = 0): string {
  return `${seed}|deal${deal}|card${serial}|try${attempt}`;
}

export const MAX_DEAL_ATTEMPTS = 64;

/**
 * Deals card `serial` of `deal` from `seed`, re-rolling (deterministically) if the layout
 * duplicates a card in `taken`. The chosen key is added to `taken`.
 */
export function dealCard(spec: BoardSpec, seed: string, deal: number, serial: number, taken: Set<string>): { cells: number[]; attempt: number } {
  let last: number[] = [];
  for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
    const cells = generateCard(spec, createSeededRng(cardSeed(seed, deal, serial, attempt)));
    last = cells;
    const key = cardKey(cells);
    if (!taken.has(key)) {
      taken.add(key);
      return { cells, attempt };
    }
  }
  // Only reachable with absurdly tiny pools; identical layouts are then unavoidable.
  taken.add(cardKey(last));
  return { cells: last, attempt: MAX_DEAL_ATTEMPTS - 1 };
}

/** Deals cards 1…count of a deal (convenience for tests, previews and verification). */
export function dealCards(spec: BoardSpec, seed: string, deal: number, count: number): number[][] {
  const taken = new Set<string>();
  const out: number[][] = [];
  for (let serial = 1; serial <= count; serial++) out.push(dealCard(spec, seed, deal, serial, taken).cells);
  return out;
}

/** True when `cells` is exactly what the seed produces for (deal, serial) at some attempt. */
export function verifyCard(spec: BoardSpec, seed: string, deal: number, serial: number, cells: readonly number[]): boolean {
  const key = cardKey(cells);
  for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
    if (cardKey(generateCard(spec, createSeededRng(cardSeed(seed, deal, serial, attempt)))) === key) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Caller bag
// ---------------------------------------------------------------------------

/** Every call token for the spec: 1–75, or 0…pool-1. */
export function allTokens(spec: Pick<BoardSpec, 'mode' | 'poolSize'>): number[] {
  const out: number[] = [];
  if (spec.mode === 'numbers') for (let n = 1; n <= BINGO_BALLS; n++) out.push(n);
  else for (let i = 0; i < spec.poolSize; i++) out.push(i);
  return out;
}

/** Tokens not yet called, in natural order. */
export function remainingTokens(spec: Pick<BoardSpec, 'mode' | 'poolSize'>, calls: readonly number[]): number[] {
  const called = new Set(calls);
  return allTokens(spec).filter((t) => !called.has(t));
}

export function isCallable(spec: Pick<BoardSpec, 'mode' | 'poolSize'>, calls: readonly number[], token: number): boolean {
  if (!Number.isInteger(token)) return false;
  if (spec.mode === 'numbers' ? token < 1 || token > BINGO_BALLS : token < 0 || token >= spec.poolSize) return false;
  return !calls.includes(token);
}

/** Draws a uniformly random uncalled token, or null when the bag is empty. */
export function drawToken(spec: Pick<BoardSpec, 'mode' | 'poolSize'>, calls: readonly number[], rng: Rng): number | null {
  const left = remainingTokens(spec, calls);
  if (left.length === 0) return null;
  return left[rng.int(left.length)] as number;
}
