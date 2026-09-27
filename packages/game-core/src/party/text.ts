/**
 * Typed-answer normalization and matching for party games.
 *
 * normalizeAnswer():
 *   1. Unicode NFKD, strip diacritics ("Pokémon" → "pokemon", "Ångström" → "angstrom")
 *   2. lower-case; "&" → " and "; apostrophes removed ("rock 'n' roll" → "rock n roll", "don't" → "dont")
 *   3. every other non letter/digit run → one space (punctuation, hyphens, dots: "e-mail" → "e mail")
 *   4. leading English articles dropped ("the", "a", "an")
 *   5. whitespace collapsed + trimmed
 *
 * matchAnswer() compares normalized keys; additionally spaces are ignored ("e mail" = "email",
 * "new york" = "newyork"). Typo tolerance (optional, on by default) — Damerau-free Levenshtein on
 * the space-less key, only where it is safe:
 *   - never for answers containing digits (numbers, years, "7up"…)
 *   - key length ≤ 4 → exact only;   5–10 → 1 edit;   ≥ 11 → 2 edits
 *     (conservative on purpose: "Austria" must never pass for "Australia")
 *   - the guess must not be an exact match for a DIFFERENT listed wrong answer (`reject` list)
 *   - the first letter must match (cuts most false positives: "paris"/"doris")
 */
import { editDistance } from '@dascade/shared';

const ARTICLES = /^(?:the|a|an)\s+/;

export function normalizeAnswer(input: string): string {
  let s = String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/['’‘`´]/g, '');
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Drop leading articles (repeat once for "the a…" oddities), but never reduce to empty.
  for (let i = 0; i < 2; i++) {
    const next = s.replace(ARTICLES, '');
    if (next.length > 0) s = next;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Space-insensitive comparison key. */
export function answerKey(input: string): string {
  return normalizeAnswer(input).replace(/ /g, '');
}

/** Edits tolerated for a key of this length (see module doc). */
export function allowedTypos(key: string): number {
  if (/\d/.test(key)) return 0;
  const len = key.length;
  if (len <= 4) return 0;
  if (len <= 10) return 1;
  return 2;
}

export type AnswerVerdict = 'exact' | 'typo' | 'wrong';

export interface MatchOptions {
  /** Allow small typos (default true). */
  typos?: boolean;
  /** Known wrong answers that must never be accepted through typo tolerance. */
  reject?: readonly string[];
}

export interface MatchResult {
  verdict: AnswerVerdict;
  /** The accepted answer (as authored) that matched. */
  matched: string | null;
  distance: number;
}

/** Checks a typed guess against a list of accepted answers. */
export function matchAnswer(input: string, accepted: readonly string[], opts: MatchOptions = {}): MatchResult {
  const guess = answerKey(input);
  if (!guess) return { verdict: 'wrong', matched: null, distance: Infinity };
  for (const a of accepted) {
    if (answerKey(a) === guess) return { verdict: 'exact', matched: a, distance: 0 };
  }
  if (opts.typos === false) return { verdict: 'wrong', matched: null, distance: Infinity };
  if (opts.reject?.some((r) => answerKey(r) === guess)) return { verdict: 'wrong', matched: null, distance: Infinity };
  let best: MatchResult = { verdict: 'wrong', matched: null, distance: Infinity };
  for (const a of accepted) {
    const key = answerKey(a);
    const allowed = /\d/.test(guess) ? 0 : allowedTypos(key);
    if (allowed === 0 || key[0] !== guess[0]) continue;
    const d = editDistance(guess, key, allowed);
    if (d <= allowed && d < best.distance) best = { verdict: 'typo', matched: a, distance: d };
  }
  return best;
}

/**
 * Parses a typed number: "1,234", "1 234", "1234.5", "-3", "+7", "12.0", "1_000".
 * Commas are thousands separators (never decimals). Returns null for anything else.
 */
export function parseNumberAnswer(input: string): number | null {
  const s = String(input ?? '')
    .trim()
    .replace(/[\s_]/g, '');
  if (!/^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^[+-]?\.\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
