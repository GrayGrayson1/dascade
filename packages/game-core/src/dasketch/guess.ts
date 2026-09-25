/**
 * Guess checking. Comparison ignores case, accents, spaces and punctuation, so
 * "Hot-Dog", "hotdog" and "hot dog" all match "hot dog".
 *
 * `close` guesses are one or two letters off, contain the whole answer, or match one word
 * of a multi-word answer. They are never shown to other players (that would leak the
 * answer); the server may privately tell the guesser they are close.
 */
import { editDistance, normalizeForCompare } from '@dascade/shared';
import { sketchWordKey } from '@dascade/shared/games/dasketch';

export type GuessVerdict = 'correct' | 'close' | 'wrong';

/** Allowed typo distance for an answer of a given compact length. */
export function closeThreshold(answerLength: number): number {
  if (answerLength <= 3) return 0;
  if (answerLength <= 7) return 1;
  return 2;
}

export function classifyGuess(guess: string, answer: string): GuessVerdict {
  const g = sketchWordKey(guess);
  const a = sketchWordKey(answer);
  if (!g || !a) return 'wrong';
  if (g === a) return 'correct';
  const threshold = closeThreshold(a.length);
  if (threshold > 0 && Math.abs(g.length - a.length) <= threshold && editDistance(g, a, threshold) <= threshold) return 'close';
  if (a.length >= 3 && g.includes(a)) return 'close';
  const guessTokens = new Set(normalizeForCompare(guess.normalize('NFKC')).split(' '));
  // Short answers ("tv", "ox") are too common as substrings, but typed as a word of a
  // longer message they would reveal the answer in public chat.
  if (guessTokens.has(a)) return 'close';
  const answerTokens = normalizeForCompare(answer.normalize('NFKC')).split(' ').filter((t) => t.length >= 3);
  if (answerTokens.length > 1 && answerTokens.some((t) => guessTokens.has(t))) return 'close';
  return 'wrong';
}
