/**
 * Delta Neon environment: quiet depth behind the shell screens that sit on the page (lobby,
 * Tournament Center, loading/error). A violet nebula, a neon perspective floor fading into the dark
 * and a handful of drifting pixel motes. The arcade floor (its own pixel room), title screens,
 * cabinet pickers and game stages paint opaque backdrops, so it renders nothing there — zero cost.
 *
 * Motes: a tiny half-resolution canvas at 12–20 fps on the shared scheduler (parks on hidden tabs);
 * fx off / reduced motion = one static frame.
 */
import { useEffect, useRef } from 'react';
import { addFrameJob, clockNow } from '../../arcade/scheduler.ts';
import type { SkinRenderContext } from '../types.ts';

const COLORS = ['#ff4fd8', '#22d3ee', '#a78bfa', '#ffd23f'];

interface Mote {
  x: number;
  y: number;
  s: number;
  v: number;
  c: string;
  p: number;
}

function motes(n: number, w: number, h: number): Mote[] {
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: Math.random() * w, y: Math.random() * h, s: Math.random() < 0.25 ? 2 : 1, v: 3 + Math.random() * 7, c: COLORS[i % COLORS.length]!, p: Math.random() * 6.28 });
  }
  return out;
}

export default function DeltaEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shows = place === 'lobby' || place === 'tournament' || place === 'other';

  useEffect(() => {
    const el = ref.current;
    if (!el || !shows) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const live = !reducedMotion && fx !== 'off';
    let w = 0;
    let h = 0;
    let list: Mote[] = [];
    let last = 0;
    const size = () => {
      w = Math.max(1, Math.ceil(window.innerWidth / 2));
      h = Math.max(1, Math.ceil(window.innerHeight / 2));
      el.width = w;
      el.height = h;
      list = motes(fx === 'off' ? 0 : Math.round(Math.min(70, (w * h) / 5200) * (fx === 'low' ? 0.5 : 1)), w, h);
    };
    const draw = (t: number) => {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const m of list) {
        if (live) {
          m.y -= m.v * dt;
          if (m.y < -2) {
            m.y = h + 2;
            m.x = Math.random() * w;
          }
        }
        const tw = live ? 0.5 + 0.5 * Math.sin(t * 1.3 + m.p) : 0.7;
        ctx.globalAlpha = 0.12 + 0.3 * tw;
        ctx.fillStyle = m.c;
        ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s);
      }
      ctx.globalAlpha = 1;
    };
    size();
    draw(clockNow());
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        size();
        draw(clockNow());
      }, 150);
    };
    window.addEventListener('resize', onResize);
    const stop = live ? addFrameJob(draw, { fps: fx === 'low' ? 12 : 20 }) : null;
    return () => {
      stop?.();
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [fx, reducedMotion, shows]);

  if (!shows) return null;
  return (
    <div className="dn-env" aria-hidden>
      <div className="dn-env__nebula" />
      <div className="dn-env__floor" />
      <canvas ref={ref} className="dn-env__motes" />
    </div>
  );
}
