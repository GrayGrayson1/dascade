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
 *     A screen or a spectator can never take over the show.
 *   - Event rooms (a DAS-O-Ween preset was loaded): crew roles on top — a producer (moves the
 *     presenter role, hands out and revokes crew links), backup presenters and moderators — each
 *     proven by a personal crew link and checked as permissions on the server (see "Crew" below).
 *     The audience picker draws who answers next in every Presenter Showcase (see "Picker" below).
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
    blurb:
      'One big Top-10 board for a crowd that shouts its guesses (or types them in a meeting chat). You flip the answers they name — no teams, no scores.',
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
  spooky: {
    title: 'Halloween Spooktacular',
    blurb: 'Haunted houses, costumes, candy and things that go bump.',
    rounds: 10,
    seasonal: true,
  },
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
        if (clean && hasWordChar(clean) && aliases.length < SHOWDOWN_LIMITS.aliasesPerAnswer && !aliases.includes(clean))
          aliases.push(clean);
      }
      const note = maskProfanity(cleanText(a.note ?? '', SHOWDOWN_LIMITS.noteMax));
      answers.push({ text, points: a.points, aliases, ...(note && hasWordChar(note) ? { note } : {}) });
    }
    if (answers.length < SHOWDOWN_LIMITS.answersMin) return problem('answers', `Add at least ${SHOWDOWN_LIMITS.answersMin} answers.`);
    if (answers.length > SHOWDOWN_LIMITS.answersMax)
      return problem('answers', `A board holds at most ${SHOWDOWN_LIMITS.answersMax} answers.`);
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
    if (special > answers.length)
      return problem('special', `The special answer is #${special}, but this board has ${answers.length} answers.`);
    const ordered = ranked
      ? answers
      : answers
          .map((a, i) => ({ a, i }))
          .sort((x, y) => y.a.points - x.a.points || x.i - y.i)
          .map((x) => x.a);
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
  /**
   * How the stage tunes itself for the way it's watched (DSP-02): 'auto' = each screen decides (the
   * stage window and the console preview are Stream-safe, a big-screen link is Projector, anything
   * else by size); 'stream' / 'projector' force one profile on every screen (the escape hatch).
   */
  display: z.enum(['auto', 'stream', 'projector']).default('auto'),
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
    display: 'auto',
  };
}

