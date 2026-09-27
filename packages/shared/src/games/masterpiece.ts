/**
 * DASterpiece — shared contract (settings, messages, payloads, public state).
 * Imported by the pure engine (@dascade/game-core/masterpiece), the server room and the client.
 *
 * Built on the DAStravaganza party kit (PartyRoom / PartyPublicView): stages run inside PLAYING,
 * the host pauses / resumes / skips with the kit's `party:host` message, seat deltas + ranks drive
 * the animated score reveal and `podiumJson` carries the final standings (+ awards in `extras`).
 *
 * Flow per round ("exhibition"):
 *   intro → write (players answer their prompts privately) → for each showdown: vote → reveal
 *   → scores → next round … → final (RESULTS).
 *
 * A *showdown* is a group of answers to the same prompt: a head-to-head matchup (2, or 3 when the
 * numbers are odd), or a gallery of up to MP_LIMITS.galleryMax answers voted on by everyone.
 *
 * Anonymity: while a showdown is being voted on, public state carries only the answer texts under
 * opaque random ids in a server-shuffled order. Authors are filled in (`authorId`/`authorName`) only
 * after that showdown's voting has closed and it has been scored. Individual ballots are never
 * published — only per-answer totals after the vote.
 */
import { z } from 'zod';
import type { PartyPublicView } from '../party.ts';
import { cleanText, containsProfanity, maskProfanity, normalizeForCompare } from '../text.ts';

// ---------------------------------------------------------------------------
// Prompt types (round themes)
// ---------------------------------------------------------------------------

export const MP_PROMPT_TYPES = ['caption', 'finish', 'advice', 'definition', 'pitch', 'explain', 'hypothetical', 'story', 'name'] as const;
export type MpBuiltInType = (typeof MP_PROMPT_TYPES)[number];
/** Host-written prompts form their own "House Specials" theme. */
export type MpPromptType = MpBuiltInType | 'custom';

export interface MpPromptTypeInfo {
  /** Round title, e.g. "Terrible Advice". */
  label: string;
  /** Instruction shown above the prompt while writing. */
  instruction: string;
  /** Lead-in shown before the prompt text ("Caption this scene"). */
  lead: string;
  /** Placeholder for the answer box. */
  placeholder: string;
  /** Maximum answer length (code points). */
  maxLength: number;
  /** Answers may use two lines (two-line stories). */
  multiline: boolean;
}

export const MP_PROMPT_TYPE_INFO: Record<MpPromptType, MpPromptTypeInfo> = {
  caption: {
    label: 'Caption Contest',
    instruction: 'Write the funniest caption for this scene.',
    lead: 'Caption this scene',
    placeholder: 'Your caption…',
    maxLength: 90,
    multiline: false,
  },
  finish: {
    label: 'Finish the Sentence',
    instruction: 'Fill in the blank. Short and sharp wins.',
    lead: 'Finish the sentence',
    placeholder: 'Finish it…',
    maxLength: 90,
    multiline: false,
  },
  advice: {
    label: 'Terrible Advice',
    instruction: 'Give advice that is confidently, spectacularly wrong.',
    lead: 'Terrible advice',
    placeholder: 'Your worst advice…',
    maxLength: 100,
    multiline: false,
  },
  definition: {
    label: 'Fake Definitions',
    instruction: 'This word is made up. Define it like it belongs in the dictionary.',
    lead: 'Define this word',
    placeholder: 'Definition…',
    maxLength: 120,
    multiline: false,
  },
  pitch: {
    label: 'The Pitch Room',
    instruction: 'Sell this ridiculous product in one line.',
    lead: 'Pitch this product',
    placeholder: 'Your one-line pitch…',
    maxLength: 100,
    multiline: false,
  },
  explain: {
    label: 'Explain It Badly',
    instruction: 'Explain it with total confidence and zero accuracy.',
    lead: 'Explain it badly',
    placeholder: 'Your explanation…',
    maxLength: 120,
    multiline: false,
  },
  hypothetical: {
    label: 'What If?',
    instruction: 'Answer the hypothetical. Keep it office-friendly.',
    lead: 'What if',
    placeholder: 'Your answer…',
    maxLength: 100,
    multiline: false,
  },
  story: {
    label: 'Two-Line Stories',
    instruction: 'Tell the whole story in two short lines.',
    lead: 'Write a two-line story',
    placeholder: 'Line one…\nLine two…',
    maxLength: 160,
    multiline: true,
  },
  name: {
    label: 'Name That Thing',
    instruction: 'Give it the perfect name.',
    lead: 'Name this',
    placeholder: 'The name…',
    maxLength: 50,
    multiline: false,
  },
  custom: {
    label: 'House Specials',
    instruction: 'A prompt from your host. Make it count.',
    lead: 'House special',
    placeholder: 'Your answer…',
    maxLength: 100,
    multiline: false,
  },
};

