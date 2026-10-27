/**
 * DAS Survey Showdown engine — the show state machine, the audience guess book and the built-in
 * question packs. Pure and deterministic (inject an Rng). SERVER-ONLY: the packs are hidden answers,
 * so the web client must never import this module (it uses @dascade/shared/games/showdown).
 */
export {
  boardView,
  createShow,
  currentRound,
  finalizeShow,
  nextSweepSlot,
  revealedIn,
  sheetView,
  showWinner,
  specialSlot,
  step,
  type CreateShowOptions,
  type ShowCommand,
  type ShowRound,
  type ShowState,
  type SlotState,
  type StepFailure,
  type StepResult,
  type StepSuccess,
} from './engine.ts';
export { GUESS_REJECTION_TEXT, GuessBook, matchSlot, type GuessRejection, type SubmitResult } from './guesses.ts';
export { SHOWDOWN_PACKS, pickRounds } from './packs.ts';
export { SHOWDOWN_EVENT_ROUNDS } from './events.ts';
export { DEFAULT_PICK_RULES, drawPick, inDraw, pickPool, type PickRules, type PickSeat } from './picker.ts';