export const SHOWDOWN_DISPLAYS = ['auto', 'stream', 'projector'] as const;
export type ShowdownDisplaySetting = (typeof SHOWDOWN_DISPLAYS)[number];
/** The profile a screen actually uses. */
export type ShowdownDisplay = Exclude<ShowdownDisplaySetting, 'auto'>;
export const SHOWDOWN_DISPLAY_INFO: Record<ShowdownDisplaySetting, { title: string; blurb: string }> = {
  auto: { title: 'Automatic', blurb: 'Each screen picks: the stage window is Stream-safe, a big-screen link is Projector.' },
  stream: { title: 'Stream-safe', blurb: 'For a Teams share: bigger type, thicker edges, calmer decor.' },
  projector: { title: 'Projector', blurb: 'For a room: lifted blacks and brighter edges that survive washout.' },
};

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
   * client → server (presenter, lobby/results) {id}: load an event preset — its settings, and (unless
   * it's settings-only, like DAS-O-Ween 2026, whose boards come from the presenter's show file) its
   * rounds, which live on the server and never in the client bundle. An event preset makes the room
   * an event room for good, and whoever loads it first becomes its producer.
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

  // ---- The audience picker (Presenter Showcase; see "Picker" below) ----
  /** client → server (presenter, or `picker.run`) ShowdownPickPayload: pick, mark done, no answer, reroll. */
  pick: 'showdown:pick',
  /** client → server (a participant, for their own seat) {on}: "Skip me" — out of the pool. Private. */
  skip: 'showdown:skip',

  // ---- Event rooms: crew, moderation, audit (see "Crew" below) ----
  /** client → server {link}: redeem a crew link (`#crew=<id>.<secret>`, read from the fragment). */
  crewClaim: 'showdown:crew-claim',
  /** client → server (`crew.issue`) {role, name}: mint a named crew link (the secret comes back once). */
  crewIssue: 'showdown:crew-issue',
  /** client → server (`crew.revoke`) {id}: revoke a crew link (its holder loses the role at once). */
  crewRevoke: 'showdown:crew-revoke',
  /** server → one player: their crew view (ShowdownCrewPrivate), null when they hold no crew role. */
  crew: 'showdown:crew',
  /** client → server (`presenter.assign`) {playerId, reason}: make someone the presenter (rotates the pass). */
  assign: 'showdown:assign',
  /** client → server (`people.rename`) {playerId, name}: rename anyone, in any phase. */
  rename: 'showdown:rename',
  /** client → server (`people.hide`) {playerId, on}: hide someone from the stage and the pool. */
  hide: 'showdown:hide',
  /** server → crew with `audit.read`: the latest audit entries (ShowdownAuditView). */
  audit: 'showdown:audit',
  /** client → server (`audit.export`) {}: server → that client: the whole log (ShowdownAuditFile). */
  auditExport: 'showdown:audit-export',

  // ---- Event rooms: sound station, preflight, black box ----
  /** client → server {ready, muted, sounds}: this device's show audio, every 2 s (consoles and big screens). */
  audio: 'showdown:audio',
  /** client → server (`audio.station`) {playerId}: which device plays show sound ('' = the presenter's console). */
  station: 'showdown:station',
  /** client → server (`preflight.read`) {}: server → that client: ShowdownPreflightData. */
  preflight: 'showdown:preflight',
  /**
   * server → presenter only: the room's encrypted snapshot (ShowdownBlackBox), after each change in
   * an event room; null clears it. The console keeps it and hands it back after a server restart.
   */
  blackbox: 'showdown:blackbox',
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
      slot: z
        .number()
        .int()
        .min(0)
        .max(SHOWDOWN_LIMITS.answersMax - 1),
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
export const ShowdownReactSchema = z
  .object({
    r: z
      .number()
      .int()
      .min(0)
      .max(SHOWDOWN_REACTION_KINDS - 1),
  })
  .strict();
export const ShowdownClaimSchema = z.object({ pass: z.string().min(1).max(64) }).strict();
export const ShowdownHandoverSchema = z.object({ playerId: z.string().min(1).max(64) }).strict();
export const ShowdownTakeoverSchema = z.object({}).strict();
export const ShowdownCardSchema = z.object({ card: z.union([z.literal(''), z.enum(SHOWDOWN_CARDS)]) }).strict();

// ---------------------------------------------------------------------------
// Picker (PCK-01…05, VIS-02, DSP-03): the server draws who answers next; screens only replay it.
//
//   pool at draw time = participants (never the presenter, crew, screens or spectators) who are
//   connected, not hidden, not skipping, not done this round and not in the hot seat.
//   pick     → the server draws with its crypto RNG, the winner takes the hot seat, every screen
//              gets the `pick` event (a pick is public the moment it lands; the stage lands at landAt).
//   done     → the turn counts: out of the pool until the next round (key D).
//   noAnswer → back in the pool, no penalty (key A).
//   reroll   → back in the pool and an immediate redraw without them; logged with a reason.
//   Every act carries the draw number it was made against: a stale or repeated one is ignored.
//   The pool refills when the next round starts (PCK-05 A).
// ---------------------------------------------------------------------------

/** The presenter sees the name at once ("on stage in 2 s"); the stage lands after the sweep. */
export const SHOWDOWN_PICK_LAND_MS = 3500;
/** The presenter may reroll a no-show from here on (the console offers it; the server logs every reroll). */
export const SHOWDOWN_NO_SHOW_MS = 30_000;
export const SHOWDOWN_REROLL_REASONS = ['noAnswer', 'away', 'other'] as const;
export type ShowdownRerollReason = (typeof SHOWDOWN_REROLL_REASONS)[number];
export const SHOWDOWN_REROLL_INFO: Record<ShowdownRerollReason, string> = {
  noAnswer: 'No answer',
  away: 'Not there',
  other: 'Other',
};

