/**
 * Visual effects that respect the player's settings:
 *  - fx 'high' | 'low' | 'off' scales particle counts and glow,
 *  - reducedMotion disables screen shake and big motion (particles become short fades).
 * Read the live settings with fxSettings() inside render loops (no React re-render needed).
 */
import { useApp, type FxLevel } from '../../app/store.ts';

export interface FxSettings {
  fx: FxLevel;
  reducedMotion: boolean;
  /** Multiplier for particle counts (0 when effects are off). */
  particles: number;
  /** Canvas shadowBlur multiplier. */
  glow: number;
}

export function fxSettings(): FxSettings {
  const s = useApp.getState().settings;
  const particles = s.fx === 'high' ? 1 : s.fx === 'low' ? 0.35 : 0;
  const glow = s.fx === 'high' ? 1 : s.fx === 'low' ? 0.45 : 0;
  return { fx: s.fx, reducedMotion: s.reducedMotion, particles: s.reducedMotion ? particles * 0.5 : particles, glow };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
}

/** Cheap pooled particle system (logical units, dt in seconds). */
export class Particles {
  private readonly items: Particle[] = [];

  constructor(private readonly cap = 400) {}

  burst(x: number, y: number, color: string, count: number, opts: { speed?: number; life?: number; size?: number; gravity?: number; spread?: number; dirX?: number; dirY?: number } = {}): void {
    const fx = fxSettings();
    const n = Math.round(count * fx.particles);
    const speed = (opts.speed ?? 120) * (fx.reducedMotion ? 0.35 : 1);
    for (let i = 0; i < n && this.items.length < this.cap; i++) {
      // Cosmetic only (never simulated on the server) — Math.random/cos are fine here.
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      const life = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * s * (opts.spread ?? 1) + (opts.dirX ?? 0),
        vy: Math.sin(a) * s * (opts.spread ?? 1) + (opts.dirY ?? 0),
        life,
        max: life,
        size: (opts.size ?? 2.5) * (0.6 + Math.random() * 0.8),
        color,
        gravity: opts.gravity ?? 260,
      });
    }
  }

  update(dt: number): void {
    const d = Math.min(0.05, Math.max(0, dt));
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      p.life -= d;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * d;
      p.x += p.vx * d;
      p.y += p.vy * d;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.items.length = 0;
  }

  get count(): number {
    return this.items.length;
  }
}

/** Decaying screen shake (disabled under reduced motion / fx off). */
export class Shake {
  private amp = 0;

  kick(amount: number): void {
    const fx = fxSettings();
    if (fx.reducedMotion || fx.fx === 'off') return;
    this.amp = Math.min(12, Math.max(this.amp, amount * (fx.fx === 'low' ? 0.5 : 1)));
  }

  /** Offset for this frame; call once per render. */
  offset(dtMs: number): { x: number; y: number } {
    if (this.amp < 0.05) {
      this.amp = 0;
      return { x: 0, y: 0 };
    }
    const o = { x: (Math.random() * 2 - 1) * this.amp, y: (Math.random() * 2 - 1) * this.amp };
    this.amp *= Math.pow(0.001, Math.min(0.1, dtMs / 1000));
    return o;
  }
}

/** Floating score pop-ups ("+250", "QUAD!"). */
export class Popups {
  private readonly items: Array<{ x: number; y: number; text: string; color: string; life: number; max: number; size: number }> = [];

  add(x: number, y: number, text: string, color: string, size = 12, life = 0.9): void {
    if (this.items.length > 24) this.items.shift();
    this.items.push({ x, y, text, color, life, max: life, size });
  }

  update(dt: number): void {
    const rm = fxSettings().reducedMotion;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      p.life -= dt;
      if (!rm) p.y -= 28 * dt;
      if (p.life <= 0) this.items.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, font: string): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.max) * 1.6));
      ctx.font = `${p.size}px ${font}`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(p.text, p.x + 1, p.y + 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** Resolved CSS font stacks for canvas text (tokens live in CSS custom properties). */
export function canvasFonts(): { display: string; num: string; pixel: string } {
  const css = getComputedStyle(document.documentElement);
  const get = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
  return {
    display: get('--font-display', 'monospace'),
    num: get('--font-num', 'system-ui, sans-serif'),
    pixel: get('--font-pixel', 'monospace'),
  };
}
