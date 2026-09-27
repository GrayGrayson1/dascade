/**
 * Brick Blitz art: original neon palette + the canvas renderer (field, bricks, paddle, balls,
 * capsules, lasers, effects). Game-art colours live here; chrome uses theme tokens in CSS.
 */
import {
  BALL_R,
  BRICK_TOP,
  CAPSULE_H,
  CAPSULE_W,
  CELL_H,
  COLS,
  FIELD_H,
  FIELD_W,
  PADDLE_H,
  PADDLE_Y,
  type Brick,
  type BricksEvent,
  type BricksSim,
  type PowerKind,
} from '@dascade/game-core/bricks';
import { Particles, Popups, Shake, alpha, beginFrame, canvasFonts, drawBlock, fxSettings, roundRect, shade, type Surface } from '../_classics/index.ts';

export const TONES = ['#ff4fd8', '#ff8a3d', '#ffd23f', '#a3e635', '#2de38f', '#22d3ee', '#a78bfa'] as const;
export const KIND_COLOR = { A: '#8fa2d8', X: '#ff5a5f', S: '#9aa0bf', P: '#ffd23f', M: '#7cf5ff' } as const;

export const POWER_INFO: Record<PowerKind, { glyph: string; name: string; color: string; hint: string }> = {
  wide: { glyph: 'W', name: 'Wide', color: '#22d3ee', hint: 'Bigger paddle' },
  multi: { glyph: '3', name: 'Multi', color: '#ff4fd8', hint: 'Every ball splits in three' },
  laser: { glyph: 'L', name: 'Laser', color: '#ff5a5f', hint: 'Fire bolts with Space / FIRE' },
  slow: { glyph: 'S', name: 'Slow', color: '#60a5fa', hint: 'Slower ball' },
  sticky: { glyph: 'C', name: 'Catch', color: '#2de38f', hint: 'Catch the ball, then aim' },
  life: { glyph: '+1', name: 'Life', color: '#ffd23f', hint: 'Extra life' },
};

export function brickColor(b: Pick<Brick, 'kind' | 'tone'>): string {
  return b.kind === 'N' ? TONES[b.tone % TONES.length]! : KIND_COLOR[b.kind as keyof typeof KIND_COLOR];
}

interface Trail {
  pts: Array<[number, number]>;
}

