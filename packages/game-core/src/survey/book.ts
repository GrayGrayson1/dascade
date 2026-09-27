/**
 * SurveyBook — anonymous answer + prediction collection for ONE question.
 *
 *  - One answer per player (or one "skip"): later attempts are rejected as duplicates, so a
 *    replayed or double-tapped message can never count twice.
 *  - One prediction per player, locked on arrival. While answering is open a player must answer
 *    (or skip) before predicting; once answering has closed anyone seated may predict.
 *  - `tally()` turns answers into anonymous counts and computes the public SurveyResult.
 *    `discardAnswers()` then forgets who answered what — only the counts survive.
 *  - `withdraw()` drops a player who left for good: a player who leaves and rejoins gets a new
 *    seat, so their first answer must not stay in the tally (one person, one answer).
 */
import {
  SURVEY_LIMITS,
  type SurveyPlayerScore,
  type SurveyPrediction,
  type SurveyQuestion,
  type SurveyResult,
} from '@dascade/shared/games/survey';
import { countVotes, leaders, rankSlots, sharePercents } from './tally.ts';
import { isPermutation, scoreMajority, scorePercent, scoreRank, type PredictionEntry } from './scoring.ts';

export type BookRejectReason = 'closed' | 'duplicate' | 'invalid' | 'answer_first';
export type BookResult = { ok: true } | { ok: false; reason: BookRejectReason };

const OK: BookResult = { ok: true };
const fail = (reason: BookRejectReason): BookResult => ({ ok: false, reason });

/** Checks a prediction's shape against a question (kind, option range, permutation, 0–100). */
export function isValidPrediction(question: SurveyQuestion, prediction: SurveyPrediction): boolean {
  if (prediction.kind !== question.mode) return false;
  const n = question.options.length;
  switch (prediction.kind) {
    case 'majority':
      return Number.isInteger(prediction.option) && prediction.option >= 0 && prediction.option < n;
    case 'rank':
      return isPermutation(prediction.order, n);
    case 'percent':
      return Number.isInteger(prediction.percent) && prediction.percent >= 0 && prediction.percent <= 100;
  }
}

export class SurveyBook {
  /** playerId → option index, or null for "skip". Cleared by discardAnswers(). */
  private answers = new Map<string, number | null>();
  /** Who has answered or skipped (never what) — public information anyway. */
  private readonly answeredIds = new Set<string>();
  private readonly predictions = new Map<string, SurveyPrediction>();
  private answersOpen = true;
  private predictionsOpen = true;
  private tallied: { counts: number[]; respondents: number } | null = null;

  constructor(
    readonly question: SurveyQuestion,
    /** Question serial (guards against stale messages from an earlier question). */
    readonly serial: number,
  ) {}

  get isAnswering(): boolean {
    return this.answersOpen;
  }

  get isPredicting(): boolean {
    return this.predictionsOpen;
  }

  /** Record a player's own answer (option index) or a skip (null). */
  answer(playerId: string, option: number | null): BookResult {
    if (!this.answersOpen) return fail('closed');
    if (this.answeredIds.has(playerId)) return fail('duplicate');
    if (option !== null && !(Number.isInteger(option) && option >= 0 && option < this.question.options.length)) return fail('invalid');
    this.answers.set(playerId, option);
    this.answeredIds.add(playerId);
    return OK;
  }

  predict(playerId: string, prediction: SurveyPrediction): BookResult {
    if (!this.predictionsOpen) return fail('closed');
    if (this.predictions.has(playerId)) return fail('duplicate');
    if (!isValidPrediction(this.question, prediction)) return fail('invalid');
    if (this.answersOpen && !this.answeredIds.has(playerId)) return fail('answer_first');
    this.predictions.set(playerId, clonePrediction(prediction));
    return OK;
  }

  closeAnswers(): void {
    this.answersOpen = false;
  }

  /**
   * A player left the room for good: forget their answer (while answering is open — afterwards only
   * anonymous counts exist) and their prediction (while predictions are open). Returns true when
   * something was removed.
   */
  withdraw(playerId: string): boolean {
    let changed = false;
    if (this.answersOpen && this.answeredIds.delete(playerId)) {
      this.answers.delete(playerId);
      changed = true;
    }
    if (this.predictionsOpen && this.predictions.delete(playerId)) changed = true;
    return changed;
  }