// ---------------------------------------------------------------------------
// Voting modes
// ---------------------------------------------------------------------------

/** Host setting. `showtime` rotates the voting style from round to round (see roundKind()). */
export const MP_VOTING_MODES = ['showtime', 'favourite', 'matchups', 'ranked'] as const;
export type MpVotingMode = (typeof MP_VOTING_MODES)[number];

/** How one showdown is voted on. */
export type MpVoteKind = 'favourite' | 'matchup' | 'ranked';

export const MP_VOTE_KIND_INFO: Record<MpVoteKind, { label: string; blurb: string }> = {
  favourite: { label: 'Favourite', blurb: 'Everyone answers the same prompt, then picks their favourite (never their own).' },
  matchup: { label: 'Head-to-Head', blurb: 'Two answers enter, one leaves. The authors sit out while everyone else votes.' },
  ranked: { label: 'Top Three', blurb: 'Rank your three favourites: gold, silver and bronze.' },
};

// ---------------------------------------------------------------------------
// Limits + scoring constants
// ---------------------------------------------------------------------------

export const MP_LIMITS = {
  /** Hard cap on raw answer payloads (before per-type cleaning). */
  answerRaw: 400,
  /** Largest per-type maxLength. */
  answerMax: 160,
  /** Lines allowed in multiline answers. */
  answerLines: 2,
  /** Custom prompt length. */
  customPromptMax: 140,
  /** Custom prompts kept per room. */
  customPromptsMax: 200,
  /** Answers per favourite/ranked gallery (bigger groups are split into several galleries). */
  galleryMax: 10,
  /** Head-to-head: every player answers two prompts up to this many writers, one prompt above it. */
  matchupDoubleMax: 8,
  /** Picks in a ranked ballot. */
  rankedPicks: 3,
  /** Ranked voting needs at least this many answers in a gallery (otherwise it is a favourite vote). */
  rankedMinAnswers: 5,
  /** Opaque id lengths. */
  idLength: 10,
} as const;

export const MP_POINTS = {
  /** Per player vote in favourite + head-to-head showdowns. */
  vote: 100,
  /** Ranked ballots: gold, silver, bronze. */
  ranked: [150, 100, 50] as readonly number[],
  /** Showdown winner (every answer tied for the most vote points > 0). */
  win: 100,
  /** "It's a DASterpiece!" — every player vote that could go to this answer did (min. 2 votes). */
  sweep: 250,
  /** Audience favourite (most audience votes, ties share). */
  audience: 100,
  /** An answer left unopposed because the other author(s) never answered. */
  walkover: 100,
  /** Sweeps need at least this many votes. */
  sweepMinVotes: 2,
} as const;

// ---------------------------------------------------------------------------
// Text cleaning (server authoritative; the client uses the same rules for counters)
// ---------------------------------------------------------------------------

/**
 * Cleans an answer for a prompt type: strips control/invisible characters, collapses whitespace,
 * masks profanity (platform policy, as in chat) and bounds the length. Two-line stories keep at
 * most two non-empty lines. Returns '' when nothing usable is left.
 */
export function sanitizeAnswer(raw: unknown, type: MpPromptType): string {
  if (typeof raw !== 'string') return '';
  const info = MP_PROMPT_TYPE_INFO[type];
  const bounded = Array.from(raw).slice(0, MP_LIMITS.answerRaw).join('');
  let text: string;
  if (info.multiline) {
    const lines = bounded
      .split(/\r\n|\r|\n|\u{2028}|\u{2029}/u)
      .map((line) => cleanText(line, info.maxLength))
      .filter((line) => line.length > 0)
      .slice(0, MP_LIMITS.answerLines);
    text = lines.join('\n');
  } else {
    text = cleanText(bounded, info.maxLength);
  }
  if (Array.from(text).length > info.maxLength) text = Array.from(text).slice(0, info.maxLength).join('').trim();
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(text)) return '';
  return maskProfanity(text);
}

/** Length the client counts against maxLength (code points, newlines included). */
export function answerLength(text: string): number {
  return Array.from(text).length;
}

export interface CustomPromptReport {
  prompts: string[];
  /** Entries that were empty or too short. */
  invalid: number;
  duplicates: number;
  /** Entries dropped because they tripped the profanity filter. */
  filtered: number;
  /** Entries beyond MP_LIMITS.customPromptsMax. */
  overflow: number;
}