const drawNo = z.number().int().min(0).max(1_000_000);
export const ShowdownPickSchema = z.discriminatedUnion('a', [
  /** Draw the next person. `drawNo` = the last draw number the console saw (state.drawNo). */
  z.object({ a: z.literal('pick'), round: z.number().int().min(0).max(1000), drawNo }).strict(),
  /** The hot seat's turn counts (they're out until the next round). */
  z.object({ a: z.literal('done'), drawNo }).strict(),
  /** The hot seat didn't answer: back in the pool. */
  z.object({ a: z.literal('noAnswer'), drawNo }).strict(),
  /** Put the hot seat back and draw again without them, with a reason for the log. */
  z.object({ a: z.literal('reroll'), drawNo, reason: z.enum(SHOWDOWN_REROLL_REASONS) }).strict(),
]);
export type ShowdownPickPayload = z.infer<typeof ShowdownPickSchema>;
export const ShowdownSkipSchema = z.object({ on: z.boolean() }).strict();

/** One seat on the stage's spotlight grid (built on clients from public state). */
export type ShowdownSeatState = 'pool' | 'hot' | 'done' | 'away';

// ---------------------------------------------------------------------------
// Crew (ADM-04 B, JOI-02 C, AUD-02 C): roles as data, checked with one question — "may this person
// <permission>?" — and denied by default. Only event rooms have crew. The presenter's set applies to
// whoever presents right now; crew roles come from personal crew links:
//   - `#crew=<id>.<secret>` in the URL fragment (never sent in a path, never logged), 128+ random bits,
//     stored hashed in room memory, compared in constant time, expiring with the event (24 h),
//     revocable, rate-limited. Claiming a link binds it to that seat (a second device moves it).
//   - Whoever makes the room an event room (loads an event preset) becomes its producer and receives
//     the producer link once, privately.
// ---------------------------------------------------------------------------

export const SHOWDOWN_PERMISSIONS = [
  'presenter.assign',
  'crew.issue',
  'crew.revoke',
  'people.rename',
  'people.hide',
  'picker.run',
  'picker.reroll',
  'audio.station',
  'audit.read',
  'audit.export',
  'preflight.read',
] as const;
export type ShowdownPermission = (typeof SHOWDOWN_PERMISSIONS)[number];

export const SHOWDOWN_CREW_ROLES = ['producer', 'backup', 'moderator'] as const;
export type ShowdownCrewRole = (typeof SHOWDOWN_CREW_ROLES)[number];
/** Roles a producer can hand out (there is one producer link, minted with the event room). */
export const SHOWDOWN_ISSUABLE_ROLES = ['backup', 'moderator'] as const;
export type ShowdownIssuableRole = (typeof SHOWDOWN_ISSUABLE_ROLES)[number];

export const SHOWDOWN_ROLE_INFO: Record<ShowdownCrewRole | 'presenter', { title: string; blurb: string }> = {
  producer: { title: 'Producer', blurb: 'Moves the presenter role, hands out and revokes crew links, moderates names.' },
  presenter: { title: 'Presenter', blurb: 'Runs the show: the answer sheet, the picker and the sound station.' },
  backup: { title: 'Backup presenter', blurb: 'Can take over the show with this link while the presenter is offline.' },
  moderator: { title: 'Moderator', blurb: 'Renames or hides guests from the stage and the picker.' },
};

/** Role presets: data, not code branches. A role missing here has no permissions (deny by default). */
export const SHOWDOWN_ROLE_PERMISSIONS: Record<ShowdownCrewRole | 'presenter', readonly ShowdownPermission[]> = {
  producer: [
    'presenter.assign',
    'crew.issue',
    'crew.revoke',
    'people.rename',
    'people.hide',
    'picker.run',
    'picker.reroll',
    'audio.station',
    'audit.read',
    'audit.export',
    'preflight.read',
  ],
  presenter: ['people.rename', 'people.hide', 'picker.run', 'picker.reroll', 'audio.station', 'audit.read', 'preflight.read'],
  backup: [],
  moderator: ['people.rename', 'people.hide'],
};