  closePredictions(): void {
    this.answersOpen = false;
    this.predictionsOpen = false;
  }

  hasAnswered(playerId: string): boolean {
    return this.answeredIds.has(playerId);
  }

  hasPredicted(playerId: string): boolean {
    return this.predictions.has(playerId);
  }

  /** The player's own answer (for their private echo only). undefined = not answered or already discarded. */
  answerOf(playerId: string): number | null | undefined {
    return this.answers.get(playerId);
  }

  predictionOf(playerId: string): SurveyPrediction | undefined {
    const p = this.predictions.get(playerId);
    return p ? clonePrediction(p) : undefined;
  }

  /** Answers + skips recorded so far. */
  get answeredCount(): number {
    return this.answeredIds.size;
  }

  /** Real answers (skips excluded). */
  get respondents(): number {
    if (this.tallied) return this.tallied.respondents;
    let n = 0;
    for (const v of this.answers.values()) if (v !== null) n++;
    return n;
  }

  get predictedCount(): number {
    return this.predictions.size;
  }

  /** Whether enough players answered to reveal the question anonymously. */
  get meetsAnonymityFloor(): boolean {
    return this.respondents >= SURVEY_LIMITS.minRespondents;
  }

  /** Forget who answered what (keeps only the anonymous counts). Called right after the tally. */
  discardAnswers(): void {
    if (!this.tallied) this.tallied = this.countAnswers();
    this.answers = new Map();
  }

  private countAnswers(): { counts: number[]; respondents: number } {
    const votes: number[] = [];
    for (const v of this.answers.values()) if (v !== null) votes.push(v);
    return { counts: countVotes(votes, this.question.options.length), respondents: votes.length };
  }

  /**
   * Close everything and compute the public result. `order` lists player ids in the order ties
   * should be displayed (the room passes join order); predictions from anyone not in `order`
   * (e.g. players who left) are dropped. Answers are discarded afterwards.
   */
  tally(meta: { index: number; seated: number; order: readonly string[] }): SurveyResult {
    this.closePredictions();
    const { counts, respondents } = this.tallied ?? this.countAnswers();
    this.tallied = { counts, respondents };
    this.answers = new Map();
    const q = this.question;
    const n = q.options.length;
    const rank = new Map(meta.order.map((id, i) => [id, i]));
    const entries = [...this.predictions.entries()]
      .filter(([id]) => rank.has(id))
      .sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0))
      .map(([playerId, prediction]) => ({ playerId, prediction }));

    const base: SurveyResult = {
      q: this.serial,
      index: meta.index,
      question: { ...q, options: [...q.options] },
      respondents,
      seated: meta.seated,
      voided: respondents < SURVEY_LIMITS.minRespondents,
      counts: [],
      percents: [],
      leaders: [],
      ranking: [],
      actual: 0,
      predictors: entries.length,
      predictionCounts: [],
      predictedPercents: [],
      closest: [],
      scores: [],
    };
    if (base.voided) return base;

    base.counts = counts;
    base.percents = sharePercents(counts);
    base.leaders = leaders(counts);
    base.ranking = rankSlots(counts);
    let scores: SurveyPlayerScore[] = [];
    switch (q.mode) {
      case 'majority': {
        const list = entries.filter(isKind('majority'));
        base.predictionCounts = countVotes(
          list.map((e) => e.prediction.option),
          n,
        );
        scores = scoreMajority(list, base.leaders);
        break;
      }
      case 'rank': {
        scores = scoreRank(entries.filter(isKind('rank')), base.ranking);
        break;
      }
      case 'percent': {
        const target = q.target ?? 0;
        const list = entries.filter(isKind('percent'));
        base.actual = base.percents[target] ?? 0;
        base.predictedPercents = list.map((e) => e.prediction.percent).sort((a, b) => a - b);
        const scored = scorePercent(list, counts[target] ?? 0, respondents);
        scores = scored.scores;
        base.closest = scored.closest;
        break;
      }
    }
    base.scores = scores;
    return base;
  }
}

function isKind<K extends SurveyPrediction['kind']>(kind: K) {
  return (e: PredictionEntry): e is PredictionEntry<Extract<SurveyPrediction, { kind: K }>> => e.prediction.kind === kind;
}

function clonePrediction(p: SurveyPrediction): SurveyPrediction {
  return p.kind === 'rank' ? { kind: 'rank', order: [...p.order] } : { ...p };
}
