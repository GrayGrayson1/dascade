/**
 * DAStravaganza Trivia — shared contract (settings, question/pack schemas, messages, public shapes).
 *
 * The answer key never reaches clients before a reveal: the server keeps packs private and
 * publishes a `TriviaQuestionView` (no answers) while a question is live, then a
 * `TriviaRevealView` once answers are closed.
 */
import { z } from 'zod';
import type { PartyPublicView } from '../party.ts';

// ---------------------------------------------------------------------------
// Categories, types, difficulty
// ---------------------------------------------------------------------------

export const TRIVIA_CATEGORY_IDS = ['general', 'science', 'screen', 'tech', 'geography', 'history', 'food', 'weird', 'nonsense'] as const;
export type TriviaCategoryId = (typeof TRIVIA_CATEGORY_IDS)[number];
/** Custom-pack questions may also use the catch-all 'custom' category. */
export const TRIVIA_ANY_CATEGORY_IDS = [...TRIVIA_CATEGORY_IDS, 'custom'] as const;
export type TriviaAnyCategoryId = (typeof TRIVIA_ANY_CATEGORY_IDS)[number];

export interface TriviaCategoryMeta {
  id: TriviaAnyCategoryId;
  title: string;
  short: string;
  blurb: string;
  /** PixelIcon name. */
  icon: string;
  /** Art colour for the category chip (always shown with its name). */
  color: string;
}

export const TRIVIA_CATEGORIES: Record<TriviaAnyCategoryId, TriviaCategoryMeta> = {
  general: { id: 'general', title: 'General Knowledge', short: 'General', blurb: 'A bit of everything.', icon: 'star', color: '#ffd23f' },
  science: {
    id: 'science',
    title: 'Science & Nature',
    short: 'Science',
    blurb: 'Atoms, animals, planets and the human body.',
    icon: 'bolt',
    color: '#2de38f',
  },
  screen: { id: 'screen', title: 'Movies & TV', short: 'Screen', blurb: 'Film and television facts.', icon: 'play', color: '#ff4fd8' },
  tech: {
    id: 'tech',
    title: 'Technology',
    short: 'Tech',
    blurb: 'Computers, the internet and inventions.',
    icon: 'disk',
    color: '#22d3ee',
  },
  geography: {
    id: 'geography',
    title: 'Geography',
    short: 'Geography',
    blurb: 'Countries, capitals, rivers and peaks.',
    icon: 'flag',
    color: '#60a5fa',
  },
  history: {
    id: 'history',
    title: 'History',
    short: 'History',
    blurb: 'People and moments that shaped the world.',
    icon: 'crown',
    color: '#e8c07d',
  },
  food: { id: 'food', title: 'Food & Drink', short: 'Food', blurb: 'Kitchens, cuisines and snacks.', icon: 'pizza', color: '#ff8a3d' },
  weird: { id: 'weird', title: 'Weird Facts', short: 'Weird', blurb: 'True things that sound made up.', icon: 'alien', color: '#a78bfa' },
  nonsense: {
    id: 'nonsense',
    title: 'Pure Nonsense',
    short: 'Nonsense',
    blurb: 'Riddles, wordplay and delightfully silly questions.',
    icon: 'ghost',
    color: '#a3e635',
  },
  custom: { id: 'custom', title: 'Custom', short: 'Custom', blurb: 'Written by your host.', icon: 'pencil', color: '#f472b6' },
};

export const TRIVIA_TYPES = ['mc', 'tf', 'text', 'number', 'order'] as const;
export type TriviaQuestionType = (typeof TRIVIA_TYPES)[number];
export const TRIVIA_TYPE_LABEL: Record<TriviaQuestionType, string> = {
  mc: 'Multiple choice',
  tf: 'True or false',
  text: 'Type the answer',
  number: 'Closest number',
  order: 'Put in order',
};

export const TRIVIA_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type TriviaDifficulty = (typeof TRIVIA_DIFFICULTIES)[number];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const TRIVIA_LIMITS = {
  prompt: 240,
  option: 80,
  minOptions: 2,
  maxOptions: 6,
  accept: 10,
  acceptLen: 60,
  orderMin: 3,
  orderMax: 6,
  item: 60,
  endLabel: 24,
  unit: 24,
  explanation: 240,
  packTitle: 60,
  packQuestions: 200,
  typed: 60,
  /** Max absolute value for numeric answers. */
  numberAbs: 1e12,
  /** Serialized custom-pack upload budget. */
  packBytes: 200_000,
  id: 40,
} as const;

// ---------------------------------------------------------------------------
// Questions + packs
// ---------------------------------------------------------------------------

