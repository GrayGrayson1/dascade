/**
 * A burst of pixel confetti over the claw machine's close-up (a win); unmounts itself when done.
 * Callers skip it entirely with reduced motion or visual effects off, and thin it on low. A skin may
 * bring its own colours and little pixel sprites (ThemeSkin.celebration); without them it's unchanged.
 */
import { useEffect, useRef, useState } from 'react';
import { celebrationSpriteCanvas, type CelebrationSprite } from '../themes/celebration.ts';

const CONFETTI = ['#ff4fd8', '#ffd23f', '#22d3ee', '#2de38f', '#a78bfa', '#ff8a3d', '#ffffff'];

export function ClawConfetti({
  amount,
  originX = 0.5,
  originY = 0.08,
  className,
  colors,
  sprites,
  spriteShare,
}: {
  amount: number;
  originX?: number;
  originY?: number;
  className?: string;
  /** Confetti colours (default: the machine's own). */
  colors?: readonly string[];
  /** Little pixel sprites mixed in (a `spriteShare` of the pieces, default 0.25). */
  sprites?: readonly CelebrationSprite[];
  spriteShare?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const palette = colors?.length ? colors : CONFETTI;
    const art = (sprites ?? []).map(celebrationSpriteCanvas).filter((s): s is HTMLCanvasElement => s !== null);
    const share = Math.max(0, Math.min(0.5, spriteShare ?? 0.25));
    const ox = w * originX;
    const oy = h * originY;
    const spread = Math.min(w * 0.6, 420);
    const size = Math.max(4, Math.min(9, w / 90));
    const parts = Array.from({ length: amount }, () => ({
      x: ox + (Math.random() - 0.5) * spread,
      y: oy + Math.random() * 8,
      vx: (Math.random() - 0.5) * 9,
      vy: -(4 + Math.random() * 7),
      s: size * (0.7 + Math.random() * 0.6),
      c: palette[Math.floor(Math.random() * palette.length)]!,
      r: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.5,
      // Without sprites this draws no extra random numbers: the default burst is exactly as it was.
      img: art.length > 0 && Math.random() < share ? art[Math.floor(Math.random() * art.length)]! : null,
    }));
    const start = performance.now();
    let last = start;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(2.5, (now - last) / 16.67);
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.17 * k;
        p.vx *= 1 - 0.012 * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.r += p.vr * k;
        if (p.y > h + 8) continue;
        alive++;
        if (p.img) {
          // A sprite: about two and a half confetti pieces wide, rocking gently instead of flipping.
          const cell = Math.max(1, Math.round((p.s * 2.4) / p.img.width));
          const sw = p.img.width * cell;
          const sh = p.img.height * cell;
          ctx.save();
          ctx.translate(Math.round(p.x), Math.round(p.y));
          ctx.rotate(Math.sin(p.r) * 0.35);
          ctx.drawImage(p.img, Math.round(-sw / 2), Math.round(-sh / 2), sw, sh);
          ctx.restore();
          continue;
        }
        const flip = Math.abs(Math.cos(p.r));
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.s), Math.max(1, Math.round(p.s * 0.65 * flip)));
      }
      if (alive > 0 && now - start < 4500) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [amount, originX, originY, colors, sprites, spriteShare]);
  return done ? null : <canvas ref={ref} className={className ?? 'clwx-confetti'} aria-hidden />;
}
