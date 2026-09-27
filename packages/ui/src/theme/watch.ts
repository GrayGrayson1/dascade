/**
 * watchThemeTokens(el, cb) — for Canvas / Phaser code outside React.
 *
 *   const stop = watchThemeTokens(stageEl, (t) => scene.applyPalette(t));   // called now + on change
 *   this.events.once('shutdown', stop);
 *
 * Calls `cb` with readThemeTokens(el) immediately (unless `immediate: false`) and again whenever the
 * theme, visual-effects level or reduced-motion setting changes — coalesced to one call per animation
 * frame, so rapid switching never floods a renderer. `el` should be inside <GameStage data-game>, so
 * per-game material nudges and the game's accent are in scope. Returns a dispose function (idempotent).
 */
import { readThemeTokens } from './read.ts';
import { subscribeThemeTokens } from './react.ts';
import type { ThemeTokens } from './types.ts';

export interface WatchThemeOptions {
  /** Call `cb` right away with the current tokens (default true). */
  immediate?: boolean;
}

export function watchThemeTokens(
  el: Element | null | undefined | (() => Element | null | undefined),
  cb: (tokens: ThemeTokens) => void,
  opts: WatchThemeOptions = {},
): () => void {
  const target = () => (typeof el === 'function' ? el() : el) ?? null;
  let disposed = false;
  let frame: number | ReturnType<typeof setTimeout> | null = null;
  const hasRaf = typeof requestAnimationFrame === 'function';
  const fire = () => {
    frame = null;
    if (disposed) return;
    cb(readThemeTokens(target()));
  };
  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = hasRaf ? requestAnimationFrame(fire) : setTimeout(fire, 0);
  };
  const off = subscribeThemeTokens(schedule);
  if (opts.immediate !== false) cb(readThemeTokens(target()));
  return () => {
    if (disposed) return;
    disposed = true;
    off();
    if (frame !== null) {
      if (hasRaf) cancelAnimationFrame(frame as number);
      else clearTimeout(frame as ReturnType<typeof setTimeout>);
      frame = null;
    }
  };
}
