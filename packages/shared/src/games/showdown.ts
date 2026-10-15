/**
 * DAS Survey Showdown — shared contract (settings, messages, payloads, public views, content rules).
 * Imported by the pure engine (@dascade/game-core/showdown), the server room and the client.
 *
 * A presenter-run survey show in the style of a TV family game show: two teams, a big board of up to
 * ten hidden survey answers, strikes, steals, a bank, sound effects and a live audience on phones.
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
  answerMax: 36,
  aliasMax: 36,
  aliasesPerAnswer: 4,
  /** Raw (pre-clean) input bounds for editor payloads. */
  rawText: 400,
  showTitle: 48,
  teamName: 22,
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
  points: number;
  /** Other spellings the audience may type ("post-its" for "Sticky notes"). Never shown. */
  aliases: string[];
}

export interface ShowdownRoundDef {
  /** Pack question id ('office-03') or 'custom-<n>'. */
  id: string;
  prompt: string;
  /** Sorted by points, most popular first (slot 1 is the top answer). */
  answers: ShowdownAnswer[];
}

const raw = (max: number = SHOWDOWN_LIMITS.rawText) => z.string().max(max);

/** Raw custom round as the presenter's editor sends it (bounded; cleaned by validateShowContent). */
export const ShowdownAnswerInputSchema = z.object({
  text: raw(),
  points: z.number().int().min(0).max(1000),
  aliases: z.array(raw()).max(8).optional(),
});
export const ShowdownRoundInputSchema = z.object({
  prompt: raw(),
  answers: z.array(ShowdownAnswerInputSchema).max(16),
});
export type ShowdownRoundInput = z.infer<typeof ShowdownRoundInputSchema>;

export const ShowdownContentSchema = z.object({
  rounds: z.array(ShowdownRoundInputSchema).max(SHOWDOWN_LIMITS.customRounds * 2),
});
export type ShowdownContentPayload = z.infer<typeof ShowdownContentSchema>;

export interface ShowdownContentIssue {
  /** 0-based round index in the submitted list. */
  index: number;
  field: 'prompt' | 'answers' | 'list';
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
 * distinct (case/accent-insensitive) with 1–100 points; 3–10 answers per round. Answers are sorted
 * by points (stable), so slot 1 is always the top answer. Invalid rounds are dropped and reported.
 * Pure and isomorphic: the editor runs it for live feedback, the server runs it authoritatively.
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
      answers.push({ text, points: a.points, aliases });
    }
    if (answers.length < SHOWDOWN_LIMITS.answersMin) return problem('answers', `Add at least ${SHOWDOWN_LIMITS.answersMin} answers.`);
    if (answers.length > SHOWDOWN_LIMITS.answersMax) return problem('answers', `A board holds at most ${SHOWDOWN_LIMITS.answersMax} answers.`);
    if (answers.some((a) => a.points < SHOWDOWN_LIMITS.pointsMin || a.points > SHOWDOWN_LIMITS.pointsMax)) {
      return problem('answers', `Give every answer ${SHOWDOWN_LIMITS.pointsMin}–${SHOWDOWN_LIMITS.pointsMax} points.`);
    }
    const keys = answers.map((a) => normalizeForCompare(a.text) || a.text);
    if (new Set(keys).size !== keys.length) return problem('answers', 'Each answer must be different.');
    const sorted = answers.map((a, i) => ({ a, i })).sort((x, y) => y.a.points - x.a.points || x.i - y.i);
    rounds.push({ id: `custom-${rounds.length + 1}`, prompt, answers: sorted.map((x) => x.a) });
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

export const ShowdownSettingsSchema = z.object({
  /** Marquee title (blank = the default title). */
  title: z.string().max(120).transform(cleanTitle),
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
});
export type ShowdownSettings = z.infer<typeof ShowdownSettingsSchema>;

export const SHOWDOWN_DEFAULT_TITLE = 'DAS Survey Showdown';

/** Defaults for a new room; in October the show opens with the Halloween pack. */
export function defaultShowdownSettings(now: Date = new Date()): ShowdownSettings {
  const october = now.getMonth() === 9;
  return {
    title: '',
    look: 'auto',
    source: 'packs',
    packs: october ? ['spooky'] : ['office', 'tech', 'food', 'life'],
    rounds: 4,
    scoring: 'final-double',
    steal: true,
    audience: true,
    teamNames: ['', ''],
  };
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
]);
export type ShowdownActPayload = z.infer<typeof ShowdownActSchema>;
export type ShowdownAction = ShowdownActPayload['a'];

export const SHOWDOWN_CUES = ['intro', 'drumroll', 'applause', 'aww', 'ding', 'suspense'] as const;
export type ShowdownCue = (typeof SHOWDOWN_CUES)[number];
export const SHOWDOWN_CUE_INFO: Record<ShowdownCue, { title: string; icon: string }> = {
  intro: { title: 'Intro sting', icon: '🎺' },
  drumroll: { title: 'Drumroll', icon: '🥁' },
  applause: { title: 'Applause', icon: '👏' },
  aww: { title: 'Aww', icon: '😢' },
  ding: { title: 'Ding', icon: '🔔' },
  suspense: { title: 'Suspense', icon: '😬' },
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
}

export interface ShowdownRoundResult {
  index: number;
  winner: TeamSlot;
  points: number;
  how: ShowdownWin;
}

/** The public board (`boardJson`): only what every screen may show. */
export interface ShowdownBoardView {
  rev: number;
  stage: ShowdownStage;
  /** 0-based round index (-1 before round 1). */
  round: number;
  totalRounds: number;
  multiplier: number;
  /** '' until the question is shown. */
  prompt: string;
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
    }
  | { type: 'strike'; rev: number; strikes: number; steal: boolean; stealFailed: boolean }
  | { type: 'award'; rev: number; team: TeamSlot; points: number; how: ShowdownWin }
  | { type: 'adjust'; rev: number; team: TeamIndex; delta: number }
  | { type: 'undo'; rev: number };

export interface ShowdownReactions {
  /** Count per reaction kind in the last moment. */
  k: number[];
  /** Reactions per team in the last moment. */
  t: [number, number];
}

/** Final results (podium extras). */
export interface ShowdownFinale {
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
