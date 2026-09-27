/**
 * Asteroid Run canvas renderer: a deep-space belt (nebula + parallax star dust), faceted rocks
 * with per-kind materials (stone, riveted iron, glowing crystal), pilots' dart ships with engine
 * flames and shield bubbles, bright shot streaks, power-up capsules, explosions and the nova
 * shockwave. World units (1600 × 1000, wrap-around); portrait screens see the belt on its side.
 * All randomness here is cosmetic (never simulated), and fx / reduced-motion are honoured.
 */
import type { PowerKind, RockKind } from '@dascade/shared/games/asteroids';
import { ROCK, SHIP, ShipFlag, WORLD, headingVec, type SnapRock, type SnapShip } from '@dascade/game-core/asteroids';
import { Particles, Popups, Shake, alpha, beginFrame, canvasFonts, fxSettings, shade, type Surface } from '../_classics/index.ts';
import type { Interp, LocalBullet } from './net.ts';
import { tint, type Materials } from '../_classics/palette.ts';
import { SPACE_ART, spaceArt, type SpaceArt } from './palette.ts';

const W = WORLD.width;
const H = WORLD.height;

/** Belt palette (game art; declared once so a theme could override it). */
export const BELT_ART = {
  spaceTop: '#0b0824',
  spaceBottom: '#04030d',
  nebulaA: '#6d28d9',
  nebulaB: '#0e7490',
  stone: '#8a84a8',
  iron: '#5b6b86',
  crystal: '#5ce1ff',
  crystalHot: '#ff6ad5',
  spread: '#ffd23f',
  rapid: '#ff8a3d',
  shield: '#22d3ee',
  nova: '#ff4fd8',
  life: '#2de38f',
} as const;

export const POWER_GLYPH: Record<PowerKind, string> = { spread: 'S', rapid: 'R', shield: '◆', nova: 'N', life: '+' };
const POWER_COLOR: Record<PowerKind, string> = {
  spread: BELT_ART.spread,
  rapid: BELT_ART.rapid,
  shield: BELT_ART.shield,
  nova: BELT_ART.nova,
  life: BELT_ART.life,
};

export interface PilotLook {
  color: string;
  name: string;
  me: boolean;
}

/** Tiny deterministic hash → [0, 1) for cosmetic per-rock shapes. */
function hash01(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
}

export class BeltRenderer {
  private readonly particles = new Particles(900);
  private readonly popups = new Popups();
  private readonly shake = new Shake();
  private rings: Ring[] = [];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private space: SpaceArt = SPACE_ART;

  /** Theme materials changed: re-colour the backdrop on the next frame (render-only). */
  setMaterials(m: Materials): void {
    const next = spaceArt(m);
    if (next === this.space) return;
    this.space = next;
    this.bg = null;
  }
  private readonly rockSprites = new Map<string, HTMLCanvasElement>();
  private fonts = canvasFonts();
  private t = 0;
  private banner: { text: string; sub: string; life: number } | null = null;
  private portrait = false;

  setPortrait(p: boolean): void {
    this.portrait = p;
  }

  /** World point → screen point (logical surface units). */
  toScreen(x: number, y: number): { x: number; y: number } {
    return this.portrait ? { x: y, y: W - x } : { x, y };
  }

