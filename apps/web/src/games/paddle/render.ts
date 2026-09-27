/**
 * Pixel Paddle canvas renderer: a neon court (grid, pixel centre line, glowing goal zones and
 * big ghost score digits), beveled pixel paddles with glow, a square ball with a motion trail,
 * impact rings, particles and point flashes. Draws in logical court units (1600 × 900).
 * Honours fx level and reduced motion via the kit's fxSettings().
 */
import { PADDLE, type Side } from '@dascade/game-core/paddle';
import { Particles, Popups, Shake, alpha, beginFrame, canvasFonts, drawBlock, fxSettings, type Surface } from '../_classics/index.ts';
import type { PaddleFrame } from './net.ts';
import { COURT_ART, courtArt, type CourtArt } from './palette.ts';
import { tint, type Materials } from '../_classics/palette.ts';

/** Court palette (game art; declared once so a theme could override it). */
export const PADDLE_ART = {
  courtTop: '#07182a',
  courtBottom: '#030b15',
  grid: 'rgba(124, 245, 255, 0.045)',
  centre: 'rgba(214, 246, 255, 0.34)',
  ball: '#f8f6ff',
  ballGlow: '#7cf5ff',
  house: '#ff4fd8',
} as const;

const W = PADDLE.width;
const H = PADDLE.height;
const PW = PADDLE.paddleW;
const PH = PADDLE.paddleH;
const BALL = PADDLE.ballR * 2;

export interface CourtView {
  colors: [string, string];
  scores: [number, number];
  mySide: Side | -1;
  /** Show the "serve" prompt at the ball (it's our serve). */
  serveHint: boolean;
  /** Highlight a side (e.g. the winner). */
  winner: Side | -1;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  color: string;
}

export class PaddleRenderer {
  private readonly particles = new Particles(520);
  private readonly popups = new Popups();
  private readonly shake = new Shake();
  private trail: Array<{ x: number; y: number }> = [];
  private rings: Ring[] = [];
  private flash: { color: string; life: number } | null = null;
  private paddleGlow: [number, number] = [0, 0];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private fonts = canvasFonts();
  private t = 0;
  private court: CourtArt = COURT_ART;

  /** Theme materials changed: re-colour the court on the next frame (render-only). */
  setMaterials(m: Materials): void {
    const next = courtArt(m);
    if (next === this.court) return;
    this.court = next;
    this.bg = null;
  }

  hit(side: Side, x: number, y: number, speed: number, color: string, rally: number): void {
    const fx = fxSettings();
    this.rings.push({ x, y, life: 1, color });
    this.paddleGlow[side] = 1;
    const dir = side === 0 ? 1 : -1;
    this.particles.burst(x, y, color, 10 + Math.min(18, rally), { speed: 160 + speed * 8, life: 0.45, size: 5, gravity: 0, dirX: dir * 140 });
    if (speed > 22) this.shake.kick(2 + (speed - 22) * 0.3);
    if (rally >= 5 && rally % 5 === 0) {
      const at = this.orient.portrait ? { x: H / 2, y: W / 2 } : { x: W / 2, y: 120 };
      this.popups.add(at.x, at.y, `RALLY ${rally}`, PADDLE_ART.ballGlow, 44, 1.1);
    }
    if (fx.reducedMotion) this.rings.length = Math.min(this.rings.length, 2);
  }

  wall(x: number, y: number): void {
    this.particles.burst(x, y <= 0 ? 4 : H - 4, PADDLE_ART.ballGlow, 5, { speed: 110, life: 0.3, size: 4, gravity: 0 });
  }

  point(scorer: Side, color: string, ballY: number): void {
    const goalX = scorer === 0 ? W - 8 : 8;
    this.flash = { color, life: 1 };
    this.particles.burst(goalX, ballY, color, 60, { speed: 320, life: 0.9, size: 7, gravity: 0, dirX: scorer === 0 ? -160 : 160 });
    this.shake.kick(7);
    this.trail = [];
  }