const lazy = <T>(build: () => T): T => build();

const text = (max: number) => z.string().trim().min(1, 'is empty').max(max, `is longer than ${max} characters`);

const QuestionBase = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(TRIVIA_LIMITS.id)
    .regex(/^[a-z0-9-]+$/i, 'may only use letters, digits and dashes')
    .optional(),
  category: z.enum(TRIVIA_ANY_CATEGORY_IDS),
  difficulty: z.enum(TRIVIA_DIFFICULTIES),
  prompt: text(TRIVIA_LIMITS.prompt),
  explanation: z.string().trim().max(TRIVIA_LIMITS.explanation).optional(),
};

export const TriviaQuestionSchema = /* @__PURE__ */ lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        ...QuestionBase,
        type: z.literal('mc'),
        options: z.array(text(TRIVIA_LIMITS.option)).min(TRIVIA_LIMITS.minOptions).max(TRIVIA_LIMITS.maxOptions),
        /** Index of the correct option. */
        correct: z
          .number()
          .int()
          .min(0)
          .max(TRIVIA_LIMITS.maxOptions - 1),
        /** Keep the authored option order (e.g. ascending numbers); otherwise the server shuffles. */
        fixedOrder: z.boolean().optional(),
      })
      .refine((q) => q.correct < q.options.length, { message: 'correct must point at one of the options', path: ['correct'] })
      .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length, {
        message: 'options must be different',
        path: ['options'],
      }),
    z.object({ ...QuestionBase, type: z.literal('tf'), correct: z.boolean() }),
    z.object({
      ...QuestionBase,
      type: z.literal('text'),
      /** Accepted answers; the first one is shown at the reveal. */
      accept: z.array(text(TRIVIA_LIMITS.acceptLen)).min(1).max(TRIVIA_LIMITS.accept),
    }),
    z.object({
      ...QuestionBase,
      type: z.literal('number'),
      correct: z.number().finite().min(-TRIVIA_LIMITS.numberAbs).max(TRIVIA_LIMITS.numberAbs),
      unit: z.string().trim().max(TRIVIA_LIMITS.unit).optional(),
    }),
    z
      .object({
        ...QuestionBase,
        type: z.literal('order'),
        /** Items in the CORRECT order (first → last). */
        items: z.array(text(TRIVIA_LIMITS.item)).min(TRIVIA_LIMITS.orderMin).max(TRIVIA_LIMITS.orderMax),
        /** Labels for the two ends, e.g. ['Earliest', 'Latest']. */
        ends: z.tuple([text(TRIVIA_LIMITS.endLabel), text(TRIVIA_LIMITS.endLabel)]),
      })
      .refine((q) => new Set(q.items.map((o) => o.toLowerCase())).size === q.items.length, {
        message: 'items must be different',
        path: ['items'],
      }),
  ]),
);
export type TriviaQuestion = z.infer<typeof TriviaQuestionSchema>;

export const TriviaPackSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    format: z.literal('dascade-trivia').optional(),
    version: z.literal(1).optional(),
    title: z.string().trim().max(TRIVIA_LIMITS.packTitle).optional(),
    questions: z
      .array(TriviaQuestionSchema)
      .min(1, 'the pack has no questions')
      .max(TRIVIA_LIMITS.packQuestions, `a pack holds at most ${TRIVIA_LIMITS.packQuestions} questions`),
  }),
);
export type TriviaPack = z.infer<typeof TriviaPackSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const TRIVIA_PACKS = ['starter', 'custom', 'mixed'] as const;
export type TriviaPackChoice = (typeof TRIVIA_PACKS)[number];

export const TRIVIA_POINTS = [100, 250, 500, 1000] as const;

export const TriviaSettingsSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    /** Free-for-all or teams. */
    mode: z.enum(['ffa', 'teams']),
    teamCount: z.number().int().min(2).max(6),
    teamScoring: z.enum(['sum', 'average']),
    questionCount: z.number().int().min(3).max(50),
    /** Empty = every category. */
    categories: z.array(z.enum(TRIVIA_CATEGORY_IDS)).max(TRIVIA_CATEGORY_IDS.length),
    types: z.array(z.enum(TRIVIA_TYPES)).min(1).max(TRIVIA_TYPES.length),
    difficulty: z.enum(['mixed', 'easy', 'medium', 'hard']),
    pack: z.enum(TRIVIA_PACKS),
    answerSeconds: z.number().int().min(8).max(90),
    basePoints: z.number().int().min(100).max(1000),
    speedBonus: z.boolean(),
    streakBonus: z.boolean(),
    difficultyBonus: z.boolean(),
    finalWager: z.boolean(),
  }),
);
export type TriviaSettings = z.infer<typeof TriviaSettingsSchema>;

