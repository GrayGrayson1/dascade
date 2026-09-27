/**
 * Letter Grid — an adjacent-letter word hunt on a 4×4 or 5×5 board.
 *
 * Board: `tiles` is row-major; each tile is one lowercase letter, or "qu" (the Qu die face).
 * Words are traced through tiles that touch horizontally, vertically or diagonally; a tile may be
 * used at most once per word.
 *
 * "Qu" handling: Q never appears alone. The Qu tile contributes the two letters "qu" to a word and
 * counts as two letters for length and scoring ("quest" = 5 letters on 4 tiles). Words that need a
 * Q without a following U ("qat", "qi") cannot be formed, and a word can't use a lone "u" from the Qu tile.
 *
 * Dice: DASwords uses its own letter dice (below) — not a copy of any commercial set. They were
 * generated for this game: faces allocated from English dictionary letter frequencies (≈38% vowels,
 * one Qu, each rare letter J/Q/X/Z/K/V/W/F on a different die, 1–3 vowels per die), then the
 * candidate sets were scored by solving thousands of seeded boards and the liveliest kept
 * (4×4: ≈52 everyday words of 3+ letters per board; 5×5: ≈77 everyday words of 4+ letters).
 * Each die has six faces; a board rolls every die once and shuffles their positions. The server
 * re-rolls boards that are too sparse (see rollPlayableGrid).
 */
import type { Rng } from '@dascade/shared';
import { shuffleInPlace } from '@dascade/shared';
import { lengthPoints } from '@dascade/shared/games/words';
import { MAX_WORD_LENGTH, normalizeWord, type WordDictionary } from './dictionary.ts';
import { BLOCKED_STEMS, BLOCKED_WORDS, isBlockedWord, maskBlocked } from './blocklist.ts';

export type GridSize = 4 | 5;

/** Six faces per die; "Q" stands for the Qu face. */
export const DICE_4X4: readonly string[] = [
  'WBOTAE', 'SOEIKR', 'TIDOMX', 'SVCULE',
  'JARSNE', 'FSLACO', 'IOELTP', 'TEAINS',
  'NTLZYA', 'SYDGTE', 'ARNIHT', 'GLUQDA',
  'RHEIMN', 'USCNRE', 'EEAHRT', 'OIBRPE',
];

export const DICE_5X5: readonly string[] = [
  'REASIN', 'ECPEIL', 'RLESAJ', 'NARVIU', 'FAGOHU',
  'TNHIPS', 'NTHEPS', 'OSRCET', 'TDYAXS', 'EYOICN',
  'RLNOAS', 'ONZAID', 'EBONIT', 'RUEIKT', 'GWSRAT',
  'OETKLS', 'EOBDET', 'QEESGI', 'TMEORF', 'RALWDB',
  'EACHDM', 'EOILRM', 'UEHLAT', 'ENUSVY', 'LICSTA',
];

export function diceFor(size: GridSize): readonly string[] {
  return size === 5 ? DICE_5X5 : DICE_4X4;
}

/** Tile text for a die face ("Q" → "qu"). */
export function faceToTile(face: string): string {
  return face === 'Q' ? 'qu' : face.toLowerCase();
}

/** Rolls every die once and shuffles positions. */
export function rollGrid(size: GridSize, rng: Rng): string[] {
  const dice = shuffleInPlace([...diceFor(size)], rng);
  return dice.map((die) => faceToTile(die[rng.int(die.length)] as string));
}

const NEIGHBOURS = new Map<number, number[][]>();

/** Neighbour lists for every tile of an n×n board (8-way adjacency). */
export function neighbourTable(size: number): number[][] {
  let table = NEIGHBOURS.get(size);
  if (!table) {
    table = [];
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const list: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < size && cc >= 0 && cc < size) list.push(rr * size + cc);
        }
      }
      table.push(list);
    }
    NEIGHBOURS.set(size, table);
  }
  return table;
}

