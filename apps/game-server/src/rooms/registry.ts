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
