/**
 * Text sanitation for all user-generated content. The UI renders text with
 * React (auto-escaped) and never uses dangerouslySetInnerHTML; these helpers
 * additionally strip invisible/control characters, bound lengths and tidy whitespace
 * on the SERVER before anything is stored or broadcast.
 */

// C0/C1 control chars (except \n and \t handled separately), zero-width chars,
// bidi overrides and BOM — all of which can be abused to spoof or break layouts.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Every Unicode "format" character (\p{Cf}: zero-width space/joiners, LRM/RLM/ALM, bidi embeddings,
// overrides and isolates, soft hyphen, word joiner, BOM, interlinear annotations, tag characters…)
// plus glyphs that render as blank space and are used for "invisible" names: Hangul fillers,
// the Braille blank, the combining grapheme joiner — and U+FDFD, a single code point that
// renders as a very wide ligature and breaks layouts.
const INVISIBLE_RE = /[\p{Cf}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}\u{FDFD}]|\u{034F}/gu;
// Excess combining marks ("zalgo") — keep at most 2 in a row.
const ZALGO_RE = /(\p{M}{2})\p{M}+/gu;

function truncateCodePoints(text: string, maxLen: number): string {
  const chars = Array.from(text);
  return chars.length > maxLen ? chars.slice(0, maxLen).join('') : text;
}

/** Single-line text: strips control/invisible chars, collapses whitespace, trims and bounds length. */
export function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  let text = String(input).normalize('NFC');
  text = text.replace(CONTROL_RE, '').replace(INVISIBLE_RE, '').replace(ZALGO_RE, '$1');
  text = text.replace(/[\s\u{A0}]+/gu, ' ').trim();
  return truncateCodePoints(text, maxLen).trim();
}

/** Multi-line text (e.g. bulk paste lists). Returns cleaned, non-empty lines. */
export function cleanLines(input: unknown, maxLineLen: number, maxLines: number): string[] {
  if (typeof input !== 'string') return [];
  return input
    .split(/\r?\n/)
    .map((line) => cleanText(line, maxLineLen))
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
}

const FALLBACK_NAMES = ['Player', 'Guest', 'Challenger', 'Rookie'];

/** Nickname: single line, 1–20 chars, never empty. */
export function cleanNickname(input: unknown, maxLen = 20): string {
  const name = cleanText(input, maxLen);
  if (name.length > 0) return name;
  return FALLBACK_NAMES[Math.floor(Math.random() * FALLBACK_NAMES.length)] ?? 'Player';
}

/** Case/diacritic-insensitive comparison key (used for guesses and duplicate detection). */
export function normalizeForCompare(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Levenshtein distance (bounded) — used for "close guess" hints. */
export function editDistance(a: string, b: string, max = 8): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

// A deliberately small, work-appropriate filter. It is a courtesy filter for
// custom words / nicknames, not a moderation system.
const PROFANITY = [
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'bastard',
  'asshole',
  'dick',
  'cunt',
  'cock',
  'pussy',
  'whore',
  'slut',
  'fag',
  'faggot',
  'nigger',
  'nigga',
  'retard',
  'twat',
  'wanker',
  'porn',
  'dildo',
];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join('|')})s?\\b`, 'i');
const PROFANITY_RE_G = new RegExp(`\\b(${PROFANITY.join('|')})s?\\b`, 'gi');

export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(normalizeForCompare(text)) || PROFANITY_RE.test(text);
}

export function maskProfanity(text: string): string {
  return text.replace(PROFANITY_RE_G, (m) => (m[0] ?? '*') + '*'.repeat(Math.max(0, m.length - 1)));
}

/** Parse a bulk paste into items: newline separated; if a single line contains commas/semicolons/tabs, split on those. */
export function parseBulkList(input: string, maxItemLen: number, maxItems: number): string[] {
  const lines = input.split(/\r?\n/);
  const raw: string[] = [];
  for (const line of lines) {
    if (/[,;\t]/.test(line) && lines.length === 1) {
      raw.push(...splitCsvLine(line));
    } else {
      raw.push(line);
    }
  }
  return raw
    .map((s) => cleanText(s, maxItemLen))
    .filter((s) => s.length > 0)
    .slice(0, maxItems);
}

/** Minimal CSV line splitter supporting quoted fields ("a, b", c). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
