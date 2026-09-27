/**
 * Title-strip selection codes, like a real jukebox's: every track keeps a code from its place in the
 * jukebox's catalogue order — eight selections per letter (A1–A8, B1–B8, …), skipping I and O so a
 * code never reads as a number — and the rack shows one letter's page at a time.
 * Pure (unit-tested in strips.test.ts).
 */

export const PER_PAGE = 8;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 0 → "A", 23 → "Z", 24 → "AA", 25 → "AB" … */
export function pageLetter(page: number): string {
  let n = Math.max(0, Math.floor(page));
  let out = '';
  for (;;) {
    out = LETTERS[n % LETTERS.length] + out;
    n = Math.floor(n / LETTERS.length) - 1;
    if (n < 0) return out;
  }
}

/** Catalogue index → selection code: 0 → "A1", 7 → "A8", 8 → "B1". */
export function selectionCode(index: number): string {
  const i = Math.max(0, Math.floor(index));
  return `${pageLetter(Math.floor(i / PER_PAGE))}${(i % PER_PAGE) + 1}`;
}

/** How many letter pages `count` tracks fill (at least one, so an empty rack still has page A). */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / PER_PAGE));
}

/** The page a catalogue index sits on. */
export function pageOf(index: number): number {
  return Math.floor(Math.max(0, index) / PER_PAGE);
}

/** "b3" / "B3" → catalogue index 10; null when it isn't a code (or is past `count`). */
export function parseCode(code: string, count: number): number | null {
  const m = /^([A-HJ-NP-Z]+)([1-8])$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  let page = -1;
  for (const ch of m[1]!) page = (page + 1) * LETTERS.length + LETTERS.indexOf(ch);
  const index = page * PER_PAGE + Number(m[2]) - 1;
  return index < count ? index : null;
}