/** Effective permissions of a set of roles (unknown roles grant nothing). */
export function permissionsOf(roles: readonly string[]): ShowdownPermission[] {
  const out = new Set<ShowdownPermission>();
  for (const role of roles) {
    const perms = (SHOWDOWN_ROLE_PERMISSIONS as Record<string, readonly ShowdownPermission[] | undefined>)[role];
    if (perms) for (const p of perms) out.add(p);
  }
  return SHOWDOWN_PERMISSIONS.filter((p) => out.has(p));
}

/** A crew link in the address bar: `<id>.<secret>`. */
export const SHOWDOWN_CREW_LINK = /^([A-Za-z0-9_-]{6,24})\.([A-Za-z0-9_-]{22,64})$/;
export const ShowdownCrewClaimSchema = z.object({ link: z.string().min(8).max(100) }).strict();
export const ShowdownCrewIssueSchema = z.object({ role: z.enum(SHOWDOWN_ISSUABLE_ROLES), name: z.string().max(64) }).strict();
export const ShowdownCrewRevokeSchema = z.object({ id: z.string().min(1).max(32) }).strict();
export const ShowdownAssignSchema = z.object({ playerId: z.string().min(1).max(64), reason: z.string().max(200).optional() }).strict();
export const ShowdownRenameSchema = z.object({ playerId: z.string().min(1).max(64), name: z.string().max(64) }).strict();
export const ShowdownHideSchema = z.object({ playerId: z.string().min(1).max(64), on: z.boolean() }).strict();
export const ShowdownEmptySchema = z.object({}).strict();

/** A crew link as the producer sees it (never the secret, except once in `fresh`). */
export interface ShowdownCrewLinkView {
  id: string;
  role: ShowdownCrewRole;
  /** Who it's for ("Dana"), as the producer typed it. */
  name: string;
  /** The seat holding it now ('' = not opened yet, or its holder left). */
  holderId: string;
  holderName: string;
  online: boolean;
  revoked: boolean;
  expiresAt: number;
}

/** One player's crew view. */
export interface ShowdownCrewPrivate {
  /** This is an event room (crew exists here). */
  event: boolean;
  /** Your crew roles (not counting presenting). */
  roles: ShowdownCrewRole[];
  /** What you may do right now (your roles, plus the presenter's set while you present). */
  perms: ShowdownPermission[];
  /** Every crew link (only with `crew.issue`). */
  links: ShowdownCrewLinkView[];
  /** Moderation (only with `people.hide` / `people.rename`): who is hidden from the stage, and who is crew right now. */
  hidden?: string[];
  crewIds?: string[];
  /**
   * A link just minted for you — the producer link when you made the event room, or one you issued.
   * Sent once: keep it on this device (the server keeps only its hash).
   */
  fresh?: { id: string; role: ShowdownCrewRole; name: string; link: string };
}

/** Crew link in the address bar → `/room/<code>#crew=<id>.<secret>`. */
export function crewLinkPath(code: string, link: string): string {
  return `/room/${code}#crew=${link}`;
}

// ---------------------------------------------------------------------------
// Audit (NN-06): per room, append-only, in memory, never synced; crew read it in the console and the
// producer can download it. It leaves with the room.
// ---------------------------------------------------------------------------

export const SHOWDOWN_AUDIT_ACTIONS = [
  'event.start',
  'preset.load',
  'crew.issue',
  'crew.revoke',
  'crew.claim',
  'crew.refused',
  'presenter.claim',
  'presenter.refused',
  'presenter.assign',
  'presenter.handover',
  'presenter.takeover',
  'people.rename',
  'people.hide',
  'people.unhide',
  'picker.draw',
  'picker.done',
  'picker.noAnswer',
  'picker.reroll',
  'audio.station',
  'audio.failover',
  'show.end',
  'show.restored',
] as const;
export type ShowdownAuditAction = (typeof SHOWDOWN_AUDIT_ACTIONS)[number];

