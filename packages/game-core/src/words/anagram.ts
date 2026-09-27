/**
 * Anagram Sprint — one shared rack of letters; players find words using each letter at most once.
 *
 * Rack generation: pick an everyday (tier 1) seed word of the rack length, then scramble it. The rack
 * is guaranteed to hide at least that long word (plus any other full-length anagrams), and is re-picked
 * until it offers enough shorter words to be fun. The displayed scramble is never itself a word and
 * never spells a blocked word. The seed and the solution list stay on the server until the reveal.
 *
 * Scoring (ANAGRAM_BONUS in the shared contract):
 *   base = length points; rare word (dictionary tier 3) +2; uses every letter +5;
 *   nobody else (no other team) found it → base ×2 (multiplayer only).
 */
import type { Rng } from '@dascade/shared';
import { shuffleInPlace } from '@dascade/shared';
import { ANAGRAM_BONUS, lengthPoints } from '@dascade/shared/games/words';
import { normalizeWord, type WordDictionary } from './dictionary.ts';
import { isBlockedWord, maskBlocked, spellsBlockedWord } from './blocklist.ts';

const A = 97;

/** Letter counts a–z. */
export function letterCounts(word: string): Uint8Array {
  const counts = new Uint8Array(26);
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i) - A;
    if (c >= 0 && c < 26) counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts;
}

/** Whether `word` can be spelled from the rack (each rack letter used at most once). */
export function canFormFromRack(word: string, rack: string | Uint8Array): boolean {
  const available = typeof rack === 'string' ? letterCounts(rack) : rack;
  const need = new Uint8Array(26);
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i) - A;
    if (c < 0 || c >= 26) return false;
    need[c] = (need[c] ?? 0) + 1;
    if ((need[c] as number) > (available[c] as number)) return false;
  }
  return true;
}

/** Every dictionary word (≥ minLength) that can be made from the rack, longest first then A–Z. */
export function solveRack(rack: string, dict: WordDictionary, minLength = 3): string[] {
  const counts = letterCounts(rack);
  const out: string[] = [];
  for (let len = Math.min(rack.length, 15); len >= minLength; len--) {
    for (const w of dict.ofLength(len)) if (canFormFromRack(w, counts)) out.push(w);
  }
  return out;
}

/** Minimum solutions a rack must offer (by rack size) before we accept it. */
export function minimumRackWords(size: number): number {
  if (size <= 6) return 18;
  if (size === 7) return 30;
  return 40;
}

export interface Rack {
  /** Scrambled letters shown to players (lowercase). */
  letters: string;
  /** Every word using the whole rack (the seed first). Secret until the reveal. */
  seeds: string[];
  /** Every valid word (≥ 3 letters). Secret until the reveal. */
  solutions: string[];
}

/** Scrambles letters so the display isn't a word and doesn't spell anything blocked. */
export function scrambleRack(word: string, dict: WordDictionary, rng: Rng): string {
  const letters = word.split('');
  let best = word;
  for (let attempt = 0; attempt < 60; attempt++) {
    const s = shuffleInPlace([...letters], rng).join('');
    if (s === word || dict.has(s) || spellsBlockedWord(s)) continue;
    best = s;
    return best;
  }
  // Pathological (e.g. all letters equal): fall back to any non-blocked arrangement.
  for (let attempt = 0; attempt < 60; attempt++) {
    const s = shuffleInPlace([...letters], rng).join('');
    if (!spellsBlockedWord(s)) return s;
  }
  return best;
}

/**
 * Picks a rack of `size` letters (6–8) built on an everyday seed word. Seeds already used this match
 * (`avoid`) are skipped. Tries up to `maxAttempts` seeds and returns the liveliest if none reaches the bar.
 */
export function pickRack(dict: WordDictionary, size: number, rng: Rng, avoid: ReadonlySet<string> = new Set(), maxAttempts = 40): Rack {
  const candidates = dict.ofLength(size).filter((w) => dict.isCommon(w) && !avoid.has(w));
  const pool = candidates.length > 0 ? candidates : dict.ofLength(size).filter((w) => dict.isCommon(w));
  if (pool.length === 0) throw new Error(`No everyday ${size}-letter words in the dictionary`);
  const need = minimumRackWords(size);
  let best: { seed: string; solutions: string[] } | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = pool[rng.int(pool.length)] as string;
    const solutions = solveRack(seed, dict, 3);
    const common = solutions.filter((w) => dict.isCommon(w)).length;
    if (common >= need * 0.5 && solutions.length >= need) {
      best = { seed, solutions };
      break;
    }
    if (!best || solutions.length > best.solutions.length) best = { seed, solutions };
  }
  const chosen = best as { seed: string; solutions: string[] };
  const seeds = chosen.solutions.filter((w) => w.length === size);
  seeds.sort((a, b) => (a === chosen.seed ? -1 : b === chosen.seed ? 1 : a < b ? -1 : 1));
  return { letters: scrambleRack(chosen.seed, dict, rng), seeds, solutions: chosen.solutions };
}

export interface AnagramWordScore {
  base: number;
  rare: boolean;
  full: boolean;
  /** Points before the uniqueness multiplier. */
  points: number;
}

/** Provisional (pre-reveal) points for an anagram word. */
export function anagramWordScore(word: string, rackSize: number, dict: WordDictionary): AnagramWordScore {
  const base = lengthPoints(word.length);
  const rare = dict.tier(word) === 3;
  const full = word.length === rackSize;
  return { base, rare, full, points: base + (rare ? ANAGRAM_BONUS.rare : 0) + (full ? ANAGRAM_BONUS.fullRack : 0) };
}

/** Final points: the base doubles when the word is unique to this player/team. */
export function anagramFinalPoints(score: AnagramWordScore, unique: boolean): number {
  return score.points + (unique ? score.base * (ANAGRAM_BONUS.uniqueMultiplier - 1) : 0);
}

export type AnagramWordCheck =
  | { ok: true; word: string; score: AnagramWordScore }
  | { ok: false; reason: 'too_short' | 'too_long' | 'blocked' | 'letters' | 'not_word'; word: string };

/** Full server check of one Anagram Sprint submission against the rack. */
export function checkAnagramWord(raw: string, rack: string, dict: WordDictionary, minLength = 3): AnagramWordCheck {
  const word = normalizeWord(raw);
  if (word.length < minLength) return { ok: false, reason: 'too_short', word };
  if (word.length > rack.length) return { ok: false, reason: 'letters', word };
  if (isBlockedWord(word)) return { ok: false, reason: 'blocked', word: maskBlocked(word) };
  if (!canFormFromRack(word, rack)) return { ok: false, reason: 'letters', word };
  if (!dict.has(word)) return { ok: false, reason: 'not_word', word };
  return { ok: true, word, score: anagramWordScore(word, rack.length, dict) };
}
