/**
 * Lobby prewarm: while players pick racers, fetch the renderer chunk (three.js) and build the
 * chosen track in idle time, so the 4-second start sequence isn't spent behind a loading card.
 * Everything here is cached by its owner (module cache, `getKartTrack`), so calling it again is
 * free; failures are ignored (the race stage loads on demand anyway).
 */
import type { KartTrackId } from '@dascade/shared/games/kart';
import { getKartTrack } from '@dascade/game-core/kart';

let rendererChunk: Promise<unknown> | null = null;

function idle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 1500 });
  else setTimeout(fn, 200);
}

export function prewarmRace(trackId: KartTrackId | null | undefined): void {
  idle(() => {
    rendererChunk ??= import('./render/renderer.ts').catch(() => {
      rendererChunk = null;
    });
    if (!trackId) return;
    idle(() => {
      try {
        getKartTrack(trackId);
      } catch {
        /* the stage reports track problems */
      }
    });
  });
}
