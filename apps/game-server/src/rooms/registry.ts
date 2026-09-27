import { GAME_IDS, type GameId } from '@dascade/shared';
import type { BaseGameRoom } from './BaseGameRoom.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameRoom = new () => BaseGameRoom<any, any>;

/** Lazy room loaders (Colyseus room name === GameId). */
export const ROOM_LOADERS: Record<GameId, () => Promise<AnyGameRoom>> = {
  dasketch: async () => (await import('./dasketch/DasketchRoom.ts')).DasketchRoom,
  holdem: async () => (await import('./holdem/HoldemRoom.ts')).HoldemRoom,
  blackjack: async () => (await import('./blackjack/BlackjackRoom.ts')).BlackjackRoom,
  bingo: async () => (await import('./bingo/BingoRoom.ts')).BingoRoom,
  wheel: async () => (await import('./wheel/WheelRoom.ts')).WheelRoom,
  dasino: async () => (await import('./dasino/DasinoRoom.ts')).DasinoRoom,
  circuit: async () => (await import('./circuit/CircuitRoom.ts')).CircuitRoom,
  quest: async () => (await import('./quest/QuestRoom.ts')).QuestRoom,
  chess: async () => (await import('./chess/ChessRoom.ts')).ChessRoom,
  checkers: async () => (await import('./checkers/CheckersRoom.ts')).CheckersRoom,
  ships: async () => (await import('./ships/ShipsRoom.ts')).ShipsRoom,
  trivia: async () => (await import('./trivia/TriviaRoom.ts')).TriviaRoom,
  deception: async () => (await import('./deception/DeceptionRoom.ts')).DeceptionRoom,
  masterpiece: async () => (await import('./masterpiece/MasterpieceRoom.ts')).MasterpieceRoom,
  words: async () => (await import('./words/WordsRoom.ts')).WordsRoom,
  survey: async () => (await import('./survey/SurveyRoom.ts')).SurveyRoom,
  putt: async () => (await import('./putt/PuttRoom.ts')).PuttRoom,
  tanks: async () => (await import('./tanks/TanksRoom.ts')).TanksRoom,
  paddle: async () => (await import('./paddle/PaddleRoom.ts')).PaddleRoom,
  snake: async () => (await import('./snake/SnakeRoom.ts')).SnakeRoom,
  bricks: async () => (await import('./bricks/BricksRoom.ts')).BricksRoom,
  asteroids: async () => (await import('./asteroids/AsteroidsRoom.ts')).AsteroidsRoom,
  memory: async () => (await import('./memory/MemoryRoom.ts')).MemoryRoom,
  blocks: async () => (await import('./blocks/BlocksRoom.ts')).BlocksRoom,
  tournament: async () => (await import('./tournament/TournamentRoom.ts')).TournamentRoom,
};

/**
 * Loads room classes. In development a broken game module is logged and skipped so the
 * other cabinets keep working; in production any failure is fatal.
 * DASCADE_ONLY_GAMES=wheel,bingo limits which rooms load (handy for focused dev/testing).
 */
export async function loadRoomClasses(
  only: readonly GameId[] | undefined,
  strict: boolean,
  onError: (id: GameId, err: unknown) => void,
): Promise<Partial<Record<GameId, AnyGameRoom>>> {
  const ids = only ?? GAME_IDS; // undefined = all, [] = none
  const out: Partial<Record<GameId, AnyGameRoom>> = {};
  for (const id of ids) {
    try {
      out[id] = await ROOM_LOADERS[id]();
    } catch (err) {
      if (strict) throw err;
      onError(id, err);
    }
  }
  return out;
}
