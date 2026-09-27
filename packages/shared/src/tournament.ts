/**
 * Tournament Center — shared contract (server ⇄ kiosk client ⇄ match rooms).
 *
 * Games declare what the Tournament Center may do with them through
 * `GameCatalogEntry.tournament` (see catalog.ts). The pure engine lives in
 * `@dascade/game-core/tournament`; the kiosk room is the `tournament` game on the server.
 *
 * Creating a tournament: `create('tournament', { settings: <TournamentConfig>, roomName })`.
 * The config IS the kiosk room's settings (validated by `TournamentConfigSchema`, published
 * in `settingsJson`). The creator becomes the organizer; later edits go through
 * `tournament:admin { action: 'updateConfig' }` (the generic `lobby:settings` is refused).
 *
 * Everything below is safe for clients: secrets (participant/organizer tokens, match
 * tickets) only ever travel in the private `tournament:me` message.
 *
 * Schemas are built through PURE-annotated thunks (like protocol.ts) so bundles that only
 * need the constants/types can drop zod.
 */
import { z } from 'zod';
import { GAME_CATALOG, isGameId, type GameId } from './catalog.ts';
import { LIMITS, type BaseRoomView } from './protocol.ts';

const lazy = <T>(build: () => T): T => build();

// ===========================================================================
// Vocabulary
// ===========================================================================

export const TOURNAMENT_FORMATS = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export const TOURNAMENT_FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
};

export const TOURNAMENT_FORMAT_BLURBS: Record<TournamentFormat, string> = {
  single_elimination: 'Lose once and you are out. Fast, dramatic, one champion.',
  double_elimination: 'Everyone gets a second life in the losers bracket. The grand final can be reset.',
  round_robin: 'Everyone plays everyone once. The fairest table — best for small groups.',
  swiss: 'A fixed number of rounds; you always meet someone on your score. Great for big fields.',
};

/** What the Tournament Center may do with a game. Absent on games that can't be played in tournaments. */
export interface TournamentCapability {
  formats: readonly TournamentFormat[];
  /** Allowed series lengths (games per match), e.g. [1, 3, 5]. */
  bestOf: readonly number[];
  /** Largest field (participants) allowed for this game. */
  maxField: number;
  /** A single game can end drawn (chess, checkers, putt ties). */
  draws: boolean;
  /** Seats have a side/colour that should be balanced across a series and across Swiss rounds (chess white/black). */
  sides: boolean;
}

/** Tournament lifecycle. `paused` is a separate flag (IN_PROGRESS only). */
export const TOURNAMENT_STATUSES = ['DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  DRAFT: 'Draft',
  REGISTRATION: 'Registration open',
  CHECK_IN: 'Check-in open',
  READY: 'Ready to start',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
};

/**
 * Match lifecycle.
 * WAITING: participants not known yet (feeder matches unfinished) or tournament paused.
 * READY: both participants known; a match room exists (`roomCode`) and tickets were issued.
 * IN_PROGRESS: the first game of the series started.
 * COMPLETE: decided by play, a bye or an organizer override. FORFEIT: decided without play (no-show, DQ, withdrawal).
 * VOID: will never be played (empty bracket slot, unneeded grand-final reset, cancelled tournament).
 */
