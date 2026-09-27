/**
 * Executive Edition environment: a wood-panelled corner office after hours. Raised mahogany
 * panels, a brass chair rail, office carpet, warm banker-lamp pools and — at FULL effects only —
 * a few dust motes drifting through the lamp light (one small canvas, ~15 fps, paused when the tab
 * is hidden, never inside a game, absent under reduced motion). Everything else is static CSS.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SkinRenderContext } from '../types.ts';

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}

interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  p: number;
}

/** Deterministic pseudo-random sequence (decor only; keeps renders stable). */
function seq(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function Dust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rnd = seq(1994);
    let w = 0;
    let h = 0;
    const motes: Mote[] = [];
    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    for (let i = 0; i < 26; i++) {
      // Motes gather in the two lamp pools (upper left / upper right).
      const side = i % 2 ? 0.14 : 0.86;
      motes.push({
        x: (side + (rnd() - 0.5) * 0.22) * w,
        y: (0.08 + rnd() * 0.5) * h,
        r: 0.6 + rnd() * 1.3,
        vx: (rnd() - 0.5) * 5,
        vy: -1.5 - rnd() * 3,
        a: 0.15 + rnd() * 0.35,
        p: rnd() * 6.28,
      });
    }
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 66) return; // ~15 fps is plenty for drifting dust
      const dt = last ? Math.min(0.2, (t - last) / 1000) : 0.066;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.p += dt * 0.8;
        // Triangle-wave sway (no trig needed): -1..1 over a period of 4.
        const tri = Math.abs(((m.p % 4) + 4) % 4 - 2) - 1;
        m.x += (m.vx + tri * 3) * dt;
        m.y += m.vy * dt;
        if (m.y < -4) {
          m.y = h * (0.45 + rnd() * 0.2);
          m.x = (rnd() < 0.5 ? 0.14 : 0.86) * w + (rnd() - 0.5) * 0.22 * w;
        }
        if (m.x < -4) m.x = w + 4;
        if (m.x > w + 4) m.x = -4;
        ctx.globalAlpha = m.a;
        ctx.fillStyle = '#ffe2a8';
        ctx.fillRect(m.x, m.y, m.r, m.r);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="ex-env__dust" />;
}

export function Environment({ fx, reducedMotion, place }: SkinRenderContext) {
  const visible = usePageVisible();
  const calm = place === 'game';
  const dust = fx === 'high' && !reducedMotion && !calm && visible;
  return (
    <div className="ex-env" data-place={place} data-fx={fx}>
      <i className="ex-env__wall" />
      <i className="ex-env__rail" />
      <i className="ex-env__carpet" />
      {fx !== 'off' ? <i className="ex-env__lamps" /> : null}
      {dust ? <Dust /> : null}
      <i className="ex-env__vignette" />
    </div>
  );
}
