/**
 * Big-win celebration: a pixel headline plus a burst of pixel coins on a canvas.
 * Particle count follows the fx setting (none when off); reduced motion shows the
 * headline only.
 */
import { useEffect, useRef } from 'react';
import { spriteCanvas, SLOT_SPRITES } from './sprites.ts';
import { fmt, useMotion } from './ui.ts';

export interface CelebrationInfo {
  key: string | number;
  title: string;
  amount: number;
  subtitle?: string;
}

export function Celebration({ info, onDone }: { info: CelebrationInfo | null; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reduced, fx } = useMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => doneRef.current(), 3200);
    return () => clearTimeout(t);
  }, [info]);

  useEffect(() => {
    if (!info || reduced || fx === 'off') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const coin = spriteCanvas(SLOT_SPRITES.coin, 2, 'coin');
    const count = fx === 'high' ? 70 : 24;
    const parts = Array.from({ length: count }, (_, i) => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.2,
      y: canvas.height * 0.55,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (-10 - Math.random() * 12) * dpr,
      s: (0.8 + Math.random() * 1.4) * dpr,
      spin: Math.random() * Math.PI * 2,
      delay: i * 12,
    }));
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const el = t - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      for (const p of parts) {
        if (el < p.delay) continue;
        p.vy += 0.45 * dpr;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += 0.2;
        const w = coin.width * p.s * Math.abs(Math.cos(p.spin));
        const h = coin.height * p.s;
        ctx.drawImage(coin, p.x - w / 2, p.y - h / 2, Math.max(1, w), h);
      }
      if (el < 3000) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [info, reduced, fx]);

  if (!info) return null;
  return (
    <div className="dn-celebrate" role="status" aria-live="assertive" onClick={() => doneRef.current()}>
      <canvas ref={canvasRef} className="dn-celebrate__coins" aria-hidden />
      <div className="dn-celebrate__card" key={info.key}>
        <span className="dn-celebrate__title">{info.title}</span>
        <span className="dn-celebrate__amount dc-num">+{fmt(info.amount)}</span>
        {info.subtitle ? <span className="dn-celebrate__sub">{info.subtitle}</span> : null}
      </div>
    </div>
  );
}

export function winTitle(multiple: number): string {
  if (multiple >= 100) return 'JACKPOT!';
  if (multiple >= 25) return 'MEGA WIN!';
  return 'BIG WIN!';
}
