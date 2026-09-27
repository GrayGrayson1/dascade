/**
 * Prediction scoring. Every rule is deterministic and documented here + in the in-game rules:
 *
 * Majority Mind
 *   +1000 if you predicted a leading option. A tie for the lead counts every tied leader as
 *   correct. +250 "Called it" when you were right and fewer than half of the predictors were.
 *
 * Rank the Room (Spearman footrule with tie ranges)
 *   Options tied on votes share a rank range lo..hi; placing an option anywhere inside its range
 *   costs nothing, otherwise it costs the distance to the nearest end of the range. Points =
 *   1000 − spotsOff × (1000 / ⌊n²/2⌋), never below 0 (⌊n²/2⌋ is the worst possible total, so a
 *   fully reversed order scores 0). +250 "Perfect order" for zero spots off.
 *
 * Guess the Percentage
 *   Points = 1000 − 20 × (percentage points off), never below 0, where the true share is exact
 *   (e.g. 2 of 3 = 66.67%). +250 "Closest" to the closest prediction(s); ties for closest all get
 *   it. Closeness is compared in exact integer arithmetic (|guess·N − 100·votes|), so equal
 *   distances are always detected as ties.
 */
import {
  SURVEY_SCORING,
  roundPercent,
  type SurveyPlayerScore,
  type SurveyPrediction,
  type SurveyRankSlot,
} from '@dascade/shared/games/survey';

export interface PredictionEntry<P extends SurveyPrediction = SurveyPrediction> {
  playerId: string;
  prediction: P;
}

function entry(playerId: string, base: number, bonus: number, bonusLabel: string, hit: boolean, off: number): SurveyPlayerScore {
  return { playerId, points: base + bonus, base, bonus: bonus, bonusLabel: bonus > 0 ? bonusLabel : '', hit, off };
}

/** Stable sort: most points first, ties keep the input order (the room passes join order). */
function bestFirst(scores: SurveyPlayerScore[]): SurveyPlayerScore[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.points - a.s.points || a.i - b.i)
    .map(({ s }) => s);
}

export function scoreMajority(
  predictions: ReadonlyArray<PredictionEntry<{ kind: 'majority'; option: number }>>,
  leaderOptions: readonly number[],
): SurveyPlayerScore[] {
  const lead = new Set(leaderOptions);
  const correct = predictions.filter((p) => lead.has(p.prediction.option)).length;
  const calledIt = correct * 2 < predictions.length;
  return bestFirst(
    predictions.map(({ playerId, prediction }) => {
      const hit = lead.has(prediction.option);
      return entry(
        playerId,
        hit ? SURVEY_SCORING.majorityCorrect : 0,
        hit && calledIt ? SURVEY_SCORING.majorityCalledIt : 0,
        'Called it',
        hit,
        0,
      );
    }),
  );
}

/** True when `order` is a permutation of 0..n-1. */
export function isPermutation(order: readonly number[], n: number): boolean {
  if (order.length !== n) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/**
 * Total spots off for a predicted order (option indices, most votes first) against the final
 * slots. Returns null for an invalid order.
 */
export function rankDistance(order: readonly number[], slots: readonly SurveyRankSlot[]): number | null {
  if (!isPermutation(order, slots.length)) return null;
  const byOption = new Map(slots.map((s) => [s.option, s]));
  let total = 0;
  order.forEach((option, i) => {
    const slot = byOption.get(option);
    if (!slot) return;
    const r = i + 1;
    total += r < slot.lo ? slot.lo - r : r > slot.hi ? r - slot.hi : 0;
  });
  return total;
}

/** Worst possible total distance for n options (a fully reversed order): ⌊n²/2⌋. */
export function maxRankDistance(n: number): number {
  return Math.floor((n * n) / 2);
}

export function rankPoints(distance: number, n: number): number {
  const max = maxRankDistance(n);
  if (max === 0) return SURVEY_SCORING.rankMax;
  return Math.max(0, Math.round(SURVEY_SCORING.rankMax - (distance * SURVEY_SCORING.rankMax) / max));
}

export function scoreRank(
  predictions: ReadonlyArray<PredictionEntry<{ kind: 'rank'; order: number[] }>>,
  slots: readonly SurveyRankSlot[],
): SurveyPlayerScore[] {
  const n = slots.length;
  const out: SurveyPlayerScore[] = [];
  for (const { playerId, prediction } of predictions) {
    const d = rankDistance(prediction.order, slots);
    if (d === null) continue;
    out.push(entry(playerId, rankPoints(d, n), d === 0 ? SURVEY_SCORING.rankPerfect : 0, 'Perfect order', d === 0, d));
  }
  return bestFirst(out);
}

/** |guess·N − 100·votes|: N × (percentage points off). Integer, so ties compare exactly. */
export function percentErrorScaled(guess: number, votes: number, respondents: number): number {
  return Math.abs(guess * respondents - 100 * votes);
}

export function percentPoints(errorScaled: number, respondents: number): number {
  if (respondents <= 0) return 0;
  return Math.max(0, Math.round(SURVEY_SCORING.percentMax - (SURVEY_SCORING.percentPerPoint * errorScaled) / respondents));
}

/** A prediction within this many percentage points counts as a "hit" for recap stats. */
export const PERCENT_HIT_WINDOW = 5;

export function scorePercent(
  predictions: ReadonlyArray<PredictionEntry<{ kind: 'percent'; percent: number }>>,
  targetVotes: number,
  respondents: number,
): { scores: SurveyPlayerScore[]; closest: string[] } {
  if (respondents <= 0) return { scores: [], closest: [] };
  const errors = predictions.map((p) => ({ p, err: percentErrorScaled(p.prediction.percent, targetVotes, respondents) }));
  const best = errors.length ? Math.min(...errors.map((e) => e.err)) : 0;
  const closest = errors.filter((e) => e.err === best).map((e) => e.p.playerId);
  const scores = errors.map(({ p, err }) => {
    const isClosest = err === best;
    return entry(
      p.playerId,
      percentPoints(err, respondents),
      isClosest ? SURVEY_SCORING.percentClosest : 0,
      err === 0 ? 'Bullseye' : 'Closest',
      err <= PERCENT_HIT_WINDOW * respondents,
      roundPercent(err / respondents),
    );
  });
  return { scores: bestFirst(scores), closest };
}
