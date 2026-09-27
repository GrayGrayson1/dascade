/**
 * DAS Survey — shared contract (settings, messages, payloads, public state).
 * Imported by the pure engine (@dascade/game-core/survey), the server room and the client.
 *
 * The game: everyone answers a question ANONYMOUSLY, then predicts how the group answered.
 *   - Majority Mind         — pick your answer, then predict the room's majority option.
 *   - Rank the Room         — vote for your favourite, then predict the final ordering by votes.
 *   - Guess the Percentage  — answer, then predict what % of the room picked the target option.
 *   - Custom Survey         — the host writes the questions (any of the three kinds).
 *
 * Anonymity (see docs in the room + README of the game):
 *   - Individual answers never enter synchronized state or any broadcast. Only the answering
 *     player receives their own answer back (private message). Public state carries "who has
 *     answered" flags (never what), and aggregate tallies once answering has closed.
 *   - A question is only revealed when at least SURVEY_LIMITS.minRespondents players answered;
 *     otherwise it is voided (no tallies, no points). Small rooms get a clear on-screen note.
 *   - The server discards raw answers as soon as the tally is computed.
 */
import { z } from 'zod';
import type { PartyPublicView } from '../party.ts';
import { cleanText, maskProfanity, normalizeForCompare } from '../text.ts';

// ---------------------------------------------------------------------------
// Modes + packs
// ---------------------------------------------------------------------------

/** The three kinds of question. */
export const SURVEY_QUESTION_MODES = ['majority', 'rank', 'percent'] as const;
export type SurveyQuestionMode = (typeof SURVEY_QUESTION_MODES)[number];

/** Game modes the host picks in the lobby. */
export const SURVEY_GAME_MODES = ['mixed', 'majority', 'rank', 'percent', 'custom'] as const;
export type SurveyGameMode = (typeof SURVEY_GAME_MODES)[number];

export const SURVEY_MODE_INFO: Record<SurveyQuestionMode, { title: string; short: string; predictVerb: string; blurb: string }> = {
  majority: {
    title: 'Majority Mind',
    short: 'Majority',
    predictVerb: 'Which answer did MOST of the room pick?',
    blurb: 'Answer for yourself, then call the room’s most popular pick.',
  },
  rank: {
    title: 'Rank the Room',
    short: 'Rank',
    predictVerb: 'Put the options in order, most votes first.',
    blurb: 'Vote for your favourite, then predict the final ranking.',
  },
  percent: {
    title: 'Guess the Percentage',
    short: 'Percent',
    predictVerb: 'What percentage of the room picked it?',
    blurb: 'Answer, then guess what share of the room agreed.',
  },
};

export const SURVEY_GAME_MODE_INFO: Record<SurveyGameMode, { title: string; blurb: string }> = {
  mixed: { title: 'Mixed', blurb: 'A shuffled mix of all three question types.' },
  majority: { title: 'Majority Mind', blurb: SURVEY_MODE_INFO.majority.blurb },
  rank: { title: 'Rank the Room', blurb: SURVEY_MODE_INFO.rank.blurb },
  percent: { title: 'Guess the Percentage', blurb: SURVEY_MODE_INFO.percent.blurb },
  custom: { title: 'Custom Survey', blurb: 'Your own questions, asked in the order you wrote them.' },
};

export const SURVEY_PACK_IDS = ['office', 'food', 'weekend', 'tech', 'whatif', 'travel'] as const;
export type SurveyPackId = (typeof SURVEY_PACK_IDS)[number];

export const SURVEY_PACK_INFO: Record<SurveyPackId, { title: string; blurb: string }> = {
  office: { title: 'Office Life', blurb: 'Meetings, desks, inboxes and the team fridge.' },
  food: { title: 'Food & Drink', blurb: 'Snacks, lunches and the great condiment debates.' },
  weekend: { title: 'Weekends & Habits', blurb: 'Mornings, hobbies and everyday quirks.' },
  tech: { title: 'Tech & Gadgets', blurb: 'Phones, passwords, tabs and chargers.' },
  whatif: { title: 'What If…', blurb: 'Hypotheticals, superpowers and silly dilemmas.' },
  travel: { title: 'Travel & Places', blurb: 'Trips, commutes, seats and suitcases.' },
};