export class BricksRenderer {
  readonly particles = new Particles(600);
  readonly popups = new Popups();
  readonly shake = new Shake();
  private trails: Trail[] = [];
  private rings: Array<{ x: number; y: number; t: number }> = [];
  private banner: { title: string; sub: string; t: number; color: string } | null = null;
  private fonts = canvasFonts();
  private flash = 0;

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    this.trails = [];
    this.rings = [];
    this.banner = null;
    this.flash = 0;
  }

  onEvents(events: BricksEvent[], sound: (name: string, opts?: { pitch?: number; index?: number; gap?: number }) => void): void {
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const color = brickColor({ kind: e.kind, tone: e.tone });
          if (e.destroyed) {
            this.particles.burst(e.x, e.y, color, e.kind === 'X' ? 8 : 10, { speed: 150, life: 0.6, size: 3, gravity: 380 });
            if (e.points >= 60) this.popups.add(e.x, e.y, `+${e.points}`, shade(color, 0.3), 11, 0.7);
            sound('brick', { pitch: Math.min(12, Math.floor(e.points / 20)) });
          } else {
            this.particles.burst(e.x, e.y, '#ffffff', 4, { speed: 90, life: 0.3, size: 2 });
            sound('armor');
          }
          break;
        }
        case 'steel':
          this.particles.burst(e.x, e.y, '#dfe3ff', 3, { speed: 80, life: 0.25, size: 2 });
          sound('steel');
          break;
        case 'blast':
          this.rings.push({ x: e.x, y: e.y, t: 0 });
          this.particles.burst(e.x, e.y, '#ffb020', 16, { speed: 220, life: 0.7, size: 3.5, gravity: 200 });
          this.shake.kick(4);
          sound('explode');
          break;
        case 'paddle':
          sound('bounce');
          break;
        case 'wall':
          sound('wall', { gap: 60 });
          break;
        case 'capsule':
          break;
        case 'power': {
          const info = POWER_INFO[e.kind];
          this.popups.add(FIELD_W / 2, PADDLE_Y - 40, `${info.name.toUpperCase()}!`, info.color, 16, 1);
          sound('powerup');
          break;
        }
        case 'laser':
          sound('laser');
          break;
        case 'launch':
          sound('launch');
          break;
        case 'miss':
          this.flash = 1;
          this.shake.kick(6);
          sound('lifelost');
          break;
        case 'life':
          this.popups.add(FIELD_W / 2, FIELD_H / 2, '+1 LIFE', '#ffd23f', 18, 1.2);
          sound('record');
          break;
        case 'clear':
          this.banner = { title: 'LEVEL CLEAR', sub: `+${e.bonus.toLocaleString('en-US')}${e.flawless ? '  ·  FLAWLESS' : ''}`, t: 0, color: '#ffd23f' };
          sound('levelup');
          break;
        case 'level':
          this.banner = { title: `LEVEL ${e.level}`, sub: e.name.toUpperCase(), t: 0, color: '#7cf5ff' };
          break;
        case 'over':
          sound('gameover');
          break;
      }
    }
  }

  draw(s: Surface, sim: BricksSim | null, alphaT: number, dtMs: number, opts: { paused: boolean; hint: string | null }): void {
    const ctx = beginFrame(s);
    const fx = fxSettings();
    const dt = dtMs / 1000;
    this.particles.update(dt);
    this.popups.update(dt);
    const off = this.shake.offset(dtMs);
    ctx.save();
    ctx.translate(off.x, off.y);
    this.drawField(ctx);
    if (!sim) {
      ctx.restore();
      return;
    }
    const now = sim.tick;

    // Bricks.
    for (const b of sim.bricks) {
      if (!b.alive) continue;
      const color = brickColor(b);
      const style = b.kind === 'S' ? 'steel' : b.kind === 'M' ? 'glass' : 'gem';
      if (b.kind === 'X' && fx.glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = (6 + 4 * Math.sin(now / 8)) * fx.glow;
      }
      drawBlock(ctx, s, color, b.x, b.y, b.w, b.h, style);
      ctx.shadowBlur = 0;
      this.drawBrickGlyph(ctx, b, now);
      if (now - b.hitAt < 6) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - (now - b.hitAt) / 6)})`;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    }

    // Blast rings.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.t += dt;
      const k = r.t / 0.35;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(255, 176, 32, ${0.8 * (1 - k)})`;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + k * (fx.reducedMotion ? 30 : 70), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Capsules.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of sim.capsules) {
      const info = POWER_INFO[c.kind];
      const x = c.x - CAPSULE_W / 2;
      const y = c.y - CAPSULE_H / 2;
      if (fx.glow > 0) {
        ctx.shadowColor = info.color;
        ctx.shadowBlur = 10 * fx.glow;
      }
      const g = ctx.createLinearGradient(0, y, 0, y + CAPSULE_H);
      g.addColorStop(0, shade(info.color, 0.35));
      g.addColorStop(1, shade(info.color, -0.25));
      ctx.fillStyle = g;
      roundRect(ctx, x, y, CAPSULE_W, CAPSULE_H, CAPSULE_H / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#0b0914';
      ctx.font = `9px ${this.fonts.pixel}`;
      ctx.fillText(info.glyph, c.x, c.y + 0.5);
    }

    // Laser bolts.
    ctx.fillStyle = '#ff5a5f';
    if (fx.glow > 0) {
      ctx.shadowColor = '#ff5a5f';
      ctx.shadowBlur = 8 * fx.glow;
    }
    for (const b of sim.bolts) ctx.fillRect(b.x - 1.5, b.y - 7, 3, 12);
    ctx.shadowBlur = 0;

    // Paddle.
    const px = sim.prevPaddleX + (sim.paddleX - sim.prevPaddleX) * alphaT;
    this.drawPaddle(ctx, sim, px);

    // Balls with trails.
    while (this.trails.length < sim.balls.length) this.trails.push({ pts: [] });
    this.trails.length = sim.balls.length;
    sim.balls.forEach((b, i) => {
      const x = b.stuck ? b.x : b.px + (b.x - b.px) * alphaT;
      const y = b.stuck ? b.y : b.py + (b.y - b.py) * alphaT;
      const tr = this.trails[i]!;
      if (!fx.reducedMotion && fx.fx !== 'off') {
        tr.pts.push([x, y]);
        if (tr.pts.length > 7) tr.pts.shift();
        tr.pts.forEach(([tx, ty], k) => {
          const a = (k + 1) / tr.pts.length;
          ctx.fillStyle = `rgba(124, 245, 255, ${0.18 * a})`;
          ctx.beginPath();
          ctx.arc(tx, ty, BALL_R * a, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      if (fx.glow > 0) {
        ctx.shadowColor = '#7cf5ff';
        ctx.shadowBlur = 14 * fx.glow;
      }
      const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, BALL_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#bff7ff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    this.particles.draw(ctx);
    this.popups.draw(ctx, this.fonts.display);
    this.drawEffects(ctx, sim);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 60, 80, ${0.25 * this.flash})`;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }

    // Banners and hints.
    if (this.banner) {
      this.banner.t += dt;
      const t = this.banner.t;
      const life = 1.8;
      if (t > life) this.banner = null;
      else {
        const a = Math.min(1, t * 4, (life - t) * 3);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(5, 4, 13, 0.55)';
        ctx.fillRect(0, FIELD_H * 0.52 - 34, FIELD_W, 68);
        ctx.fillStyle = this.banner.color;
        ctx.font = `30px ${this.fonts.display}`;
        ctx.fillText(this.banner.title, FIELD_W / 2, FIELD_H * 0.52 - 8);
        ctx.fillStyle = '#f8f6ff';
        ctx.font = `12px ${this.fonts.pixel}`;
        ctx.fillText(this.banner.sub, FIELD_W / 2, FIELD_H * 0.52 + 18);
        ctx.globalAlpha = 1;
      }
    }
    if (opts.hint && sim.phase === 'serve' && !this.banner) {
      const blink = fx.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(performance.now() / 260);
      ctx.globalAlpha = blink;
      ctx.fillStyle = '#f8f6ff';
      ctx.font = `12px ${this.fonts.pixel}`;
      ctx.fillText(opts.hint, FIELD_W / 2, PADDLE_Y - 64);
      ctx.globalAlpha = 1;
    }
    if (opts.paused) {
      ctx.fillStyle = 'rgba(5, 4, 13, 0.6)';
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    }
    ctx.restore();
  }

  /** Active power-ups as pills along the top edge (visible on every device, incl. phones). */
  private drawEffects(ctx: CanvasRenderingContext2D, sim: BricksSim): void {
    const active: Array<[PowerKind, number]> = [];
    if (sim.wide > 0) active.push(['wide', sim.wide]);
    if (sim.laser > 0) active.push(['laser', sim.laser]);
    if (sim.slow > 0) active.push(['slow', sim.slow]);
    if (sim.sticky > 0) active.push(['sticky', sim.sticky]);
    if (sim.balls.length > 1) active.push(['multi', 0]);
    let x = 10;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [kind, ticks] of active) {
      const info = POWER_INFO[kind];
      const w = 46;
      ctx.fillStyle = 'rgba(5, 4, 13, 0.7)';
      roundRect(ctx, x, 10, w, 18, 9);
      ctx.fill();
      ctx.strokeStyle = alpha(info.color, 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = info.color;
      ctx.font = `9px ${this.fonts.pixel}`;
      ctx.fillText(kind === 'multi' ? `×${sim.balls.length}` : `${info.glyph} ${Math.ceil(ticks / 60)}s`, x + w / 2, 19.5);
      if (ticks > 0) {
        ctx.fillRect(x + 6, 25, (w - 12) * Math.min(1, ticks / 720), 1.5);
      }
      x += w + 6;
    }
  }

  private drawField(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    bg.addColorStop(0, '#0d0a22');
    bg.addColorStop(0.7, '#07061a');
    bg.addColorStop(1, '#0a0716');
    ctx.fillStyle = bg;
    ctx.fillRect(-16, -16, FIELD_W + 32, FIELD_H + 32);
    ctx.strokeStyle = 'rgba(160, 150, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= FIELD_W; x += 40) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, FIELD_H);
    }
    for (let y = 0; y <= FIELD_H; y += 40) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(FIELD_W, y + 0.5);
    }
    ctx.stroke();
    // Danger zone glow under the paddle line.
    const glow = ctx.createLinearGradient(0, PADDLE_Y - 40, 0, FIELD_H);
    glow.addColorStop(0, 'rgba(255, 138, 61, 0)');
    glow.addColorStop(1, 'rgba(255, 138, 61, 0.12)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, PADDLE_Y - 40, FIELD_W, FIELD_H - PADDLE_Y + 40);
    // Brick zone ceiling line.
    ctx.fillStyle = 'rgba(124, 245, 255, 0.12)';
    ctx.fillRect(0, BRICK_TOP - CELL_H, FIELD_W, 1);
  }

  private drawBrickGlyph(ctx: CanvasRenderingContext2D, b: Brick, now: number): void {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (b.kind === 'A') {
      // Rivets + cracks as it takes damage.
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(b.x + 4, cy - 1, 2, 2);
      ctx.fillRect(b.x + b.w - 6, cy - 1, 2, 2);
      const dmg = b.maxHp - b.hp;
      if (dmg > 0) {
        ctx.strokeStyle = 'rgba(10, 8, 22, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx - 6, b.y + 2);
        ctx.lineTo(cx - 1, cy);
        ctx.lineTo(cx - 4, b.y + b.h - 2);
        if (dmg > 1) {
          ctx.moveTo(cx + 5, b.y + 2);
          ctx.lineTo(cx + 2, cy + 1);
          ctx.lineTo(cx + 8, b.y + b.h - 2);
        }
        ctx.stroke();
      }
    } else if (b.kind === 'X') {
      ctx.fillStyle = '#1a0710';
      ctx.fillRect(cx - 3, cy - 3, 6, 6);
      ctx.fillRect(cx - 1, cy - 6, 2, 3);
      ctx.fillStyle = now % 20 < 10 ? '#ffd23f' : '#ffffff';
      ctx.fillRect(cx, cy - 7, 2, 2);
    } else if (b.kind === 'P') {
      const tw = (now % 60) / 60;
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.abs(Math.sin(tw * Math.PI))})`;
      ctx.fillRect(cx - 1, cy - 5, 2, 10);
      ctx.fillRect(cx - 5, cy - 1, 10, 2);
    } else if (b.kind === 'M') {
      ctx.fillStyle = 'rgba(5, 20, 30, 0.75)';
      const dir = b.vx > 0 ? 1 : -1;
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * 7;
        ctx.beginPath();
        ctx.moveTo(x - 2 * dir, cy - 4);
        ctx.lineTo(x + 2 * dir, cy);
        ctx.lineTo(x - 2 * dir, cy + 4);
        ctx.lineTo(x - 2 * dir, cy - 4);
        ctx.fill();
      }
    } else if (b.kind === 'S') {
      ctx.fillStyle = 'rgba(40, 42, 70, 0.7)';
      ctx.fillRect(b.x + 3, b.y + 3, 2, 2);
      ctx.fillRect(b.x + b.w - 5, b.y + 3, 2, 2);
      ctx.fillRect(b.x + 3, b.y + b.h - 5, 2, 2);
      ctx.fillRect(b.x + b.w - 5, b.y + b.h - 5, 2, 2);
    }
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, sim: BricksSim, px: number): void {
    const fx = fxSettings();
    const w = sim.paddleW;
    const x = px - w / 2;
    const y = PADDLE_Y;
    if (fx.glow > 0) {
      ctx.shadowColor = sim.sticky > 0 ? '#2de38f' : '#ff8a3d';
      ctx.shadowBlur = 16 * fx.glow;
    }
    const g = ctx.createLinearGradient(0, y, 0, y + PADDLE_H);
    g.addColorStop(0, '#fff3e6');
    g.addColorStop(0.35, '#ffb070');
    g.addColorStop(1, '#c2410c');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, PADDLE_H, PADDLE_H / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Neon end caps.
    ctx.fillStyle = '#22d3ee';
    roundRect(ctx, x, y, 12, PADDLE_H, PADDLE_H / 2);
    ctx.fill();
    roundRect(ctx, x + w - 12, y, 12, PADDLE_H, PADDLE_H / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x + 8, y + 2, w - 16, 2);
    if (sim.laser > 0) {
      ctx.fillStyle = '#ff5a5f';
      ctx.fillRect(x + 4, y - 6, 4, 7);
      ctx.fillRect(x + w - 8, y - 6, 4, 7);
    }
    if (sim.sticky > 0) {
      ctx.fillStyle = alpha('#2de38f', 0.85);
      ctx.fillRect(x + 6, y - 2, w - 12, 3);
    }
  }
}

/** Tiny rival field preview ("level:rows:cells"). */
export function drawFieldPreview(ctx: CanvasRenderingContext2D, preview: string, w: number, h: number, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#07061a';
  ctx.fillRect(0, 0, w, h);
  const [, rowsRaw, cells = ''] = preview.split(':');
  const rows = Math.max(1, Number(rowsRaw) || 1);
  const cw = w / COLS;
  const ch = Math.min(cw * 0.5, (h * 0.7) / Math.max(rows, 8));
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]!;
    if (k === '.') continue;
    const x = (i % COLS) * cw;
    const y = 6 + Math.floor(i / COLS) * ch;
    ctx.fillStyle = k === 'N' ? TONES[Math.floor(i / COLS) % TONES.length]! : (KIND_COLOR as Record<string, string>)[k] ?? '#ffffff';
    ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
  }
  ctx.fillStyle = '#ff8a3d';
  ctx.fillRect(w * 0.4, h - 6, w * 0.2, 2);
}
