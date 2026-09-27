/**
 * Forbidden Letter — name things in a category without using the banned letter.
 *
 * Automatic checks (server, instant): the answer is 1–3 dictionary words (no blocked words), at
 * least 3 letters in total, never contains the forbidden letter, and isn't a repeat of one of your
 * own answers (plurals fold: "cats" repeats "cat").
 * Category fit: known members are approved instantly; anything else is "pending" and goes to the host
 * (or is trusted when the host chose trust mode). The host only judges meaning, never spelling.
 *
 * Letter choice: for each category a letter is drawn from common letters so that it's a real
 * constraint (25–75% of the known members contain it) while plenty of members stay possible.
 */
import type { Rng } from '@dascade/shared';
import { FORBIDDEN_POINTS, WORDS_LIMITS, type WordsRejectReason } from '@dascade/shared/games/words';
import { normalizePhrase, type WordDictionary } from './dictionary.ts';
import { isBlockedWord, maskBlocked } from './blocklist.ts';
import { FORBIDDEN_CATEGORIES, type ForbiddenCategory } from './categories.ts';

/** Letters the game may forbid (common enough to bite). */
export const FORBIDDEN_LETTER_POOL = ['e', 'a', 'o', 'i', 't', 'r', 'n', 's', 'l', 'u', 'c'] as const;

/** Singular-ish form used for duplicate checks and category matching ("berries" → "berry"). */
export function foldPlural(word: string, dict?: WordDictionary): string {
  const has = (w: string) => (dict ? dict.has(w) : true);
  if (word.length > 4 && word.endsWith('ies') && has(word.slice(0, -3) + 'y')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && /(ches|shes|sses|xes|zes|oes)$/.test(word) && has(word.slice(0, -2))) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && has(word.slice(0, -1))) return word.slice(0, -1);
  return word;
}

/** Comparison key of a phrase: normalized, each word plural-folded. */
export function phraseKey(phrase: string, dict?: WordDictionary): string {
  return normalizePhrase(phrase)
    .split(' ')
    .filter(Boolean)
    .map((w) => foldPlural(w, dict))
    .join(' ');
}

export interface ForbiddenRoundSpec {
  category: ForbiddenCategory;
  letter: string;
}

/** Member keys of a category (plural-folded, spaces kept), cached. */
const memberCache = new WeakMap<ForbiddenCategory, Set<string>>();
export function categoryKeys(category: ForbiddenCategory): Set<string> {
  let set = memberCache.get(category);
  if (!set) {
    set = new Set<string>();
    for (const m of category.members) {
      const n = normalizePhrase(m);
      set.add(n);
      set.add(n.replace(/ /g, ''));
      set.add(phraseKey(n));
    }
    memberCache.set(category, set);
  }
  return set;
}

/** Share of a category's members that contain `letter`. */
export function letterShare(category: ForbiddenCategory, letter: string): number {
  const members = category.members;
  if (members.length === 0) return 0;
  return members.filter((m) => m.includes(letter)).length / members.length;
}

/** Letters that make a fair challenge for this category. */
export function fairLetters(category: ForbiddenCategory): string[] {
  return FORBIDDEN_LETTER_POOL.filter((l) => {
    const share = letterShare(category, l);
    const without = category.members.filter((m) => !m.includes(l)).length;
    return share >= 0.25 && share <= 0.75 && without >= 12;
  });
}

/** Picks an unused category (falls back to any) and a fair forbidden letter. */
export function pickForbiddenRound(rng: Rng, usedCategoryIds: ReadonlySet<string> = new Set(), categories: readonly ForbiddenCategory[] = FORBIDDEN_CATEGORIES): ForbiddenRoundSpec {
  const fresh = categories.filter((c) => !usedCategoryIds.has(c.id) && fairLetters(c).length > 0);
  const pool = fresh.length > 0 ? fresh : categories.filter((c) => fairLetters(c).length > 0);
  const category = pool[rng.int(pool.length)] as ForbiddenCategory;
  const letters = fairLetters(category);
  return { category, letter: letters[rng.int(letters.length)] as string };
}

export type ForbiddenCheck =
  | { ok: true; key: string; display: string; known: boolean; points: number }
  | { ok: false; reason: WordsRejectReason; display: string };

/**
 * Validates one answer. `display` in the result is safe to show (blocked words masked).
 * `known` = an automatic category match.
 */
export function checkForbiddenAnswer(raw: string, spec: ForbiddenRoundSpec, dict: WordDictionary): ForbiddenCheck {
  const phrase = normalizePhrase(raw);
  const words = phrase.split(' ').filter(Boolean);
  const safeDisplay = words.map((w) => (isBlockedWord(w) ? maskBlocked(w) : w)).join(' ');
  const letters = phrase.replace(/ /g, '');
  if (letters.length < 3) return { ok: false, reason: 'too_short', display: safeDisplay };
  if (words.length > WORDS_LIMITS.phraseWords || phrase.length > 30) return { ok: false, reason: 'too_long', display: safeDisplay };
  if (words.some((w) => isBlockedWord(w))) return { ok: false, reason: 'blocked', display: safeDisplay };
  if (letters.includes(spec.letter)) return { ok: false, reason: 'forbidden_letter', display: safeDisplay };
  const isWord = (w: string) => dict.has(w) || (w.length <= 2 && /^(a|an|of|in|on|to|up)$/.test(w));
  if (!words.every(isWord)) {
    // "icecream" style joins: accept when the space-less form is a known member.
    const joined = categoryKeys(spec.category).has(letters);
    if (!joined) return { ok: false, reason: 'not_word', display: safeDisplay };
  }
  const key = phraseKey(phrase, dict);
  const keys = categoryKeys(spec.category);
  const known = keys.has(phrase) || keys.has(key) || keys.has(letters);
  return { ok: true, key, display: phrase, known, points: FORBIDDEN_POINTS.answer };
}

/** Final points for an approved answer. */
export function forbiddenFinalPoints(unique: boolean): number {
  return FORBIDDEN_POINTS.answer + (unique ? FORBIDDEN_POINTS.unique : 0);
}
