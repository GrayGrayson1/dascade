import type { SnakeView } from '@dascade/shared/games/snake';

/**
 * Length shown in the HUD. The server clears a crashed snake's body, so while it is down (or after
 * the game over) show the length it reached — the same number the verified result reports.
 */
export function shownLength(v: Pick<SnakeView, 'alive' | 'length' | 'best'> | undefined): number {
  if (!v) return 0;
  return v.alive ? v.length : Math.max(v.best, v.length);
}
