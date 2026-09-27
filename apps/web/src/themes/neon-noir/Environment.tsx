/**
 * Neon Noir environment: the rain-soaked district behind the whole app.
 *
 *  - fx high: 30 fps, full rain, drifting fog, ripples, animated signage.
 *  - fx low: 15 fps, lighter rain, no ripples.
 *  - fx off / reduced motion: one static frame (no loop at all).
 *  - In a game (`place === 'game'`) it paints one calm static frame and stops.
 * The loop runs on the arcade's shared scheduler, which parks while the tab is hidden.
 * On the arcade floor the street's horizon lines up with the centred cabinet so the lineup
 * stands on the wet pavement.
 */
import { useEffect, useRef } from 'react';
import { addFrameJob, clockNow } from '../../arcade/scheduler.ts';
import type { SkinRenderContext } from '../types.ts';
import { NoirScene, type NoirOptions } from './scene.ts';

const HORIZON: Record<SkinRenderContext['place'], number> = {
  floor: 0.62,
  cabinet: 0.7,
  entry: 0.7,
  lobby: 0.72,
  game: 0.74,
  tournament: 0.72,
  other: 0.7,
};

/** Where the centred cabinet's control deck sits (the street horizon on the floor), 0–1 of the viewport. */
function measureFloorHorizon(): number | null {
  const body = document.querySelector<HTMLElement>(".af-slot[data-active='true'] .af-cab__body");
  if (!body) return null;
  const r = body.getBoundingClientRect();
  if (r.height < 40 || !window.innerHeight) return null;
  return (r.top + r.height * 0.6) / window.innerHeight;
}

/** DEV only: rolling frame-cost stats on window.__NN_ENV_STATS__ (read by the perf check in QA). */
function profiled(fn: (t: number) => void): (t: number) => void {
  const w = window as unknown as { __NN_ENV_STATS__?: { frames: number; total: number; max: number } };
  const stats = (w.__NN_ENV_STATS__ ??= { frames: 0, total: 0, max: 0 });
  return (t) => {
    const t0 = performance.now();
    fn(t);
    const ms = performance.now() - t0;
    stats.frames += 1;
    stats.total += ms;
    if (ms > stats.max) stats.max = ms;
  };
}

export default function NoirEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<NoirScene | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scene: NoirScene;
    try {
      scene = sceneRef.current ?? (sceneRef.current = new NoirScene(el));
    } catch {
      return; // no 2D canvas: the CSS backdrop underneath still reads as night
    }
    const live = !reducedMotion && fx !== 'off' && place !== 'game';
    const opts: NoirOptions = {
      rain: fx === 'off' ? 0 : place === 'game' ? 0.25 : fx === 'low' ? 0.45 : place === 'floor' ? 1 : 0.75,
      motion: live,
      ripples: live && fx === 'high',
    };
    // Reduced motion keeps a light, frozen rain texture; fx off shows no rain at all.
    if (reducedMotion && fx !== 'off') opts.rain = Math.min(opts.rain, 0.35);

    let horizon = HORIZON[place];
    let size = '';
    const relayout = (force = false) => {
      if (place === 'floor') horizon = measureFloorHorizon() ?? HORIZON.floor;
      const key = `${window.innerWidth}x${window.innerHeight}@${horizon.toFixed(3)}`;
      if (!force && key === size) return;
      size = key;
      scene.layout(window.innerWidth, window.innerHeight, horizon, place !== 'floor');
      scene.frame(clockNow(), opts);
    };
    relayout(true);

    const timers = place === 'floor' ? [120, 600, 1500].map((ms) => window.setTimeout(() => relayout(), ms)) : [];
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => relayout(), 120);
    };
    window.addEventListener('resize', onResize);
    const tick = import.meta.env.DEV ? profiled((t: number) => scene.frame(t, opts)) : (t: number) => scene.frame(t, opts);
    const stop = live ? addFrameJob(tick, { fps: fx === 'low' ? 15 : 30 }) : null;
    return () => {
      stop?.();
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, [fx, reducedMotion, place]);

  return (
    <div className="nn-env" aria-hidden data-place={place}>
      <canvas ref={ref} className="nn-env__canvas" />
      <div className="nn-env__shade" />
    </div>
  );
}
