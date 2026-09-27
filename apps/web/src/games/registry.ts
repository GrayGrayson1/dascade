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
  kart: () => import('./kart/index.tsx'),
  quest: () => import('./quest/index.tsx'),
  chess: () => import('./chess/index.tsx'),
  checkers: () => import('./checkers/index.tsx'),
  ships: () => import('./ships/index.tsx'),
  trivia: () => import('./trivia/index.tsx'),
  deception: () => import('./deception/index.tsx'),
  masterpiece: () => import('./masterpiece/index.tsx'),
  words: () => import('./words/index.tsx'),
  survey: () => import('./survey/index.tsx'),
  putt: () => import('./putt/index.tsx'),
  tanks: () => import('./tanks/index.tsx'),
  paddle: () => import('./paddle/index.tsx'),
  snake: () => import('./snake/index.tsx'),
  bricks: () => import('./bricks/index.tsx'),
  asteroids: () => import('./asteroids/index.tsx'),
  memory: () => import('./memory/index.tsx'),
  blocks: () => import('./blocks/index.tsx'),
  tournament: () => import('./tournament/index.tsx'),
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