export const MATCH_STATUSES = ['WAITING', 'READY', 'IN_PROGRESS', 'COMPLETE', 'FORFEIT', 'VOID'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** A match in one of these statuses is final (never changes again unless an organizer override amends it). */
export const FINISHED_MATCH_STATUSES: readonly MatchStatus[] = ['COMPLETE', 'FORFEIT', 'VOID'];

export const SEEDING_METHODS = ['random', 'manual', 'rating'] as const;
export type SeedingMethod = (typeof SEEDING_METHODS)[number];
export const SEEDING_LABELS: Record<SeedingMethod, string> = {
  random: 'Random draw',
  manual: 'Organizer order',
  rating: 'DASCADE rating',
};

/**
 * registered → (checked_in) → active → eliminated | champion; or withdrawn / disqualified / no_show.
 * `no_show` = missed check-in (never entered the field).
 */
export const PARTICIPANT_STATUSES = ['registered', 'checked_in', 'active', 'eliminated', 'champion', 'withdrawn', 'disqualified', 'no_show'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/** Which part of the event a match belongs to. Round robin and Swiss use `main`; single elimination uses `winners`. */
export const TOURNAMENT_BRACKETS = ['winners', 'losers', 'grand_final', 'grand_final_reset', 'main'] as const;
export type TournamentBracket = (typeof TOURNAMENT_BRACKETS)[number];

/**
 * How a finished match was decided.
 * played · bye (walkover: empty slot) · forfeit (no-show / organizer forfeit) · dq (disqualification or withdrawal)
 * · double_forfeit (neither side can play) · override (organizer decision, see audit) · lots (tied after all
 * decider games, drawn by the server's crypto RNG) · void (never played).
 */
export const MATCH_RESULT_KINDS = ['played', 'bye', 'forfeit', 'dq', 'double_forfeit', 'override', 'lots', 'void'] as const;
export type MatchResultKind = (typeof MATCH_RESULT_KINDS)[number];

export type TournamentSide = 'first' | 'second';

// ===========================================================================
// Series rules (documented once, shown in the UI)
// ===========================================================================

/**
 * Series scoring: a win is 1 point, a draw ½ to each side. A best-of-N stops as soon as the leader
 * can't be caught. Sides alternate every game (game 1 side is balanced by colour history).
 *
 * Tied after N games (possible with draws, or an even N such as a chess best-of-2 mini-match):
 *  - round robin / Swiss: the match is drawn (½ match point each);
 *  - elimination: decider games. Decider 1 is sudden death; decider 2 is sudden death again, and for
 *    games with sides it is ARMAGEDDON — a draw counts as a win for the `second` side (Black).
 *    If a side-less game is still level after both deciders, the winner is drawn by lot (server
 *    crypto RNG, written to the audit log).
 */
export const SERIES_DECIDER_GAMES = 2;

export const SERIES_RULES_TEXT = [
  'A win scores 1 point in the series, a draw ½ each. The series stops as soon as it is decided.',
  'Sides alternate every game.',
  'Round robin and Swiss: a level series is a drawn match (½ point each).',
  'Elimination: a level series goes to sudden-death decider games; in games with sides the last decider is Armageddon (a draw wins for the second player).',
] as const;

/** "1½", "2", "½" — series/tournament points with a proper half glyph. */
export function formatPoints(points: number): string {
  const whole = Math.floor(points + 1e-9);
  const half = points - whole > 0.25;
  if (whole === 0 && half) return '½';
  return `${whole}${half ? '½' : ''}`;
}

// ===========================================================================
// Tiebreaks (RR / Swiss standings)
// ===========================================================================

export const TIEBREAK_IDS = ['buchholz_cut1', 'buchholz', 'sonneborn_berger', 'direct_encounter', 'wins', 'progressive'] as const;
export type TiebreakId = (typeof TIEBREAK_IDS)[number];

export interface TiebreakDefinition {
  id: TiebreakId;
  /** Column header, e.g. "BH-C1". */
  short: string;
  name: string;
  /** Plain-language explanation for the standings help. */
  explanation: string;
}

export const TIEBREAKS: Record<TiebreakId, TiebreakDefinition> = {
  buchholz_cut1: {
    id: 'buchholz_cut1',
    short: 'BH-C1',
    name: 'Buchholz Cut 1',
    explanation: "Your opponents' final scores added up, leaving out the lowest one — so one weak opponent doesn't drag you down.",
  },
  buchholz: {
    id: 'buchholz',
    short: 'BH',
    name: 'Buchholz',
    explanation: "Your opponents' final scores added up. Higher means you faced tougher opposition. A round without an opponent (bye or forfeit) counts your own score.",
  },
  sonneborn_berger: {
    id: 'sonneborn_berger',
    short: 'SB',
    name: 'Sonneborn-Berger',
    explanation: "For every opponent you beat, add their final score; for every draw, add half of it. Beating strong players counts more than beating weak ones.",
  },
  direct_encounter: {
    id: 'direct_encounter',
    short: 'H2H',
    name: 'Head-to-head',
    explanation: 'If all the tied players played each other, whoever scored more in those matches ranks higher.',
  },
  wins: {
    id: 'wins',
    short: 'W',
    name: 'Wins',
    explanation: 'Number of matches won (byes do not count).',
  },
  progressive: {
    id: 'progressive',
    short: 'Prog',
    name: 'Progressive score',
    explanation: 'Your running score after each round, added together. Early wins count more — it rewards leading from the front.',
  },
};

/** Tiebreaks in the order they are applied, per format (elimination brackets rank by how far you went). */
export const FORMAT_TIEBREAKS: Record<TournamentFormat, readonly TiebreakId[]> = {
  single_elimination: [],
  double_elimination: [],
  round_robin: ['direct_encounter', 'wins', 'sonneborn_berger'],
  swiss: ['buchholz_cut1', 'buchholz', 'sonneborn_berger', 'direct_encounter', 'wins', 'progressive'],
};

/** Shown under the standings: what happens when every tiebreak is equal. */
export const FINAL_TIEBREAK_TEXT = 'Still level after every tiebreak? The players share the place; the list shows the better seed first.';

// ===========================================================================
// Configuration (= the kiosk room's settings)
// ===========================================================================

export const TOURNAMENT_LIMITS = {
  name: 48,
  nameRaw: 120,
  minField: 2,
  /** Absolute ceiling regardless of game capability. */
  maxField: 64,
  swissRoundsMax: 15,
  checkInMinutesMax: 240,
  noShowMinutesMax: 60,
  reason: 200,
  reasonRaw: 400,
  /** JSON size of `gameSettings`. */
  gameSettingsBytes: 4096,
  /** Audit entries kept in public state (older ones stay in persistence only). */
  audit: 200,
  participantName: LIMITS.nickname,
  token: 64,
  id: 40,
  requestId: 40,
} as const;

export interface TournamentConfig {
  /** Display name (also the kiosk room name). */
  name: string;
  /** Must be a tournament-capable game (`GAME_CATALOG[gameId].tournament`). */
  gameId: GameId;
  format: TournamentFormat;
  /** Games per match; one of the game's `tournament.bestOf`. */
  bestOf: number;
  /** Maximum participants (≤ the game's `tournament.maxField`). */
  maxField: number;
  /** Seeding applied at `begin` when the organizer hasn't seeded explicitly. */
  seeding: SeedingMethod;
  /** Require participants to check in before the start. */
  checkIn: boolean;
  /** Check-in window once opened (minutes). 0 = open until the organizer closes it / begins. */
  checkInMinutes: number;
  /** Swiss only: number of rounds. 0 = automatic (⌈log2 N⌉, at least 3 when the field allows). */
  swissRounds: number;
  /** Double elimination only: if the losers-bracket champion wins the grand final, play a reset match. */
  grandFinalReset: boolean;
  /** Minutes an absent participant has after their match room opens (or between series games) before they forfeit. 0 = never. */
  noShowMinutes: number;
  /** `public` tournaments appear in GET /api/tournaments; `unlisted` ones are joined by code only. */
  visibility: 'public' | 'unlisted';
  /** Settings forwarded to every match room (merged over the game's defaults, validated by the game room). */
  gameSettings: Record<string, unknown>;
}

export function defaultTournamentConfig(gameId: GameId = 'chess'): TournamentConfig {
  const cap = GAME_CATALOG[gameId]?.tournament;
  const bestOf = cap?.bestOf.includes(1) ? 1 : (cap?.bestOf[0] ?? 1);
  return {
    name: `${GAME_CATALOG[gameId]?.title ?? 'DASCADE'} Open`.slice(0, TOURNAMENT_LIMITS.name),
    gameId,
    format: cap?.formats[0] ?? 'single_elimination',
    bestOf,
    maxField: Math.min(16, cap?.maxField ?? 16),
    seeding: 'random',
    checkIn: false,
    checkInMinutes: 10,
    swissRounds: 0,
    grandFinalReset: true,
    noShowMinutes: 5,
    visibility: 'public',
    gameSettings: {},
  };
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = /* @__PURE__ */ defaultTournamentConfig('chess');

/** Why a config is not valid for its game (null = fine). Used by the schema and the create wizard. */
export function tournamentConfigProblem(config: Pick<TournamentConfig, 'gameId' | 'format' | 'bestOf' | 'maxField'>): string | null {
  if (!isGameId(config.gameId)) return 'Unknown game.';
  const cap = GAME_CATALOG[config.gameId].tournament;
  if (!cap) return `${GAME_CATALOG[config.gameId].title} can't be played in tournaments.`;
  if (!cap.formats.includes(config.format)) return `${TOURNAMENT_FORMAT_LABELS[config.format]} isn't available for this game.`;
  if (!cap.bestOf.includes(config.bestOf)) return `Best of ${config.bestOf} isn't available for this game (choose ${cap.bestOf.join(', ')}).`;
  if (config.maxField > cap.maxField) return `This game allows at most ${cap.maxField} participants.`;
  return null;
}

const TOURNAMENT_GAME_IDS = /* @__PURE__ */ lazy(
  () => Object.values(GAME_CATALOG).filter((g) => g.tournament !== undefined).map((g) => g.id) as [GameId, ...GameId[]],
);

const ConfigShape = /* @__PURE__ */ lazy(() => ({
  name: z.string().trim().min(1).max(TOURNAMENT_LIMITS.nameRaw),
  gameId: z.enum(TOURNAMENT_GAME_IDS),
  format: z.enum(TOURNAMENT_FORMATS),
  bestOf: z.number().int().min(1).max(9),
  maxField: z.number().int().min(TOURNAMENT_LIMITS.minField).max(TOURNAMENT_LIMITS.maxField),
  seeding: z.enum(SEEDING_METHODS),
  checkIn: z.boolean(),
  checkInMinutes: z.number().int().min(0).max(TOURNAMENT_LIMITS.checkInMinutesMax),
  swissRounds: z.number().int().min(0).max(TOURNAMENT_LIMITS.swissRoundsMax),
  grandFinalReset: z.boolean(),
  noShowMinutes: z.number().int().min(0).max(TOURNAMENT_LIMITS.noShowMinutesMax),
  visibility: z.enum(['public', 'unlisted']),
  gameSettings: z
    .record(z.string().max(40), z.unknown())
    .refine((v) => JSON.stringify(v).length <= TOURNAMENT_LIMITS.gameSettingsBytes, 'Game settings are too large.'),
}));

/** The complete, validated tournament config (checks the game's tournament capability too). */
export const TournamentConfigSchema = /* @__PURE__ */ lazy(() =>
  z.object(ConfigShape).superRefine((config, ctx) => {
    const problem = tournamentConfigProblem(config);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['format'] });
  }),
);

/** Partial config patch for `updateConfig` (merged over the current config, then re-validated in full). */
export const TournamentConfigPatchSchema = /* @__PURE__ */ lazy(() => z.object(ConfigShape).partial());

// ===========================================================================
// Messages
// ===========================================================================

export const TOURNAMENT_MSG = {
  /** client → server `{ name? }`: register the viewer as a participant (REGISTRATION; CHECK_IN when late entry allowed). */
  register: 'tournament:register',
  /** client → server `{ token }`: re-bind this viewer to a participant after a refresh / on another device. */
  claim: 'tournament:claim',
  /** client → server `{ token }`: re-claim organizer powers (e.g. after returning from a match room). */
  claimOrganizer: 'tournament:claimOrganizer',
  /** client → server `{}`: check in (CHECK_IN, bound participant only). */
  checkIn: 'tournament:checkIn',
  /** client → server `{ confirm: true }`: leave the tournament (forfeits remaining matches once started). */
  withdraw: 'tournament:withdraw',
  /** client → server `TournamentAdminAction`: organizer console (organizer only). */
  admin: 'tournament:admin',
  /** server → ONE client: `TournamentMe` (tokens, tickets). Re-sent on reconnect (syncPrivate) and on every change. */
  me: 'tournament:me',
  /** server → client: `TournamentAck` result of register/claim/checkIn/withdraw/admin. */
  ack: 'tournament:ack',
  /** server → everyone: `TournamentEvent` for toasts, sounds and animations. State is the source of truth. */
  event: 'tournament:event',
} as const;

const RequestId = /* @__PURE__ */ lazy(() => z.string().max(TOURNAMENT_LIMITS.requestId).optional());
const Id = /* @__PURE__ */ lazy(() => z.string().min(1).max(TOURNAMENT_LIMITS.id));
const Token = /* @__PURE__ */ lazy(() => z.string().min(8).max(TOURNAMENT_LIMITS.token));
const Reason = /* @__PURE__ */ lazy(() => z.string().trim().min(3).max(TOURNAMENT_LIMITS.reasonRaw));

export const TournamentRegisterSchema = /* @__PURE__ */ lazy(() =>
  z.object({ name: z.string().max(64).optional(), requestId: RequestId }).optional(),
);
export const TournamentClaimSchema = /* @__PURE__ */ lazy(() => z.object({ token: Token, requestId: RequestId }));
export const TournamentCheckInSchema = /* @__PURE__ */ lazy(() => z.object({ requestId: RequestId }).optional());
export const TournamentWithdrawSchema = /* @__PURE__ */ lazy(() => z.object({ confirm: z.literal(true), requestId: RequestId }));

/**
 * Organizer actions. Destructive ones require `confirm: true` and a `reason` (3–200 chars, written to the audit log).
 * - updateConfig: DRAFT → READY (gameId only in DRAFT; maxField ≥ current entries).
 * - openRegistration: DRAFT/READY → REGISTRATION. closeRegistration: → CHECK_IN (check-in on) or READY.
 * - openCheckIn: REGISTRATION/READY → CHECK_IN (deadline = now + checkInMinutes). closeCheckIn: → READY (unchecked = no_show).
 * - checkInParticipant: organizer checks someone in/out during CHECK_IN.
 * - seed: REGISTRATION..READY; `order` (participant ids, best first) required for `manual`.
 * - begin: REGISTRATION/CHECK_IN/READY with ≥ 2 eligible participants → IN_PROGRESS (seeds if needed).
 * - pause/resume: IN_PROGRESS — pausing stops NEW matches/rounds from starting; live matches continue.
 * - forfeit: a READY/IN_PROGRESS match; `participantId` loses it (stays in the event).
 * - disqualify: removes a participant (before start: from the field; after: remaining matches forfeited).
 * - override: decide a match by hand (`outcome` win|draw|double_forfeit; draw only in RR/Swiss). Allowed while
 *   the match is unfinished, or finished with no dependent match started yet.
 * - relaunchMatch: close a stuck match room and open a fresh one (series score is kept).
 * - end: finish now (RR/Swiss standings stand; unfinished matches become VOID). cancel: CANCELLED.
 */
export const TournamentAdminSchema = /* @__PURE__ */ lazy(() =>
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('updateConfig'), config: TournamentConfigPatchSchema, requestId: RequestId }),
    z.object({ action: z.literal('openRegistration'), requestId: RequestId }),
    z.object({ action: z.literal('closeRegistration'), requestId: RequestId }),
    z.object({ action: z.literal('openCheckIn'), requestId: RequestId }),
    z.object({ action: z.literal('closeCheckIn'), requestId: RequestId }),
    z.object({ action: z.literal('checkInParticipant'), participantId: Id, checkedIn: z.boolean(), requestId: RequestId }),
    z.object({
      action: z.literal('seed'),
      method: z.enum(SEEDING_METHODS),
      order: z.array(Id).max(TOURNAMENT_LIMITS.maxField).optional(),
      requestId: RequestId,
    }),
    z.object({ action: z.literal('begin'), requestId: RequestId }),
    z.object({ action: z.literal('pause'), requestId: RequestId }),
    z.object({ action: z.literal('resume'), requestId: RequestId }),
    z.object({ action: z.literal('forfeit'), matchId: Id, participantId: Id, reason: Reason, requestId: RequestId }),
    z.object({ action: z.literal('disqualify'), participantId: Id, reason: Reason, confirm: z.literal(true), requestId: RequestId }),
    z.object({
      action: z.literal('override'),
      matchId: Id,
      outcome: z.enum(['win', 'draw', 'double_forfeit']),
      winnerId: Id.optional(),
      reason: Reason,
      confirm: z.literal(true),
      requestId: RequestId,
    }),
    z.object({ action: z.literal('relaunchMatch'), matchId: Id, requestId: RequestId }),
    z.object({ action: z.literal('end'), reason: Reason, confirm: z.literal(true), requestId: RequestId }),
    z.object({ action: z.literal('cancel'), reason: Reason, confirm: z.literal(true), requestId: RequestId }),
  ]),
);
export type TournamentAdminAction = z.infer<typeof TournamentAdminSchema>;
export type TournamentAdminActionName = TournamentAdminAction['action'];

