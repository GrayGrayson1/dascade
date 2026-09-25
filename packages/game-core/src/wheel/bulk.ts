/**
 * Bulk paste parsing for the wheel editor.
 *
 * One option per line. Each line may carry CSV-like extras in any order after the
 * label: a weight ("3", "x3", "3x", "25%"), a color ("#ff0000" / "#f00") and an
 * icon ("🍕"). Quoted fields keep commas ("\"Salt, pepper\", 2"). Unrecognized
 * extra fields are treated as part of the label, so "Salt, pepper" survives.
 * A single line with commas and no extras (or nothing but plain numbers) is split
 * into several options ("Pizza, Tacos, Sushi", "1, 2, 3"). A leading emoji ("🍕 Pizza") becomes the icon.
 * A header row such as "label,weight,color" is skipped.
 */
import { splitCsvLine } from '@dascade/shared';
import { WHEEL_LIMITS, cleanWheelEmoji, cleanWheelLabel, graphemes } from '@dascade/shared/games/wheel';

export interface ParsedSegmentInput {
  label: string;
  emoji: string;
  weight?: number;
  color?: string;
}

const HEADER_WORDS = new Set(['label', 'name', 'option', 'options', 'item', 'items', 'weight', 'weights', 'color', 'colour', 'emoji', 'icon']);
const PICTO_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const WEIGHT_RE = /^(?:[x×*]\s*)?(\d{1,7}(?:\.\d+)?|\.\d+)\s*(?:[x×%])?$/i;
const COLOR_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** Parses a weight token, or returns undefined when the token is not a weight. */
export function parseWeightToken(token: string): number | undefined {
  const m = WEIGHT_RE.exec(token.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(WHEEL_LIMITS.weightMax, Math.max(0, n));
}

/** Parses a #rgb / #rrggbb token into lowercase #rrggbb. */
export function parseColorToken(token: string): string | undefined {
  const m = COLOR_RE.exec(token.trim());
  if (!m) return undefined;
  const hex = (m[1] as string).toLowerCase();
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
}

/** True when a token is a short pictographic icon (1–2 graphemes containing an emoji). */
export function isIconToken(token: string): boolean {
  const t = token.trim();
  if (!t || !PICTO_RE.test(t)) return false;
  const g = graphemes(t);
  return g.length <= WHEEL_LIMITS.emojiGraphemes && g.every((x) => PICTO_RE.test(x));
}

/** Splits a leading emoji off a label: "🍕 Pizza" → ["🍕", "Pizza"]. */
export function splitLeadingIcon(label: string): { emoji: string; label: string } {
  const g = graphemes(label);
  const first = g[0];
  if (first && PICTO_RE.test(first) && g.length > 2 && /^\s$/u.test(g[1] ?? '')) {
    const rest = g.slice(2).join('').trim();
    if (rest) return { emoji: first, label: rest };
  }
  return { emoji: '', label };
}

function parseFields(fields: string[]): ParsedSegmentInput | null {
  const [first = '', ...extras] = fields;
  const labelParts = [first];
  let weight: number | undefined;
  let color: string | undefined;
  let emoji = '';
  for (const raw of extras) {
    const token = raw.trim();
    if (!token) continue;
    const w = weight === undefined ? parseWeightToken(token) : undefined;
    if (w !== undefined) {
      weight = w;
      continue;
    }
    const c = color === undefined ? parseColorToken(token) : undefined;
    if (c !== undefined) {
      color = c;
      continue;
    }
    if (!emoji && isIconToken(token)) {
      emoji = cleanWheelEmoji(token);
      continue;
    }
    labelParts.push(token);
  }
  let label = labelParts.map((p) => p.trim()).filter(Boolean).join(', ');
  if (!emoji) {
    const compact = label.replace(/\s+/gu, '');
    if (isIconToken(compact)) {
      emoji = cleanWheelEmoji(compact);
      label = '';
    } else {
      const split = splitLeadingIcon(label.trim());
      emoji = cleanWheelEmoji(split.emoji);
      label = split.label;
    }
  }
  label = cleanWheelLabel(label);
  if (!label && !emoji) return null;
  const out: ParsedSegmentInput = { label, emoji };
  if (weight !== undefined) out.weight = weight;
  if (color !== undefined) out.color = color;
  return out;
}

function hasExtras(fields: string[]): boolean {
  return fields.slice(1).some((f) => parseWeightToken(f) !== undefined || parseColorToken(f) !== undefined || isIconToken(f));
}

const PLAIN_NUMBER_RE = /^\d+(?:\.\d+)?$/;

/** "1, 2, 3, 4, 5, 6" on one line is a number wheel, not "label 1 with weight 2". */
function isNumberList(fields: string[]): boolean {
  const values = fields.map((f) => f.trim()).filter(Boolean);
  return values.length >= 2 && values.every((v) => PLAIN_NUMBER_RE.test(v));
}

function isHeaderRow(fields: string[]): boolean {
  const words = fields.map((f) => f.trim().toLowerCase()).filter(Boolean);
  return words.length >= 2 && words.every((w) => HEADER_WORDS.has(w));
}

export function parseBulkSegments(text: string, maxItems: number = WHEEL_LIMITS.segments): ParsedSegmentInput[] {
  if (typeof text !== 'string') return [];
  const lines = text
    .slice(0, WHEEL_LIMITS.bulkChars)
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const out: ParsedSegmentInput[] = [];
  const limit = Math.max(0, Math.min(maxItems, WHEEL_LIMITS.segments));
  lines.forEach((line, index) => {
    if (out.length >= limit) return;
    const fields = /[,;\t]/.test(line) ? splitCsvLine(line) : [line];
    if (index === 0 && isHeaderRow(fields)) return;
    if (lines.length === 1 && fields.length > 1 && (!hasExtras(fields) || isNumberList(fields))) {
      for (const f of fields) {
        if (out.length >= limit) break;
        const parsed = parseFields([f]);
        if (parsed) out.push(parsed);
      }
      return;
    }
    const parsed = parseFields(fields);
    if (parsed) out.push(parsed);
  });
  return out;
}

function csvField(value: string): string {
  return /[",;\t]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Formats a segment as a bulk line that `parseBulkSegments` reads back identically. */
export function formatBulkLine(segment: { label: string; emoji: string; weight: number; color: string }): string {
  const parts = [csvField(segment.label || segment.emoji), String(Number(segment.weight.toFixed(3))), segment.color];
  if (segment.emoji && segment.label) parts.push(segment.emoji);
  return parts.join(', ');
}