  /** Screen direction → world direction (for stick aiming). */
  toWorldDir(dx: number, dy: number): { x: number; y: number } {
    return this.portrait ? { x: -dy, y: dx } : { x: dx, y: dy };
  }

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    this.rings = [];
    this.banner = null;
  }

  // --- effects -------------------------------------------------------------------
  rockHit(x: number, y: number, size: number, kind: RockKind, destroyed: boolean, points: number): void {
    const color = kind === 'crystal' ? BELT_ART.crystal : kind === 'iron' ? '#c9d4ea' : '#d8d2f0';
    if (destroyed) {
      this.particles.burst(x, y, color, 10 + size * 8, { speed: 90 + size * 40, life: 0.7, size: 3 + size, gravity: 0 });
      if (kind === 'crystal') this.particles.burst(x, y, BELT_ART.crystalHot, 12, { speed: 150, life: 0.5, size: 3, gravity: 0 });
      this.rings.push({ x, y, r: 6, max: ROCK.radius[size]! * 1.6, life: 1, color });
      if (points > 0) this.addPopup(x, y, `+${points}`, color, 22);
      if (size === 3) this.shake.kick(2.5);
    } else {
      this.particles.burst(x, y, '#ffe9a8', 6, { speed: 140, life: 0.25, size: 2.5, gravity: 0 });
    }
  }

  shipHit(x: number, y: number, color: string): void {
    this.rings.push({ x, y, r: 20, max: 60, life: 1, color: BELT_ART.shield });
    this.particles.burst(x, y, color, 8, { speed: 120, life: 0.35, size: 3, gravity: 0 });
    this.shake.kick(3);
  }

  shipDown(x: number, y: number, color: string, mine: boolean): void {
    this.particles.burst(x, y, color, 50, { speed: 220, life: 1.1, size: 5, gravity: 0 });
    this.particles.burst(x, y, '#fff3c4', 26, { speed: 120, life: 0.6, size: 4, gravity: 0 });
    this.rings.push({ x, y, r: 10, max: 140, life: 1, color });
    if (mine) this.shake.kick(9);
  }

  pickup(x: number, y: number, kind: PowerKind, label: string): void {
    const c = POWER_COLOR[kind];
    this.rings.push({ x, y, r: 10, max: 70, life: 1, color: c });
    this.particles.burst(x, y, c, 18, { speed: 110, life: 0.5, size: 3, gravity: 0 });
    this.addPopup(x, y - 24, label.toUpperCase(), c, 20);
  }

  nova(x: number, y: number): void {
    this.rings.push({ x, y, r: 20, max: 300, life: 1, color: BELT_ART.nova });
    this.rings.push({ x, y, r: 10, max: 220, life: 0.8, color: '#ffffff' });
    this.shake.kick(7);
  }

  wave(wave: number, bonus: number): void {
    this.banner = { text: `WAVE ${wave} CLEAR`, sub: bonus > 0 ? `+${bonus} bonus` : '', life: 2.4 };
  }

  incoming(wave: number): void {
    this.banner = { text: `WAVE ${wave}`, sub: 'Incoming', life: 1.6 };
  }

  private addPopup(x: number, y: number, text: string, color: string, size: number): void {
    const p = this.toScreen(x, y);
    this.popups.add(p.x, p.y, text, color, size, 0.9);
  }

  // --- art -----------------------------------------------------------------------
  private background(s: Surface): HTMLCanvasElement {
    const key = `${s.scale.toFixed(3)}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const art = this.space;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * s.scale));
    c.height = Math.max(1, Math.round(H * s.scale));
    const g = c.getContext('2d')!;
    g.scale(s.scale, s.scale);
    const grad = g.createLinearGradient(0, 0, W * 0.3, H);
    grad.addColorStop(0, art.spaceTop);
    grad.addColorStop(1, art.spaceBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const blob = (x: number, y: number, r: number, color: string, a: number) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, tint(color, a));
      rg.addColorStop(1, tint(color, 0));
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(W * 0.22, H * 0.28, 520, art.nebulaA, 0.22);
    blob(W * 0.78, H * 0.7, 560, art.nebulaB, 0.2);
    blob(W * 0.6, H * 0.15, 300, art.nebulaC, 0.1);
    // Star dust (three depths).
    for (let i = 0; i < 420; i++) {
      const x = hash01(i * 3 + 1) * W;
      const y = hash01(i * 3 + 2) * H;
      const depth = hash01(i * 3 + 3);
      const size = depth > 0.93 ? 3 : depth > 0.7 ? 2 : 1.2;
      g.fillStyle = `rgba(${220 + Math.round(depth * 35)}, ${220 + Math.round(depth * 20)}, 255, ${0.25 + depth * 0.6})`;
      g.fillRect(x, y, size, size);
    }
    this.bg = { key, canvas: c };
    return c;
  }

  private rockSprite(r: SnapRock, px: number): HTMLCanvasElement {
    const shapeSeed = r.id % 97;
    const key = `${shapeSeed}|${r.kind}|${r.size}|${Math.min(r.hp, 4)}|${px.toFixed(2)}`;
    const hit = this.rockSprites.get(key);
    if (hit) return hit;
    const rad = ROCK.radius[r.size]!;
    const pad = 6;
    const dim = (rad + pad) * 2;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(dim * px));
    c.height = c.width;
    const g = c.getContext('2d')!;
    g.scale(px, px);
    g.translate(dim / 2, dim / 2);
    const n = 9 + (shapeSeed % 4);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.78 + hash01(shapeSeed * 31 + i) * 0.28;
      pts.push([Math.cos(a) * rad * k, Math.sin(a) * rad * k]);
    }
    const base = r.kind === 'crystal' ? BELT_ART.crystal : r.kind === 'iron' ? BELT_ART.iron : BELT_ART.stone;
    // Body.
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    const body = g.createLinearGradient(-rad, -rad, rad, rad);
    if (r.kind === 'crystal') {
      body.addColorStop(0, alpha('#e8fbff', 0.95));
      body.addColorStop(0.45, alpha(BELT_ART.crystal, 0.85));
      body.addColorStop(1, alpha(BELT_ART.crystalHot, 0.75));
    } else {
      body.addColorStop(0, shade(base, 0.35));
      body.addColorStop(0.55, base);
      body.addColorStop(1, shade(base, -0.55));
    }
    g.fillStyle = body;
    g.fill();
    // Facets: lighter wedges on the lit (top-left) side.
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % n]!;
      const lit = (ax + bx) * -0.5 + (ay + by) * -0.5;
      if (lit <= 0) continue;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(ax, ay);
      g.lineTo(bx, by);
      g.closePath();
      g.fillStyle = r.kind === 'crystal' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)';
      g.fill();
    }
    // Rim.
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.lineWidth = r.kind === 'crystal' ? 2.5 : 2;
    g.strokeStyle = r.kind === 'crystal' ? '#e8fbff' : shade(base, 0.55);
    g.stroke();
    if (r.kind === 'iron') {
      // Riveted armour band + damage cracks (fewer hp = more cracks).
      g.strokeStyle = 'rgba(210, 225, 245, 0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-rad * 0.7, -rad * 0.1);
      g.lineTo(rad * 0.7, rad * 0.15);
      g.stroke();
      g.fillStyle = '#dfe8f7';
      for (let i = -2; i <= 2; i++) g.fillRect(i * rad * 0.28 - 1.5, i * rad * 0.035 - 1.5, 3, 3);
      const cracks = Math.max(0, ROCK.hp.iron[r.size]! - r.hp);
      g.strokeStyle = 'rgba(255, 190, 120, 0.8)';
      g.lineWidth = 1.5;
      for (let i = 0; i < cracks; i++) {
        const a = hash01(shapeSeed + i * 7) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * rad * 0.2, Math.sin(a) * rad * 0.2);
        g.lineTo(Math.cos(a + 0.4) * rad * 0.75, Math.sin(a + 0.4) * rad * 0.75);
        g.stroke();
      }
    } else if (r.kind === 'stone') {
      // Craters.
      for (let i = 0; i < 2 + r.size; i++) {
        const cx = (hash01(shapeSeed * 13 + i) - 0.5) * rad;
        const cy = (hash01(shapeSeed * 17 + i) - 0.5) * rad;
        const cr = rad * (0.1 + hash01(shapeSeed + i * 5) * 0.12);
        g.fillStyle = 'rgba(20, 16, 40, 0.35)';
        g.beginPath();
        g.arc(cx, cy, cr, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // Inner glow core.
      const core = g.createRadialGradient(0, 0, 0, 0, 0, rad * 0.6);
      core.addColorStop(0, 'rgba(255,255,255,0.55)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core;
      g.fillRect(-rad, -rad, rad * 2, rad * 2);
    }
    if (this.rockSprites.size > 400) this.rockSprites.clear();
    this.rockSprites.set(key, c);
    return c;
  }

  /** Call fn at (x, y) and at the wrapped copies needed near the edges. */
  private wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
    const xs = [x];
    const ys = [y];
    if (x < r) xs.push(x + W);
    else if (x > W - r) xs.push(x - W);
    if (y < r) ys.push(y + H);
    else if (y > H - r) ys.push(y - H);
    for (const xx of xs) for (const yy of ys) fn(xx, yy);
  }

  private drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, thrusting: boolean, shield: number, invuln: boolean, glow: number): void {
    if (invuln && Math.floor(this.t * 12) % 2 === 0) return;
    const [dx, dy] = headingVec(h);
    const angle = Math.atan2(dy, dx); // cosmetic only
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Drawn a little larger than the hit radius so the dart reads clearly on phones.
    const r = SHIP.radius * 1.3;
    if (thrusting) {
      const flick = 0.75 + Math.random() * 0.5;
      const fl = ctx.createLinearGradient(-r, 0, -r - 26 * flick, 0);
      fl.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
      fl.addColorStop(0.4, alpha(color, 0.8));
      fl.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = fl;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -6);
      ctx.lineTo(-r - 26 * flick, 0);
      ctx.lineTo(-r * 0.55, 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * glow;
    // Dart hull: swept wings + a long nose.
    ctx.beginPath();
    ctx.moveTo(r * 1.25, 0);
    ctx.lineTo(-r * 0.2, -r * 0.42);
    ctx.lineTo(-r * 0.85, -r * 0.95);
    ctx.lineTo(-r * 0.6, 0);
    ctx.lineTo(-r * 0.85, r * 0.95);
    ctx.lineTo(-r * 0.2, r * 0.42);
    ctx.closePath();
    const hull = ctx.createLinearGradient(0, -r, 0, r);
    hull.addColorStop(0, shade(color, 0.45));
    hull.addColorStop(0.5, color);
    hull.addColorStop(1, shade(color, -0.4));
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = shade(color, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Cockpit.
    ctx.fillStyle = '#e9fbff';
    ctx.fillRect(r * 0.15, -2.5, 8, 5);
    ctx.restore();
    // Shield bubble (strength shown by its brightness; always a ring so it reads without colour).
    if (shield > 0) {
      ctx.save();
      ctx.strokeStyle = alpha(BELT_ART.shield, 0.12 + (shield / 100) * 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, SHIP.radius * 1.3 + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  draw(
    s: Surface,
    interp: Interp | null,
    looks: Map<number, PilotLook>,
    me: { x: number; y: number; h: number; ox: number; oy: number; thrusting: boolean } | null,
    myBullets: readonly LocalBullet[],
    mySlot: number,
    frameMs: number,
  ): void {
    const dt = Math.min(0.05, frameMs / 1000);
    this.t += dt;
    const fx = fxSettings();
    const ctx = beginFrame(s);
    const o = this.shake.offset(frameMs);
    ctx.save();
    ctx.translate(o.x, o.y);
    if (this.portrait) ctx.transform(0, -1, 1, 0, 0, W);
    ctx.drawImage(this.background(s), 0, 0, W, H);
    if (!interp) {
      ctx.restore();
      return;
    }
    const { a, b, t } = interp;
    const lerpWrap = (p: number, q: number, size: number) => {
      let d = q - p;
      if (d > size / 2) d -= size;
      else if (d < -size / 2) d += size;
      let v = p + d * t;
      if (v < 0) v += size;
      else if (v >= size) v -= size;
      return v;
    };

    // Drops.
    const dropsA = new Map(a.drops.map((d) => [d.id, d]));
    for (const d of b.drops) {
      const p = dropsA.get(d.id) ?? d;
      const x = lerpWrap(p.x, d.x, W);
      const y = lerpWrap(p.y, d.y, H);
      if (d.ttl < 120 && Math.floor(this.t * 8) % 2 === 0) continue;
      const c = POWER_COLOR[d.kind];
      const pulse = fx.reducedMotion ? 1 : 1 + Math.sin(this.t * 5 + d.id) * 0.12;
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 18 * fx.glow;
      ctx.fillStyle = alpha(c, 0.22);
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      const sz = 17 * pulse;
      ctx.beginPath();
      ctx.moveTo(x, y - sz);
      ctx.lineTo(x + sz, y);
      ctx.lineTo(x, y + sz);
      ctx.lineTo(x - sz, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.glyph(ctx, x, y, POWER_GLYPH[d.kind], c);
    }

    // Rocks.
    const rocksA = new Map(a.rocks.map((r) => [r.id, r]));
    for (const r of b.rocks) {
      const p = rocksA.get(r.id);
      const x = p ? lerpWrap(p.x, r.x, W) : r.x;
      const y = p ? lerpWrap(p.y, r.y, H) : r.y;
      const sprite = this.rockSprite(r, s.scale);
      const dim = (ROCK.radius[r.size]! + 6) * 2;
      const rot = fx.reducedMotion ? 0 : this.t * r.spin * 0.35 + (r.id % 7);
      this.wrapped(x, y, dim / 2, (xx, yy) => {
        ctx.save();
        ctx.translate(xx, yy);
        ctx.rotate(rot);
        if (r.kind === 'crystal') {
          ctx.shadowColor = BELT_ART.crystal;
          ctx.shadowBlur = 20 * fx.glow;
        }
        ctx.drawImage(sprite, -dim / 2, -dim / 2, dim, dim);
        ctx.restore();
      });
    }

    // Shots: others' from snapshots, ours from prediction.
    const bulletsA = new Map(a.bullets.map((q) => [q.id, q]));
    const drawShot = (x: number, y: number, vx: number, vy: number, color: string) => {
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      const ux = vx / len;
      const uy = vy / len;
      ctx.strokeStyle = alpha(color, 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - ux * 14, y - uy * 14);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    };
    ctx.save();
    ctx.shadowBlur = 10 * fx.glow;
    for (const q of b.bullets) {
      if (q.owner === mySlot && me) continue;
      const p = bulletsA.get(q.id);
      const color = looks.get(q.owner)?.color ?? '#ffffff';
      ctx.shadowColor = color;
      drawShot(p ? lerpWrap(p.x, q.x, W) : q.x, p ? lerpWrap(p.y, q.y, H) : q.y, q.vx, q.vy, color);
    }
    const myColor = looks.get(mySlot)?.color ?? '#ffffff';
    ctx.shadowColor = myColor;
    for (const q of myBullets) drawShot(q.x, q.y, q.vx, q.vy, myColor);
    ctx.restore();

    // Ships.
    const shipsA = new Map(a.ships.map((sh) => [sh.slot, sh]));
    for (const sh of b.ships) {
      if (!(sh.flags & ShipFlag.alive)) continue;
      const look = looks.get(sh.slot) ?? { color: '#c4b5fd', name: '', me: false };
      if (look.me && me) continue;
      const p: SnapShip = shipsA.get(sh.slot) ?? sh;
      const x = lerpWrap(p.x, sh.x, W);
      const y = lerpWrap(p.y, sh.y, H);
      let dh = sh.h - p.h;
      if (dh > 32) dh -= 64;
      else if (dh < -32) dh += 64;
      this.wrapped(x, y, 40, (xx, yy) => this.drawShip(ctx, xx, yy, p.h + dh * t, look.color, (sh.flags & ShipFlag.thrusting) !== 0, sh.shield, sh.invuln > 0, fx.glow));
      this.nameTag(ctx, x, y, look.name, look.color);
    }
    if (me) {
      const mine = b.ships.find((sh) => sh.slot === mySlot);
      let x = me.x + me.ox;
      let y = me.y + me.oy;
      if (x < 0) x += W;
      else if (x >= W) x -= W;
      if (y < 0) y += H;
      else if (y >= H) y -= H;
      this.wrapped(x, y, 40, (xx, yy) => this.drawShip(ctx, xx, yy, me.h, myColor, me.thrusting, mine?.shield ?? 100, (mine?.invuln ?? 0) > 0, fx.glow));
    }

    // Rings.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt * (r.max > 200 ? 1.4 : 2.4);
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const rad = r.r + (r.max - r.r) * (fx.reducedMotion ? 0.5 : 1 - r.life);
      ctx.strokeStyle = alpha(r.color, r.life * 0.7);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.particles.update(dt);
    this.particles.draw(ctx);
    ctx.restore();

    // Screen-space text.
    this.popups.update(dt);
    this.popups.draw(ctx, this.fonts.num);
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
      else {
        const k = Math.min(1, this.banner.life * 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = alpha('#f3eaff', k);
        ctx.font = `${this.portrait ? 64 : 72}px ${this.fonts.display}`;
        ctx.fillText(this.banner.text, s.width / 2, s.height * 0.42);
        if (this.banner.sub) {
          ctx.font = `28px ${this.fonts.pixel}`;
          ctx.fillStyle = alpha(BELT_ART.crystal, k);
          ctx.fillText(this.banner.sub.toUpperCase(), s.width / 2, s.height * 0.42 + 64);
        }
      }
    }
  }

  private glyph(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
    ctx.save();
    if (this.portrait) {
      // Keep glyphs upright on a rotated belt.
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-x, -y);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 18px ${this.fonts.num}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  private nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, color: string): void {
    if (!name) return;
    ctx.save();
    const ty = y - 36;
    if (this.portrait) {
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-x, -y);
    }
    ctx.font = `16px ${this.fonts.pixel}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = alpha(color, 0.85);
    ctx.fillText(name.slice(0, 12), x, this.portrait ? y - 36 : ty);
    ctx.restore();
  }
}