// ---------------------------------------------------------------------------
// Limits + scoring constants
// ---------------------------------------------------------------------------

export const SURVEY_LIMITS = {
  /** Prompt length (characters, after cleaning). */
  promptMax: 140,
  promptMin: 3,
  optionMax: 48,
  /** Options per question kind. */
  options: {
    majority: { min: 2, max: 4 },
    rank: { min: 3, max: 5 },
    percent: { min: 2, max: 4 },
  } satisfies Record<SurveyQuestionMode, { min: number; max: number }>,
  /** Largest option count of any kind (payload bounds). */
  optionsAbsMax: 5,
  customQuestions: 30,
  /** A question is revealed only when at least this many players answered (anonymity floor). */
  minRespondents: 3,
  /** Below this many answers, results show a "small room" anonymity note. */
  smallRoomNote: 5,
} as const;

export const SURVEY_SCORING = {
  /** Majority Mind: predicted a top option (ties: every tied leader counts). */
  majorityCorrect: 1000,
  /** Majority Mind: correct AND fewer than half of the predictors got it. */
  majorityCalledIt: 250,
  /** Rank the Room: max points, minus a fixed amount per spot off (see rankStepPoints). */
  rankMax: 1000,
  /** Rank the Room: a perfect order. */
  rankPerfect: 250,
  /** Guess the Percentage: max accuracy points; lose `percentPerPoint` per percentage point off. */
  percentMax: 1000,
  percentPerPoint: 20,
  /** Guess the Percentage: the closest prediction(s) in the room (ties: all of them). */
  percentClosest: 250,
} as const;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface SurveyQuestion {
  /** Pack id ('office-m-01') or 'custom-<n>'. */
  id: string;
  mode: SurveyQuestionMode;
  prompt: string;
  options: string[];
  /** Guess the Percentage: the option whose share players predict. Omitted for other kinds. */
  target?: number;
  pack: SurveyPackId | 'custom';
}

/** Raw custom question as the host's editor sends it (bounded; cleaned by validateCustomSurvey). */
export const SurveyCustomQuestionSchema = z.object({
  mode: z.enum(SURVEY_QUESTION_MODES),
  prompt: z.string().max(400),
  options: z.array(z.string().max(160)).max(8),
  target: z.number().int().min(0).max(7).optional(),
});
export type SurveyCustomQuestionInput = z.infer<typeof SurveyCustomQuestionSchema>;

export const SurveyCustomSchema = z.object({
  questions: z.array(SurveyCustomQuestionSchema).max(SURVEY_LIMITS.customQuestions * 2),
});
export type SurveyCustomPayload = z.infer<typeof SurveyCustomSchema>;

export interface SurveyCustomIssue {
  /** 0-based question index in the submitted list. */
  index: number;
  field: 'prompt' | 'options' | 'target' | 'list';
  message: string;
}

export interface SurveyCustomReport {
  questions: SurveyQuestion[];
  issues: SurveyCustomIssue[];
  /** Submitted questions dropped because they were invalid or over the limit. */
  dropped: number;
}

/**
 * Cleans and validates a custom survey. Every string is sanitized (control/invisible characters
 * removed, whitespace collapsed, profanity masked) and bounded; option counts are checked per
 * kind; duplicate options (case/accent-insensitive) are rejected. Invalid questions are dropped
 * and reported with a human-readable reason. Pure and isomorphic: the editor runs it for live
 * feedback and the server runs it authoritatively.
 */
