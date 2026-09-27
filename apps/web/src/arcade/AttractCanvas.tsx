/**
 * A cabinet screen: a tiny canvas running an attract playlist on the shared
 * frame scheduler. Pauses off-screen / in hidden tabs, renders a single still
 * frame with reduced motion or effects off, and only animates while `running`
 * (the lineup runs just the centred cabinet and its neighbours).
 */
import { useEffect, useRef } from 'react';
import type { GameAccent } from '@dascade/shared';
import { useApp } from '../app/store.ts';
import { drawAttract, type SceneId } from './attract.ts';
import { addFrameJob, clockNow } from './scheduler.ts';

export interface AttractCanvasProps {
  /** Scene playlist (one scene loops; several cycle with channel changes). */
  scenes: readonly SceneId[];
  /** Marquee title for the HUD band. */
  title: string;
  accent: GameAccent;
  active?: boolean;
  /** Animate (true) or hold a representative still (false). */
  running?: boolean;
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

export function AttractCanvas({
  scenes,
  title,
  accent,
  active = false,
  running = true,
  fit = 'exact',
  resolution = 84,
  hud = true,
  fps = 24,
  offset = 0,
  className,
}: AttractCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const live = !reduced && fx !== 'off' && running;
  const state = useRef({ active, live, W: 0, H: 0, lastT: 0 });
  state.current.active = active;
  state.current.live = live;
  const scenesKey = scenes.join(',');

  const paint = useRef<(t?: number) => void>(() => undefined);
  paint.current = (t?: number) => {
    const canvas = ref.current;
    const s = state.current;
    if (!canvas || !s.W) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // A paused (not running) screen keeps its last live frame when it has one; motion-off shows the still.
    const motionOff = reduced || fx === 'off';
    const time = t ?? (s.lastT || clockNow() + offset);
    if (t !== undefined) s.lastT = t;
    drawAttract({ ctx, W: s.W, H: s.H, t: time, active: s.active, hud, still: motionOff || (!s.live && !s.lastT), scenes, title, accent });
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
        // Measure the untransformed box: the lineup scales cabinets with CSS transforms.
        const w = host.clientWidth || r.width;
        const h = host.clientHeight || r.height;
        if (w < 4 || h < 4) return;
        const dpr = window.devicePixelRatio || 1;
        const devW = w * dpr;
        const devH = h * dpr;
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
    return addFrameJob((t) => paint.current(t + offset), { fps: fx === 'low' ? Math.min(fps, 15) : fps, el: canvas });
  }, [live, fps, fx, offset, scenesKey]);

  // Repaint immediately when the active state flips (HUD text changes).
  useEffect(() => {
    if (!live) paint.current();
  }, [active, live]);

  return <canvas ref={ref} className={className ?? 'af-attract'} aria-hidden />;
}
