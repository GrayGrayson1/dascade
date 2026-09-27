/**
 * DASwords — shared contract (settings, messages, payloads, public state, scoring tables, rule text).
 * Imported by the engine (@dascade/game-core/words), the server room and the client.
 *
 * Four modes, one match = several rounds of the host's chosen mode:
 *  - grid       Letter Grid: trace or type words through touching tiles (4×4 or 5×5, Qu tile).
 *  - anagram    Anagram Sprint: make words from one rack of letters that always hides a long word.
 *  - chain      Word Chain: simultaneous links — everyone answers the same link at once.
 *  - forbidden  Forbidden Letter: name things in a category without using the banned letter.
 *
 * The dictionary is server-side only; clients never receive word lists, answer keys or other
 * players' words before a reveal.
 */
import { z } from 'zod';
import type { PartyPublicView } from '../party.ts';

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export const WORDS_MODES = ['grid', 'anagram', 'chain', 'forbidden'] as const;
export type WordsMode = (typeof WORDS_MODES)[number];

export interface WordsModeInfo {
  title: string;
  tagline: string;
  /** Plain-language rules (rules drawer + intro card). */
  rules: string[];
}

export const WORDS_MODE_INFO: Record<WordsMode, WordsModeInfo> = {
  grid: {
    title: 'Letter Grid',
    tagline: 'Trace words through touching tiles.',
    rules: [
      'Make words from letters that touch — sideways, up/down or diagonally.',
      'Each tile can be used once per word. Drag across the tiles or type the word.',
      'The Qu tile counts as two letters: “quiz” is 4 letters on 3 tiles.',
      'Longer words score much more. Words are checked against the DASwords dictionary.',
    ],
  },
  anagram: {
    title: 'Anagram Sprint',
    tagline: 'One rack. One hidden long word. Go.',
    rules: [
      'Build words from the letters on the rack — each letter once per word.',
      'The rack always hides at least one word that uses every letter.',
      'Longer words score more; rare words and words nobody else found score extra.',
    ],
  },
  chain: {
    title: 'Word Chain',
    tagline: 'Everyone answers every link.',
    rules: [
      'Your word must start with the last letter of the current word (or its last two letters, if the host chose that rule).',
      'Everyone answers the same link at the same time. No repeats: a word played once is burned.',
      'Miss a link (no valid word in time) and you lose a heart. Out of hearts? You watch until the next chain.',
      'The longest answer becomes the next link and earns its author a Link bonus.',
    ],
  },
  forbidden: {
    title: 'Forbidden Letter',
    tagline: 'Name it without the banned letter.',
    rules: [
      'Name as many things in the category as you can — without using the forbidden letter.',
      'Every word must be a real dictionary word; answers of up to three words are fine.',
      'Answers the game already knows fit the category are approved instantly; others go to the host.',
      'Answers nobody else gave score double.',
    ],
  },
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const WORDS_LIMITS = {
  /** Raw characters in one submission. */
  input: 40,
  /** Accepted words a player can bank in one round (anti-flood; far above human pace). */
  maxWords: 300,
  /** Rejected attempts kept in a player's private list. */
  maxRejects: 40,
  /** Words per player shown in a round reveal. */
  revealWords: 80,
  /** Missed words listed in a reveal. */
  missed: 18,
  /** Words in a multi-word Forbidden Letter answer. */
  phraseWords: 3,
  /** Pending answers the host can review in one round. */
  reviewItems: 300,
} as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const CHAIN_RULES = ['last', 'last2'] as const;
export type ChainRule = (typeof CHAIN_RULES)[number];

export const REVIEW_MODES = ['host', 'trust'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const WordsSettingsSchema = z.object({
  mode: z.enum(WORDS_MODES),
  /** Rounds per match (chains in Word Chain). */
  rounds: z.number().int().min(1).max(8),
  /** 0 = free-for-all, otherwise the number of teams (2–4). */
  teams: z.number().int().min(0).max(4).refine((n) => n !== 1, 'Pick 0 (free-for-all) or 2–4 teams'),
  // Letter Grid
  gridSize: z.union([z.literal(4), z.literal(5)]),
  gridSeconds: z.number().int().min(60).max(300),
  gridMinLength: z.number().int().min(3).max(4),
  /** Classic rule: words found by more than one player (or team) score nothing. */
  uniqueOnly: z.boolean(),
  // Anagram Sprint
  rackSize: z.number().int().min(6).max(8),
  anagramSeconds: z.number().int().min(45).max(180),
  // Word Chain
  chainRule: z.enum(CHAIN_RULES),
  chainLives: z.number().int().min(1).max(5),
  chainSeconds: z.number().int().min(8).max(30),
  chainMinLength: z.number().int().min(3).max(6),
  chainLinks: z.number().int().min(5).max(30),
  // Forbidden Letter
  forbiddenSeconds: z.number().int().min(30).max(180),
  review: z.enum(REVIEW_MODES),
  reviewSeconds: z.number().int().min(15).max(120),
});
export type WordsSettings = z.infer<typeof WordsSettingsSchema>;

export const DEFAULT_WORDS_SETTINGS: WordsSettings = {
  mode: 'grid',
  rounds: 3,
  teams: 0,
  gridSize: 4,
  gridSeconds: 120,
  gridMinLength: 3,
  uniqueOnly: false,
  rackSize: 7,
  anagramSeconds: 90,
  chainRule: 'last',
  chainLives: 3,
  chainSeconds: 15,
  chainMinLength: 3,
  chainLinks: 12,
  forbiddenSeconds: 60,
  review: 'host',
  reviewSeconds: 40,
};

// ---------------------------------------------------------------------------
// Scoring (shown in the UI exactly as applied by the server)
// ---------------------------------------------------------------------------

/** Points by word length (Letter Grid, Anagram Sprint, Word Chain). Qu counts as two letters. */
export const WORD_LENGTH_POINTS: ReadonlyArray<{ length: number; points: number; label: string }> = [
  { length: 3, points: 1, label: '3' },
  { length: 4, points: 2, label: '4' },
  { length: 5, points: 3, label: '5' },
  { length: 6, points: 5, label: '6' },
  { length: 7, points: 8, label: '7' },
  { length: 8, points: 11, label: '8' },
  { length: 9, points: 15, label: '9+' },
];

export function lengthPoints(length: number): number {
  if (length < 3) return 0;
  let points = 0;
  for (const row of WORD_LENGTH_POINTS) if (length >= row.length) points = row.points;
  return points;
}

export const ANAGRAM_BONUS = {
  /** Word outside the everyday vocabulary (the dictionary's rare tier). */
  rare: 2,
  /** Uses every letter on the rack. */
  fullRack: 5,
  /** Nobody else (no other team) found it: base points ×2. */
  uniqueMultiplier: 2,
} as const;

export const CHAIN_BONUS = {
  /** Your answer became the next link. */
  link: 2,
  /** Still standing when the chain ends (multiplayer). */
  survivor: 3,
} as const;

export const FORBIDDEN_POINTS = {
  /** Approved answer. */
  answer: 2,
  /** Extra when nobody else (no other team) gave it. */
  unique: 2,
} as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const WORDS_MSG = {
  /** client → server: { round, word, path? } */
  submit: 'words:submit',
  /** host → server: { round, id, verdict } */
  review: 'words:review',
  /** host → server: { round, verdict } — decide every remaining answer and end the review. */
  reviewAll: 'words:reviewAll',
  /** server → player: WordsPrivate (own entries; re-sent on reconnect). */
  private: 'words:private',
  /** server → all: WordsEvent (animation cues). */
  event: 'words:event',
} as const;

export const WordsSubmitSchema = z.object({
  round: z.number().int().min(0).max(10_000),
  word: z.string().min(1).max(WORDS_LIMITS.input),
  /** Letter Grid: traced tile indices (validated by the server; typed words omit it). */
  path: z.array(z.number().int().min(0).max(24)).min(1).max(25).optional(),
});
export type WordsSubmitPayload = z.infer<typeof WordsSubmitSchema>;

export const REVIEW_VERDICTS = ['accept', 'reject'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const WordsReviewSchema = z.object({
  round: z.number().int().min(0).max(10_000),
  id: z.string().min(1).max(16),
  verdict: z.enum(REVIEW_VERDICTS),
});
export type WordsReviewPayload = z.infer<typeof WordsReviewSchema>;

export const WordsReviewAllSchema = z.object({
  round: z.number().int().min(0).max(10_000),
  verdict: z.enum(REVIEW_VERDICTS),
});
export type WordsReviewAllPayload = z.infer<typeof WordsReviewAllSchema>;

// ---------------------------------------------------------------------------
// Private entries
// ---------------------------------------------------------------------------

export const WORDS_REJECT_REASONS = [
  'too_short',
  'too_long',
  'not_word',
  'not_on_grid',
  'letters',
  'duplicate',
  'blocked',
  'forbidden_letter',
  'wrong_start',
  'used',
  'too_many',
  'category',
  'eliminated',
  'answered',
] as const;
export type WordsRejectReason = (typeof WORDS_REJECT_REASONS)[number];

export const WORDS_REJECT_TEXT: Record<WordsRejectReason, string> = {
  too_short: 'Too short',
  too_long: 'Too long',
  not_word: 'Not in the dictionary',
  not_on_grid: 'Can’t be traced on the grid',
  letters: 'Uses letters that aren’t on the rack',
  duplicate: 'Already played',
  blocked: 'Not allowed in DASwords',
  forbidden_letter: 'Uses the forbidden letter',
  wrong_start: 'Doesn’t link to the chain',
  used: 'Already used in this chain',
  too_many: 'Word limit reached',
  category: 'Host said it doesn’t fit',
  eliminated: 'You’re out of hearts',
  answered: 'You already answered this link',
};

export type WordsEntryStatus = 'ok' | 'pending' | 'rejected';

export interface WordsEntry {
  /** Short id (review references it). */
  id: string;
  /** Display text (lowercase; blocked words arrive masked, e.g. "f***"). */
  word: string;
  status: WordsEntryStatus;
  reason?: WordsRejectReason;
  /** Provisional points (final points arrive with the reveal). */
  points: number;
  /** Letter Grid: tiles used (for the found-word highlight). */
  path?: number[];
  /** Anagram: outside the everyday vocabulary. */
  rare?: boolean;
  /** Anagram: uses every letter. */
  full?: boolean;
  /** Forbidden Letter: auto-approved as a known category member. */
  known?: boolean;
}

export interface WordsPrivate {
  /** state.round this list belongs to (stale lists are ignored). */
  round: number;
  /** Chain link the `chainAnswer` belongs to. */
  link: number;
  entries: WordsEntry[];
  /** Increments with every verdict (the client animates new ones). */
  seq: number;
  /** The latest verdict (drives the inline feedback line). */
  last: { word: string; ok: boolean; pending: boolean; reason?: WordsRejectReason; points: number } | null;
  /** Word Chain: my accepted answer for the current link. */
  chainAnswer: string | null;
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

/**
 * Stages (state.stage):
 *  intro      round card (mode, round, rules) — 4 s
 *  play       Letter Grid / Anagram / Forbidden answer window
 *  review     Forbidden Letter: host approves/rejects answers the game couldn't place
 *  link       Word Chain: everyone answers the current link
 *  linkReveal Word Chain: this link's answers, hearts lost, the next link
 *  reveal     round results
 *  final      podium (RESULTS phase)
 */
export type WordsStage = 'idle' | 'intro' | 'play' | 'review' | 'link' | 'linkReveal' | 'reveal' | 'final';

export interface WordsSeatProgress {
  /** Accepted words so far this round (never which). */
  found: number;
  /** Word Chain hearts left. */
  lives: number;
  /** Word Chain: out of hearts this chain. */
  out: boolean;
}

export interface WordsPublicState extends PartyPublicView {
  mode: WordsMode;
  /** Letter Grid tiles (row-major, lowercase, "qu" for the Qu tile). Empty outside play/reveal. */
  grid: string[];
  gridSize: number;
  minLength: number;
  /** Anagram rack (scrambled, lowercase). */
  rack: string;
  /** Number of valid words in the puzzle (grid / rack); 0 = not applicable. */
  possible: number;
  /** Forbidden Letter round. */
  category: string;
  categoryHint: string;
  forbidden: string;
  /** Word Chain. */
  chainWord: string;
  chainPrefix: string;
  chainLink: number;
  chainLinks: number;
  chainRule: string;
  /** JSON ChainTrailItem[] — the chosen links so far this chain. */
  chainJson: string;
  /** JSON ChainLinkReveal of the last finished link ('' otherwise). */
  linkJson: string;
  progress: Record<string, WordsSeatProgress>;
  /** JSON WordsReviewItem[] during the review stage (anonymous). */
  reviewJson: string;
  /** JSON WordsRoundReveal for the last finished round. */
  revealJson: string;
  /** JSON WordsRoundSummary[] for the final screen. */
  historyJson: string;
}

export interface ChainTrailItem {
  link: number;
  word: string;
  /** Author (empty for the starter word or a DASwords fallback word). */
  playerId: string;
  name: string;
}

export interface ChainLinkReveal {
  link: number;
  /** The word players linked from and the letters they needed. */
  from: string;
  prefix: string;
  answers: Array<{ playerId: string; word: string; points: number; maker: boolean; shared: boolean }>;
  /** Lost a heart this link. */
  missed: string[];
  /** Ran out of hearts this link. */
  eliminated: string[];
  /** Next link word ('' when the chain ended). */
  next: string;
  /** DASwords picked the next word because nobody linked. */
  fallback: boolean;
}

export interface WordsReviewItem {
  id: string;
  text: string;
  /** How many players gave it (authors stay hidden until the reveal). */
  count: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface WordsRevealWord {
  w: string;
  /** Final points credited for it. */
  p: number;
  /** Only this player/team found it. */
  u?: 1;
  /** Found by others too (crossed out when "unique only" is on). */
  s?: 1;
  /** A teammate found it first (no points for this entry). */
  t?: 1;
  /** Rare word (Anagram). */
  r?: 1;
  /** Uses every letter (Anagram). */
  f?: 1;
  /** Forbidden Letter: rejected by the host. */
  x?: 1;
  /** Forbidden Letter: accepted by the host (not a known category member). */
  h?: 1;
}

export interface WordsRevealPlayer {
  id: string;
  name: string;
  teamId: string;
  points: number;
  count: number;
  best: string;
  words: WordsRevealWord[];
}

export interface WordsRoundReveal {
  round: number;
  mode: WordsMode;
  players: WordsRevealPlayer[];
  /** Everyday words nobody found (grid / anagram), longest first. */
  missed: string[];
  possible: number;
  found: number;
  /** Anagram: every word using the whole rack. */
  seeds: string[];
  /** Longest valid word played this round and who played it. */
  longest: { word: string; playerIds: string[] } | null;
  /** Forbidden Letter context. */
  category?: string;
  forbidden?: string;
  /** Word Chain: links played and survivors. */
  links?: number;
  survivors?: string[];
}

export interface WordsRoundSummary {
  round: number;
  mode: WordsMode;
  label: string;
  best: { word: string; name: string; points: number } | null;
}

export type WordsEvent =
  | { type: 'round'; round: number; mode: WordsMode }
  | { type: 'play'; round: number }
  | { type: 'link'; round: number; link: number }
  | { type: 'linkReveal'; round: number; link: number; eliminated: string[] }
  | { type: 'reveal'; round: number }
  | { type: 'timeUp'; round: number };

// ---------------------------------------------------------------------------
// Client helpers (pure, tiny)
// ---------------------------------------------------------------------------

/** Tile label for display ("qu" → "Qu", others upper-case). */
export function tileLabel(tile: string): string {
  return tile === 'qu' ? 'Qu' : tile.toUpperCase();
}

/** Whether two tile indices touch on an n×n board (8-way). */
export function tilesTouch(a: number, b: number, size: number): boolean {
  if (a === b) return false;
  return Math.abs(Math.floor(a / size) - Math.floor(b / size)) <= 1 && Math.abs((a % size) - (b % size)) <= 1;
}

/** The letters a Word Chain answer must start with. */
export function chainPrefixOf(word: string, rule: ChainRule): string {
  return rule === 'last2' ? word.slice(-2) : word.slice(-1);
}

/** Round length in seconds for the answer window of a mode. */
export function roundSeconds(settings: WordsSettings): number {
  switch (settings.mode) {
    case 'grid':
      return settings.gridSeconds;
    case 'anagram':
      return settings.anagramSeconds;
    case 'forbidden':
      return settings.forbiddenSeconds;
    case 'chain':
      return settings.chainSeconds;
  }
}
