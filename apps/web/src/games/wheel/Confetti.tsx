/**
 * Celebration particles: chunky pixel squares and ribbons that burst from the
 * pointer, arc under gravity and flutter out. The rAF loop only runs while
 * particles are alive. Counts scale with the fx setting; nothing runs when
 * effects are off or reduced motion is on. A theme's celebration can mix in
 * tiny pixel sprites (bats, candy corn…).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useApp } from '../../app/store.ts';
import { celebrationSpriteCanvas, type CelebrationSprite } from '../../themes/celebration.ts';
import { uiRng } from './model.ts';

export interface ConfettiExtras {
  /** Pixel sprites drawn for a share of the particles. */
  sprites?: readonly CelebrationSprite[];
  /** Share of particles drawn as sprites, 0–0.5 (default 0.25). */
  share?: number;
}

export interface ConfettiHandle {
  /** Burst from a point given as fractions of the layer (0..1). */
  burst: (colors: string[], origin?: { x: number; y: number }, extras?: ConfettiExtras) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: 'pixel' | 'ribbon' | 'sprite';
  sprite: HTMLCanvasElement | null;
  life: number;
  ttl: number;
  wobble: number;
}

export const ConfettiLayer = forwardRef<ConfettiHandle, { className?: string }>(function ConfettiLayer({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useImperativeHandle(ref, () => ({
    burst(colors, origin = { x: 0.5, y: 0.12 }, extras) {
      const { fx, reducedMotion } = useApp.getState().settings;
      if (fx === 'off' || reducedMotion) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const count = fx === 'high' ? 190 : 70;
      const scale = Math.max(0.6, Math.min(1.4, rect.width / 900));
      const ox = origin.x * rect.width;
      const oy = origin.y * rect.height;
      const palette = colors.length ? colors : ['#ffb020', '#ff4f81'];
      const sprites = (extras?.sprites ?? []).map(celebrationSpriteCanvas).filter((c): c is HTMLCanvasElement => c !== null);
      const share = Math.max(0, Math.min(0.5, extras?.share ?? 0.25));
      const r = () => uiRng.next();
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.25;
        const speed = (380 + r() * 720) * scale;
        particles.current.push({
          x: ox + (r() - 0.5) * 30,
          y: oy + (r() - 0.5) * 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: r() * Math.PI * 2,
          vr: (r() - 0.5) * 14,
          size: (5 + r() * 7) * scale,
          color: palette[i % palette.length] as string,
          // Without sprites the random sequence is exactly the plain confetti's.
          ...(sprites.length && r() < share
            ? { shape: 'sprite' as const, sprite: sprites[i % sprites.length]! }
            : { shape: r() < 0.62 ? ('pixel' as const) : ('ribbon' as const), sprite: null }),
          life: 0,
          ttl: 2.1 + r() * 1.4,
          wobble: r() * Math.PI * 2,
        });
      }
      if (!raf.current) {
        last.current = performance.now();
        raf.current = requestAnimationFrame(step);
      }
    },
  }));

  const step = (t: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      raf.current = 0;
      return;
    }
    const dt = Math.min(0.05, (t - last.current) / 1000);
    last.current = t;
    const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const h = canvas.height / dpr;
    const alive: Particle[] = [];
    for (const p of particles.current) {
      p.life += dt;
      p.vy += 980 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 0.9 * dt;
      p.x += (p.vx + Math.sin(p.wobble + p.life * 6) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.life > p.ttl || p.y > h + 40) continue;
      alive.push(p);
      const fade = Math.min(1, (p.ttl - p.life) / 0.5);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'sprite' && p.sprite) {
        // Crisp pixel art, about a third of the particle size per cell; sprites flutter (±0.35 rad) instead of tumbling.
        const cell = Math.max(2, Math.round(p.size / 3));
        const w = p.sprite.width * cell;
        const sh = p.sprite.height * cell;
        ctx.rotate(Math.sin(p.rot) * 0.35 - p.rot);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(p.sprite, -w / 2, -sh / 2, w, sh);
      } else if (p.shape === 'pixel') {
        const s = Math.round(p.size);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-s / 2, -s / 2, s, Math.max(1, s / 4));
      } else {
        const flip = Math.abs(Math.cos(p.life * 9 + p.wobble));
        ctx.fillRect(-p.size * 0.9, -p.size * 0.22 * flip, p.size * 1.8, Math.max(1, p.size * 0.44 * flip));
      }
      ctx.restore();
    }
    particles.current = alive;
    if (alive.length) raf.current = requestAnimationFrame(step);
    else {
      raf.current = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  return <canvas ref={canvasRef} className={className ?? 'wh-confetti'} aria-hidden />;
});
