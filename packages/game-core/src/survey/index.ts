/**
 * DAS Survey engine — anonymous answer collection, tallies, prediction scoring, question
 * planning, standings, awards and recap. Pure and deterministic (inject an Rng).
 */
export { SurveyBook, isValidPrediction, type BookRejectReason, type BookResult } from './book.ts';
export { countVotes, leaders, rankSlots, sharePercents, spread } from './tally.ts';
export {
  PERCENT_HIT_WINDOW,
  isPermutation,
  maxRankDistance,
  percentErrorScaled,
  percentPoints,
  rankDistance,
  rankPoints,
  scoreMajority,
  scorePercent,
  scoreRank,
  type PredictionEntry,
} from './scoring.ts';
export { QuestionDeck, plannedCount, poolFor, type PlanInput } from './deck.ts';
export { SURVEY_PACKS, ALL_SURVEY_QUESTIONS } from './packs.ts';
export { SurveyStats, buildRecap, historyEntry, placeStandings, placementGroups, type ScoreRow } from './stats.ts';