// ===========================================================================
// Server → client payloads
// ===========================================================================

/** `tournament:me` — private to one viewer. */
export interface TournamentMe {
  isOrganizer: boolean;
  /** Only sent to the organizer's own client: store it (per tournament code) to reclaim the console later. */
  organizerToken: string | null;
  /** The participant this viewer is bound to (register / claim), else null. */
  participantId: string | null;
  /** Only sent to the bound participant's own client(s): store it per tournament code and `claim` with it on return. */
  participantToken: string | null;
  /** The participant's playable match (a participant is never in two active matches). */
  activeMatch: TournamentActiveMatch | null;
}

export interface TournamentActiveMatch {
  matchId: string;
  gameId: GameId;
  /** Live match room code (join it with `{ ticket }` to take your seat; without it you spectate). */
  roomCode: string;
  ticket: string;
  label: string;
  opponentId: string | null;
  opponentName: string;
  /** Your side in the current game, when the game has sides. */
  side: TournamentSide | null;
}

export interface TournamentAck {
  /** Echo of the request's `requestId` (when given). */
  requestId?: string;
  /** Message type or admin action name. */
  action: string;
  ok: boolean;
  message: string;
}

export type TournamentEventKind =
  | 'status'
  | 'registered'
  | 'withdrawn'
  | 'round_started'
  | 'match_ready'
  | 'match_started'
  | 'game_result'
  | 'match_complete'
  | 'champion'
  | 'paused'
  | 'resumed'
  | 'override'
  | 'disqualified';