export function gridSizeOf(tiles: readonly string[]): number {
  return Math.round(Math.sqrt(tiles.length));
}

export function areAdjacent(a: number, b: number, size: number): boolean {
  if (a === b) return false;
  const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size));
  const dc = Math.abs((a % size) - (b % size));
  return dr <= 1 && dc <= 1;
}

/** Letters spelled by a path (no validation). */
export function pathWord(tiles: readonly string[], path: readonly number[]): string {
  return path.map((i) => tiles[i] ?? '').join('');
}

export type PathError = 'empty' | 'out_of_bounds' | 'reused_tile' | 'not_adjacent' | 'mismatch';

export type PathCheck = { ok: true; word: string } | { ok: false; reason: PathError };

/**
 * Validates a traced path: indices on the board, each step adjacent, no tile reused, and (when
 * `word` is given) the path spells exactly that word.
 */
export function validatePath(tiles: readonly string[], path: readonly number[], word?: string): PathCheck {
  if (path.length === 0) return { ok: false, reason: 'empty' };
  const size = gridSizeOf(tiles);
  const seen = new Set<number>();
  for (let k = 0; k < path.length; k++) {
    const i = path[k] as number;
    if (!Number.isInteger(i) || i < 0 || i >= tiles.length) return { ok: false, reason: 'out_of_bounds' };
    if (seen.has(i)) return { ok: false, reason: 'reused_tile' };
    if (k > 0 && !areAdjacent(path[k - 1] as number, i, size)) return { ok: false, reason: 'not_adjacent' };
    seen.add(i);
  }
  const spelled = pathWord(tiles, path);
  if (word !== undefined && spelled !== word) return { ok: false, reason: 'mismatch' };
  return { ok: true, word: spelled };
}

/** Finds one valid path spelling `word` on the board (depth-first), or null. */
export function findPath(tiles: readonly string[], word: string): number[] | null {
  if (!word) return null;
  const size = gridSizeOf(tiles);
  const table = neighbourTable(size);
  const path: number[] = [];
  const used = new Array<boolean>(tiles.length).fill(false);

  const dfs = (tile: number, pos: number): boolean => {
    const text = tiles[tile] as string;
    if (!word.startsWith(text, pos)) return false;
    used[tile] = true;
    path.push(tile);
    const next = pos + text.length;
    if (next === word.length) return true;
    for (const n of table[tile] as number[]) {
      if (!used[n] && dfs(n, next)) return true;
    }
    used[tile] = false;
    path.pop();
    return false;
  };

  for (let t = 0; t < tiles.length; t++) {
    if (dfs(t, 0)) return path;
  }
  return null;
}

/** Every dictionary word of at least `minLength` letters on the board, with one path each. */
export function solveGrid(tiles: readonly string[], dict: WordDictionary, minLength = 3): Map<string, number[]> {
  const size = gridSizeOf(tiles);
  const table = neighbourTable(size);
  const found = new Map<string, number[]>();
  const used = new Array<boolean>(tiles.length).fill(false);
  const path: number[] = [];

  const dfs = (tile: number, prefix: string): void => {
    const word = prefix + (tiles[tile] as string);
    if (!dict.hasPrefix(word)) return;
    used[tile] = true;
    path.push(tile);
    if (word.length >= minLength && !found.has(word) && dict.has(word)) found.set(word, [...path]);
    for (const n of table[tile] as number[]) if (!used[n]) dfs(n, word);
    used[tile] = false;
    path.pop();
  };

  for (let t = 0; t < tiles.length; t++) dfs(t, '');
  return found;
}

const BOARD_BLOCKLIST = [...BLOCKED_WORDS.filter((w) => w.length >= 4), ...BLOCKED_STEMS];

/**
 * Whether a blocked word of 4+ letters (or a blocked stem) can be traced on the board — such boards
 * are re-rolled so nothing offensive sits in plain sight. Three-letter blocked words are common
 * letter clusters; they're simply refused if someone plays them.
 */
