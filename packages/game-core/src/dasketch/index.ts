/**
 * @dascade/game-core/dasketch — pure DASketch rules: word bank + picking, guess checking,
 * hints, scoring, artist rotation and the drawing op log. No Colyseus, no DOM.
 */
export { WORD_BANK } from './words.ts';
export { buildWordPool, wordPoolSize, WordPicker, type WordPool, type WordPoolSettings } from './pool.ts';
export { classifyGuess, closeThreshold, type GuessVerdict } from './guess.ts';
export { hintRevealCount, hintSchedule, letterIndices, maskWord, pickRevealIndex, wordLengths } from './hints.ts';
export {
  ARTIST_ALL_GUESSED_BONUS,
  ARTIST_SHARE,
  GUESS_MIN_POINTS,
  GUESS_SPEED_POINTS,
  RANK_BONUS,
  artistShare,
  guessPoints,
  rankStandings,
  type StandingInput,
} from './scoring.ts';
export { TurnOrder } from './turns.ts';
export { SketchBoard, isFreehand, pointsInBounds, type ApplyResult, type BoardRejectReason } from './board.ts';
