/**
 * DAS Survey Showdown — shared contract (settings, messages, payloads, public views, content rules).
 * Imported by the pure engine (@dascade/game-core/showdown), the server room and the client.
 *
 * A presenter-run survey show in the style of a TV family game show: two teams, a big board of up to
 * ten hidden survey answers, strikes, steals, a bank, sound effects and a live audience on phones.
 *
 * Two formats (the `mode` setting):
 *   - 'classic' (Team Showdown): the full game — teams, strikes, steals, a bank and scores.
 *   - 'showcase' (Presenter Showcase): one presenter runs a big Top-10 board for an audience that
 *     guesses out loud (or in a video-call chat). No teams, no scores: the presenter flips the answers
 *     people name, buzzes wrong answers (as often as needed, never "strikes"), celebrates a special
 *     answer (e.g. #5), runs a round clock, and finally reveals what's left from #10 down to #1.
 *
 * Roles (decided on the server, never by the client):
 *   - Presenter: the room's creator. The only player who receives the answer sheet (`showdown:sheet`)
 *     and the only one whose show controls (`showdown:act`, `showdown:cue`) are accepted. The role never
 *     migrates on its own: a secret presenter pass (`showdown:pass`, presenter-only) reclaims it from
 *     another device, and the presenter can hand it over explicitly.
 *   - Contestants / audience: every other seated player, on Team 1 or Team 2. They cheer (`react`),
 *     lock in private guesses (`guess`) that score "called it" points when a matching answer is
 *     revealed, and watch the board.
 *   - Big screens: any connection may mark itself as a stage display (`screen`); it joins no team.
 *
 * Hidden information: answers that are not revealed yet never enter synchronized state or any
 * broadcast. Built-in question packs live only in the server engine package (never bundled into the
 * client), and custom rounds travel presenter → server and back to the presenter only.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import { cleanText, maskProfanity, normalizeForCompare } from '../text.ts';

// ---------------------------------------------------------------------------
// Limits + teams
// ---------------------------------------------------------------------------

export const SHOWDOWN_LIMITS = {
  /** Answers on one board. */
  answersMin: 3,
  answersMax: 10,
  /** Survey points of one answer. */
  pointsMin: 1,
  pointsMax: 100,
  /** Rounds drawn from the packs for one show. */
  packRoundsMin: 1,
  packRoundsMax: 8,
  /** Custom rounds the presenter may store. */
  customRounds: 12,
  promptMin: 5,
  promptMax: 160,
  /** Long song and movie titles ("It's the Great Pumpkin, Charlie Brown") fit. */
  answerMax: 48,
  aliasMax: 36,
  aliasesPerAnswer: 4,
  /** A small line under a revealed answer (artist, year…). */
  noteMax: 40,
  /** A round's category name ("Halloween Songs"), shown from its title card. */
  roundTitleMax: 40,
  /** "According to …" attribution of a round. */
  sourceMax: 60,
  /** Raw (pre-clean) input bounds for editor payloads. */
  rawText: 400,
  showTitle: 48,
  /** The holding screen's headline ("Remoties DAS-O-Ween Happy Hour"). */
  eventName: 60,
  teamName: 22,
  /** Round clock (Presenter Showcase), whole minutes; 0 = no clock. */
  minutesMax: 30,
  /** Strikes before the other team may steal. */
  strikes: 3,
  /** Private audience guesses per player per round. */
  guessesPerRound: 3,
  guessText: 40,
  /** Presenter undo depth. */
  undo: 40,
  /** Manual score adjustment per action. */
  adjustMax: 500,
  scoreMax: 99_999,
} as const;

export type TeamIndex = 0 | 1;
/** -1 = nobody (no team in control, unclaimed answer, no winner). */
export type TeamSlot = -1 | TeamIndex;

export interface ShowdownTeamDef {
  id: 'delta' | 'sierra';
  defaultName: string;
  /** Fixed team colour (meaningful: the same in every look and theme, always paired with the name). */
  color: string;
  /** PixelIcon name. */
  icon: 'bolt' | 'star';
}

/** Delta and Sierra — the D and S of DAS. */
export const SHOWDOWN_TEAMS: readonly [ShowdownTeamDef, ShowdownTeamDef] = [
  { id: 'delta', defaultName: 'Team Delta', color: '#22d3ee', icon: 'bolt' },
  { id: 'sierra', defaultName: 'Team Sierra', color: '#ff4fd8', icon: 'star' },
];

