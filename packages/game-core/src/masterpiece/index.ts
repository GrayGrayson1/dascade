/**
 * @dascade/game-core/masterpiece — pure DASterpiece rules: the prompt pack and deck, round planning
 * (who answers what, head-to-head vs galleries), the ballot box (self-vote, duplicate and lock rules)
 * and scoring (votes, winner, sweep, audience, walkover, standings, awards). No Colyseus, no DOM.
 */
export { PROMPT_PACK, SAFETY_ANSWERS, builtInPromptCount } from './prompts.ts';
export { PromptDeck, deckThemes, fillPlayerToken, type DeckOptions, type DeckPrompt } from './deck.ts';
export { balancedSizes, planRound, resolveShowdown, roundKind, type ResolvedShowdown, type RoundPlan, type ShowdownFormat, type WrittenEntry } from './plan.ts';
export { ShowdownBallots, type Ballot, type BallotAnswer, type BallotError, type CastResult } from './ballots.ts';
export { WriteDesk, type DeskPrompt, type DeskSubmitResult } from './desk.ts';
export {
  computeAwards,
  emptyStats,
  tallyShowdown,
  walkoverPoints,
  type AnswerTally,
  type WriterStats,
} from './scoring.ts';
