/**
 * Word masking and progressive letter hints.
 *
 * The public hint is a pattern with one character per character of the word:
 *   '_'  hidden letter or digit
 *   ' '  gap between words
 *   any other character (revealed letter, hyphen, apostrophe) as-is
 */
import type { Rng } from '@dascade/shared';
import { isHintLetter, type SketchHintMode } from '@dascade/shared/games/dasketch';

/** Indices of the guessable characters (letters and digits) in a word. */
export function letterIndices(word: string): number[] {
  const chars = Array.from(word);
  const out: number[] = [];
  chars.forEach((ch, i) => {
    if (isHintLetter(ch)) out.push(i);
  });
  return out;
}

export function maskWord(word: string, revealed: ReadonlySet<number> = new Set()): string {
  return Array.from(word)
    .map((ch, i) => {
      if (ch === ' ') return ' ';
      if (!isHintLetter(ch)) return ch;
      return revealed.has(i) ? ch : '_';
    })
    .join('');
}

/** "ice cream" → [3, 5] (letters per word, for "3 5" style length labels). */
export function wordLengths(pattern: string): number[] {
  return pattern
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => Array.from(part).filter((ch) => ch === '_' || isHintLetter(ch)).length);
}

const HINT_FRACTION: Record<SketchHintMode, number> = { off: 0, slow: 0.25, normal: 0.4, fast: 0.55 };
const HINT_START: Record<SketchHintMode, number> = { off: 1, slow: 0.45, normal: 0.3, fast: 0.2 };
const HINT_END = 0.85;

/**
 * How many letters a hint mode reveals over a whole turn. At least two letters always
 * stay hidden (words with fewer than three letters get no hints).
 */
export function hintRevealCount(letterCount: number, mode: SketchHintMode): number {
  if (mode === 'off' || letterCount < 3) return 0;
  const wanted = Math.max(1, Math.floor(letterCount * HINT_FRACTION[mode]));
  return Math.max(0, Math.min(wanted, letterCount - 2));
}

/** Milliseconds after drawing starts at which each hint letter is revealed (ascending). */
export function hintSchedule(letterCount: number, mode: SketchHintMode, drawMs: number): number[] {
  const count = hintRevealCount(letterCount, mode);
  if (count === 0 || drawMs <= 0) return [];
  const start = HINT_START[mode];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = count === 1 ? (start + HINT_END) / 2 : start + ((HINT_END - start) * i) / (count - 1);
    out.push(Math.round(drawMs * f));
  }
  return out;
}

/** Picks a random still-hidden letter to reveal (never the last hidden one). */
export function pickRevealIndex(word: string, revealed: ReadonlySet<number>, rng: Rng): number | null {
  const hidden = letterIndices(word).filter((i) => !revealed.has(i));
  if (hidden.length <= 1) return null;
  return hidden[rng.int(hidden.length)] ?? null;
}
