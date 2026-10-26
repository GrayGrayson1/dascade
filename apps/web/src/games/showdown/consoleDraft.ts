/**
 * The round editor's draft model (pure, unit-tested): editor rows ⇄ the raw rounds the server
 * validates (ShowdownRoundInput), and the "whole show" file a presenter saves on their device
 * (rounds + the show's settings).
 *
 * A round is either scored (every answer has survey points; the board sorts by them) or a ranked
 * list (no points: every answer goes out with 0 and the board keeps the order as listed). The
 * special answer is a place on the board, 1–10 (0 = none), exactly as `validateShowContent` reads it.
 */
import {
  SHOWDOWN_LIMITS,
  ShowdownContentSchema,
  ShowdownSettingsSchema,
  type ShowdownRoundInput,
  type ShowdownSettings,
} from '@dascade/shared/games/showdown';

export interface DraftAnswer {
  /** Stable React key (answers move up and down). */
  key: number;
  text: string;
  points: number;
  /** Comma-separated other spellings. */
  aliases: string;
  /** The small line under a revealed answer (artist, year…). */
  note: string;
}

export interface DraftRound {
  key: number;
  title: string;
  prompt: string;
  source: string;
  /** Board place of the special answer, 1–10; 0 = none. */
  special: number;
  ranked: boolean;
  answers: DraftAnswer[];
}

let seq = 0;
export const nextKey = () => ++seq;

export const blankAnswer = (): DraftAnswer => ({ key: nextKey(), text: '', points: 0, aliases: '', note: '' });

export function blankRound(ranked: boolean): DraftRound {
  return {
    key: nextKey(),
    title: '',
    prompt: '',
    source: '',
    special: 0,
    ranked,
    answers: Array.from({ length: ranked ? 10 : 5 }, blankAnswer),
  };
}

const splitAliases = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);

/** Editor rows → the raw rounds the server validates. Blank answers are left out. */
export function toInput(rounds: readonly DraftRound[]): ShowdownRoundInput[] {
  return rounds.map((r) => {
    const answers = r.answers
      .filter((a) => a.text.trim())
      .map((a) => ({
        text: a.text,
        // A ranked list has no points: every answer 0 keeps the order as listed.
        points: r.ranked ? 0 : Math.max(0, Math.min(1000, Math.round(a.points || 0))),
        aliases: splitAliases(a.aliases),
        ...(a.note.trim() ? { note: a.note } : {}),
      }));
    return {
      prompt: r.prompt,
      ...(r.title.trim() ? { title: r.title } : {}),
      ...(r.source.trim() ? { source: r.source } : {}),
      ...(r.special > 0 ? { special: Math.min(r.special, SHOWDOWN_LIMITS.answersMax) } : {}),
      answers,
    };
  });
}

/** Raw rounds (a stored round via roundToInput, a preset, a show file) → editor rows. */
export function fromInput(rounds: readonly ShowdownRoundInput[]): DraftRound[] {
  return rounds.map((r) => {
    const ranked = r.answers.length > 0 && r.answers.every((a) => a.points === 0);
    return {
      key: nextKey(),
      title: r.title ?? '',
      prompt: r.prompt,
      source: r.source ?? '',
      special: r.special ?? 0,
      ranked,
      answers: r.answers.map((a) => ({
        key: nextKey(),
        text: a.text,
        points: a.points,
        aliases: (a.aliases ?? []).join(', '),
        note: a.note ?? '',
      })),
    };
  });
}

/** Moves an item one place up (-1) or down (+1); out of range = unchanged. */
export function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

// ---------------------------------------------------------------------------
// Whole-show files (rounds + settings), saved on the presenter's device
// ---------------------------------------------------------------------------

/** Settings a whole-show file carries (the question source is always "your own rounds"). */
export const SHOW_FILE_SETTINGS = [
  'mode',
  'title',
  'eventName',
  'look',
  'minutes',
  'stageClock',
  'audience',
  'scoring',
  'steal',
  'teamNames',
  'display',
] as const;
export type ShowFileSettings = Partial<Pick<ShowdownSettings, (typeof SHOW_FILE_SETTINGS)[number]>>;

