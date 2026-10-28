/**
 * The Scores tab's model (pure, unit-tested): the score record as CSV, the file names, medals and
 * finale steps in words. The record itself comes from the server (`showdown:scores-export`), which
 * never puts an unrevealed answer in it; the files are built in the browser.
 */
import {
  SHOWDOWN_MEDAL_INFO,
  type ShowdownFinaleStepKind,
  type ShowdownMedals,
  type ShowdownScoresFile,
} from '@dascade/shared/games/showdown';

const MEDAL_ORDER: ReadonlyArray<keyof ShowdownMedals> = ['pumpkin', 'gold', 'silver', 'bronze', 'ribbon'];

/** "🎃1 🥇2" — only the medals someone has ('' = none). */
export function medalWords(m: ShowdownMedals | null | undefined): string {
  if (!m) return '';
  return MEDAL_ORDER.filter((k) => (m[k] ?? 0) > 0)
    .map((k) => `${SHOWDOWN_MEDAL_INFO[k].icon}${m[k]}`)
    .join(' ');
}

/** "1 Golden Pumpkin, 2 Gold" — the same, for screen readers ('No medals'). */
export function medalSpeech(m: ShowdownMedals | null | undefined): string {
  if (!m) return 'No medals';
  const parts = MEDAL_ORDER.filter((k) => (m[k] ?? 0) > 0).map((k) => `${m[k]} ${SHOWDOWN_MEDAL_INFO[k].title}`);
  return parts.length ? parts.join(', ') : 'No medals';
}

/**
 * One CSV cell: quoted when it holds a quote, a comma, a line break or edge spaces; text starting with
 * = + - @ (or a tab / carriage return) gets a leading apostrophe, so a spreadsheet never runs a name
 * as a formula.
 */
export function csvCell(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The score record as CSV: rank, name, points, medals, position hits, perfect bonuses, then each round's points. */
export function scoresCsv(file: Pick<ShowdownScoresFile, 'people'>): string {
  const rounds = file.people.reduce((n, p) => Math.max(n, p.rounds.length), 0);
  const head = [
    'Rank',
    'Name',
    'Points',
    'Medals',
    'Position hits',
    'Perfect bonuses',
    ...Array.from({ length: rounds }, (_, i) => `Round ${i + 1}`),
  ];
  const lines = [head.map(csvCell).join(',')];
  for (const p of file.people) {
    const row: Array<string | number> = [
      p.rank > 0 ? p.rank : '',
      p.name,
      p.points,
      medalWords(p.medals),
      p.positionHits,
      p.perfect,
      ...Array.from({ length: rounds }, (_, i) => p.rounds[i] ?? 0),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** `dasoween-scores-ABCDE.csv` / `.json` (like the audit log's file). */
export function scoresFileName(code: string, ext: 'csv' | 'json'): string {
  const safe = (code || 'room').replace(/[^A-Za-z0-9_-]/g, '');
  return `dasoween-scores-${safe || 'room'}.${ext}`;
}

/** The paced finale's steps in words. */
export const FINALE_STEP_WORDS: Record<ShowdownFinaleStepKind, string> = {
  wrap: 'The wrap-up',
  medals: 'The medal ceremony',
  third: '3rd place',
  second: '2nd place',
  first: '1st place',
};

/** "1st place" → "1st place (the winner)" for the last step. */
export function finaleStepWords(kind: ShowdownFinaleStepKind): string {
  return kind === 'first' ? `${FINALE_STEP_WORDS.first} — the winner` : FINALE_STEP_WORDS[kind];
}