export function gridSpellsBlockedWord(tiles: readonly string[]): boolean {
  for (const w of BOARD_BLOCKLIST) if (findPath(tiles, w)) return true;
  return false;
}

export interface GridQuality {
  /** Solutions of at least the round's minimum length. */
  words: number;
  /** Everyday (tier 1) solutions. */
  common: number;
  longest: number;
}

export function gridQuality(solutions: ReadonlyMap<string, number[]>, dict: WordDictionary): GridQuality {
  let common = 0;
  let longest = 0;
  for (const w of solutions.keys()) {
    if (dict.isCommon(w)) common++;
    if (w.length > longest) longest = w.length;
  }
  return { words: solutions.size, common, longest };
}

/** Minimum everyday words a board must offer (per size and minimum length) before we accept it. */
export function minimumCommonWords(size: GridSize, minLength: number): number {
  if (size === 5) return minLength >= 4 ? 45 : 80;
  return minLength >= 4 ? 14 : 30;
}

export interface RolledGrid {
  tiles: string[];
  solutions: Map<string, number[]>;
  quality: GridQuality;
  attempts: number;
}

/**
 * Rolls boards until one is lively enough (enough everyday words and a word of 6+ letters) and can't
 * spell a blocked word; after `maxAttempts` the best board seen is used.
 */
export function rollPlayableGrid(size: GridSize, minLength: number, dict: WordDictionary, rng: Rng, maxAttempts = 40): RolledGrid {
  let best: RolledGrid | null = null;
  const need = minimumCommonWords(size, minLength);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tiles = rollGrid(size, rng);
    if (gridSpellsBlockedWord(tiles)) continue;
    const solutions = solveGrid(tiles, dict, minLength);
    const quality = gridQuality(solutions, dict);
    const candidate: RolledGrid = { tiles, solutions, quality, attempts: attempt };
    if (quality.common >= need && quality.longest >= 6) return candidate;
    if (!best || quality.common > best.quality.common) best = candidate;
  }
  if (best) return { ...best, attempts: maxAttempts };
  // Every roll spelled a blocked word (practically impossible): accept a plain roll.
  const tiles = rollGrid(size, rng);
  const solutions = solveGrid(tiles, dict, minLength);
  return { tiles, solutions, quality: gridQuality(solutions, dict), attempts: maxAttempts };
}

/** Points for a Letter Grid word by letter count (Qu counts as two letters) — WORD_LENGTH_POINTS. */
export function gridWordPoints(length: number): number {
  return lengthPoints(length);
}

export type GridWordCheck =
  | { ok: true; word: string; path: number[]; points: number }
  | { ok: false; reason: 'too_short' | 'too_long' | 'blocked' | 'not_on_grid' | 'not_word'; word: string };

/**
 * Full server check of one Letter Grid submission. A traced `path` is used when it is valid and
 * spells the word; otherwise (typed words, or a stale/garbled trace) the server searches the board
 * itself — the client's path is never trusted on its own.
 */
export function checkGridWord(raw: string, tiles: readonly string[], dict: WordDictionary, minLength: number, path?: readonly number[]): GridWordCheck {
  const word = normalizeWord(raw);
  if (word.length < minLength) return { ok: false, reason: 'too_short', word };
  if (word.length > MAX_WORD_LENGTH) return { ok: false, reason: 'too_long', word };
  if (isBlockedWord(word)) return { ok: false, reason: 'blocked', word: maskBlocked(word) };
  let used: number[] | null = null;
  if (path && path.length > 0) {
    const check = validatePath(tiles, path, word);
    if (check.ok) used = [...path];
  }
  if (!used) used = findPath(tiles, word);
  if (!used) return { ok: false, reason: 'not_on_grid', word };
  if (!dict.has(word)) return { ok: false, reason: 'not_word', word };
  return { ok: true, word, path: used, points: gridWordPoints(word.length) };
}