export interface TournamentEvent {
  kind: TournamentEventKind;
  text: string;
  matchId?: string;
  participantId?: string;
  round?: number;
}

// ===========================================================================
// Public (synchronized) kiosk state — `room.state.toJSON()` of the `tournament` room
// ===========================================================================

/** One participant (`state.participants[id]`). */
export interface TournamentParticipantView {
  id: string;
  name: string;
  avatar: string;
  /** 1 = top seed; 0 = not seeded yet. */
  seed: number;
  status: ParticipantStatus;
  checkedIn: boolean;
  /** DASCADE rating for the tournament's game (snapshot, refreshed until the start). Internal rating — not FIDE. */
  rating: number;
  provisional: boolean;
  /** Registration order (1-based). */
  entry: number;
  /** A kiosk viewer is currently bound to this participant. */
  online: boolean;
  /** Final place once decided (elimination: when knocked out; RR/Swiss: at completion). 0 = not yet. */
  place: number;
  /** Match points (RR/Swiss: win 1, draw ½, bye 1 in Swiss). Elimination: matches won. */
  points: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  /** READY / IN_PROGRESS match id ('' = none). */
  currentMatchId: string;
}

/** One match (`state.matches[id]`). Slot A/B are the two sides of the pairing. */
export interface TournamentMatchView {
  id: string;
  bracket: TournamentBracket;
  /** 1-based round within its bracket. */
  round: number;
  /** 0-based position within its round (bracket order, top to bottom). */
  order: number;
  /** "Semifinal · Match 2", "Losers round 3 · Match 1", "Grand final", "Round 4 · Board 2". */
  label: string;
  /** "Semifinal", "Losers round 3", "Swiss round 2". */
  roundLabel: string;
  status: MatchStatus;
  /** Participant ids ('' = unknown yet or empty slot). */
  aId: string;
  bId: string;
  /** What fills the slot while unknown: "Seed 4", "Winner of W1-2", "Loser of W2-1", "Bye". */
  aLabel: string;
  bLabel: string;
  /** Feeder match ids for bracket connectors ('' = seeded directly). */
  aFrom: string;
  bFrom: string;
  /** 'winner' | 'loser' of the feeder ('' = seed). */
  aFromTake: string;
  bFromTake: string;
  /** Where the winner / loser goes next ('' = nowhere). Slots are 'a' | 'b'. */
  nextMatchId: string;
  nextSlot: string;
  loserNextMatchId: string;
  loserNextSlot: string;
  /** Grand-final reset: only played if the losers-bracket champion wins the grand final. */
  conditional: boolean;
  bestOf: number;
  /** Game currently being played (or the last one played); 0 before the first game. */
  gameNumber: number;
  /** Series points (win 1, draw ½). */
  aPoints: number;
  bPoints: number;
  /** JSON `TournamentGameRecord[]`. */
  gamesJson: string;
  winnerId: string;
  loserId: string;
  /** A drawn match (RR/Swiss only). */
  draw: boolean;
  resultKind: MatchResultKind | '';
  /** Short human note: "No-show", "Armageddon", "Decided by lot", "Organizer decision". */
  resultNote: string;
  /** Participant with the `first` side in game 1 ('' for games without sides). */
  firstId: string;
  /** Current game is a decider: '' | 'sudden_death' | 'armageddon'. */
  decider: string;
  /** Live match room ('' = none). Anyone may spectate by joining it without a ticket. */
  roomCode: string;
  /** Participant is connected to the match room. */
  aPresent: boolean;
  bPresent: boolean;
  /** Server epoch ms when an absent participant forfeits (0 = no timer running). */
  noShowAt: number;
  startedAt: number;
  completedAt: number;
}

