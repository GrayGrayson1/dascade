/**
 * DAScade Classics — server kit.
 *  - ClassicsRoom: standings, instant solo, multiplayer match flow, outcomes, high scores.
 *  - VerifiedClassicsRoom: authority model 2 (client sim + server replay of the input log).
 *  - IntentQueue (from game-core): authority model 1 input queue for server-simulated games.
 *  - highScores / registerClassicsRoutes: verified high-score boards + GET /api/classics/scores/:gameId.
 */
export { ClassicsRoom, type FinishInfo } from './ClassicsRoom.ts';
export { VerifiedClassicsRoom } from './VerifiedClassicsRoom.ts';
export { VerifiedRun, type IngestResult } from './VerifiedRun.ts';
export { ClassicsMeta, ClassicsStanding, ClassicsState } from './schema.ts';
export { HighScoreService, highScores, type HighScorePersistence, type HighScoreSubmission, type RecordResult } from './highScores.ts';
export { registerClassicsRoutes } from './scoresRoute.ts';
export { IntentQueue, intentBits, ByteWriter, ByteReader } from '@dascade/game-core/classics/shared';
