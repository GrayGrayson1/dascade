import type { GameId } from '@dascade/shared';
import type { GameClientModule } from './types.ts';

/** Lazy loaders — each game's code (and Phaser, where used) loads only when entered. */
export const GAME_MODULES: Record<GameId, () => Promise<{ default: GameClientModule }>> = {
  dasketch: () => import('./dasketch/index.tsx'),
  holdem: () => import('./holdem/index.tsx'),
  blackjack: () => import('./blackjack/index.tsx'),
  bingo: () => import('./bingo/index.tsx'),
  wheel: () => import('./wheel/index.tsx'),
  dasino: () => import('./dasino/index.tsx'),
  circuit: () => import('./circuit/index.tsx'),
  quest: () => import('./quest/index.tsx'),
};

const cache = new Map<GameId, Promise<GameClientModule>>();

export function loadGameModule(id: GameId): Promise<GameClientModule> {
  let p = cache.get(id);
  if (!p) {
    p = GAME_MODULES[id]().then((m) => m.default);
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}