export interface TournamentGameRecord {
  /** 1-based game number in the series (numbers above bestOf are deciders). */
  n: number;
  /** Winning participant id, or null for a draw. */
  winnerId: string | null;
  /** Participant who had the `first` side (null for games without sides). */
  firstId: string | null;
  decider: '' | 'sudden_death' | 'armageddon';
  /** Game-reported reason ('checkmate', 'resign', 'timeout'…). */
  reason: string;
  at: number;
}

/** A round / stage for headers (`roundsJson`). */
export interface TournamentRoundView {
  bracket: TournamentBracket;
  round: number;
  label: string;
  /** 'pending' (not paired / not reachable yet), 'active', 'complete'. */
  status: 'pending' | 'active' | 'complete';
  /** Swiss: participant who received the bye this round (''). */
  byeId: string;
}

/** One standings row (`standingsJson`). Elimination: rank = final place (0 while still alive). */
export interface TournamentStandingRow {
  participantId: string;
  rank: number;
  /** Same rank as another row (every tiebreak equal). */
  shared: boolean;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  /** Sum of series game points (e.g. 2½ from a 2½–½ result). */
  gamePoints: number;
  tiebreaks: Partial<Record<TiebreakId, number>>;
  /** Elimination: where they went out, e.g. "Losers round 3". */
  eliminatedIn: string;
}

