/**
 * Explosions and particles: flash + shockwave, fireball, sparks, flying terrain debris,
 * lingering smoke, dirt sprays, driller bore sparks, cluster splits, projectile trails,
 * floating damage numbers and the victory fireworks. One emitter per effect type keeps
 * draw calls low; the particle budget scales with the fx setting.
 */
import Phaser from 'phaser';
import type { BlastKind, WeaponId } from '@dascade/shared/games/tanks';
import type { LiveProjectile } from '../model/presenter.ts';
import { DISPLAY_FONT, NUM_FONT, WEAPON_TINT, hexToInt, type ThemePalette } from '../art/themes.ts';

export interface FxQuality {
  /** Particle multiplier (0.15..1). */
  amount: number;
  reducedMotion: boolean;
}

interface Popup {
  text: Phaser.GameObjects.Text;
  born: number;
  life: number;
  x: number;
  y: number;
  rise: number;
}

interface Bore {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  dur: number;
}

export class Effects {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly H: number;
  private q: FxQuality;
  private fire: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private exhaust: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti: Phaser.GameObjects.Particles.ParticleEmitter;
  private trailG: Phaser.GameObjects.Graphics;
  private readonly trails = new Map<number, { pts: Array<[number, number]>; tint: number; seen: number }>();
  private readonly popups: Popup[] = [];
  private readonly bores: Bore[] = [];
  private readonly wrecks = new Map<string, { x: number; y: number; next: number }>();
  private celebrate: { x: number; y: number; until: number; next: number; tint: number } | null = null;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, theme: ThemePalette, H: number, q: FxQuality, depth: number) {
    this.scene = scene;
    this.layer = layer;
    this.H = H;
    this.q = q;
    const a = q.amount;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T, d: number): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(d);
      layer.add(o);
      return o;
    };
    this.smoke = add(
      scene.add.particles(0, 0, 'tk-puff', {
        lifespan: { min: 1300, max: 2600 },
        speed: { min: 6, max: 38 },
        gravityY: -26,
        scale: { start: 0.7, end: 3.4 },
        alpha: { start: 0.55, end: 0 },
        tint: [0x2a2436, 0x3b3348, 0x1b1622, 0x4a4058],
        maxAliveParticles: Math.round(260 * a) + 12,
        emitting: false,
      }),
      depth + 1,
    );
    this.fire = add(
      scene.add.particles(0, 0, 'tk-puff', {
        lifespan: { min: 380, max: 900 },
        speed: { min: 24, max: 210 },
        scale: { start: 0.9, end: 2.9 },
        alpha: { start: 1, end: 0 },
        tint: [0xfff1c1, 0xffd23f, 0xff8a3d, 0xff4fd8],
        blendMode: Phaser.BlendModes.ADD,
        maxAliveParticles: Math.round(320 * a) + 16,
        emitting: false,
      }),
      depth + 3,
    );
    const soil = [theme.topsoil, theme.soil, theme.rock, theme.rim].map(hexToInt);
    this.debris = add(
      scene.add.particles(0, 0, 'tk-px', {
        lifespan: { min: 700, max: 1400 },
        speed: { min: 120, max: 420 },
        angle: { min: 200, max: 340 },
        gravityY: 760,
        scale: { min: 0.35, max: 1.1 },
        rotate: { min: 0, max: 360 },
        alpha: { start: 1, end: 0.6 },
        tint: soil,
        maxAliveParticles: Math.round(420 * a) + 20,
        emitting: false,
      }),
      depth + 2,
    );
    this.sparks = add(
      scene.add.particles(0, 0, 'tk-spark', {
        lifespan: { min: 220, max: 520 },
        speed: { min: 180, max: 560 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 300,
        rotate: { onEmit: () => 0, onUpdate: (p) => (Math.atan2(p.velocityY, p.velocityX) * 180) / Math.PI },
        tint: [0xffffff, 0xffd23f, 0xff8a3d],
        blendMode: Phaser.BlendModes.ADD,
        maxAliveParticles: Math.round(300 * a) + 20,
        emitting: false,
      }),
      depth + 4,
    );
    this.dust = add(
      scene.add.particles(0, 0, 'tk-puff', {
        lifespan: { min: 450, max: 900 },
        speed: { min: 10, max: 60 },
        angle: { min: 180, max: 360 },
        scale: { start: 0.35, end: 1.5 },
        alpha: { start: 0.45, end: 0 },
        tint: [hexToInt(theme.topsoil), hexToInt(theme.soil)],
        maxAliveParticles: Math.round(160 * a) + 8,
        emitting: false,
      }),
      depth + 1,
    );
    this.exhaust = add(
      scene.add.particles(0, 0, 'tk-puff', {
        lifespan: { min: 300, max: 700 },
        speed: { min: 4, max: 20 },
        scale: { start: 0.18, end: 0.8 },
        alpha: { start: 0.45, end: 0 },
        tint: [0xcfd3ea, 0x9aa4c8],
        maxAliveParticles: Math.round(220 * a) + 10,
        emitting: false,
      }),
      depth + 2,
    );
    this.confetti = add(
      scene.add.particles(0, 0, 'tk-confetti', {
        lifespan: { min: 1600, max: 2600 },
        speed: { min: 120, max: 360 },
        angle: { min: 230, max: 310 },
        gravityY: 260,
        rotate: { start: 0, end: 540 },
        scale: { min: 0.5, max: 0.9 },
        alpha: { start: 1, end: 0.2 },
        tint: [0xff4fd8, 0xffd23f, 0x22d3ee, 0x2de38f, 0xff8a3d, 0xa78bfa],
        maxAliveParticles: Math.round(300 * a) + 30,
        emitting: false,
      }),
      depth + 6,
    );
    this.trailG = add(scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD), depth + 3);
  }

  /** Weak hardware: halve the particle budget. */
  degrade(): void {
    this.q = { ...this.q, amount: Math.max(0.15, this.q.amount * 0.5) };
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.q.amount));
  }

  private py(y: number): number {
    return this.H - y;
  }

  private flash(x: number, y: number, size: number, tint: number, life: number, alpha = 1): void {
    const img = this.scene.add.image(x, y, 'tk-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setAlpha(alpha).setDepth(95);
    img.setDisplaySize(size * 0.4, size * 0.4);
    this.layer.add(img);
    const target = size / 64;
    this.scene.tweens.add({ targets: img, scaleX: target, scaleY: target, alpha: 0, duration: life, ease: 'Cubic.easeOut', onComplete: () => img.destroy() });
  }

  private ring(x: number, y: number, radius: number, tint: number, life: number): void {
    if (this.q.amount < 0.2 && radius < 50) return;
    const img = this.scene.add.image(x, y, 'tk-ring').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setAlpha(0.8).setDepth(94);
    img.setScale(0.05);
    this.layer.add(img);
    const target = (radius * 2.3) / 128;
    this.scene.tweens.add({ targets: img, scaleX: target, scaleY: target, alpha: 0, duration: life, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
  }

  launch(x: number, y: number, angle: number, weapon: WeaponId): void {
    const px = x;
    const py = this.py(y);
    const rad = (angle * Math.PI) / 180;
    this.flash(px, py, 70, WEAPON_TINT[weapon] ?? 0xffffff, 180);
    for (let i = 0; i < this.n(10); i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      this.smoke.emitParticleAt(px + Math.cos(rad + spread) * 6, py - Math.sin(rad + spread) * 6, 1);
    }
    this.fire.emitParticleAt(px + Math.cos(rad) * 4, py - Math.sin(rad) * 4, this.n(8));
    this.sparks.emitParticleAt(px, py, this.n(6));
  }

  boom(x: number, y: number, r: number, kind: BlastKind, terrain: 'crater' | 'dirt' | 'none', direct: boolean): void {
    const px = x;
    const py = this.py(y);
    if (terrain === 'dirt') {
      this.flash(px, py, r * 2.2, 0xc58b52, 300, 0.6);
      this.ring(px, py, r * 0.9, 0xffd9a6, 420);
      this.debris.emitParticleAt(px, py, this.n(40 + r));
      this.dust.emitParticleAt(px, py, this.n(18));
      return;
    }
    const air = terrain === 'none';
    const big = kind === 'heavy' || kind === 'wreck';
    const tint = kind === 'airburst' ? 0x7cf5ff : kind === 'cluster' || kind === 'bomblet' ? 0xff8ae6 : kind === 'driller' ? 0xd9ff8a : 0xffb347;
    this.flash(px, py, r * (big ? 6 : 4.8), tint, big ? 700 : 520);
    this.flash(px, py, r * 2, 0xffffff, 200);
    this.ring(px, py, r, air ? 0x7cf5ff : 0xffd9a6, big ? 700 : 520);
    if (big) this.ring(px, py, r * 0.6, 0xffffff, 360);
    // Fireball: a burst plus a few rolling puffs just above the impact.
    this.fire.emitParticleAt(px, py, this.n(air ? 30 : 22 + r * 0.6));
    for (let i = 0; i < this.n(6 + r * 0.1); i++) {
      this.fire.emitParticleAt(px + (Math.random() - 0.5) * r * 0.8, py - Math.random() * r * 0.7, 1);
    }
    this.sparks.emitParticleAt(px, py, this.n(air ? 40 : 18 + r * 0.35));
    if (!air) {
      this.debris.emitParticleAt(px, py, this.n(26 + r * 1.1));
      this.dust.emitParticleAt(px, py + r * 0.3, this.n(10));
      // The crater glows hot for a moment, then cools.
      const hot = this.scene.add.image(px, py + r * 0.15, 'tk-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff6a1f).setDepth(12);
      hot.setDisplaySize(r * 2.4, r * 1.6).setAlpha(0.9);
      this.layer.add(hot);
      this.scene.tweens.add({ targets: hot, alpha: 0, duration: big ? 2200 : 1500, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
    }
    for (let i = 0; i < this.n(big ? 16 : 9); i++) {
      this.smoke.emitParticleAt(px + (Math.random() - 0.5) * r * 1.1, py - Math.random() * r * 0.8, 1);
    }
    if (direct) this.popup(x, y + 26, 'DIRECT HIT', '#ffd23f', 1100, 34, DISPLAY_FONT, 18);
  }

  bore(x0: number, y0: number, x1: number, y1: number, durMs: number, now: number): void {
    this.bores.push({ x0, y0, x1, y1, start: now, dur: Math.max(120, durMs) });
    this.debris.emitParticleAt(x0, this.py(y0), this.n(26));
    this.sparks.emitParticleAt(x0, this.py(y0), this.n(12));
  }

  split(x: number, y: number): void {
    const py = this.py(y);
    this.flash(x, py, 90, 0xff4fd8, 260);
    this.sparks.emitParticleAt(x, py, this.n(18));
  }

  land(x: number, y: number, drop: number): void {
    this.dust.emitParticleAt(x, this.py(y), this.n(Math.min(24, 6 + drop * 0.2)));
  }

  drive(x: number, y: number, dir: number): void {
    if (Math.random() > 0.5) return;
    this.dust.emitParticleAt(x - dir * 12, this.py(y) - 2, 1);
    this.exhaust.emitParticleAt(x - dir * 14, this.py(y) - 12, 1);
  }

  death(id: string, x: number, y: number, color: string): void {
    const py = this.py(y + 8);
    this.flash(x, py, 260, hexToInt(color), 700);
    this.flash(x, py, 120, 0xffffff, 240);
    this.ring(x, py, 70, hexToInt(color), 700);
    this.fire.emitParticleAt(x, py, this.n(46));
    this.sparks.emitParticleAt(x, py, this.n(40));
    this.popup(x, y + 40, 'K.O.', '#ff5a5f', 1500, 44, DISPLAY_FONT, 26);
    this.wrecks.set(id, { x, y, next: 0 });
  }

  forgetWreck(id: string): void {
    this.wrecks.delete(id);
  }

  damage(x: number, y: number, amount: number, src: 'blast' | 'fall'): void {
    const color = src === 'fall' ? '#ffb347' : amount >= 40 ? '#ff5a5f' : '#ffd23f';
    this.popup(x + (Math.random() - 0.5) * 16, y + 32, `-${amount}`, color, 1200, 40, NUM_FONT, amount >= 40 ? 24 : 19);
  }

  lost(x: number, y: number): void {
    this.popup(Math.max(40, Math.min(1560, x)), Math.max(60, y), 'OUT OF BOUNDS', '#9d95c4', 1100, 20, DISPLAY_FONT, 13);
  }

  label(x: number, y: number, text: string, color: string): void {
    this.popup(x, y, text, color, 1400, 30, DISPLAY_FONT, 16);
  }

  private popup(x: number, y: number, text: string, color: string, life: number, rise: number, font: string, size: number): void {
    // Stack on top of recent popups at the same spot instead of overlapping them.
    const now = performance.now();
    for (let guard = 0; guard < 6; guard++) {
      const clash = this.popups.some((p) => now - p.born < 700 && Math.abs(p.x - x) < 70 && Math.abs(p.y - y) < 18);
      if (!clash) break;
      y += 20;
    }
    const t = this.scene.add
      .text(x, this.py(y), text, { fontFamily: font, fontSize: `${size}px`, fontStyle: font === NUM_FONT ? '700' : 'normal', color, stroke: '#07050f', strokeThickness: 5, resolution: 2 })
      .setOrigin(0.5, 1)
      .setDepth(120);
    this.layer.add(t);
    this.popups.push({ text: t, born: performance.now(), life, x, y, rise });
  }

  celebrateAt(x: number, y: number, tint: number, ms: number): void {
    this.celebrate = { x, y, until: performance.now() + ms, next: 0, tint };
  }

  /** Per frame: trails, bores, popups, wreck smoke, fireworks. `labelScale` keeps popups readable. */
  update(now: number, projectiles: LiveProjectile[], labelScale: number): void {
    // Trails.
    const g = this.trailG;
    g.clear();
    for (const p of projectiles) {
      let tr = this.trails.get(p.id);
      if (!tr) {
        tr = { pts: [], tint: WEAPON_TINT[p.kind] ?? 0xffffff, seen: now };
        this.trails.set(p.id, tr);
      }
      tr.seen = now;
      tr.pts.push([p.x, this.py(p.y)]);
      if (tr.pts.length > 34) tr.pts.shift();
      if (Math.random() < 0.55 * this.q.amount) this.smoke.emitParticleAt(p.x, this.py(p.y), 1);
    }
    for (const [id, tr] of this.trails) {
      if (tr.seen !== now) {
        tr.pts.shift();
        tr.pts.shift();
        if (tr.pts.length < 2) {
          this.trails.delete(id);
          continue;
        }
      }
      const n = tr.pts.length;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        g.lineStyle(1 + k * 3, tr.tint, k * 0.75);
        g.lineBetween(tr.pts[i - 1]![0], tr.pts[i - 1]![1], tr.pts[i]![0], tr.pts[i]![1]);
      }
    }
    // Bores: a spark head racing through the ground.
    for (let i = this.bores.length - 1; i >= 0; i--) {
      const b = this.bores[i]!;
      const k = (now - b.start) / b.dur;
      if (k >= 1) {
        this.bores.splice(i, 1);
        continue;
      }
      const x = b.x0 + (b.x1 - b.x0) * k;
      const y = b.y0 + (b.y1 - b.y0) * k;
      this.sparks.emitParticleAt(x, this.py(y), 1);
      if (Math.random() < 0.5) this.debris.emitParticleAt(x, this.py(y), 1);
    }
    // Floating text.
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        p.text.destroy();
        this.popups.splice(i, 1);
        continue;
      }
      const rise = this.q.reducedMotion ? p.rise * 0.3 : p.rise;
      p.text.setPosition(p.x, this.py(p.y) - rise * (1 - (1 - k) * (1 - k)) * labelScale);
      p.text.setScale(labelScale * (k < 0.12 ? 0.7 + k * 2.5 : 1));
      p.text.setAlpha(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
    // Burning wrecks.
    for (const w of this.wrecks.values()) {
      if (now < w.next) continue;
      w.next = now + 260 / Math.max(0.2, this.q.amount);
      this.smoke.emitParticleAt(w.x + (Math.random() - 0.5) * 10, this.py(w.y + 8), 1);
      if (Math.random() < 0.4) this.fire.emitParticleAt(w.x + (Math.random() - 0.5) * 8, this.py(w.y + 6), 1);
    }
    // Victory fireworks.
    const c = this.celebrate;
    if (c) {
      if (now > c.until) this.celebrate = null;
      else if (now > c.next) {
        c.next = now + (this.q.reducedMotion ? 700 : 320);
        const fx = c.x + (Math.random() - 0.5) * 360;
        const fy = c.y + 160 + Math.random() * 160;
        const tint = [0xff4fd8, 0xffd23f, 0x22d3ee, 0x2de38f, c.tint][Math.floor(Math.random() * 5)]!;
        this.flash(fx, this.py(fy), 120, tint, 600);
        this.sparks.emitParticleAt(fx, this.py(fy), this.n(26));
        if (!this.q.reducedMotion) this.confetti.emitParticleAt(c.x + (Math.random() - 0.5) * 200, this.py(c.y + 20), this.n(18));
      }
    }
  }

  destroy(): void {
    for (const p of this.popups) p.text.destroy();
    this.popups.length = 0;
    for (const o of [this.fire, this.smoke, this.debris, this.sparks, this.dust, this.exhaust, this.confetti, this.trailG]) o.destroy();
  }
}
