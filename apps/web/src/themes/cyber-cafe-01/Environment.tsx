/**
 * Cyber Café 2001 environment: a deep CRT-blue café behind the whole app — a gliding grid floor,
 * the café network (stations, hubs, servers, packets on the cables), Y2K bubbles and a wireframe globe.
 *
 *  - fx high: 24 fps, everything. fx low: 12 fps, half the packets, no bubbles/globe motion.
 *  - fx off / reduced motion: one still frame, no loop.
 *  - In a game (place === 'game') the stage covers it; it paints one dim still frame and stops.
 * The loop runs on the arcade's shared scheduler (parks while the tab is hidden). The canvas is the
 * viewport size inside the host's `contain: strict; overflow: hidden` layer, so nothing overflows.
 */
import { useEffect, useRef } from 'react';
import { addFrameJob, clockNow } from '../../arcade/scheduler.ts';
import type { SkinRenderContext } from '../types.ts';
import { CafeScene, type CafeOptions } from './scene.ts';

const HORIZON: Record<SkinRenderContext['place'], number> = {
  floor: 0.64,
  cabinet: 0.72,
  entry: 0.74,
  lobby: 0.78,
  game: 0.8,
  tournament: 0.8,
  other: 0.76,
};

/** The centred cabinet's base on the arcade floor (the grid horizon), 0–1 of the viewport. */
function measureFloorHorizon(): number | null {
  const body = document.querySelector<HTMLElement>(".af-slot[data-active='true'] .af-cab__body");
  if (!body) return null;
  const r = body.getBoundingClientRect();
  if (r.height < 40 || !window.innerHeight) return null;
  return Math.min(0.85, Math.max(0.45, (r.top + r.height * 0.55) / window.innerHeight));
}

export default function CafeEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CafeScene | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scene: CafeScene;
    try {
      scene = sceneRef.current ?? (sceneRef.current = new CafeScene(el));
    } catch {
      return; // no canvas: the CSS gradient underneath still reads as the café
    }
    const calm = place === 'game';
    const live = !reducedMotion && fx !== 'off' && !calm;
    const opts: CafeOptions = {
      intensity: calm ? 0.45 : place === 'floor' ? 1 : 0.7,
      motion: live,
      packets: fx === 'high' ? 1 : 0.5,
      flourishes: fx !== 'off',
    };
    let horizon = HORIZON[place];
    let key = '';
    const relayout = (force = false) => {
      if (place === 'floor') horizon = measureFloorHorizon() ?? HORIZON.floor;
      const k = `${window.innerWidth}x${window.innerHeight}@${horizon.toFixed(3)}`;
      if (!force && k === key) return;
      key = k;
      scene.layout(window.innerWidth, window.innerHeight, horizon, fx === 'high' ? 1.5 : 1);
      scene.frame(clockNow(), opts);
    };
    relayout(true);
    const timers = place === 'floor' ? [150, 700, 1600].map((ms) => window.setTimeout(() => relayout(), ms)) : [];
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => relayout(), 140);
    };
    window.addEventListener('resize', onResize);
    const stop = live ? addFrameJob((t) => scene.frame(t, opts), { fps: fx === 'low' ? 12 : 24 }) : null;
    return () => {
      stop?.();
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, [fx, reducedMotion, place]);

  return (
    <div className="cc-env" data-place={place}>
      <canvas ref={ref} className="cc-env__canvas" />
      <div className="cc-env__glass" />
    </div>
  );
}