export interface TournamentStandings {
  format: TournamentFormat;
  /** Tiebreaks in the order applied (definitions in TIEBREAKS). */
  tiebreaks: TiebreakId[];
  /** True once the tournament is complete (ranks are final). */
  final: boolean;
  rows: TournamentStandingRow[];
}

export type TournamentAuditActor = 'organizer' | 'system' | 'participant';

/** Audit log entry (`auditJson`, newest last). Public — no secrets. */
export interface TournamentAuditEntry {
  id: number;
  at: number;
  actor: TournamentAuditActor;
  /** Machine action: 'override', 'forfeit', 'disqualify', 'no_show', 'lots', 'seed', 'begin', 'pause', 'relaunch'… */
  action: string;
  /** Human sentence. */
  text: string;
  reason?: string;
  matchId?: string;
  participantId?: string;
}

/**
 * Kiosk public state as seen by clients. Participants and matches are Schema maps (delta-synced, so
 * a 64-player bracket costs bytes per change, not kilobytes); the rest are small JSON strings.
 * Use `tournamentViewFromState()` to get one parsed, UI-friendly object.
 */
export interface TournamentPublicState extends BaseRoomView {
  status: TournamentStatus;
  paused: boolean;
  /** Room player id of the connected organizer ('' while they're away). */
  organizerId: string;
  organizerName: string;
  /** Seeding method applied ('' = not seeded yet). */
  seedingMethod: SeedingMethod | '';
  /** RR/Swiss: current round (1-based). Elimination: highest round with a live match. */
  currentRound: number;
  totalRounds: number;
  championId: string;
  /** Server epoch ms when check-in closes automatically (0 = no deadline). */
  checkInEndsAt: number;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  participants: Record<string, TournamentParticipantView>;
  matches: Record<string, TournamentMatchView>;
  /** JSON TournamentRoundView[]. */
  roundsJson: string;
  /** JSON TournamentStandings. */
  standingsJson: string;
  /** JSON TournamentAuditEntry[]. */
  auditJson: string;
}

