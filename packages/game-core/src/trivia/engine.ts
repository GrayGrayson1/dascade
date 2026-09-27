/**
 * DAStravaganza Trivia engine — pure and deterministic with an injected Rng.
 *
 * Scoring (P = base points × difficulty multiplier when "difficulty bonus" is on):
 *  - Multiple choice / true-false / typed: correct → P (+ speed bonus) (+ streak bonus).
 *  - Closest number: every guess at the minimum distance from the answer counts as correct
 *    (ties share full points, over or under). Other guesses within 10 % of the answer earn P/2
 *    (partial: no bonuses, streak resets).
 *  - Put in order: all positions right → correct. Otherwise partial credit: P × (right/total) / 2.
 *  - Speed bonus (on): up to +50 % of P, linear in the time left when the answer locked.
 *  - Streak bonus (on): +10 % of P per consecutive correct answer after the first, max +50 %.
 *  - Final wager (on): before the last question each player privately wagers 0…max(score, base
 *    points). Correct → +wager, wrong or no answer → −wager (a score never drops below 0).
 *    No speed/streak bonuses in the final.
 *  - Wrong or no answer → 0 points and the streak resets.
 */
import { maskProfanity, shuffleInPlace, type Rng } from '@dascade/shared';
import {
  TRIVIA_SCORING,
  formatTriviaNumber,
  type TriviaAnswerInput,
  type TriviaDifficulty,
  type TriviaPlayerResult,
  type TriviaQuestion,
  type TriviaQuestionView,
  type TriviaRevealView,
  type TriviaSettings,
} from '@dascade/shared/games/trivia';
import { closestWins, matchAnswer, speedBonus, streakBonus, withinShare } from '../party/index.ts';

// ---------------------------------------------------------------------------
// Pool + selection
// ---------------------------------------------------------------------------

export interface PoolQuestion {
  /** Stable key (starter id, or `custom-<n>`). */
  key: string;
  q: TriviaQuestion;
  source: 'starter' | 'custom';
}

export type PoolFilter = Pick<TriviaSettings, 'categories' | 'types' | 'difficulty' | 'pack'>;

/**
 * Questions matching the host's filters. Custom questions ignore the category filter (they were
 * hand-picked by the host) but honour types/difficulty.
 */
export function buildPool(starter: readonly TriviaQuestion[], custom: readonly TriviaQuestion[], filter: PoolFilter): PoolQuestion[] {
  const types = new Set(filter.types);
  const cats = new Set(filter.categories);
  const diffOk = (d: TriviaDifficulty) => filter.difficulty === 'mixed' || filter.difficulty === d;
  const out: PoolQuestion[] = [];
  if (filter.pack !== 'custom') {
    starter.forEach((q, i) => {
      if (!types.has(q.type) || !diffOk(q.difficulty)) return;
      if (cats.size > 0 && !cats.has(q.category as never)) return;
      out.push({ key: q.id ?? `starter-${i}`, q, source: 'starter' });
    });
  }
  if (filter.pack !== 'starter') {
    custom.forEach((q, i) => {
      if (!types.has(q.type) || !diffOk(q.difficulty)) return;
      out.push({ key: `custom-${i}`, q, source: 'custom' });
    });
  }
  return out;
}

/**
 * Picks `count` questions with variety: questions are grouped by category, each group shuffled,
 * then dealt round-robin across a shuffled category order. Keys in `avoid` (recently played)
 * are only used when the fresh pool runs out. Returns fewer when the pool is smaller.
 */
export function pickQuestions(
  pool: readonly PoolQuestion[],
  count: number,
  rng: Rng,
  avoid: ReadonlySet<string> = new Set(),
): PoolQuestion[] {
  const fresh = pool.filter((p) => !avoid.has(p.key));
  const stale = pool.filter((p) => avoid.has(p.key));
  const picked = dealByCategory(fresh, count, rng);
  if (picked.length < count) picked.push(...dealByCategory(stale, count - picked.length, rng));
  return picked;
}

