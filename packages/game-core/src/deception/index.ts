/**
 * @dascade/game-core/deception — pure DASception rules: role dealing, night resolution,
 * the day vote tally and the match state machine. No Colyseus, no DOM.
 */
export { dealRoles, roleDeck, teamMembers } from './roles.ts';
export { resolveNight, type NightInput, type NightOutcome } from './night.ts';
export { tallyVotes, type CastVote, type VoteInput, type VoteOutcome, type VoteOutcomeKind } from './vote.ts';
export {
  DECEPTION_POINTS,
  DeceptionGame,
  type DeceptionErrorCode,
  type DeceptionResult,
  type DeceptionSeat,
  type DeceptionWin,
} from './game.ts';