export const DEFAULT_TRIVIA_SETTINGS: TriviaSettings = {
  mode: 'ffa',
  teamCount: 2,
  teamScoring: 'average',
  questionCount: 10,
  categories: [],
  types: ['mc', 'tf', 'text', 'number', 'order'],
  difficulty: 'mixed',
  pack: 'starter',
  answerSeconds: 20,
  basePoints: 500,
  speedBonus: true,
  streakBonus: true,
  difficultyBonus: false,
  finalWager: false,
};

// ---------------------------------------------------------------------------
// Scoring constants (documented in the rules drawer)
// ---------------------------------------------------------------------------

export const TRIVIA_SCORING = {
  /** Speed bonus: up to this share of base points, linear in the time left. */
  speedShare: 0.5,
  /** Streak bonus per consecutive correct answer after the first. */
  streakShare: 0.1,
  /** Max streak bonus share. */
  streakCapShare: 0.5,
  difficultyMultiplier: { easy: 1, medium: 1.5, hard: 2 } as Record<TriviaDifficulty, number>,
  /** Numeric: non-winning guesses within this share of the answer earn half points. */
  numberNearShare: 0.1,
  numberNearPoints: 0.5,
  /** Wager floor for players at or below zero points. */
  minWagerCap: 0,
} as const;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const TRIVIA_MSG = {
  /** client → server: lock in an answer for question `seq`. */
  answer: 'trivia:answer',
  /** client → server: final-round wager. */
  wager: 'trivia:wager',
  /** client → server (host, LOBBY/RESULTS): upload / clear the custom pack. */
  pack: 'trivia:pack',
  /** server → client: your private view (locked answer, result, wager, custom pack echo for the host). */
  private: 'trivia:private',
  /** server → host: validated custom pack (host only, lobby/results only). */
  packEcho: 'trivia:packEcho',
  /** server → all: short events for sounds/animations. */
  event: 'trivia:event',
} as const;

export const TriviaAnswerInputSchema = /* @__PURE__ */ lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('mc'),
      index: z
        .number()
        .int()
        .min(0)
        .max(TRIVIA_LIMITS.maxOptions - 1),
    }),
    z.object({ kind: z.literal('tf'), value: z.boolean() }),
    z.object({
      kind: z.literal('text'),
      text: z
        .string()
        .min(1)
        .max(TRIVIA_LIMITS.typed * 2),
    }),
    z.object({ kind: z.literal('number'), value: z.number().finite().min(-TRIVIA_LIMITS.numberAbs).max(TRIVIA_LIMITS.numberAbs) }),
    z.object({
      kind: z.literal('order'),
      order: z
        .array(
          z
            .number()
            .int()
            .min(0)
            .max(TRIVIA_LIMITS.orderMax - 1),
        )
        .min(TRIVIA_LIMITS.orderMin)
        .max(TRIVIA_LIMITS.orderMax),
    }),
  ]),
);
export type TriviaAnswerInput = z.infer<typeof TriviaAnswerInputSchema>;

export const TriviaAnswerSchema = /* @__PURE__ */ lazy(() =>
  z.object({ seq: z.number().int().min(0).max(1_000_000), answer: TriviaAnswerInputSchema }),
);
export type TriviaAnswerPayload = z.infer<typeof TriviaAnswerSchema>;

export const TriviaWagerSchema = /* @__PURE__ */ lazy(() =>
  z.object({ seq: z.number().int().min(0).max(1_000_000), amount: z.number().int().min(0).max(1_000_000) }),
);
export type TriviaWagerPayload = z.infer<typeof TriviaWagerSchema>;

/** The pack upload is validated in the handler (per-question error report), so the envelope is loose but bounded. */
export const TriviaPackUploadSchema = /* @__PURE__ */ lazy(() => z.object({ pack: z.unknown().nullable() }));

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type TriviaStage = 'idle' | 'intro' | 'question' | 'reveal' | 'scores' | 'wager' | 'final';

/** A live question as players see it — never the answer. */
export interface TriviaQuestionView {
  seq: number;
  /** 1-based question number and the total. */
  index: number;
  total: number;
  category: TriviaAnyCategoryId;
  difficulty: TriviaDifficulty;
  type: TriviaQuestionType;
  prompt: string;
  /** mc: options in display order (the server shuffles). tf: ['True', 'False']. */
  options?: string[];
  /** order: items in a shuffled display order; answers are permutations of these indices. */
  items?: string[];
  ends?: [string, string];
  unit?: string;
  isFinal: boolean;
  /** Points available (base × difficulty multiplier). */
  points: number;
}