export const otherTeam = (team: TeamIndex): TeamIndex => (team === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Looks (the show's set dressing — part of the show, so every screen in the room shows the same one)
// ---------------------------------------------------------------------------

export const SHOWDOWN_LOOKS = ['auto', 'halloween', 'showtime'] as const;
export type ShowdownLookSetting = (typeof SHOWDOWN_LOOKS)[number];
export type ShowdownLook = Exclude<ShowdownLookSetting, 'auto'>;

export const SHOWDOWN_LOOK_INFO: Record<ShowdownLookSetting, { title: string; blurb: string }> = {
  auto: { title: 'Seasonal', blurb: 'Haunted in October, Showtime the rest of the year.' },
  halloween: { title: 'Halloween Night', blurb: 'Pumpkins, bats and a ghostly host. Spooky-cute, never gory.' },
  showtime: { title: 'DAS Showtime', blurb: 'Marquee lights, chrome and neon. The classic arcade game show.' },
};

/** Resolves the 'auto' look for a date (the viewer's local date): October = Halloween. */
export function resolveShowdownLook(setting: ShowdownLookSetting, now: Date | null): ShowdownLook {
  if (setting !== 'auto') return setting;
  return now && now.getMonth() === 9 ? 'halloween' : 'showtime';
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export const SHOWDOWN_MODES = ['classic', 'showcase'] as const;
export type ShowdownMode = (typeof SHOWDOWN_MODES)[number];

export const SHOWDOWN_MODE_INFO: Record<ShowdownMode, { title: string; blurb: string }> = {
  classic: { title: 'Team Showdown', blurb: 'Two teams, strikes, steals and a bank — the full family game show.' },
  showcase: {
    title: 'Presenter Showcase',
    blurb: 'One big Top-10 board for a crowd that shouts its guesses (or types them in a meeting chat). You flip the answers they name — no teams, no scores.',
  },
};

// ---------------------------------------------------------------------------
// Stage cards (holding screens the presenter can put up at any time)
// ---------------------------------------------------------------------------

export const SHOWDOWN_CARDS = ['welcome', 'break', 'prizes', 'thanks'] as const;
export type ShowdownCard = (typeof SHOWDOWN_CARDS)[number];

export const SHOWDOWN_CARD_INFO: Record<ShowdownCard, { title: string; blurb: string; icon: string }> = {
  welcome: { title: 'Welcome', blurb: 'The event’s name and “the show starts soon”.', icon: '🎪' },
  break: { title: 'Be right back', blurb: 'For a video, a break or technical trouble.', icon: '⏸️' },
  prizes: { title: 'Prize time', blurb: 'Up next: the prize winners.', icon: '🏆' },
  thanks: { title: 'Thanks for playing', blurb: 'The closing card.', icon: '👋' },
};

// ---------------------------------------------------------------------------
// Question packs (metadata only — the questions live in the server engine package)
// ---------------------------------------------------------------------------

export const SHOWDOWN_PACK_IDS = ['spooky', 'office', 'tech', 'food', 'life'] as const;
export type ShowdownPackId = (typeof SHOWDOWN_PACK_IDS)[number];

export const SHOWDOWN_PACK_INFO: Record<ShowdownPackId, { title: string; blurb: string; rounds: number; seasonal?: boolean }> = {
  spooky: { title: 'Halloween Spooktacular', blurb: 'Haunted houses, costumes, candy and things that go bump.', rounds: 10, seasonal: true },
  office: { title: 'Office Life', blurb: 'Meetings, desks, the kitchen fridge and Friday at 4:59.', rounds: 10 },
  tech: { title: 'Tech Talk', blurb: 'Frozen screens, passwords, video calls and IT support.', rounds: 8 },
  food: { title: 'Snack Attack', blurb: 'Pizza, coffee, potlucks and leftovers.', rounds: 8 },
  life: { title: 'Life & Leisure', blurb: 'Lazy Sundays, chores, vacations and hobbies.', rounds: 8 },
};

// ---------------------------------------------------------------------------
// Content (one round = one survey question with its answers)
// ---------------------------------------------------------------------------

export interface ShowdownAnswer {
  text: string;
  /** Survey points (0 in a ranked round, which has none). */
  points: number;
  /** Other spellings the audience may type ("post-its" for "Sticky notes"). Never shown. */
  aliases: string[];
  /** A small line shown under the answer once it's revealed (artist, year…). Hidden until then. */
  note?: string;
}

export interface ShowdownRoundDef {
  /** Pack question id ('office-03'), event preset id ('dasoween-songs') or 'custom-<n>'. */
  id: string;
  prompt: string;
  /** Sorted by points, most popular first (slot 1 is the top answer) — or, ranked, in the order given. */
  answers: ShowdownAnswer[];
  /** Category name shown from the round's title card ("Halloween Songs"). */
  title?: string;
  /** "According to …" attribution, shown with the question. Never an invented poll. */
  source?: string;
  /** Slot (0-based) of the special answer that sets off the big celebration; -1 or absent = none. */
  special?: number;
  /** A ranked list (no survey points): the order is the presenter's, the points are all 0. */
  ranked?: boolean;
}

const raw = (max: number = SHOWDOWN_LIMITS.rawText) => z.string().max(max);

/**
 * Raw custom round as the presenter's editor sends it (bounded; cleaned by validateShowContent).
 * Points: every answer 1–100 (sorted by points), or every answer 0 for a ranked list (kept in order).
 * `special` is the answer's place on the board, 1–10 (0 or absent = no special answer).
 */
export const ShowdownAnswerInputSchema = z.object({
  text: raw(),
  points: z.number().int().min(0).max(1000),
  aliases: z.array(raw()).max(8).optional(),
  note: raw().optional(),
});
export const ShowdownRoundInputSchema = z.object({
  prompt: raw(),
  // A board holds 10; a couple more still reach the validator, which says so ("at most 10").
  answers: z.array(ShowdownAnswerInputSchema).max(SHOWDOWN_LIMITS.answersMax + 2),
  title: raw().optional(),
  source: raw().optional(),
  special: z.number().int().min(0).max(SHOWDOWN_LIMITS.answersMax).optional(),
});
export type ShowdownRoundInput = z.infer<typeof ShowdownRoundInputSchema>;

/** A stored round back in editor form (the inverse of validateShowContent for a valid round). */
export function roundToInput(round: ShowdownRoundDef): ShowdownRoundInput {
  return {
    prompt: round.prompt,
    ...(round.title ? { title: round.title } : {}),
    ...(round.source ? { source: round.source } : {}),
    ...(round.special !== undefined && round.special >= 0 ? { special: round.special + 1 } : {}),
    answers: round.answers.map((a) => ({
      text: a.text,
      points: round.ranked ? 0 : a.points,
      aliases: [...a.aliases],
      ...(a.note ? { note: a.note } : {}),
    })),
  };
}

export const ShowdownContentSchema = z.object({
  rounds: z.array(ShowdownRoundInputSchema).max(SHOWDOWN_LIMITS.customRounds * 2),
});
export type ShowdownContentPayload = z.infer<typeof ShowdownContentSchema>;

export interface ShowdownContentIssue {
  /** 0-based round index in the submitted list. */
  index: number;
  field: 'prompt' | 'answers' | 'special' | 'list';
  message: string;
}

export interface ShowdownContentReport {
  rounds: ShowdownRoundDef[];
  issues: ShowdownContentIssue[];
  /** Submitted rounds dropped because they were invalid or over the limit. */
  dropped: number;
}

const hasWordChar = (s: string) => /[\p{L}\p{N}]/u.test(s);

/**
 * Cleans and validates custom rounds. Every string is sanitized (control/invisible characters removed,
 * whitespace collapsed, profanity masked) and bounded; blank answers are dropped; answers must be
 * distinct (case/accent-insensitive); 3–10 answers per round. Either every answer has 1–100 points
 * (sorted by points, stable, so slot 1 is the top answer) or every answer has 0 points: a ranked list
 * kept in the order given. A special answer (1–10) must be on the board. Invalid rounds are dropped
 * and reported. Pure and isomorphic: the editor runs it for live feedback, the server authoritatively.
 */
export function validateShowContent(input: readonly ShowdownRoundInput[]): ShowdownContentReport {
  const rounds: ShowdownRoundDef[] = [];
  const issues: ShowdownContentIssue[] = [];
  let dropped = 0;
  let overflowReported = false;
  input.forEach((round, index) => {
    const problem = (field: ShowdownContentIssue['field'], message: string) => {
      issues.push({ index, field, message });
      dropped++;
    };
    if (rounds.length >= SHOWDOWN_LIMITS.customRounds) {
      dropped++;
      if (!overflowReported) {
        overflowReported = true;
        issues.push({ index, field: 'list', message: `Only the first ${SHOWDOWN_LIMITS.customRounds} rounds are kept.` });
      }
      return;
    }
    const prompt = maskProfanity(cleanText(round.prompt, SHOWDOWN_LIMITS.promptMax));
    if (Array.from(prompt).length < SHOWDOWN_LIMITS.promptMin || !hasWordChar(prompt)) {
      return problem('prompt', `Write the survey question (at least ${SHOWDOWN_LIMITS.promptMin} characters).`);
    }
    const answers: ShowdownAnswer[] = [];
    for (const a of round.answers) {
      const text = maskProfanity(cleanText(a.text, SHOWDOWN_LIMITS.answerMax));
      if (!text || !hasWordChar(text)) continue;
      const aliases: string[] = [];
      for (const alias of a.aliases ?? []) {
        const clean = maskProfanity(cleanText(alias, SHOWDOWN_LIMITS.aliasMax));
        if (clean && hasWordChar(clean) && aliases.length < SHOWDOWN_LIMITS.aliasesPerAnswer && !aliases.includes(clean)) aliases.push(clean);
      }
      const note = maskProfanity(cleanText(a.note ?? '', SHOWDOWN_LIMITS.noteMax));
      answers.push({ text, points: a.points, aliases, ...(note && hasWordChar(note) ? { note } : {}) });
    }
    if (answers.length < SHOWDOWN_LIMITS.answersMin) return problem('answers', `Add at least ${SHOWDOWN_LIMITS.answersMin} answers.`);
    if (answers.length > SHOWDOWN_LIMITS.answersMax) return problem('answers', `A board holds at most ${SHOWDOWN_LIMITS.answersMax} answers.`);
    const ranked = answers.every((a) => a.points === 0);
    if (!ranked && answers.some((a) => a.points < SHOWDOWN_LIMITS.pointsMin || a.points > SHOWDOWN_LIMITS.pointsMax)) {
      return problem(
        'answers',
        `Give every answer ${SHOWDOWN_LIMITS.pointsMin}–${SHOWDOWN_LIMITS.pointsMax} points — or leave every answer at 0 to rank them in the order listed.`,
      );
    }
    const keys = answers.map((a) => normalizeForCompare(a.text) || a.text);
    if (new Set(keys).size !== keys.length) return problem('answers', 'Each answer must be different.');
    const special = round.special ?? 0;
    if (special > answers.length) return problem('special', `The special answer is #${special}, but this board has ${answers.length} answers.`);
    const ordered = ranked ? answers : answers.map((a, i) => ({ a, i })).sort((x, y) => y.a.points - x.a.points || x.i - y.i).map((x) => x.a);
    const title = maskProfanity(cleanText(round.title ?? '', SHOWDOWN_LIMITS.roundTitleMax));
    const source = maskProfanity(cleanText(round.source ?? '', SHOWDOWN_LIMITS.sourceMax));
    rounds.push({
      id: `custom-${rounds.length + 1}`,
      prompt,
      answers: ordered,
      ...(title && hasWordChar(title) ? { title } : {}),
      ...(source && hasWordChar(source) ? { source } : {}),
      ...(special > 0 ? { special: special - 1 } : {}),
      ...(ranked ? { ranked: true } : {}),
    });
  });
  return { rounds, issues, dropped };
}

/** Survey points on a board (what a "clean sweep" is worth before the multiplier). */
export function boardTotal(round: Pick<ShowdownRoundDef, 'answers'>): number {
  return round.answers.reduce((sum, a) => sum + a.points, 0);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SHOWDOWN_SCORING = ['flat', 'final-double', 'rising'] as const;
export type ShowdownScoring = (typeof SHOWDOWN_SCORING)[number];

export const SHOWDOWN_SCORING_INFO: Record<ShowdownScoring, { title: string; blurb: string }> = {
  flat: { title: 'Single points', blurb: 'Every round counts the same.' },
  'final-double': { title: 'Double final', blurb: 'The last round is worth double.' },
  rising: { title: 'Big finish', blurb: 'Second-to-last round ×2, the last ×3.' },
};

/** Point multiplier of each round for a show of `rounds` rounds. */
export function roundMultipliers(rounds: number, scoring: ShowdownScoring): number[] {
  const n = Math.max(0, Math.floor(rounds));
  const out = Array.from({ length: n }, () => 1);
  if (scoring === 'final-double' && n >= 2) out[n - 1] = 2;
  if (scoring === 'rising') {
    if (n >= 3) {
      out[n - 2] = 2;
      out[n - 1] = 3;
    } else if (n === 2) out[1] = 2;
  }
  return out;
}

const cleanTitle = (t: string) => maskProfanity(cleanText(t, SHOWDOWN_LIMITS.showTitle));
const cleanTeamName = (t: string) => maskProfanity(cleanText(t, SHOWDOWN_LIMITS.teamName));
const cleanEventName = (t: string) => maskProfanity(cleanText(t, SHOWDOWN_LIMITS.eventName));

export const ShowdownSettingsSchema = z.object({
  /** Team Showdown (teams, strikes, steals, scores) or Presenter Showcase (one board, no teams). */
  mode: z.enum(SHOWDOWN_MODES),
  /** Marquee title (blank = the default title). */
  title: z.string().max(120).transform(cleanTitle),
  /** The holding screen's headline (blank = the show title). Presenter Showcase's Welcome card. */
  eventName: z.string().max(160).transform(cleanEventName),
  look: z.enum(SHOWDOWN_LOOKS),
  /** Built-in packs, or the presenter's own rounds. */
  source: z.enum(['packs', 'custom']),
  packs: z
    .array(z.enum(SHOWDOWN_PACK_IDS))
    .min(1)
    .max(SHOWDOWN_PACK_IDS.length)
    .refine((list) => new Set(list).size === list.length, 'Packs must be unique'),
  /** Rounds drawn from the packs (custom shows play every stored round). */
  rounds: z.number().int().min(SHOWDOWN_LIMITS.packRoundsMin).max(SHOWDOWN_LIMITS.packRoundsMax),
  scoring: z.enum(SHOWDOWN_SCORING),
  /** Three strikes hand the other team one guess to steal the bank. */
  steal: z.boolean(),
  /** The audience may lock in private guesses for "called it" points. */
  audience: z.boolean(),
  teamNames: z.tuple([z.string().max(60).transform(cleanTeamName), z.string().max(60).transform(cleanTeamName)]),
  /** Presenter Showcase: each round's clock in minutes (0 = no clock). It never reveals anything by itself. */
  minutes: z.number().int().min(0).max(SHOWDOWN_LIMITS.minutesMax),
  /** Presenter Showcase: the round clock shows on the stage too (the console always has it). */
  stageClock: z.boolean(),
});
export type ShowdownSettings = z.infer<typeof ShowdownSettingsSchema>;

export const SHOWDOWN_DEFAULT_TITLE = 'DAS Survey Showdown';

/** Defaults for a new room; in October the show opens with the Halloween pack. */
export function defaultShowdownSettings(now: Date = new Date()): ShowdownSettings {
  const october = now.getMonth() === 9;
  return {
    mode: 'classic',
    title: '',
    eventName: '',
    look: 'auto',
    source: 'packs',
    packs: october ? ['spooky'] : ['office', 'tech', 'food', 'life'],
    rounds: 4,
    scoring: 'final-double',
    steal: true,
    audience: true,
    teamNames: ['', ''],
    minutes: 10,
    stageClock: true,
  };
}

/** The holding screen's headline: the event name, else the show title. */
export function eventTitle(settings: Pick<ShowdownSettings, 'eventName' | 'title'>): string {
  return settings.eventName || showTitle(settings);
}

export function showTitle(settings: Pick<ShowdownSettings, 'title'>): string {
  return settings.title || SHOWDOWN_DEFAULT_TITLE;
}

export function teamName(settings: Pick<ShowdownSettings, 'teamNames'> | null | undefined, team: TeamIndex): string {
  return settings?.teamNames?.[team] || SHOWDOWN_TEAMS[team].defaultName;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const SHOWDOWN_MSG = {
  /** client → server (presenter): a show control (ShowdownActPayload). */
  act: 'showdown:act',
  /** client → server (presenter) {cue}: play a sound/stage cue on every screen. server → all: {cue, id}. */
  cue: 'showdown:cue',
  /** client → server {team}: pick your team (lobby, or before round 1 / once if you have none). */
  team: 'showdown:team',
  /** client → server (presenter) {playerId, team}: move a player (team -1 = no team). */
  move: 'showdown:move',
  /** client → server {on}: this connection is a stage display (joins no team). */
  screen: 'showdown:screen',
  /** client → server {round, text}: a private audience guess. */
  guess: 'showdown:guess',
  /** client → server {r}: a reaction (cheer for your team). */
  react: 'showdown:react',
  /** client → server {pass}: reclaim the presenter role with the presenter pass. */
  claim: 'showdown:claim',
  /** client → server (presenter) {playerId}: hand the presenter role to another player. */
  handover: 'showdown:handover',
  /**
   * client → server {}: become the presenter of a room whose presenter left for good — only between
   * shows (lobby / results). The old presenter's custom rounds are discarded and the pass changes.
   */
  takeover: 'showdown:takeover',
  /**
   * client → server (presenter, lobby/results) {rounds}: replace the custom rounds.
   * server → presenter only: the stored rounds + issues (ShowdownContentPrivate), null for others.
   */
  content: 'showdown:content',
  /**
   * client → server (presenter, lobby/results) {id}: load an event preset — its settings and its rounds
   * (which live on the server, never in the client bundle) become this room's custom rounds.
   */
  preset: 'showdown:preset',
  /** client → server (presenter, any phase) {card}: put a holding card on every stage ('' = none). */
  card: 'showdown:card',
  /** server → presenter only: the answer sheet (ShowdownSheet), null when you are not (or no longer) the presenter. */
  sheet: 'showdown:sheet',
  /** server → presenter only: {pass} (null for everyone else). */
  pass: 'showdown:pass',
  /** server → one player: their own guesses and called-it points (ShowdownMe). */
  me: 'showdown:me',
  /** server → all: board events for sounds and animation (ShowdownEvent). */
  event: 'showdown:event',
  /** server → all: aggregated reactions of the last moment (ShowdownReactions). */
  reactions: 'showdown:reactions',
} as const;

const rev = z.number().int().min(0).max(100_000_000);
const team = z.union([z.literal(0), z.literal(1)]);

export const ShowdownActSchema = z.discriminatedUnion('a', [
  z.object({ a: z.literal('begin'), rev }).strict(),
  z.object({ a: z.literal('question'), rev }).strict(),
  z.object({ a: z.literal('control'), rev, team }).strict(),
  /**
   * Reveals are idempotent by slot, so they don't need the board revision (a fast presenter can flip
   * several before the board catches up). `round` is the round the console was showing: a reveal that
   * arrives after the show moved on (e.g. "Reveal the rest" racing "Next round") is ignored instead of
   * flipping a tile of the next board. Optional for consoles loaded before it existed.
   */
  z
    .object({
      a: z.literal('reveal'),
      slot: z.number().int().min(0).max(SHOWDOWN_LIMITS.answersMax - 1),
      round: z.number().int().min(-1).max(1000).optional(),
    })
    .strict(),
  z.object({ a: z.literal('strike'), rev }).strict(),
  z.object({ a: z.literal('award'), rev, team }).strict(),
  z
    .object({
      a: z.literal('adjust'),
      rev,
      team,
      delta: z.number().int().min(-SHOWDOWN_LIMITS.adjustMax).max(SHOWDOWN_LIMITS.adjustMax),
    })
    .strict(),
  z.object({ a: z.literal('next'), rev }).strict(),
  z.object({ a: z.literal('undo'), rev }).strict(),
  z.object({ a: z.literal('finish'), rev }).strict(),
  // ---- Presenter Showcase ----
  /**
   * A wrong answer: the buzzer and a big ✕ on every screen. Not a strike — it changes nothing on the
   * board, so it carries the round (not the revision) and may be pressed as often as people miss. The
   * server drops a second one within SHOWDOWN_MISS_GAP_MS (a double click is one miss).
   */
  z.object({ a: z.literal('miss'), round: z.number().int().min(-1).max(1000) }).strict(),
  /** The current round back to its title card: every tile hidden again, the clock reset. Undoable. */
  z.object({ a: z.literal('restart'), rev }).strict(),
  /** The whole show back to the opening marquee. Undoable. */
  z.object({ a: z.literal('reset'), rev }).strict(),
  /**
   * Reveal what's left, from the bottom of the board up (#10, #9 … #1), skipping answers already up.
   * The server runs the sequence (a drumroll before the special answer), so a busy or hidden console
   * can't stall it. Ignored if the show has moved on from `round`.
   */
  z.object({ a: z.literal('sweep'), round: z.number().int().min(-1).max(1000) }).strict(),
  /** Stop a running sweep (pressing Reveal remaining again carries on from where it stopped). */
  z.object({ a: z.literal('halt') }).strict(),
  /** The round clock: start/resume, pause, back to full time (paused), one minute more or less. */
  z.object({ a: z.literal('clock'), op: z.enum(['start', 'pause', 'reset', 'plus', 'minus', 'show', 'hide']) }).strict(),
]);
export type ShowdownActPayload = z.infer<typeof ShowdownActSchema>;
export type ShowdownAction = ShowdownActPayload['a'];
export type ShowdownClockOp = Extract<ShowdownActPayload, { a: 'clock' }>['op'];

/** A second wrong-answer press within this window is the same miss (a double click). */
export const SHOWDOWN_MISS_GAP_MS = 450;

export const SHOWDOWN_CUES = ['intro', 'drumroll', 'applause', 'aww', 'ding', 'suspense', 'celebrate'] as const;
export type ShowdownCue = (typeof SHOWDOWN_CUES)[number];
export const SHOWDOWN_CUE_INFO: Record<ShowdownCue, { title: string; icon: string }> = {
  intro: { title: 'Intro sting', icon: '🎺' },
  drumroll: { title: 'Drumroll', icon: '🥁' },
  applause: { title: 'Applause', icon: '👏' },
  aww: { title: 'Aww', icon: '😢' },
  ding: { title: 'Ding', icon: '🔔' },
  suspense: { title: 'Suspense', icon: '😬' },
  celebrate: { title: 'Celebrate!', icon: '🎉' },
};
export const ShowdownCueSchema = z.object({ cue: z.enum(SHOWDOWN_CUES) }).strict();

export const ShowdownTeamSchema = z.object({ team }).strict();
export const ShowdownMoveSchema = z.object({ playerId: z.string().min(1).max(64), team: z.union([z.literal(-1), team]) }).strict();
export const ShowdownScreenSchema = z.object({ on: z.boolean() }).strict();
export const ShowdownGuessSchema = z.object({ round: z.number().int().min(0).max(1000), text: z.string().max(200) }).strict();
/** Reaction kinds: index into the look's reaction set (clap, fire, wow, laugh, love, party). */
export const SHOWDOWN_REACTION_KINDS = 6;
export const ShowdownReactSchema = z.object({ r: z.number().int().min(0).max(SHOWDOWN_REACTION_KINDS - 1) }).strict();
export const ShowdownClaimSchema = z.object({ pass: z.string().min(1).max(64) }).strict();
export const ShowdownHandoverSchema = z.object({ playerId: z.string().min(1).max(64) }).strict();
export const ShowdownTakeoverSchema = z.object({}).strict();
export const ShowdownCardSchema = z.object({ card: z.union([z.literal(''), z.enum(SHOWDOWN_CARDS)]) }).strict();

// ---------------------------------------------------------------------------
// Event presets (metadata only — their rounds live in the server engine package)
// ---------------------------------------------------------------------------

export const SHOWDOWN_EVENT_IDS = ['dasoween-2026', 'dasoween-rehearsal'] as const;
export type ShowdownEventId = (typeof SHOWDOWN_EVENT_IDS)[number];
export const ShowdownPresetSchema = z.object({ id: z.enum(SHOWDOWN_EVENT_IDS) }).strict();

export interface ShowdownEventInfo {
  title: string;
  blurb: string;
  /** Rounds it loads. */
  rounds: number;
  /** Demo answers for practising: the console and stage say "Rehearsal" while it's loaded. */
  rehearsal: boolean;
  /** Settings it applies (the rest stay as they are). */
  settings: Partial<ShowdownSettings>;
}

const DASOWEEN_SETTINGS: Partial<ShowdownSettings> = {
  mode: 'showcase',
  look: 'halloween',
  title: 'DAS-O-Ween Trivia',
  eventName: 'Remoties DAS-O-Ween Happy Hour',
  source: 'custom',
  minutes: 10,
  stageClock: true,
  audience: false,
};

export const SHOWDOWN_EVENT_INFO: Record<ShowdownEventId, ShowdownEventInfo> = {
  'dasoween-2026': {
    title: 'DAS-O-Ween 2026',
    blurb: 'Two Top-10 boards — Halloween songs, then Halloween movies — with a celebration on #5, a 10-minute clock per round and the Halloween Night look.',
    rounds: 2,
    rehearsal: false,
    settings: DASOWEEN_SETTINGS,
  },
  'dasoween-rehearsal': {
    title: 'DAS-O-Ween rehearsal',
    blurb: 'The same show with two practice boards (candy and costumes), so you can try every control without giving the real answers away.',
    rounds: 2,
    rehearsal: true,
    settings: { ...DASOWEEN_SETTINGS, title: 'DAS-O-Ween Rehearsal' },
  },
};

// ---------------------------------------------------------------------------
// Public views
// ---------------------------------------------------------------------------

/**
 * Show stage inside PLAYING:
 *   intro  — the marquee before round 1
 *   title  — a round's title card; the board shows how many answers there are, the question is hidden
 *   live   — the question is up; the team in control guesses (reveals, strikes)
 *   steal  — three strikes: the other team gets one guess to steal the bank
 *   done   — the round is decided; the presenter may reveal the rest of the board for show
 * Presenter Showcase uses intro → title → live → done (done = every answer is up).
 */
export type ShowdownStage = 'intro' | 'title' | 'live' | 'steal' | 'done';

/** How a round's bank was won. */
export type ShowdownWin = 'sweep' | 'steal' | 'defend' | 'manual' | 'none';

export interface ShowdownSlotView {
  revealed: boolean;
  /** Only present once revealed. */
  text?: string;
  /** Survey points, only present once revealed. */
  points?: number;
  /** Team credited with it (-1 = face-off before control, or revealed after the round was decided). */
  by: TeamSlot;
  /** Reveal order (0 = hidden): lets screens stagger a "reveal the rest" sweep. */
  seq: number;
  /** Audience members who called it (aggregate, only once revealed). */
  callers: number;
  /** Revealed after the round was played (Reveal the rest / Reveal remaining) — nobody found it. */
  late: boolean;
  /** The answer's small line (artist, year…), only once revealed. */
  note?: string;
}

export interface ShowdownRoundResult {
  index: number;
  winner: TeamSlot;
  points: number;
  how: ShowdownWin;
  /** Presenter Showcase: answers found while the round was live, of `total`. */
  found?: number;
  total?: number;
}

/** The public board (`boardJson`): only what every screen may show. */
export interface ShowdownBoardView {
  rev: number;
  mode: ShowdownMode;
  stage: ShowdownStage;
  /** 0-based round index (-1 before round 1). */
  round: number;
  totalRounds: number;
  multiplier: number;
  /** The round's category name ('' = none), public from its title card. */
  title: string;
  /** '' until the question is shown. */
  prompt: string;
  /** "According to …" attribution ('' = none), shown with the question. */
  source: string;
  /** Slot of the special answer (-1 = none). A position on the board, never the answer. */
  special: number;
  slots: ShowdownSlotView[];
  control: TeamSlot;
  strikes: number;
  /** The steal attempt failed (a red X on the stealing side). */
  stealFailed: boolean;
  /** Points in play this round (already multiplied). */
  bank: number;
  scores: [number, number];
  roundWinner: TeamSlot;
  roundHow: ShowdownWin | '';
  /** Every decided round so far. */
  results: ShowdownRoundResult[];
}

export interface ShowdownPublicState extends BaseRoomView {
  presenterId: string;
  /** JSON ShowdownBoardView ('' outside a show). */
  boardJson: string;
  /** Board revision (also in boardJson) — cheap to select. */
  rev: number;
  /** playerId → team (0 | 1). Players without a team are absent. */
  teams: Record<string, number>;
  /** playerIds of stage displays. */
  screens: Record<string, boolean>;
  /** Team hype meters, 0–100 (cheering fills them, they drain over time). */
  hype0: number;
  hype1: number;
  /** Audience guesses locked in this round (aggregate). */
  guessesIn: number;
  /** Valid custom rounds stored by the presenter (the rounds themselves stay private). */
  customRounds: number;
  /** JSON ShowdownFinale once the show is over ('' otherwise). */
  finaleJson: string;
  /** The holding card on every stage ('' = none): ShowdownCard. */
  card: string;
  /** Presenter Showcase: the round clock. Running while clockEndsAt > 0 (server epoch ms). */
  clockEndsAt: number;
  /** Milliseconds left while paused (negative = overtime). */
  clockLeft: number;
  /** The round's full time in ms (0 = no clock this show). */
  clockMax: number;
  /** The stage shows the clock. */
  clockShow: boolean;
  /** A "Reveal remaining" sweep is running. */
  sweep: boolean;
  /** The loaded rounds are an event preset's practice boards. */
  rehearsal: boolean;
}

/** Milliseconds left on the round clock (negative = overtime). `now` = serverNow() on clients. */
export function clockRemaining(s: Pick<ShowdownPublicState, 'clockEndsAt' | 'clockLeft'>, now: number): number {
  return s.clockEndsAt > 0 ? s.clockEndsAt - now : s.clockLeft;
}

export function parseBoard(json: string | undefined | null): ShowdownBoardView | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ShowdownBoardView;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private payloads
// ---------------------------------------------------------------------------

export interface ShowdownSheetAnswer extends ShowdownAnswer {
  revealed: boolean;
  /** Audience members whose locked-in guess matches this answer (presenter only). */
  guessed: number;
}

export interface ShowdownSheetRound {
  index: number;
  prompt: string;
  multiplier: number;
  answers: ShowdownAnswer[];
  title?: string;
  source?: string;
  /** Slot of the special answer (-1 = none). */
  special: number;
  ranked: boolean;
}

export interface ShowdownGuessCloudEntry {
  /** A representative guess (as typed, cleaned). */
  text: string;
  count: number;
  /** Slot it matches (-1 = not on the board). */
  slot: number;
}

/** The presenter's answer sheet (never sent to anyone else). */
export interface ShowdownSheet {
  rev: number;
  round: number;
  prompt: string;
  multiplier: number;
  /** Slot of the special answer this round (-1 = none). */
  special: number;
  /** This round ranks its answers (no survey points to show). */
  ranked: boolean;
  title?: string;
  source?: string;
  answers: ShowdownSheetAnswer[];
  /** Every round of the show (the rundown), including the current one. */
  rundown: ShowdownSheetRound[];
  /** Most common audience guesses this round. */
  cloud: ShowdownGuessCloudEntry[];
  /** Undo steps available. */
  undo: number;
}

export interface ShowdownContentPrivate {
  rounds: ShowdownRoundDef[];
  issues: ShowdownContentIssue[];
  dropped: number;
}

export interface ShowdownMyGuess {
  text: string;
  /** Slot it called once that answer was revealed (-1 = not (yet) on the board). */
  slot: number;
  points: number;
}

/** One player's private view of their audience game. */
export interface ShowdownMe {
  round: number;
  guesses: ShowdownMyGuess[];
  /** Called-it points this show / correct calls this show. */
  points: number;
  calls: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ShowdownEvent =
  | { type: 'intro'; rev: number }
  /** `answers` = tiles on the new board (the event can arrive before the board itself). */
  | { type: 'round'; rev: number; round: number; multiplier: number; answers: number }
  | { type: 'question'; rev: number }
  | { type: 'control'; rev: number; team: TeamIndex }
  | {
      type: 'reveal';
      rev: number;
      slot: number;
      /** The answer just revealed (public from this moment on). */
      text: string;
      points: number;
      /** Slot 1 (the top answer). */
      top: boolean;
      /** Revealed after the round was decided (no points move). */
      late: boolean;
      callers: number;
      /** Every answer on the board is now showing. */
      cleared: boolean;
      /** The special answer: the big celebration. */
      special: boolean;
      /** Part of a Reveal remaining sweep (#10 → #1). */
      sweep: boolean;
      /** The answer's small line, if it has one. */
      note?: string;
    }
  | { type: 'strike'; rev: number; strikes: number; steal: boolean; stealFailed: boolean }
  | { type: 'award'; rev: number; team: TeamSlot; points: number; how: ShowdownWin }
  | { type: 'adjust'; rev: number; team: TeamIndex; delta: number }
  | { type: 'undo'; rev: number }
  // ---- Presenter Showcase ----
  /** A wrong answer (`n` counts this round's misses, for keys; nothing is scored). */
  | { type: 'miss'; rev: number; round: number; n: number }
  /** A sweep started (on) or ended (off: finished, or stopped by the presenter). */
  | { type: 'sweep'; rev: number; on: boolean }
  /** The sweep's drumroll beat before the special answer flips. */
  | { type: 'suspense'; rev: number; slot: number }
  /** The round clock ran out (once per round; the show carries on — the presenter wraps up). */
  | { type: 'timeup'; rev: number; round: number }
  /** The round went back to its title card. */
  | { type: 'restart'; rev: number; round: number }
  /** The show went back to the opening. */
  | { type: 'reset'; rev: number };

export interface ShowdownReactions {
  /** Count per reaction kind in the last moment. */
  k: number[];
  /** Reactions per team in the last moment. */
  t: [number, number];
}

/** Final results (podium extras). Presenter Showcase: winner -1, no teams — never an invented winner. */
export interface ShowdownFinale {
  mode: ShowdownMode;
  winner: TeamSlot;
  scores: [number, number];
  names: [string, string];
  results: ShowdownRoundResult[];
  /** Top "called it" audience members. */
  callers: Array<{ playerId: string; name: string; points: number; calls: number; team: TeamSlot }>;
  members: [string[], string[]];
}

export const SHOWDOWN_STATS = {
  /** Correct "called it" guesses (summed across shows). */
  calls: 'calls',
  /** Best called-it points in one show. */
  bestCallPoints: 'bestCallPoints',
} as const;
