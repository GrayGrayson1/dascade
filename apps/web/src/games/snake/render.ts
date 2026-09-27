/**
 * Neon Snake canvas renderer: a dark arena with a dot lattice and glowing rim, snakes as neon
 * light-tubes (bright head with eyes, body fading towards the tail), original pickups (energy
 * orbs, sparks, prism gems, phase rings, magnet cores), and effects for eating, crashing and
 * power-ups. Logical units: one grid cell = CELL.
 */
import { DX, DY, type SnakeSnapshot, type SnapSnake } from '@dascade/game-core/snake';
import { Particles, Popups, Shake, alpha, beginFrame, canvasFonts, fxSettings, shade, type Surface } from '../_classics/index.ts';
import type { Materials } from '../_classics/palette.ts';
import { ARENA_ART, arenaArt, type ArenaArt } from './palette.ts';

export const CELL = 20;

/** Arena + item palette (game art; declared once so a theme could override it). */
export const SNAKE_ART = {
  floorTop: '#04140c',
  floorBottom: '#020906',
  lattice: 'rgba(120, 255, 190, 0.10)',
  rim: '#2de38f',
  energy: '#5ef2b5',
  spark: '#ffd23f',
  gem: '#ff4fd8',
  phase: '#a78bfa',
  magnet: '#ff8a3d',
} as const;

const SnakeFlag = { alive: 1, phase: 2, magnet: 4, guard: 8, retired: 16 } as const;

export interface SnakeLook {
  color: string;
  name: string;
  me: boolean;
}

interface Wreck {
  body: Array<[number, number]>;
  color: string;
  life: number;
}

export class SnakeRenderer {
  private readonly particles = new Particles(600);
  private readonly popups = new Popups();
  private readonly shake = new Shake();
  private wrecks: Wreck[] = [];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private fonts = canvasFonts();
  private t = 0;
  private portrait = false;
  private arenaW = 0;
  private readonly tags: Array<{ x: number; y: number; name: string; color: string }> = [];

  private arena: ArenaArt = ARENA_ART;

  /** Theme materials changed: re-colour the arena on the next frame (render-only). */
  setMaterials(m: Materials): void {
    const next = arenaArt(m);
    if (next === this.arena) return;
    this.arena = next;
    this.bg = null;
  }

  setPortrait(p: boolean): void {
    this.portrait = p;
  }