/** Parsed, sorted view of the kiosk state for UIs. */
export interface TournamentView {
  code: string;
  config: TournamentConfig;
  status: TournamentStatus;
  paused: boolean;
  organizerId: string;
  organizerName: string;
  seedingMethod: SeedingMethod | '';
  currentRound: number;
  totalRounds: number;
  championId: string | null;
  checkInEndsAt: number;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  /** Seed order when seeded, else registration order. */
  participants: TournamentParticipantView[];
  /** Sorted by bracket (winners, losers, grand final, reset, main), round, order. */
  matches: TournamentMatchView[];
  rounds: TournamentRoundView[];
  standings: TournamentStandings;
  tiebreaks: TiebreakDefinition[];
  audit: TournamentAuditEntry[];
}

const BRACKET_ORDER: Record<TournamentBracket, number> = { winners: 0, losers: 1, grand_final: 2, grand_final_reset: 3, main: 4 };

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Build the UI view from `room.state.toJSON()` of a tournament kiosk (memoize per state version). */
export function tournamentViewFromState(state: TournamentPublicState): TournamentView {
  const config = { ...DEFAULT_TOURNAMENT_CONFIG, ...parseJson<Partial<TournamentConfig>>(state.settingsJson, {}) };
  const participants = Object.values(state.participants ?? {}).sort(
    (a, b) => (a.seed || 1e6) - (b.seed || 1e6) || a.entry - b.entry,
  );
  const matches = Object.values(state.matches ?? {}).sort(
    (a, b) => BRACKET_ORDER[a.bracket] - BRACKET_ORDER[b.bracket] || a.round - b.round || a.order - b.order,
  );
  const standings = parseJson<TournamentStandings>(state.standingsJson, { format: config.format, tiebreaks: [], final: false, rows: [] });
  return {
    code: state.code,
    config,
    status: state.status,
    paused: state.paused,
    organizerId: state.organizerId,
    organizerName: state.organizerName,
    seedingMethod: state.seedingMethod,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    championId: state.championId || null,
    checkInEndsAt: state.checkInEndsAt,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    participants,
    matches,
    rounds: parseJson<TournamentRoundView[]>(state.roundsJson, []),
    standings,
    tiebreaks: standings.tiebreaks.map((id) => TIEBREAKS[id]).filter(Boolean),
    audit: parseJson<TournamentAuditEntry[]>(state.auditJson, []),
  };
}