function dealByCategory(pool: readonly PoolQuestion[], count: number, rng: Rng): PoolQuestion[] {
  const groups = new Map<string, PoolQuestion[]>();
  for (const p of pool) {
    const list = groups.get(p.q.category) ?? [];
    list.push(p);
    groups.set(p.q.category, list);
  }
  const order = shuffleInPlace([...groups.keys()].sort(), rng);
  for (const k of order) shuffleInPlace(groups.get(k)!, rng);
  const out: PoolQuestion[] = [];
  while (out.length < count) {
    let took = false;
    for (const k of order) {
      const next = groups.get(k)!.pop();
      if (next) {
        out.push(next);
        took = true;
        if (out.length >= count) break;
      }
    }
    if (!took) break;
  }
  return out;
}

/**
 * Chooses the final-wager question out of `picked` (moves it to the end): prefers a medium/hard
 * question that isn't true/false, else any non-true/false one, else leaves the order unchanged.
 */
export function arrangeFinal(picked: PoolQuestion[], rng: Rng): PoolQuestion[] {
  if (picked.length < 2) return picked;
  const score = (p: PoolQuestion) => (p.q.type === 'tf' ? 0 : p.q.difficulty === 'easy' ? 1 : 2);
  const best = Math.max(...picked.map(score));
  if (best === 0) return picked;
  const candidates = picked.map((p, i) => ({ p, i })).filter(({ p }) => score(p) === best);
  const choice = candidates[rng.int(candidates.length)]!;
  const out = picked.filter((_, i) => i !== choice.i);
  out.push(choice.p);
  return out;
}

// ---------------------------------------------------------------------------
// Presentation (the view players see) + the private answer key
// ---------------------------------------------------------------------------

export interface AnswerKey {
  type: TriviaQuestion['type'];
  /** mc/tf: correct display index. */
  correctIndex?: number;
  /** text: accepted answers (first = canonical). */
  accept?: string[];
  /** number: exact answer. */
  correctNumber?: number;
  unit?: string;
  /** order: display indices in the correct order. */
  correctOrder?: number[];
  /** Human-readable correct answer. */
  correctText: string;
  explanation?: string;
}

export interface PresentedQuestion {
  view: TriviaQuestionView;
  key: AnswerKey;
}

export function questionPoints(q: Pick<TriviaQuestion, 'difficulty'>, basePoints: number, difficultyBonus: boolean): number {
  return Math.round(basePoints * (difficultyBonus ? TRIVIA_SCORING.difficultyMultiplier[q.difficulty] : 1));
}