export interface ShowFile {
  rounds: ShowdownRoundInput[];
  settings?: ShowFileSettings;
}

export function pickShowSettings(settings: Partial<ShowdownSettings> | null | undefined): ShowFileSettings {
  const out: Record<string, unknown> = {};
  if (!settings) return {};
  for (const k of SHOW_FILE_SETTINGS) if (settings[k] !== undefined) out[k] = settings[k];
  return out as ShowFileSettings;
}

const SettingsPatch = ShowdownSettingsSchema.pick({
  mode: true,
  title: true,
  eventName: true,
  look: true,
  minutes: true,
  stageClock: true,
  audience: true,
  scoring: true,
  steal: true,
  teamNames: true,
  display: true,
}).partial();

/** Only the settings that are valid on their own (a hand-edited file can't break the lobby). */
export function cleanShowSettings(raw: unknown): ShowFileSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const k of SHOW_FILE_SETTINGS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const one = SettingsPatch.safeParse({ [k]: v });
    if (one.success && one.data[k] !== undefined) out[k] = one.data[k];
  }
  return Object.keys(out).length ? (out as ShowFileSettings) : undefined;
}

/**
 * Reads a show file: `{"rounds":[…], "settings":{…}}`, or an older rounds-only preset (a bare
 * array of rounds). Null when it isn't one.
 */
export function parseShowFile(data: unknown): ShowFile | null {
  const raw = Array.isArray(data) ? { rounds: data } : data;
  const parsed = ShowdownContentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const settings = cleanShowSettings((raw as { settings?: unknown }).settings);
  return { rounds: parsed.data.rounds.slice(0, SHOWDOWN_LIMITS.customRounds), ...(settings ? { settings } : {}) };
}

/** A one-line summary of a show file's settings ("Presenter Showcase · Halloween Night · 10-min clock"). */
export function describeShowSettings(s: ShowFileSettings): string {
  const parts: string[] = [];
  if (s.mode) parts.push(s.mode === 'showcase' ? 'Presenter Showcase' : 'Team Showdown');
  if (s.title) parts.push(`“${s.title}”`);
  if (s.look) parts.push(s.look === 'halloween' ? 'Halloween Night' : s.look === 'showtime' ? 'DAS Showtime' : 'Seasonal look');
  if (s.mode === 'showcase' && s.minutes !== undefined) parts.push(s.minutes > 0 ? `${s.minutes}-min clock` : 'no clock');
  if (s.display === 'stream') parts.push('Stream-safe display');
  else if (s.display === 'projector') parts.push('Projector display');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// The show file on disk (ADM-01): the event's boards live in a file on the presenter's computer,
// never in the app or the repo. These helpers never put round content into words.
// ---------------------------------------------------------------------------

/** Marks a file this editor saved (extra keys are ignored when it's read back). */
export const SHOW_FILE_KIND = 'dascade-showdown-show';

/** The file a presenter downloads: rounds + settings, tagged. */
export function showFileData(file: ShowFile, savedAt: Date): ShowFile & { kind: string; version: 1; savedAt: string } {
  return { kind: SHOW_FILE_KIND, version: 1, savedAt: savedAt.toISOString(), ...file };
}

/** "das-o-ween-trivia-show.json" (the show title, else "showdown-show.json"). */
export function showFileName(title: string | null | undefined): string {
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'showdown'}-show.json`;
}

/** A load confirmation in words, without any answer: "2 rounds, 2 with a special answer, plus its settings". */
export function describeShowFile(file: ShowFile): string {
  const n = file.rounds.length;
  const specials = file.rounds.filter((r) => (r.special ?? 0) > 0).length;
  const parts = [`${n} round${n === 1 ? '' : 's'}`];
  parts.push(
    specials === n && n > 0 ? (n === 1 ? 'with a special answer' : 'each with a special answer') : `${specials} with a special answer`,
  );
  if (file.settings && Object.keys(file.settings).length) parts.push('plus its settings');
  return parts.join(', ');
}

/** Show files are small; anything bigger isn't one (and isn't worth parsing). */
export const SHOW_FILE_MAX_BYTES = 512 * 1024;