  /** Arena point (logical units) → screen point. */
  private toScreen(x: number, y: number): { x: number; y: number } {
    return this.portrait ? { x: y, y: this.arenaW - x } : { x, y };
  }

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    this.wrecks = [];
  }

  eat(x: number, y: number, kind: string, points: number, color: string): void {
    const cx = (x + 0.5) * CELL;
    const cy = (y + 0.5) * CELL;
    const c = kind === 'gem' ? SNAKE_ART.gem : kind === 'phase' ? SNAKE_ART.phase : kind === 'magnet' ? SNAKE_ART.magnet : kind === 'spark' ? SNAKE_ART.spark : color;
    this.particles.burst(cx, cy, c, kind === 'energy' || kind === 'spark' ? 8 : 22, { speed: 90, life: 0.45, size: 3.2, gravity: 0 });
    const p = this.toScreen(cx, cy);
    this.popups.add(p.x, p.y - 10, `+${points}`, c, kind === 'gem' ? 16 : 12, 0.8);
  }

  crash(body: Array<[number, number]>, color: string, big: boolean): void {
    if (body.length) this.wrecks.push({ body, color, life: 1 });
    const step = Math.max(1, Math.floor(body.length / 14));
    for (let i = 0; i < body.length; i += step) {
      const [x, y] = body[i]!;
      this.particles.burst((x + 0.5) * CELL, (y + 0.5) * CELL, color, i === 0 ? 18 : 4, { speed: 120, life: 0.7, size: 3.5, gravity: 0 });
    }
    if (big) this.shake.kick(6);
  }

  label(x: number, y: number, text: string, color: string): void {
    const p = this.toScreen((x + 0.5) * CELL, (y + 0.5) * CELL);
    this.popups.add(p.x, p.y - 16, text, color, 13, 1.2);
  }

  private background(s: Surface, cols: number, rows: number): HTMLCanvasElement {
    const key = `${s.scale.toFixed(3)}|${cols}|${rows}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const W = cols * CELL;
    const H = rows * CELL;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * s.scale));
    c.height = Math.max(1, Math.round(H * s.scale));
    const g = c.getContext('2d')!;
    g.scale(s.scale, s.scale);
    const grad = g.createLinearGradient(0, 0, 0, H);
    const art = this.arena;
    grad.addColorStop(0, art.floorTop);
    grad.addColorStop(1, art.floorBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Faint checker for depth + a dot lattice at cell corners.
    g.fillStyle = art.checker;
    for (let y = 0; y < rows; y++) for (let x = (y & 1); x < cols; x += 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    g.fillStyle = art.lattice;
    for (let y = 1; y < rows; y++) for (let x = 1; x < cols; x++) g.fillRect(x * CELL - 1, y * CELL - 1, 2, 2);
    // Soft pools of light.
    const pool = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.6);
    pool.addColorStop(0, art.pool);
    pool.addColorStop(1, art.poolClear);
    g.fillStyle = pool;
    g.fillRect(0, 0, W, H);
    // Rim.
    g.strokeStyle = art.rim;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
    this.bg = { key, canvas: c };
    return c;
  }

  private drawItem(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, ttl: number, glow: number): void {
    const cx = (x + 0.5) * CELL;
    const cy = (y + 0.5) * CELL;
    // Fading items blink during their last ~2 seconds.
    if (ttl < 255 && ttl < 20 && Math.floor(this.t * 8) % 2 === 0) return;
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 5 + x * 0.7 + y);
    ctx.save();
    switch (kind) {
      case 'energy': {
        ctx.shadowColor = SNAKE_ART.energy;
        ctx.shadowBlur = 12 * glow;
        ctx.fillStyle = SNAKE_ART.energy;
        const r = 7 * pulse;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#eafff5';
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
        break;
      }
      case 'spark':
        ctx.fillStyle = SNAKE_ART.spark;
        ctx.shadowColor = SNAKE_ART.spark;
        ctx.shadowBlur = 6 * glow;
        ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
        ctx.fillStyle = alpha(SNAKE_ART.spark, 0.5);
        ctx.fillRect(cx - 5, cy - 0.5, 10, 1);
        ctx.fillRect(cx - 0.5, cy - 5, 1, 10);
        break;
      case 'gem': {
        ctx.shadowColor = SNAKE_ART.gem;
        ctx.shadowBlur = 16 * glow;
        const r = 8 * pulse;
        ctx.fillStyle = SNAKE_ART.gem;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.8, cy - r * 0.2);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.8, cy - r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(SNAKE_ART.gem, 0.55);
        ctx.fillRect(cx - 2, cy - r * 0.55, 4, 3);
        break;
      }
      case 'phase': {
        ctx.shadowColor = SNAKE_ART.phase;
        ctx.shadowBlur = 14 * glow;
        ctx.strokeStyle = SNAKE_ART.phase;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([3, 3]);
        ctx.lineDashOffset = -this.t * 12;
        ctx.strokeRect(cx - 7, cy - 7, 14, 14);
        ctx.setLineDash([]);
        ctx.fillStyle = alpha(SNAKE_ART.phase, 0.6);
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
        break;
      }
      case 'magnet': {
        ctx.shadowColor = SNAKE_ART.magnet;
        ctx.shadowBlur = 14 * glow;
        ctx.fillStyle = SNAKE_ART.magnet;
        // A pixel "U" core.
        ctx.fillRect(cx - 7, cy - 6, 4, 11);
        ctx.fillRect(cx + 3, cy - 6, 4, 11);
        ctx.fillRect(cx - 7, cy + 2, 14, 4);
        ctx.fillStyle = '#fff4e0';
        ctx.fillRect(cx - 7, cy - 6, 4, 3);
        ctx.fillRect(cx + 3, cy - 6, 4, 3);
        break;
      }
    }
    ctx.restore();
  }

  /**
   * Neon tube through the cell centres (breaking across a wrap edge): one blurred glow stroke for
   * the whole body (shadowBlur is expensive, so never per segment), a tapered body, a bright core.
   */
  private drawTube(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, color: string, width: number, glow: number, ghost: boolean): void {
    const n = pts.length;
    if (n < 2) return;
    const joined = (i: number) => Math.abs(pts[i]![0] - pts[i - 1]![0]) <= 1.5 && Math.abs(pts[i]![1] - pts[i - 1]![1]) <= 1.5;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo((pts[0]![0] + 0.5) * CELL, (pts[0]![1] + 0.5) * CELL);
      for (let i = 1; i < n; i++) {
        const x = (pts[i]![0] + 0.5) * CELL;
        const y = (pts[i]![1] + 0.5) * CELL;
        if (joined(i)) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ghost) ctx.globalAlpha = 0.45;
    if (glow > 0) {
      path();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12 * glow;
      ctx.strokeStyle = alpha(color, 0.55);
      ctx.lineWidth = width * 0.8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Tapered body, head to tail.
    ctx.strokeStyle = color;
    for (let i = 1; i < n; i++) {
      if (!joined(i)) continue;
      ctx.lineWidth = width * (1 - (i / n) * 0.55);
      ctx.beginPath();
      ctx.moveTo((pts[i - 1]![0] + 0.5) * CELL, (pts[i - 1]![1] + 0.5) * CELL);
      ctx.lineTo((pts[i]![0] + 0.5) * CELL, (pts[i]![1] + 0.5) * CELL);
      ctx.stroke();
    }
    path();
    ctx.strokeStyle = shade(color, 0.5);
    ctx.lineWidth = width * 0.26;
    ctx.stroke();
    ctx.restore();
  }

  draw(s: Surface, snap: SnakeSnapshot | null, looks: Map<number, SnakeLook>, progress: number, myNextDir: number, frameMs: number, growing: ReadonlySet<number> = new Set()): void {
    const dt = Math.min(0.05, frameMs / 1000);
    this.t += dt;
    const fx = fxSettings();
    const ctx = beginFrame(s);
    if (!snap) return;
    const o = this.shake.offset(frameMs);
    this.arenaW = snap.cols * CELL;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.save();
    // Portrait screens see the arena on its side (world +x points up the screen).
    if (this.portrait) ctx.transform(0, -1, 1, 0, 0, this.arenaW);
    ctx.drawImage(this.background(s, snap.cols, snap.rows), 0, 0, snap.cols * CELL, snap.rows * CELL);

    for (const it of snap.items) this.drawItem(ctx, it.x, it.y, it.kind, it.ttl, fx.glow);

    // Fading wrecks of crashed snakes.
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i]!;
      w.life -= dt * 1.4;
      if (w.life <= 0) {
        this.wrecks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = w.life * 0.6;
      this.drawTube(ctx, w.body, shade(w.color, -0.35), CELL * 0.62, 0, false);
      ctx.globalAlpha = 1;
    }

    const t = fx.reducedMotion ? Math.min(progress, 1) : progress;
    for (const sn of snap.snakes) {
      if (!(sn.flags & SnakeFlag.alive) || !sn.body.length) continue;
      const look = looks.get(sn.slot) ?? { color: '#2de38f', name: '', me: false };
      this.drawSnake(ctx, snap, sn, look, t, look.me ? myNextDir : sn.next >= 0 ? sn.next : sn.dir, fx.glow, growing.has(sn.slot));
    }
    this.particles.update(dt);
    this.particles.draw(ctx);
    ctx.restore();
    // Screen-space text: rival name tags, then pop-ups.
    ctx.font = `11px ${this.fonts.pixel}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tag of this.tags) {
      const p = this.toScreen(tag.x, tag.y);
      ctx.fillStyle = alpha(tag.color, 0.8);
      ctx.fillText(tag.name, p.x, p.y - 16);
    }
    this.tags.length = 0;
    this.popups.update(dt);
    this.popups.draw(ctx, this.fonts.num);
    ctx.restore();
  }

  private drawSnake(ctx: CanvasRenderingContext2D, snap: SnakeSnapshot, sn: SnapSnake, look: SnakeLook, t: number, nextDir: number, glow: number, growing: boolean): void {
    const ghost = (sn.flags & (SnakeFlag.phase | SnakeFlag.guard)) !== 0;
    if (sn.flags & SnakeFlag.guard && Math.floor(this.t * 10) % 2 === 0) return;
    const [hx, hy] = sn.body[0]!;
    const d = nextDir >= 0 ? nextDir : sn.dir;
    let ex = hx + (DX[d] ?? 0) * t;
    let ey = hy + (DY[d] ?? 0) * t;
    // Don't slide the head through the arena rim (the crash is the server's call).
    if (ex < -0.2 || ey < -0.2 || ex > snap.cols - 0.8 || ey > snap.rows - 0.8) {
      ex = hx;
      ey = hy;
    }
    const pts: Array<[number, number]> = [[ex, ey], ...sn.body];
    // The tail follows along unless the snake is growing this step.
    const n = pts.length;
    if (!growing && n >= 3 && (ex !== hx || ey !== hy)) {
      const [lx, ly] = pts[n - 1]!;
      const [kx, ky] = pts[n - 2]!;
      if (Math.abs(lx - kx) <= 1 && Math.abs(ly - ky) <= 1) pts[n - 1] = [lx + (kx - lx) * t, ly + (ky - ly) * t];
    }
    this.drawTube(ctx, pts, look.color, CELL * 0.64, glow, ghost);
    // Head.
    const cx = (ex + 0.5) * CELL;
    const cy = (ey + 0.5) * CELL;
    if (!look.me && look.name) this.tags.push({ x: cx, y: cy, name: look.name.slice(0, 12), color: look.color });
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.6;
    ctx.shadowColor = look.color;
    ctx.shadowBlur = 18 * glow;
    ctx.fillStyle = shade(look.color, 0.35);
    const hs = CELL * 0.86;
    ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.shadowBlur = 0;
    // Eyes look where the snake is heading.
    const fx = DX[d] ?? 1;
    const fy = DY[d] ?? 0;
    const px = -fy;
    const py = fx;
    ctx.fillStyle = '#041008';
    for (const side of [-1, 1]) {
      const exx = cx + fx * 3.5 + px * side * 4;
      const eyy = cy + fy * 3.5 + py * side * 4;
      ctx.fillRect(exx - 2, eyy - 2, 4, 4);
    }
    ctx.restore();
    // Magnet aura.
    if (sn.flags & SnakeFlag.magnet) {
      ctx.save();
      ctx.strokeStyle = alpha(SNAKE_ART.magnet, 0.55);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = this.t * 20;
      const r = CELL * 2.5;
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }
    // Our own snake: a chevron showing the next turn.
    if (look.me) {
      const ax = cx + (DX[d] ?? 0) * CELL * 0.95;
      const ay = cy + (DY[d] ?? 0) * CELL * 0.95;
      ctx.fillStyle = alpha('#ffffff', 0.75);
      ctx.fillRect(ax - 2, ay - 2, 4, 4);
    }
  }
}