/** Builds the public view (shuffled options/items, no answer) and the server-only answer key. */
export function presentQuestion(
  q: TriviaQuestion,
  opts: { seq: number; index: number; total: number; isFinal: boolean; points: number },
  rng: Rng,
): PresentedQuestion {
  const base: TriviaQuestionView = {
    seq: opts.seq,
    index: opts.index,
    total: opts.total,
    category: q.category,
    difficulty: q.difficulty,
    type: q.type,
    prompt: q.prompt,
    isFinal: opts.isFinal,
    points: opts.points,
  };
  const explanation = q.explanation || undefined;
  switch (q.type) {
    case 'mc': {
      const order = q.options.map((_, i) => i);
      if (!q.fixedOrder) shuffleInPlace(order, rng);
      const options = order.map((i) => q.options[i]!);
      const correctIndex = order.indexOf(q.correct);
      return { view: { ...base, options }, key: { type: 'mc', correctIndex, correctText: q.options[q.correct]!, explanation } };
    }
    case 'tf':
      return {
        view: { ...base, options: ['True', 'False'] },
        key: { type: 'tf', correctIndex: q.correct ? 0 : 1, correctText: q.correct ? 'True' : 'False', explanation },
      };
    case 'text':
      return { view: base, key: { type: 'text', accept: [...q.accept], correctText: q.accept[0]!, explanation } };
    case 'number':
      return {
        view: { ...base, ...(q.unit ? { unit: q.unit } : {}) },
        key: { type: 'number', correctNumber: q.correct, unit: q.unit, correctText: formatTriviaNumber(q.correct, q.unit), explanation },
      };
    case 'order': {
      // Display order: a shuffle that is never already the correct order.
      const display = q.items.map((_, i) => i);
      for (let tries = 0; tries < 8; tries++) {
        shuffleInPlace(display, rng);
        if (display.some((v, i) => v !== i)) break;
      }
      if (display.every((v, i) => v === i)) display.reverse();
      const items = display.map((i) => q.items[i]!);
      // correctOrder[k] = display index of the k-th item in the correct order.
      const correctOrder = q.items.map((_, orig) => display.indexOf(orig));
      return {
        view: { ...base, items, ends: [q.ends[0], q.ends[1]] },
        key: { type: 'order', correctOrder, correctText: q.items.join(' → '), explanation },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Validation + grading
// ---------------------------------------------------------------------------

/** Structural check of an answer against the live question (kind, index range, permutation). */
export function isValidAnswer(view: TriviaQuestionView, input: TriviaAnswerInput): boolean {
  switch (view.type) {
    case 'mc':
      return input.kind === 'mc' && input.index >= 0 && input.index < (view.options?.length ?? 0);
    case 'tf':
      return input.kind === 'tf';
    case 'text':
      return input.kind === 'text' && input.text.trim().length > 0;
    case 'number':
      return input.kind === 'number' && Number.isFinite(input.value);
    case 'order': {
      if (input.kind !== 'order') return false;
      const n = view.items?.length ?? 0;
      if (input.order.length !== n) return false;
      const seen = new Set(input.order);
      return seen.size === n && input.order.every((i) => i >= 0 && i < n);
    }
  }
}

export interface Grade {
  correct: boolean;
  /** 0…1 share of the points for partial credit (order). */
  partialShare: number;
}

/** Grades one answer (numeric questions are graded relative to the room in scoreQuestion). */
export function gradeAnswer(key: AnswerKey, input: TriviaAnswerInput): Grade {
  switch (key.type) {
    case 'mc':
    case 'tf': {
      const idx = input.kind === 'tf' ? (input.value ? 0 : 1) : input.kind === 'mc' ? input.index : -1;
      return { correct: idx === key.correctIndex, partialShare: 0 };
    }
    case 'text':
      return { correct: input.kind === 'text' && matchAnswer(input.text, key.accept ?? []).verdict !== 'wrong', partialShare: 0 };
    case 'number':
      return { correct: input.kind === 'number' && input.value === key.correctNumber, partialShare: 0 };
    case 'order': {
      if (input.kind !== 'order' || !key.correctOrder) return { correct: false, partialShare: 0 };
      const right = key.correctOrder.filter((v, i) => input.order[i] === v).length;
      const n = key.correctOrder.length;
      return right === n ? { correct: true, partialShare: 0 } : { correct: false, partialShare: right / n };
    }
  }
}

/** Short public rendering of an answer for the reveal. */
export function answerText(view: TriviaQuestionView, input: TriviaAnswerInput): string {
  switch (input.kind) {
    case 'mc':
      return view.options?.[input.index] ?? '—';
    case 'tf':
      return input.value ? 'True' : 'False';
    case 'text':
      return maskProfanity(input.text);
    case 'number':
      return formatTriviaNumber(input.value, view.unit);
    case 'order':
      return input.order.map((i) => view.items?.[i] ?? '?').join(' → ');
  }
}

// ---------------------------------------------------------------------------
// Scoring one question for the whole room
// ---------------------------------------------------------------------------

export interface SubmittedAnswer {
  playerId: string;
  input: TriviaAnswerInput;
  /** ms from question open to lock-in. */
  elapsedMs: number;
}

export interface ScoreContext {
  view: TriviaQuestionView;
  key: AnswerKey;
  /** Everyone who could answer (missing answers get a zero result). */
  playerIds: readonly string[];
  answers: readonly SubmittedAnswer[];
  /** Answer window (speed bonus). */
  windowMs: number;
  speedBonus: boolean;
  streakBonus: boolean;
  /** Current streaks before this question. */
  streaks: ReadonlyMap<string, number>;
  /** Final: locked wagers (player → amount). */
  wagers?: ReadonlyMap<string, number>;
  /** Final: current scores (for the no-negative floor). */
  scores?: ReadonlyMap<string, number>;
}

export interface ScoredQuestion {
  results: Record<string, TriviaPlayerResult>;
  /** New streak per player. */
  streaks: Map<string, number>;
  reveal: TriviaRevealView;
}

export function scoreQuestion(ctx: ScoreContext): ScoredQuestion {
  const { view, key } = ctx;
  const P = view.points;
  const byId = new Map(ctx.answers.map((a) => [a.playerId, a]));
  const results: Record<string, TriviaPlayerResult> = {};
  const streaks = new Map<string, number>();

  // Numeric: closest-wins across the room.
  let closest: TriviaRevealView['closest'] = null;
  let numberWinners = new Set<string>();
  if (key.type === 'number') {
    const guesses = ctx.answers
      .filter((a) => a.input.kind === 'number')
      .map((a) => ({ id: a.playerId, value: (a.input as { value: number }).value }));
    const res = closestWins(guesses, key.correctNumber ?? 0);
    numberWinners = new Set(res.winners);
    if (res.winners.length) {
      const first = res.ranked[0]!;
      closest = { ids: res.winners, value: first.value, distance: res.distance };
    }
  }

  let correctCount = 0;
  const allIds = [...new Set([...ctx.playerIds, ...ctx.answers.map((a) => a.playerId)])];
  for (const id of allIds) {
    const a = byId.get(id);
    const prevStreak = ctx.streaks.get(id) ?? 0;
    const wager = view.isFinal ? Math.max(0, Math.round(ctx.wagers?.get(id) ?? 0)) : 0;
    if (!a) {
      streaks.set(id, 0);
      const loss = view.isFinal ? -Math.min(wager, Math.max(0, ctx.scores?.get(id) ?? 0)) : 0;
      results[id] = { correct: false, partial: false, points: loss, speedBonus: 0, streakBonus: 0, wager, answerText: '', answered: false };
      continue;
    }
    let correct: boolean;
    let partialShare = 0;
    if (key.type === 'number') {
      correct = numberWinners.has(id);
      const value = a.input.kind === 'number' ? a.input.value : NaN;
      if (!correct && Number.isFinite(value) && withinShare(value, key.correctNumber ?? 0, TRIVIA_SCORING.numberNearShare))
        partialShare = TRIVIA_SCORING.numberNearPoints;
    } else {
      const g = gradeAnswer(key, a.input);
      correct = g.correct;
      partialShare = key.type === 'order' ? g.partialShare * 0.5 : 0;
    }
    if (correct) correctCount++;
    let points: number;
    let speed = 0;
    let streakPts = 0;
    let streak: number;
    if (view.isFinal) {
      const current = Math.max(0, ctx.scores?.get(id) ?? 0);
      points = correct ? wager : -Math.min(wager, current);
      streak = correct ? prevStreak + 1 : 0;
    } else if (correct) {
      streak = prevStreak + 1;
      speed = ctx.speedBonus ? speedBonus(a.elapsedMs, ctx.windowMs, P * TRIVIA_SCORING.speedShare) : 0;
      streakPts = ctx.streakBonus ? streakBonus(streak, P * TRIVIA_SCORING.streakShare, P * TRIVIA_SCORING.streakCapShare) : 0;
      points = P + speed + streakPts;
    } else {
      points = Math.round(P * partialShare);
      streak = 0;
    }
    streaks.set(id, streak);
    results[id] = {
      correct,
      partial: !correct && partialShare > 0 && !view.isFinal,
      points,
      speedBonus: speed,
      streakBonus: streakPts,
      wager,
      answerText: answerText(view, a.input),
      answered: true,
    };
  }

  let distribution: number[] | undefined;
  if (key.type === 'mc' || key.type === 'tf') {
    distribution = (view.options ?? []).map(() => 0);
    for (const a of ctx.answers) {
      const idx = a.input.kind === 'mc' ? a.input.index : a.input.kind === 'tf' ? (a.input.value ? 0 : 1) : -1;
      if (idx >= 0 && idx < distribution.length) distribution[idx]! += 1;
    }
  }

  const reveal: TriviaRevealView = {
    seq: view.seq,
    type: view.type,
    correctText: key.correctText,
    answeredCount: ctx.answers.length,
    correctCount,
    results,
    ...(key.correctIndex !== undefined ? { correctIndex: key.correctIndex } : {}),
    ...(key.correctOrder ? { correctOrder: key.correctOrder } : {}),
    ...(key.correctNumber !== undefined ? { correctNumber: key.correctNumber } : {}),
    ...(key.type === 'text' && key.accept && key.accept.length > 1 ? { alsoAccepted: key.accept.slice(1) } : {}),
    ...(key.explanation ? { explanation: key.explanation } : {}),
    ...(distribution ? { distribution } : {}),
    ...(key.type === 'number' ? { closest } : {}),
  };
  return { results, streaks, reveal };
}

/** Max wager for a player: their score, or the base points when they have less. */
export function maxWager(score: number, basePoints: number): number {
  return Math.max(Math.max(0, Math.round(score)), Math.round(basePoints), TRIVIA_SCORING.minWagerCap);
}