/** Cleans a custom prompt list: one line each, de-duplicated, profanity-filtered, capped. */
export function cleanCustomPrompts(input: readonly unknown[]): CustomPromptReport {
  const seen = new Set<string>();
  const prompts: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  let filtered = 0;
  let overflow = 0;
  for (const raw of input) {
    const text = cleanText(raw, MP_LIMITS.customPromptMax);
    const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    if (letters < 3) {
      if (text) invalid++;
      continue;
    }
    const key = normalizeForCompare(text);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (containsProfanity(text)) {
      filtered++;
      continue;
    }
    if (prompts.length >= MP_LIMITS.customPromptsMax) {
      overflow++;
      continue;
    }
    seen.add(key);
    prompts.push(text);
  }
  return { prompts, invalid, duplicates, filtered, overflow };
}

/** Splits a pasted prompt list: one prompt per line. */
export function splitPromptList(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Placeholder a prompt may contain; replaced by a random player's name when the prompt is dealt. */
export const MP_PLAYER_TOKEN = '{player}';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const MasterpieceSettingsSchema = z.object({
  /** Exhibitions (rounds) in a match. */
  rounds: z.number().int().min(1).max(5),
  votingMode: z.enum(MP_VOTING_MODES),
  /** Built-in round themes in rotation. */
  promptTypes: z
    .array(z.enum(MP_PROMPT_TYPES))
    .max(MP_PROMPT_TYPES.length)
    .refine((list) => new Set(list).size === list.length, 'Round types must be unique'),
  /** Use only the host's custom prompts. */
  customOnly: z.boolean(),
  /** Writing time per prompt a player has to answer. */
  writeSeconds: z.number().int().min(30).max(180),
  /** Voting time per showdown (ranked ballots get 10 s extra). */
  voteSeconds: z.number().int().min(10).max(60),
  /** Players may change their vote until they lock it in (otherwise a cast vote is final). */
  allowVoteChange: z.boolean(),
  /** Spectators vote as the audience; the audience favourite earns a bonus. */
  audienceVote: z.boolean(),
  /** The final exhibition scores double. */
  doubleFinal: z.boolean(),
});
export type MasterpieceSettings = z.infer<typeof MasterpieceSettingsSchema>;

export const DEFAULT_MASTERPIECE_SETTINGS: MasterpieceSettings = {
  rounds: 3,
  votingMode: 'showtime',
  promptTypes: [...MP_PROMPT_TYPES],
  customOnly: false,
  writeSeconds: 60,
  voteSeconds: 20,
  allowVoteChange: false,
  audienceVote: true,
  doubleFinal: true,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MASTERPIECE_MSG = {
  /** client → server: answer one of my prompts {showdownId, text}. Final once accepted. */
  submit: 'masterpiece:submit',
  /** client → server: ballot for the current showdown {showdownId, picks}. */
  vote: 'masterpiece:vote',
  /** client → server: lock my ballot (only meaningful when vote changes are allowed). */
  lock: 'masterpiece:lock',
  /**
   * client → server (host, lobby/results): replace the custom prompt list {prompts}.
   * server → host only: the stored list + cleaning report (MpPromptsPrivate).
   */
  prompts: 'masterpiece:prompts',
  /** server → one client: private view (MpPrivate). */
  private: 'masterpiece:private',
  /** server → all: public events for sound + animation (MpGameEvent). */
  event: 'masterpiece:event',
} as const;

const opaqueId = z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/u);

export const MpSubmitSchema = z.object({ showdownId: opaqueId, text: z.string().max(MP_LIMITS.answerRaw * 2) });
export type MpSubmitPayload = z.infer<typeof MpSubmitSchema>;
export const MpVoteSchema = z.object({ showdownId: opaqueId, picks: z.array(opaqueId).min(1).max(MP_LIMITS.rankedPicks) });
export type MpVotePayload = z.infer<typeof MpVoteSchema>;
export const MpLockSchema = z.object({ showdownId: opaqueId });
export const MpPromptsSchema = z.object({ prompts: z.array(z.string().max(MP_LIMITS.customPromptMax * 2)).max(MP_LIMITS.customPromptsMax * 2) });

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

export interface MpAssignment {
  showdownId: string;
  type: MpPromptType;
  prompt: string;
  /** This player's accepted answer (null until submitted). */
  answer: string | null;
}

export type MpRole = 'writer' | 'audience' | 'spectator';

export interface MpBallotView {
  showdownId: string;
  picks: string[];
  locked: boolean;
}

/** Private per-player view (re-sent on join/reconnect and whenever it changes). */
export interface MpPrivate {
  round: number;
  role: MpRole;
  /** Prompts this player answers this round (writers only). */
  assignments: MpAssignment[];
  /** Current showdown (vote/reveal) or ''. */
  showdownId: string;
  /** Ids of this player's own answers in the current showdown (to grey them out). */
  ownAnswerIds: string[];
  /** Whether this player may vote on the current showdown. */
  canVote: boolean;
  /**
   * Why not (for the UI): 'author' = head-to-head author, 'spectator' = audience voting is off,
   * 'device' = this browser/account already holds a seat or cast an audience vote (one audience
   * vote per device, never a sock-puppet vote for your own answer).
   */
  voteBlock: '' | 'author' | 'spectator' | 'late' | 'device';
  /** This player's ballot in the current showdown. */
  ballot: MpBallotView | null;
}

/** Host-only copy of the custom prompt list. */
export interface MpPromptsPrivate {
  prompts: string[];
  report: Omit<CustomPromptReport, 'prompts'>;
}

export type MpGameEvent =
  | { type: 'round'; round: number; totalRounds: number; roundType: MpPromptType; kind: MpVoteKind; multiplier: number }
  | { type: 'write'; round: number }
  | { type: 'submitted'; playerId: string; done: boolean }
  | { type: 'vote'; round: number; index: number }
  | { type: 'reveal'; round: number; index: number; winners: string[]; sweep: boolean; walkover: boolean }
  | { type: 'scores'; round: number };

// ---------------------------------------------------------------------------
// Public state (state.toJSON())
// ---------------------------------------------------------------------------

export type MpStage = 'idle' | 'intro' | 'write' | 'vote' | 'reveal' | 'scores' | 'final';

/** Stages the host may skip (kit `party:host` skip). */
export const MP_SKIPPABLE_STAGES: readonly MpStage[] = ['intro', 'write', 'vote', 'reveal', 'scores'];

export interface MpAnswerView {
  /** Opaque, random per showdown. */
  id: string;
  text: string;
  /** Empty placeholder for an author who never answered (head-to-head walkovers only). */
  blank: boolean;
  /** Player ballots that picked it (any rank) — 0 until revealed. */
  votes: number;
  /** Ranked: first-choice votes. */
  firsts: number;
  audienceVotes: number;
  points: number;
  /** '' until the showdown is scored. */
  authorId: string;
  authorName: string;
  winner: boolean;
  sweep: boolean;
  audiencePick: boolean;
}

export interface MpHallEntry {
  round: number;
  type: MpPromptType;
  prompt: string;
  text: string;
  authorId: string;
  authorName: string;
  votes: number;
  points: number;
  sweep: boolean;
}

export type MpAwardId = 'crowd' | 'sweeper' | 'audience' | 'quick' | 'consistent';

/** `PartyPodium.extras` for DASterpiece. */
export interface MpPodiumExtras {
  awards: MpAward[];
  sweeps: number;
  showdowns: number;
}

export interface MpAward {
  id: MpAwardId;
  playerId: string;
  name: string;
  /** Human-readable stat, e.g. "14 votes". */
  value: string;
}

export interface MasterpiecePublicState extends PartyPublicView {
  stage: MpStage;
  roundType: MpPromptType | '';
  /** The round's voting style (a small ranked gallery falls back to favourite). */
  roundKind: MpVoteKind | '';
  multiplier: number;
  /** Prompts each writer answers this round. */
  perWriter: number;
  /** Answers submitted so far this round, per writer (never what they wrote). */
  written: Record<string, number>;
  /** Showdowns this round (known after writing). */
  showdownCount: number;
  /** 0-based index of the current showdown. */
  showdownIndex: number;
  showdownId: string;
  voteKind: MpVoteKind | '';
  prompt: string;
  promptType: MpPromptType | '';
  /** An unopposed answer (no vote). */
  walkover: boolean;
  answers: MpAnswerView[];
  /** Player ballots cast in the current showdown. */
  votesIn: number;
  /**
   * Seated players who can vote on this showdown (head-to-head: minus its answers' authors). Purely
   * structural — it never depends on who is connected, so it can't hint at who sits out.
   */
  votersExpected: number;
  audienceIn: number;
  /** Spectators may vote as the audience this match. */
  audienceOpen: boolean;
  /** JSON MpHallEntry[]: every scored showdown's winning answer(s), for the results gallery. */
  hallJson: string;
  /** Usable custom prompts. The prompts themselves stay private to the host. */
  customCount: number;
}