/** Parsed games of a match view. */
export function matchGames(match: Pick<TournamentMatchView, 'gamesJson'>): TournamentGameRecord[] {
  return parseJson<TournamentGameRecord[]>(match.gamesJson, []);
}

// ===========================================================================
// HTTP: GET /api/tournaments
// ===========================================================================

export interface TournamentListing {
  code: string;
  name: string;
  gameId: GameId;
  format: TournamentFormat;
  status: TournamentStatus;
  paused: boolean;
  bestOf: number;
  /** Entries still in the event (excludes withdrawn / disqualified / no-show). */
  participants: number;
  checkedIn: number;
  maxField: number;
  checkIn: boolean;
  currentRound: number;
  totalRounds: number;
  /** "Semifinal", "Swiss round 3", "Registration open"… */
  stageLabel: string;
  organizerName: string;
  /** Kiosk viewers connected right now. */
  viewers: number;
  liveMatches: number;
  createdAt: number;
}

export interface TournamentListResponse {
  tournaments: TournamentListing[];
}

// ===========================================================================
// Match rooms (any tournament-capable game)
// ===========================================================================

/**
 * Tournament binding of a game room created by the Tournament Center for one match.
 * Published (as JSON) in the room's `tournamentJson` state field, so clients can show
 * "Semifinal · Game 1 of 3" and the series score. Game rooms read it via `this.tournamentMatch`.
 */
export interface TournamentMatchInfo {
  tournamentCode: string;
  tournamentName: string;
  matchId: string;
  /** Human label, e.g. "Winners round 2", "Grand final", "Swiss round 3". */
  roundLabel: string;
  format: TournamentFormat;
  bestOf: number;
  /** 1-based number of the game currently being played in this series (numbers above bestOf are deciders). */
  gameNumber: number;
  /** The current game is a decider (elimination only): '' | 'sudden_death' | 'armageddon' (a draw wins for `second`). */
  decider?: '' | 'sudden_death' | 'armageddon';
  /** Series points so far keyed by participantId (win 1, draw ½ each — see SERIES rules). */
  seriesScore: Record<string, number>;
  /**
   * Series progress inside the match room:
   * waiting (for both participants), playing, intermission (between games — next game auto-starts at
   * `nextGameAt`), decided (see `result`), void (cancelled by the tournament; nothing is recorded).
   */
  seriesStatus?: 'waiting' | 'playing' | 'intermission' | 'decided' | 'void';
  /** Server epoch ms when the next game starts automatically (intermission), else 0. */
  nextGameAt?: number;
  /** Set once the series is decided. `winnerId` null = drawn match (RR/Swiss). */
  result?: { winnerId: string | null; kind: MatchResultKind; note: string } | null;
  participants: Array<{
    participantId: string;
    name: string;
    seed: number;
    /** The room's logical player id once this participant has joined (null before). */
    playerId: string | null;
    /** Side for the CURRENT game when the game has sides: 'first' = moves first (white in chess). */
    side?: TournamentSide;
  }>;
}