export function validateCustomSurvey(input: readonly SurveyCustomQuestionInput[]): SurveyCustomReport {
  const questions: SurveyQuestion[] = [];
  const issues: SurveyCustomIssue[] = [];
  let dropped = 0;
  let overflowReported = false;
  input.forEach((raw, index) => {
    const problem = (field: SurveyCustomIssue['field'], message: string) => {
      issues.push({ index, field, message });
      dropped++;
    };
    if (questions.length >= SURVEY_LIMITS.customQuestions) {
      dropped++;
      if (!overflowReported) {
        overflowReported = true;
        issues.push({ index, field: 'list', message: `Only the first ${SURVEY_LIMITS.customQuestions} questions are kept.` });
      }
      return;
    }
    const prompt = maskProfanity(cleanText(raw.prompt, SURVEY_LIMITS.promptMax));
    if (Array.from(prompt).length < SURVEY_LIMITS.promptMin || !/[\p{L}\p{N}]/u.test(prompt)) {
      return problem('prompt', 'Write a question (at least 3 characters).');
    }
    const range = SURVEY_LIMITS.options[raw.mode];
    const cleaned = raw.options.map((o) => maskProfanity(cleanText(o, SURVEY_LIMITS.optionMax)));
    // Blank options are dropped, so the percent target (an index into the SUBMITTED options) must
    // be re-mapped — otherwise a blank row above it would silently retarget the question.
    const kept = cleaned.map((o, i) => ({ o, i })).filter((x) => x.o.length > 0);
    const options = kept.map((x) => x.o);
    if (options.length < range.min) return problem('options', `Add at least ${range.min} options.`);
    if (options.length > range.max) return problem('options', `Use at most ${range.max} options for this kind of question.`);
    const keys = options.map((o) => normalizeForCompare(o) || o);
    if (new Set(keys).size !== keys.length) return problem('options', 'Each option must be different.');
    const question: SurveyQuestion = { id: `custom-${questions.length + 1}`, mode: raw.mode, prompt, options, pack: 'custom' };
    if (raw.mode === 'percent') {
      const target = kept.findIndex((x) => x.i === (raw.target ?? 0));
      if (target < 0) return problem('target', 'Pick which option players guess the percentage of.');
      question.target = target;
    }
    questions.push(question);
  });
  return { questions, issues, dropped };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SurveySettingsSchema = z.object({
  mode: z.enum(SURVEY_GAME_MODES),
  /** Questions per game (custom mode: capped by the custom list length). */
  questions: z.number().int().min(3).max(30),
  /** Built-in packs the questions come from (ignored in custom mode). */
  packs: z
    .array(z.enum(SURVEY_PACK_IDS))
    .max(SURVEY_PACK_IDS.length)
    .refine((list) => new Set(list).size === list.length, 'Packs must be unique'),
  /** Seconds to answer. */
  answerSeconds: z.number().int().min(10).max(90),
  /** Seconds to predict once answering has closed. */
  predictSeconds: z.number().int().min(10).max(90),
  /** Seconds the results stay up before the next question (the host can skip ahead). */
  revealSeconds: z.number().int().min(6).max(30),
});
export type SurveySettings = z.infer<typeof SurveySettingsSchema>;

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  mode: 'mixed',
  questions: 10,
  packs: [...SURVEY_PACK_IDS],
  answerSeconds: 20,
  predictSeconds: 25,
  revealSeconds: 12,
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const SURVEY_MSG = {
  /** client → server: your own anonymous answer {q, option} or {q, skip: true}. */
  answer: 'survey:answer',
  /** client → server: your prediction for the current question (SurveyPredictPayload). */
  predict: 'survey:predict',
  /**
   * client → server (host, lobby/results): replace the custom survey {questions}.
   * server → host only: the stored, cleaned survey + issues (SurveyCustomPrivate).
   */
  custom: 'survey:custom',
  /** server → one player: their own answer/prediction for this question (SurveyPrivate). */
  private: 'survey:private',
  /** server → all: public events for sounds/animation (SurveyEvent). */
  event: 'survey:event',
} as const;

const qSerial = z.number().int().min(0).max(1_000_000);

export const SurveyAnswerSchema = z.union([
  z
    .object({
      q: qSerial,
      option: z
        .number()
        .int()
        .min(0)
        .max(SURVEY_LIMITS.optionsAbsMax - 1),
    })
    .strict(),
  z.object({ q: qSerial, skip: z.literal(true) }).strict(),
]);
export type SurveyAnswerPayload = z.infer<typeof SurveyAnswerSchema>;

export const SurveyPredictSchema = z.discriminatedUnion('kind', [
  z
    .object({
      q: qSerial,
      kind: z.literal('majority'),
      option: z
        .number()
        .int()
        .min(0)
        .max(SURVEY_LIMITS.optionsAbsMax - 1),
    })
    .strict(),
  z
    .object({
      q: qSerial,
      kind: z.literal('rank'),
      order: z
        .array(
          z
            .number()
            .int()
            .min(0)
            .max(SURVEY_LIMITS.optionsAbsMax - 1),
        )
        .min(SURVEY_LIMITS.options.rank.min)
        .max(SURVEY_LIMITS.options.rank.max),
    })
    .strict(),
  z.object({ q: qSerial, kind: z.literal('percent'), percent: z.number().int().min(0).max(100) }).strict(),
]);
export type SurveyPredictPayload = z.infer<typeof SurveyPredictSchema>;
export type SurveyPrediction =
  { kind: 'majority'; option: number } | { kind: 'rank'; order: number[] } | { kind: 'percent'; percent: number };

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

/**
 * Private per-player view of the current question (re-sent on join/reconnect and on change).
 * Once answering closes the server SEALS the question: it forgets every individual answer
 * (only anonymous counts remain), so from then on `answer`/`skipped` are no longer sent — the
 * client keeps its own copy for display.
 */
export interface SurveyPrivate {
  /** Question serial this payload belongs to. */
  q: number;
  /** Answered or skipped. */
  answered: boolean;
  skipped: boolean;
  /** Your own answer (option index) — only ever sent to you, and only until the question is sealed. */
  answer: number | null;
  prediction: SurveyPrediction | null;
  /** Answering has closed and the server has discarded individual answers. */
  sealed: boolean;
}

/** Host-only copy of the stored custom survey. */
export interface SurveyCustomPrivate {
  questions: SurveyQuestion[];
  issues: SurveyCustomIssue[];
  dropped: number;
}

/** Points one player earned on a question. */
export interface SurveyPlayerScore {
  playerId: string;
  points: number;
  /** Base points before bonuses. */
  base: number;
  bonus: number;
  /** Short label for the bonus, e.g. 'Called it', 'Perfect order', 'Closest'. */
  bonusLabel: string;
  /** Majority: predicted a leader. Rank: perfect order. Percent: within 5 points. */
  hit: boolean;
  /** Rank: spots off in total. Percent: percentage points off (1 decimal). */
  off: number;
}

/** Rank of one option in the final order: ties share a range lo..hi (1-based). */
export interface SurveyRankSlot {
  option: number;
  lo: number;
  hi: number;
}

/** Aggregate result of one question (public from the reveal on). Never contains individual answers. */
export interface SurveyResult {
  q: number;
  index: number;
  question: SurveyQuestion;
  /** Answers counted (skips excluded). */
  respondents: number;
  /** Seated players when answering closed. */
  seated: number;
  /** Too few answers to stay anonymous: no tallies, no points. */
  voided: boolean;
  /** Votes per option (empty when voided). */
  counts: number[];
  /** Share per option in percent, rounded to one decimal (empty when voided). */
  percents: number[];
  /** Majority: the leading option(s); more than one = tie. */
  leaders: number[];
  /** Rank: options by votes (ties keep the question's order) with shared rank ranges. */
  ranking: SurveyRankSlot[];
  /** Percent: exact share of the target option (one decimal). */
  actual: number;
  /** How many players predicted. */
  predictors: number;
  /** Majority: predictions per option (anonymous). */
  predictionCounts: number[];
  /** Percent: every predicted percentage, sorted (anonymous dot plot). */
  predictedPercents: number[];
  /** Percent: the closest predictor(s) (ties: all of them). */
  closest: string[];
  /** Points per player who predicted, best first. */
  scores: SurveyPlayerScore[];
}

export type SurveyEvent =
  | { type: 'question'; q: number; index: number; total: number; mode: SurveyQuestionMode }
  | { type: 'answers-closed'; q: number; respondents: number }
  | { type: 'reveal'; q: number; voided: boolean }
  | { type: 'final' };

/** Host controls come from the party kit: `party:host {action: 'pause' | 'resume' | 'skip'}`. */

/** A finished question, for the end-of-game "your room in numbers" recap. */
export interface SurveyHistoryEntry {
  q: number;
  index: number;
  mode: SurveyQuestionMode;
  prompt: string;
  voided: boolean;
  respondents: number;
  /** Leading option text (ties joined with " & "). */
  headline: string;
  /** Share of the leader (one decimal). */
  share: number;
  /** Lead over the runner-up in percentage points (one decimal). */
  margin: number;
  /** Players who predicted. */
  predictors: number;
  /** Share of predictors who hit (see SurveyPlayerScore.hit), 0–100. */
  hitRate: number;
}

export type SurveyAwardId = 'mind-reader' | 'barometer' | 'ranker' | 'bold';

export interface SurveyAward {
  id: SurveyAwardId;
  playerIds: string[];
  names: string[];
  /** Human-readable stat, e.g. '5 majority calls' or 'avg 6.2 points off'. */
  value: string;
}

export interface SurveyRecapItem {
  id: 'united' | 'divided' | 'surprise';
  title: string;
  prompt: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Public state (state.toJSON())
// ---------------------------------------------------------------------------

export type SurveyStage = 'idle' | 'answer' | 'predict' | 'reveal' | 'final';

/** Per-player progress on the current question: WHETHER they answered / predicted, never what. */
export interface SurveyProgressView {
  answered: boolean;
  predicted: boolean;
}

/**
 * Built on the party kit's public view (stage, stageSeq, stageMs, paused, seats with delta/rank,
 * scoreSeq, podiumJson…). `round` is the 1-based question number and `totalRounds` the count.
 * The kit's `seats[id].answered` tracks the CURRENT step (answer stage: answered; predict stage:
 * predicted); `progress` carries both flags for the whole question.
 */
export interface SurveyPublicState extends PartyPublicView {
  stage: SurveyStage;
  /** Question serial (increments every question, across games in this room). */
  q: number;
  /** JSON SurveyQuestion of the current question ('' when none). */
  questionJson: string;
  /** Players who answered or skipped this question. */
  answersIn: number;
  /** Players who predicted this question. */
  predictionsIn: number;
  progress: Record<string, SurveyProgressView>;
  /** JSON SurveyResult of the current question (set at reveal, '' otherwise). */
  resultJson: string;
  /** JSON SurveyHistoryEntry[]. */
  historyJson: string;
  /** Number of valid custom questions the host has saved (the questions stay private to the host). */
  customCount: number;
}

/** Game extras published in the party podium (`podiumJson.extras`). */
export interface SurveyPodiumExtras {
  awards: SurveyAward[];
  recap: SurveyRecapItem[];
  questions: number;
  voided: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by server + client)
// ---------------------------------------------------------------------------

/** 66.666… → 66.7, 50 → 50. */
export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "66.7%" / "50%". */
export function formatPercent(value: number): string {
  const v = roundPercent(value);
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** Points lost per spot off in Rank the Room for `n` options (Spearman footrule scale). */
export function rankStepPoints(n: number): number {
  const maxDistance = Math.floor((n * n) / 2);
  return maxDistance > 0 ? SURVEY_SCORING.rankMax / maxDistance : SURVEY_SCORING.rankMax;
}

/** Parses a question JSON from state (null when empty/invalid). */
export function parseSurveyQuestion(json: string | undefined): SurveyQuestion | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as SurveyQuestion;
  } catch {
    return null;
  }
}