  serve(): void {
    this.trail = [];
  }

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    this.trail = [];
    this.rings = [];
    this.flash = null;
  }

  private background(s: Surface, colors: [string, string]): HTMLCanvasElement {
    const key = `${s.scale.toFixed(3)}|${colors[0]}|${colors[1]}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * s.scale));
    c.height = Math.max(1, Math.round(H * s.scale));
    const g = c.getContext('2d')!;
    g.scale(s.scale, s.scale);
    const grad = g.createLinearGradient(0, 0, 0, H);
    const art = this.court;
    grad.addColorStop(0, art.courtTop);
    grad.addColorStop(1, art.courtBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Goal zones in each side's colour.
    for (const side of [0, 1] as const) {
      const x0 = side === 0 ? 0 : W;
      const zone = g.createLinearGradient(x0, 0, side === 0 ? 220 : W - 220, 0);
      zone.addColorStop(0, alpha(colors[side], 0.2));
      zone.addColorStop(1, alpha(colors[side], 0));
      g.fillStyle = zone;
      g.fillRect(side === 0 ? 0 : W - 220, 0, 220, H);
      g.fillStyle = alpha(colors[side], 0.55);
      g.fillRect(side === 0 ? 0 : W - 4, 0, 4, H);
    }
    // Centre pool of light.
    const pool = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.46);
    pool.addColorStop(0, tint(art.glow, 0.1));
    pool.addColorStop(1, tint(art.glow, 0));
    g.fillStyle = pool;
    g.fillRect(0, 0, W, H);
    // Floor grid.
    g.fillStyle = art.grid;
    for (let x = 50; x < W; x += 50) g.fillRect(x, 0, 1.5, H);
    for (let y = 50; y < H; y += 50) g.fillRect(0, y, W, 1.5);
    // Pixel centre line (with a soft glow) + centre diamond.
    g.save();
    g.shadowColor = tint(art.glow, 0.8);
    g.shadowBlur = 14;
    g.fillStyle = art.centre;
    for (let y = 14; y < H; y += 44) g.fillRect(W / 2 - 5, y, 10, 24);
    g.restore();
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(Math.PI / 4);
    g.strokeStyle = tint(art.line, 0.16);
    g.lineWidth = 4;
    g.strokeRect(-70, -70, 140, 140);
    g.restore();
    // Top/bottom rails.
    g.save();
    g.shadowColor = tint(art.glow, 0.9);
    g.shadowBlur = 16;
    g.fillStyle = tint(art.line, 0.5);
    g.fillRect(0, 0, W, 4);
    g.fillRect(0, H - 4, W, 4);
    g.restore();
    // Vignette.
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.62);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    this.bg = { key, canvas: c };
    return c;
  }

  /** Court → screen transform for the current orientation (portrait: `bottom` side at the bottom). */
  private orient: { portrait: boolean; bottom: Side } = { portrait: false, bottom: 0 };

  setOrientation(portrait: boolean, bottom: Side): void {
    this.orient = { portrait, bottom };
  }

  /** Court point → screen point (logical units of the surface). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const { portrait, bottom } = this.orient;
    if (!portrait) return { x, y };
    return bottom === 0 ? { x: y, y: W - x } : { x: H - y, y: x };
  }

  /** Screen point → court point. */
  toCourt(x: number, y: number): { x: number; y: number } {
    const { portrait, bottom } = this.orient;
    if (!portrait) return { x, y };
    return bottom === 0 ? { x: W - y, y: x } : { x: y, y: H - x };
  }

  private applyCourtTransform(ctx: CanvasRenderingContext2D): void {
    const { portrait, bottom } = this.orient;
    if (!portrait) return;
    if (bottom === 0) ctx.transform(0, -1, 1, 0, 0, W);
    else ctx.transform(0, 1, -1, 0, H, 0);
  }

  draw(s: Surface, f: PaddleFrame, view: CourtView, frameMs: number): void {
    const dt = Math.min(0.05, frameMs / 1000);
    this.t += dt;
    const fx = fxSettings();
    const ctx = beginFrame(s);
    const o = this.shake.offset(frameMs);
    const portrait = this.orient.portrait;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.save();
    this.applyCourtTransform(ctx);
    ctx.drawImage(this.background(s, view.colors), 0, 0, W, H);
    ctx.restore();

    // Ghost score digits (screen-space text, placed on each side's half).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${portrait ? 190 : 170}px ${this.fonts.num}`;
    for (const side of [0, 1] as const) {
      const at = portrait ? this.toScreen(W / 2 + (side === 0 ? -300 : 300), H / 2) : { x: W / 2 + (side === 0 ? -210 : 210), y: 170 };
      ctx.fillStyle = alpha(view.colors[side], view.winner === side ? 0.3 : 0.12);
      ctx.fillText(String(view.scores[side]), at.x, at.y);
    }

    ctx.save();
    this.applyCourtTransform(ctx);
    // Ball trail + ball.
    const b = f.ball;
    const moving = f.status === 'play';
    if (moving) {
      this.trail.push({ x: b.x, y: b.y });
      const maxTrail = fx.reducedMotion ? 3 : fx.fx === 'off' ? 0 : 10;
      while (this.trail.length > maxTrail) this.trail.shift();
    } else if (this.trail.length) this.trail.shift();
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i]!;
      const k = (i + 1) / (this.trail.length + 1);
      ctx.fillStyle = alpha(PADDLE_ART.ballGlow, 0.35 * k);
      const size = BALL * (0.45 + 0.5 * k);
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    if (f.live) {
      ctx.save();
      ctx.shadowColor = PADDLE_ART.ballGlow;
      ctx.shadowBlur = 26 * fx.glow;
      ctx.fillStyle = PADDLE_ART.ball;
      ctx.fillRect(b.x - BALL / 2, b.y - BALL / 2, BALL, BALL);
      ctx.restore();
      ctx.fillStyle = alpha(PADDLE_ART.ballGlow, 0.9);
      ctx.fillRect(b.x - BALL / 2 + 4, b.y - BALL / 2 + 4, 6, 6);
    }

    // Paddles.
    for (const side of [0, 1] as const) {
      const x = side === 0 ? PADDLE.inset : W - PADDLE.inset - PW;
      const y = f.paddles[side] - PH / 2;
      const color = view.colors[side];
      this.paddleGlow[side] = Math.max(0, this.paddleGlow[side] - dt * 3);
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = (16 + this.paddleGlow[side] * 30) * fx.glow;
      drawBlock(ctx, s, color, x, y, PW, PH, 'gem');
      ctx.restore();
      if (view.mySide === side) {
        // "You" marker: a small pixel dot behind the paddle.
        ctx.fillStyle = alpha(color, 0.8);
        const cx = side === 0 ? x - 16 : x + PW + 10;
        ctx.fillRect(cx, f.paddles[side] - 3, 6, 6);
      }
    }

    // Impact rings.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt * 2.6;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const size = 24 + (1 - r.life) * (fx.reducedMotion ? 30 : 90);
      ctx.strokeStyle = alpha(r.color, r.life * 0.8);
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x - size / 2, r.y - size / 2, size, size);
    }

    this.particles.update(dt);
    this.particles.draw(ctx);
    ctx.restore();

    // Screen-space text: pop-ups and the serve prompt.
    this.popups.update(dt);
    this.popups.draw(ctx, this.fonts.display);
    if (view.serveHint && f.status === 'serve') {
      const pulse = fx.reducedMotion ? 0.8 : 0.55 + 0.45 * Math.sin(this.t * 6);
      ctx.font = `28px ${this.fonts.pixel}`;
      ctx.fillStyle = alpha(this.court.ink, pulse);
      if (portrait) {
        const at = this.toScreen(b.x + (f.server === 0 ? 60 : -60), b.y);
        ctx.textAlign = 'center';
        ctx.fillText('YOUR SERVE', Math.max(110, Math.min(s.width - 110, at.x)), at.y);
      } else {
        ctx.textAlign = f.server === 0 ? 'left' : 'right';
        ctx.fillText('YOUR SERVE', f.server === 0 ? b.x + 30 : b.x - 30, b.y - 38);
      }
    }
    ctx.restore();

    if (this.flash) {
      this.flash.life -= dt * (fx.reducedMotion ? 3 : 1.8);
      if (this.flash.life <= 0) this.flash = null;
      else {
        ctx.fillStyle = alpha(this.flash.color, this.flash.life * (fx.reducedMotion ? 0.08 : 0.16));
        ctx.fillRect(0, 0, s.width, s.height);
      }
    }
  }
}