export interface TriviaPlayerResult {
  correct: boolean;
  /** Partial credit (order questions / near numeric guesses). */
  partial: boolean;
  points: number;
  speedBonus: number;
  streakBonus: number;
  /** Final wager (0 if not the final). */
  wager: number;
  /** Short public rendering of what they answered (after the reveal only). */
  answerText: string;
  answered: boolean;
}

export interface TriviaRevealView {
  seq: number;
  type: TriviaQuestionType;
  /** mc / tf: index of the correct option in display order. */
  correctIndex?: number;
  /** order: correct order as display indices. */
  correctOrder?: number[];
  /** number: the exact answer. */
  correctNumber?: number;
  /** Human-readable correct answer. */
  correctText: string;
  /** Also accepted (typed answers). */
  alsoAccepted?: string[];
  explanation?: string;
  /** mc/tf: answers per option (display order). */
  distribution?: number[];
  answeredCount: number;
  correctCount: number;
  /** number: closest guess(es). */
  closest?: { ids: string[]; value: number; distance: number } | null;
  results: Record<string, TriviaPlayerResult>;
}

/** Question counts: matrix[category][type][difficulty]. */
export type TriviaCountMatrix = Record<string, Record<string, Record<string, number>>>;

export interface TriviaPackInfo {
  starter: { total: number; byCategory: Record<string, number>; byType: Record<string, number>; matrix: TriviaCountMatrix };
  custom: { title: string; total: number; matrix: TriviaCountMatrix } | null;
}

/** Count questions in a matrix matching a filter (custom packs ignore the category filter, like the server). */
export function countMatching(
  matrix: TriviaCountMatrix,
  filter: { categories: readonly string[]; types: readonly string[]; difficulty: string },
  ignoreCategories = false,
): number {
  let n = 0;
  for (const [cat, byType] of Object.entries(matrix)) {
    if (!ignoreCategories && filter.categories.length > 0 && !filter.categories.includes(cat)) continue;
    for (const [type, byDiff] of Object.entries(byType)) {
      if (!filter.types.includes(type)) continue;
      for (const [diff, count] of Object.entries(byDiff)) {
        if (filter.difficulty === 'mixed' || filter.difficulty === diff) n += count;
      }
    }
  }
  return n;
}

/** Builds a count matrix from questions. */
export function countMatrix(questions: ReadonlyArray<{ category: string; type: string; difficulty: string }>): TriviaCountMatrix {
  const m: TriviaCountMatrix = {};
  for (const q of questions) {
    const byType = (m[q.category] ??= {});
    const byDiff = (byType[q.type] ??= {});
    byDiff[q.difficulty] = (byDiff[q.difficulty] ?? 0) + 1;
  }
  return m;
}

export interface TriviaPublicState extends PartyPublicView {
  stage: TriviaStage;
  /** JSON TriviaQuestionView ('' when none). */
  questionJson: string;
  /** JSON TriviaRevealView ('' until the reveal). */
  revealJson: string;
  /** JSON TriviaPackInfo. */
  packInfoJson: string;
  /** Final wager stage: category of the final question ('' otherwise). */
  finalCategory: string;
  /** JSON Record<playerId, number> of correct answers (filled at the end). */
  correctJson: string;
}

export interface TriviaPrivate {
  seq: number;
  /** Your locked answer for question `seq` (null if none). */
  answer: TriviaAnswerInput | null;
  /** Your result once revealed. */
  result: TriviaPlayerResult | null;
  /** Final round: your wager and the max you may wager. */
  wager: { amount: number; max: number; locked: boolean } | null;
}

export interface TriviaPackEcho {
  /** The room's custom pack — only for the host who wrote it (it contains every answer). */
  pack: TriviaPack | null;
  errors: string[];
  /**
   * The room has a custom pack written by someone else (e.g. the host role moved): its questions
   * and answers stay hidden; this host may replace or clear it.
   */
  hidden?: { title: string; total: number } | null;
}

export type TriviaEvent =
  { type: 'question'; seq: number } | { type: 'locked'; seq: number; count: number } | { type: 'reveal'; seq: number } | { type: 'final' };

// ---------------------------------------------------------------------------
// Answer rendering helpers (isomorphic)
// ---------------------------------------------------------------------------

/**
 * Numeric answers: thousands separators from 10,000 up (so years such as 1969 read naturally),
 * at most four decimals, optional unit.
 */
export function formatTriviaNumber(value: number, unit?: string): string {
  const rounded = +value.toFixed(4);
  const str = Math.abs(rounded) >= 10_000 ? rounded.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(rounded);
  return unit ? `${str} ${unit}` : str;
}
