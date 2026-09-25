/**
 * A cabinet screen: a tiny canvas running the game's attract loop on the
 * shared frame scheduler. Pauses off-screen / in hidden tabs, and renders a
 * single still frame with reduced motion or effects off.
 */
import { useEffect, useRef } from 'react';
import type { GameCatalogEntry } from '@dascade/shared';
import { useApp } from '../app/store.ts';
import { drawAttract, stillTime } from './attract.ts';
import { addFrameJob, clockNow } from './scheduler.ts';

export interface AttractCanvasProps {
  game: GameCatalogEntry;
  active?: boolean;
  /**
   * 'exact' sizes the canvas to its parent with whole device pixels per art
   * pixel (crisp cabinet screens); 'cover' renders a fixed 4:3 frame that CSS
   * stretches over a large area (background art).
   */
  fit?: 'exact' | 'cover';
  /** Approximate logical width in art pixels. */
  resolution?: number;
  hud?: boolean;
  fps?: number;
  /** Time offset so neighbouring cabinets don't animate in lockstep. */
  offset?: number;
  className?: string;
}

export function AttractCanvas({ game, active = false, fit = 'exact', resolution = 84, hud = true, fps = 24, offset = 0, className }: AttractCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const live = !reduced && fx !== 'off';
  const state = useRef({ active, live, W: 0, H: 0 });
  state.current.active = active;
  state.current.live = live;

  const paint = useRef<(t?: number) => void>(() => undefined);
  paint.current = (t?: number) => {
    const canvas = ref.current;
    const s = state.current;
    if (!canvas || !s.W) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = !s.live;
    drawAttract({ ctx, W: s.W, H: s.H, t: still ? stillTime(game.id) : (t ?? clockNow()) + offset, active: s.active, hud, still, game });
  };

  // Size the backing store.
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const resize = () => {
      let W: number;
      let H: number;
      if (fit === 'cover') {
        W = resolution;
        H = Math.round(resolution * 0.75);
      } else {
        const r = host.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const dpr = window.devicePixelRatio || 1;
        const devW = r.width * dpr;
        const devH = r.height * dpr;
        const k = Math.max(1, Math.round(devW / resolution));
        W = Math.max(40, Math.floor(devW / k));
        H = Math.max(30, Math.floor(devH / k));
        canvas.style.width = `${(W * k) / dpr}px`;
        canvas.style.height = `${(H * k) / dpr}px`;
      }
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      state.current.W = W;
      state.current.H = H;
      paint.current();
    };
    resize();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit, resolution]);

  // Animate (or paint a still).
  useEffect(() => {
    paint.current();
    if (!live) return;
    const canvas = ref.current;
    return addFrameJob((t) => paint.current(t), { fps: fx === 'low' ? Math.min(fps, 15) : fps, el: canvas });
  }, [live, fps, fx]);

  // Repaint the still immediately when the active state flips.
  useEffect(() => {
    if (!live) paint.current();
  }, [active, live]);

  return <canvas ref={ref} className={className ?? 'af-attract'} aria-hidden />;
}
