/**
 * Screen-space particles (sparks, splashes, sand puffs, confetti, portal motes). Pooled,
 * capped by the fx setting, and skipped entirely when effects are off.
 */

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  kind: 'dot' | 'spark' | 'confetti' | 'ring';
  spin: number;
}

export type FxLevel = 'high' | 'low' | 'off';

export class Particles {
  private readonly list: P[] = [];
  private readonly cap: number;
  private readonly amount: number;

  constructor(fx: FxLevel, reducedMotion: boolean) {
    this.cap = fx === 'high' ? 420 : fx === 'low' ? 140 : 0;
    this.amount = (fx === 'high' ? 1 : fx === 'low' ? 0.4 : 0) * (reducedMotion ? 0.5 : 1);
  }

  private spawn(n: number, make: (i: number) => Omit<P, 'life'>): void {
    const count = Math.round(n * this.amount);
    for (let i = 0; i < count && this.list.length < this.cap; i++) {
      const p = make(i);
      this.list.push({ ...p, life: p.max });
    }
  }

  sparks(x: number, y: number, nx: number, ny: number, strength: number, color: string): void {
    const n = 4 + Math.min(10, strength / 60);
    this.spawn(n, () => {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.8;
      const v = 60 + Math.random() * (80 + strength * 0.25);
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: 0.25 + Math.random() * 0.25, size: 1.5 + Math.random() * 1.5, color, gravity: 0, drag: 4, kind: 'spark', spin: 0 };
    });
  }

  splash(x: number, y: number, scale: number): void {
    this.spawn(26, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (40 + Math.random() * 120) * scale;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 90 * scale, max: 0.5 + Math.random() * 0.4, size: (1.5 + Math.random() * 2.5) * scale, color: Math.random() < 0.5 ? '#a5f3fc' : '#e0f7ff', gravity: 320 * scale, drag: 1, kind: 'dot', spin: 0 };
    });
    this.spawn(3, (i) => ({ x, y, vx: 0, vy: 0, max: 0.55 + i * 0.15, size: (10 + i * 7) * scale, color: '#67e8f9', gravity: 0, drag: 0, kind: 'ring', spin: 0 }));
  }

  puff(x: number, y: number, color: string, scale: number): void {
    this.spawn(10, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (15 + Math.random() * 40) * scale;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, max: 0.5 + Math.random() * 0.4, size: (2 + Math.random() * 2.5) * scale, color, gravity: 0, drag: 2.5, kind: 'dot', spin: 0 };
    });
  }

  ring(x: number, y: number, size: number, color: string, life = 0.6): void {
    this.spawn(1, () => ({ x, y, vx: 0, vy: 0, max: life, size, color, gravity: 0, drag: 0, kind: 'ring', spin: 0 }));
  }

  confetti(x: number, y: number, colors: readonly string[], scale: number, big = false): void {
    this.spawn(big ? 90 : 40, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = (140 + Math.random() * (big ? 260 : 170)) * scale;
      return {
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        max: 1 + Math.random() * 0.9,
        size: (2.5 + Math.random() * 2.5) * Math.max(0.7, scale),
        color: colors[Math.floor(Math.random() * colors.length)] ?? '#fde047',
        gravity: 260 * scale,
        drag: 1.4,
        kind: 'confetti',
        spin: (Math.random() - 0.5) * 16,
      };
    });
  }

  motes(x: number, y: number, color: string, scale: number): void {
    this.spawn(14, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (30 + Math.random() * 70) * scale;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: 0.4 + Math.random() * 0.4, size: 1.5 + Math.random() * 2, color, gravity: 0, drag: 3, kind: 'spark', spin: 0 };
    });
  }

  get empty(): boolean {
    return this.list.length === 0;
  }

  clear(): void {
    this.list.length = 0;
  }

  step(dt: number, g: CanvasRenderingContext2D): void {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        list[i] = list[list.length - 1]!;
        list.pop();
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.max;
      g.globalAlpha = Math.min(1, t * 1.6);
      if (p.kind === 'ring') {
        g.strokeStyle = p.color;
        g.lineWidth = 2 * t;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.6 - t * 0.9), 0, Math.PI * 2);
        g.stroke();
      } else if (p.kind === 'spark') {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        g.stroke();
      } else if (p.kind === 'confetti') {
        g.fillStyle = p.color;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.spin * (p.max - p.life));
        g.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
        g.restore();
      } else {
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
  }
}
