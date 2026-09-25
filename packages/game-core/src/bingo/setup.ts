/**
 * Custom item parsing (bulk paste), setup validation and the published round plan.
 */
import { splitCsvLine } from '@dascade/shared';
import { BINGO_LIMITS, bingoItemKey, sanitizeBingoItems, type BingoPlanRound, type BingoRound, type BingoSettings } from '@dascade/shared/games/bingo';
import { boardSpec, centerIndex, itemsPerCard, type BoardSpec } from './board.ts';
import { maskToString, resolveRound, roundTitle } from './patterns.ts';
import { trivialMask } from './claims.ts';

// ---------------------------------------------------------------------------
// Bulk paste
// ---------------------------------------------------------------------------

export type ItemParseMode = 'auto' | 'lines' | 'csv';

const BULLET_RE = /^\s*(?:[-*•·–—]|\d{1,3}[.)])\s+/u;

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '');
}

function looksLikeQuotedCsv(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => /^\s*"/.test(l) && /",|";|"\t/.test(l));
}

/**
 * Splits a pasted block into raw items.
 *  - lines: one item per line (list bullets / numbering stripped)
 *  - csv:   every line is split on commas/semicolons/tabs (quotes respected)
 *  - auto:  lines, unless the paste is a single delimited line, a spreadsheet
 *           (tab-separated) block, or fully quoted CSV rows
 */
export function parseItemsInput(text: string, mode: ItemParseMode = 'auto'): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  let csv = mode === 'csv';
  if (mode === 'auto') {
    const hasTabs = lines.some((l) => l.includes('\t'));
    const singleDelimited = lines.length === 1 && /[,;\t]/.test(lines[0]!);
    csv = hasTabs || singleDelimited || looksLikeQuotedCsv(lines);
  }
  const raw = csv ? lines.flatMap((l) => splitCsvLine(l)) : lines.map(stripBullet);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface ItemsSummary {
  items: string[];
  /** Raw entries that were dropped as duplicates (case-insensitive). */
  duplicates: number;
  /** Entries dropped because the list hit the limit. */
  overflow: number;
  /** Entries that had to be shortened. */
  truncated: number;
}

/** Parse + clean + dedupe, reporting what happened (for the settings UI). */
export function summarizeItems(text: string, mode: ItemParseMode = 'auto'): ItemsSummary {
  const raw = parseItemsInput(text, mode);
  const truncated = raw.filter((s) => Array.from(s).length > BINGO_LIMITS.itemLength).length;
  const unlimited: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const item of raw) {
    const cleaned = sanitizeBingoItems([item])[0];
    if (!cleaned) continue;
    const key = bingoItemKey(cleaned);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unlimited.push(cleaned);
  }
  const items = unlimited.slice(0, BINGO_LIMITS.maxItems);
  return { items, duplicates, overflow: unlimited.length - items.length, truncated };
}

// ---------------------------------------------------------------------------
// Setup validation
// ---------------------------------------------------------------------------

export function roundsInPlay(settings: Pick<BingoSettings, 'format' | 'rounds'>): BingoRound[] {
  return settings.format === 'single' ? settings.rounds.slice(0, 1) : settings.rounds;
}

/** Human-readable problems that block starting the game (empty = ready). */
export function setupProblems(settings: BingoSettings): string[] {
  const spec = boardSpec(settings);
  const problems: string[] = [];
  if (spec.mode === 'text') {
    const need = itemsPerCard(spec);
    if (spec.poolSize < need) {
      problems.push(
        `Add ${need - spec.poolSize} more item${need - spec.poolSize === 1 ? '' : 's'} — a ${spec.size}×${spec.size} card needs at least ${need} different squares.`,
      );
    }
  }
  const free = spec.free ? centerIndex(spec.size) : null;
  roundsInPlay(settings).forEach((round, i) => {
    const label = settings.format === 'single' ? 'The winning pattern' : `Round ${i + 1}`;
    const { patterns, problems: roundProblems } = resolveRound(round, spec.size);
    for (const p of roundProblems) problems.push(`${label}: ${p}.`);
    for (const p of patterns) {
      if (p.masks.some((m) => trivialMask(m, free))) problems.push(`${label}: “${p.name}” only uses the free square, so everyone would win instantly.`);
    }
    if (patterns.length === 0 && roundProblems.length === 0) problems.push(`${label} has no winning pattern.`);
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Published plan
// ---------------------------------------------------------------------------

/** The match plan published to every client (resolved masks for each round). */
export function buildPlan(settings: BingoSettings, spec: BoardSpec = boardSpec(settings)): BingoPlanRound[] {
  return roundsInPlay(settings).map((round, index) => {
    const { patterns } = resolveRound(round, spec.size);
    return {
      index,
      prize: round.prize,
      title: roundTitle(round),
      patterns: patterns.map((p) => ({
        name: p.name,
        masks: p.masks.map(maskToString),
        family: p.family,
        rotate: p.rotate,
        mirror: p.mirror,
      })),
    };
  });
}
