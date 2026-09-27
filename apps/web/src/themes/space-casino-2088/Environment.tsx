/**
 * Space Casino 2088 environment: deep space behind the whole app.
 *   - a nebula (CSS gradients, static),
 *   - a canvas starfield in three parallax depths with twinkle and the occasional shooting star,
 *   - an orbital window (chrome porthole) through which a ringed planet slowly turns.
 *
 * Budget: one starfield canvas (≤30 fps FULL, 15 REDUCED, one static frame MINIMAL / reduced motion)
 * and one small planet canvas (≤15 fps). Both run on the shared arcade clock, which parks itself while
 * the tab is hidden. Inside a game the stars freeze, dim, and the window is hidden (calm).
 */
import { useEffect, useRef } from 'react';
import { addFrameJob, clockNow } from '../../arcade/scheduler.ts';
import type { SkinRenderContext } from '../types.ts';
import { drawPlanet, makePlanetTexture, type PlanetTexture } from './planet.ts';

interface Star {
  x: number;
  y: number;
  /** depth 0.25–1 (bigger = nearer = faster, brighter) */
  z: number;
  r: number;
  tw: number;
  ph: number;
  hue: 0 | 1 | 2;
}

const HUES = ['#eef6ff', '#bfe9ff', '#ffd9f2'] as const;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeStars(n: number, w: number, h: number): Star[] {
  const rnd = seeded(2088);
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    const z = 0.25 + rnd() * 0.75;
    out.push({
      x: rnd() * w,
      y: rnd() * h,
      z,
      r: z > 0.92 ? 1.6 : z > 0.7 ? 1.1 : 0.7,
      tw: 0.6 + rnd() * 2.2,
      ph: rnd() * 6.283,
      hue: (rnd() < 0.72 ? 0 : rnd() < 0.5 ? 1 : 2) as 0 | 1 | 2,
    });
  }
  return out;
}

export function SpaceEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const starsRef = useRef<HTMLCanvasElement>(null);
  const planetRef = useRef<HTMLCanvasElement>(null);
  const calm = place === 'game';
  const live = !reducedMotion && fx !== 'off';
  const showWindow = !calm;

  // ---- Starfield ----
  useEffect(() => {
    const canvas = starsRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, fx === 'high' ? 1.5 : 1);
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    const density = fx === 'high' ? 1 : fx === 'low' ? 0.55 : 0.35;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(320, (w * h) / 5200) * density);
      stars = makeStars(n, w, h);
    };
    resize();

    const start = clockNow();
    let shoot = { at: start + 6, x: 0, y: 0, vx: 0, vy: 0 };
    const draw = (t: number, moving: boolean) => {
      ctx.clearRect(0, 0, w, h);
      const el = t - start;
      const drift = moving ? el * 6 : 0; // px/s at depth 1
      const dim = calm ? 0.6 : 1;
      for (const s of stars) {
        let x = s.x - drift * s.z;
        x = ((x % w) + w) % w;
        const twinkle = moving ? 0.65 + 0.35 * Math.sin(el * s.tw + s.ph) : 0.85;
        ctx.globalAlpha = Math.max(0, Math.min(1, (0.35 + s.z * 0.65) * twinkle * dim));
        ctx.fillStyle = HUES[s.hue];
        if (s.r > 1.2) {
          ctx.beginPath();
          ctx.arc(x, s.y, s.r, 0, 6.2832);
          ctx.fill();
          if (fx === 'high' && !calm) {
            // four-point glint on the nearest stars (very 1996)
            ctx.globalAlpha *= 0.45;
            ctx.fillRect(x - 4, s.y - 0.5, 8, 1);
            ctx.fillRect(x - 0.5, s.y - 4, 1, 8);
          }
        } else {
          ctx.fillRect(x, s.y, s.r, s.r);
        }
      }
      // Shooting star (FULL only, outside games).
      if (moving && fx === 'high' && !calm) {
        if (t >= shoot.at) {
          if (shoot.vx === 0) {
            const rnd = Math.random;
            shoot = { at: t, x: w * (0.2 + rnd() * 0.7), y: h * (0.05 + rnd() * 0.3), vx: -(420 + rnd() * 260), vy: 120 + rnd() * 90 };
          }
          const life = t - shoot.at;
          if (life < 1.1) {
            const x = shoot.x + shoot.vx * life;
            const y = shoot.y + shoot.vy * life;
            const g = ctx.createLinearGradient(x, y, x - shoot.vx * 0.18, y - shoot.vy * 0.18);
            g.addColorStop(0, 'rgba(255,255,255,0.95)');
            g.addColorStop(1, 'rgba(79,240,255,0)');
            ctx.globalAlpha = 1 - life / 1.1;
            ctx.strokeStyle = g;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - shoot.vx * 0.18, y - shoot.vy * 0.18);
            ctx.stroke();
          } else {
            shoot = { at: t + 9 + Math.random() * 14, x: 0, y: 0, vx: 0, vy: 0 };
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const moving = live && !calm;
    draw(clockNow(), false);
    const onResize = () => {
      resize();
      draw(clockNow(), false);
    };
    window.addEventListener('resize', onResize);
    const stop = moving ? addFrameJob((t) => draw(t, true), { fps: fx === 'high' ? 30 : 15 }) : null;
    return () => {
      window.removeEventListener('resize', onResize);
      stop?.();
    };
  }, [fx, live, calm]);

  // ---- Planet ----
  useEffect(() => {
    if (!showWindow) return;
    const canvas = planetRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = fx === 'high' ? 360 : 240;
    canvas.width = size;
    canvas.height = size;
    let tex: PlanetTexture | null = makePlanetTexture();
    const start = clockNow();
    const draw = (t: number) => {
      if (!tex) return;
      drawPlanet(ctx, tex, size, (t - start) / 110 + 0.37);
    };
    draw(start);
    const stop = live ? addFrameJob(draw, { fps: fx === 'high' ? 15 : 8 }) : null;
    return () => {
      stop?.();
      tex = null;
    };
  }, [fx, live, showWindow]);

  return (
    <div className="sc-env" data-calm={calm ? 'true' : undefined} data-live={live ? 'true' : undefined} data-place={place}>
      <div className="sc-env__nebula" />
      <canvas ref={starsRef} className="sc-env__stars" />
      {showWindow ? (
        <div className="sc-env__window">
          <div className="sc-env__glass">
            <canvas ref={planetRef} className="sc-env__planet" />
            <i className="sc-env__glare" />
          </div>
          <i className="sc-env__ring" />
          <i className="sc-env__bolts" />
          <span className="sc-env__leds">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}
    </div>
  );
}