export interface ShowdownAuditEntry {
  seq: number;
  at: number;
  /** '' = the server itself (a failover, an automatic end). */
  actorId: string;
  actorName: string;
  /** The actor's role when they acted: 'presenter' | crew role | 'guest' | 'server'. */
  role: string;
  action: ShowdownAuditAction;
  target?: string;
  targetName?: string;
  before?: string;
  after?: string;
  reason?: string;
}

/** Pushed to crew with `audit.read` (the latest entries, newest last). */
export interface ShowdownAuditView {
  entries: ShowdownAuditEntry[];
  total: number;
}

export interface ShowdownAuditFile {
  room: string;
  exportedAt: number;
  entries: ShowdownAuditEntry[];
}

// ---------------------------------------------------------------------------
// Sound station (AUD-02 C): exactly one device plays the show's sound in an event room. Consoles and
// big screens report `audio` every SHOWDOWN_AUDIO_BEAT_MS; the station falls back to the presenter's
// console after SHOWDOWN_STATION_TIMEOUT_MS without a heartbeat, or at once when it disconnects.
// ---------------------------------------------------------------------------

export const SHOWDOWN_AUDIO_BEAT_MS = 2000;
export const SHOWDOWN_STATION_TIMEOUT_MS = 5000;
export const ShowdownAudioSchema = z.object({ ready: z.boolean(), muted: z.boolean(), sounds: z.boolean() }).strict();
export const ShowdownStationSchema = z.object({ playerId: z.string().max(64) }).strict();
/** Public per-device audio status (`audio` map): 1 = can play now, 2 = locked, muted or sounds off. */
export const SHOWDOWN_AUDIO_READY = 1;
export const SHOWDOWN_AUDIO_SILENT = 2;

/** Which device plays show sound on this connection ('' station = the presenter's console). */
export function isSoundStation(
  state: Pick<ShowdownPublicState, 'event' | 'soundStation' | 'presenterId'>,
  playerId: string | null,
): boolean {
  if (!playerId) return false;
  return state.soundStation ? state.soundStation === playerId : state.presenterId === playerId;
}

// ---------------------------------------------------------------------------
// Preflight (OPS-03 B): crew-only server facts for the go/no-go list. `/api/health` stays as it is.
// ---------------------------------------------------------------------------

export interface ShowdownPreflightData {
  at: number;
  uptimeSeconds: number;
  /** When this server process started (server epoch ms). */
  startedAt: number;
  /** The running commit (Render sets RENDER_GIT_COMMIT), '' when unknown. */
  commit: string;
  /** The room is an event room ('' = no). */
  event: string;
  rehearsal: boolean;
  /** Custom rounds loaded, and how many of them have a special answer. */
  rounds: number;
  specials: number;
  /** Crew links issued for backup presenters, and how many of their holders are here right now. */
  backups: { issued: number; online: number };
  station: { playerId: string; name: string; ready: boolean; seenAgoMs: number | null };
  /** Snapshots can be taken (the server has its key). */
  blackbox: boolean;
}

// ---------------------------------------------------------------------------
// Black box (OPS-01 C): an encrypted, authenticated snapshot of an event room. Only the server can
// read it; the presenter's console only carries it and hands it back (CreateOptions.restore) after a
// restart, which recreates the room under the same code. Expires after 24 hours.
// ---------------------------------------------------------------------------

export interface ShowdownBlackBox {
  code: string;
  takenAt: number;
  blob: string;
}

/** Seconds an event room holds the presenter's and crew's seats after a drop. */
export const SHOWDOWN_EVENT_GRACE_SECONDS = 30 * 60;

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
  /**
   * Loading it makes the room an event room for the rest of its life: crew links, the event join
   * screen, the sound station, keep-alive and the black box, the Room DJ lock and the preflight.
   */
  event: boolean;
  /**
   * Its rounds stay out of the public repo: the preset carries settings only, and the presenter loads
   * the boards from a show file (rounds already loaded in the room are kept).
   */
  settingsOnly: boolean;
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
  display: 'auto',
};

export const SHOWDOWN_EVENT_INFO: Record<ShowdownEventId, ShowdownEventInfo> = {
  'dasoween-2026': {
    title: 'DAS-O-Ween 2026',
    blurb:
      'The show’s settings — Presenter Showcase, the Halloween Night look, a celebration on #5 and a 10-minute clock per round. The boards come from your show file.',
    rounds: 2,
    rehearsal: false,
    event: true,
    settingsOnly: true,
    settings: DASOWEEN_SETTINGS,
  },
  'dasoween-rehearsal': {
    title: 'DAS-O-Ween rehearsal',
    blurb:
      'The same show with two practice boards (candy and costumes), so you can try every control without giving the real answers away.',
    rounds: 2,
    rehearsal: true,
    event: true,
    settingsOnly: false,
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
  /** Presenter Showcase: who was in the hot seat when it flipped ("called by Priya S."), only once revealed. */
  calledBy?: string;
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

  // ---- Event rooms ----
  /** The event preset that made this an event room ('' = an ordinary room). */
  event: string;

  // ---- The picker (public: a pick is public the moment it lands; who skipped never is) ----
  /** Draws so far this show (the console sends the last one it saw with every picker act). */
  drawNo: number;
  /** The player in the hot seat ('' = nobody). */
  hotSeat: string;
  /** When the current draw was made / when the stage lands on it (server epoch ms; 0 = no draw). */
  pickAt: number;
  landAt: number;
  /** People who could be drawn right now (not counting the hot seat). */
  poolSize: number;
  /** playerIds whose turn counted this round. */
  done: Record<string, boolean>;
  /** playerIds with a seat on the stage's spotlight grid (participants who aren't hidden). */
  seats: Record<string, boolean>;

  // ---- Sound station (event rooms) ----
  /** The device that plays show sound ('' = the presenter's console). */
  soundStation: string;
  /** Server epoch ms of the station's last heartbeat (0 = none yet). */
  soundSeenAt: number;
  /** playerId → SHOWDOWN_AUDIO_READY | SHOWDOWN_AUDIO_SILENT, for consoles and big screens that report. */
  audio: Record<string, number>;
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
  /**
   * Presenter Showcase picker, private to you (DSP-03 B): `in` = you could be drawn next, `skip` =
   * your Skip me switch, `done` = your turn counted this round. Absent for crew, screens, spectators.
   */
  pool?: { in: boolean; skip: boolean; done: boolean };
  /** You're in the hot seat right now ("You're up!"). */
  picked?: boolean;
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
  | { type: 'reset'; rev: number }
  /** One minute left on the round clock (once per round; AUD-01's tower bell). */
  | { type: 'clockWarn'; rev: number; round: number }
  /** The last ten seconds: n = 10 … 1, one per second (AUD-01's clock "tock"). */
  | { type: 'tick'; rev: number; round: number; n: number }
  /**
   * The picker drew someone (the server already decided; screens replay it). The presenter's console
   * names them at once; the stage sweeps and lands at `landAt` (server epoch ms).
   */
  | { type: 'pick'; rev: number; drawNo: number; winnerId: string; name: string; poolSize: number; landAt: number; reroll: boolean }
  /** The hot seat emptied: their turn counted (done), they're back in the pool (noAnswer/reroll), or a moderator hid them. */
  | { type: 'pickEnd'; rev: number; drawNo: number; playerId: string; how: 'done' | 'noAnswer' | 'reroll' | 'cleared' }
  /** The sound station moved ('' = back to the presenter's console); `lost` = the old station stopped answering. */
  | { type: 'station'; rev: number; playerId: string; lost: boolean };

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
