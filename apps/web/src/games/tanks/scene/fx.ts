/**
 * Explosions and particles: flash + shockwave, fireball, sparks, flying terrain debris,
 * lingering smoke, dirt sprays, nuke mushroom clouds, beams (railgun, Sky Lance, lightning),
 * shield ripples and shatters, deflector sparks, warps, wrap-around portals, parachute pops,
 * driller bore sparks, splitter bursts, projectile trails, floating damage numbers and the
 * victory fireworks. One emitter per effect type keeps draw calls low; the particle budget
 * scales with the fx setting, and reduced motion keeps everything calm (no strobing, short rises).
 */
import Phaser from 'phaser';
import type { BeamKind, BlastKind, DamageSource, ShieldKind, WeaponId } from '@dascade/shared/games/tanks';
import type { LiveProjectile } from '../model/presenter.ts';
import { BEAM_TINT, CONFETTI_TINTS, DISPLAY_FONT, NUM_FONT, SHIELD_TINT, WEAPON_TINT, hexToInt, type ThemePalette } from '../art/themes.ts';

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

/** A beam or streak drawn for a moment and faded out. Screen-space y (y-down world). */
interface Streak {
  kind: BeamKind | 'warp';
  pts: Array<[number, number]>;
  start: number;
  life: number;
  core: number;
  glow: number;
  width: number;
}

/** Sub-munition kinds whose trail colour comes from the projectile id (confetti). */
function trailTint(p: LiveProjectile): number {
  if (p.kind === 'confetti') return CONFETTI_TINTS[p.id % CONFETTI_TINTS.length]!;
  return WEAPON_TINT[p.kind] ?? 0xffffff;
}

const NUKES: ReadonlySet<BlastKind> = new Set<BlastKind>(['nuke', 'mininuke']);
const BIG: ReadonlySet<BlastKind> = new Set<BlastKind>(['heavy', 'heavyroller', 'wreck', 'warhead', 'meteor']);

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
  private shards: Phaser.GameObjects.Particles.ParticleEmitter;
  private trailG: Phaser.GameObjects.Graphics;
  private streakG: Phaser.GameObjects.Graphics;
  private readonly trails = new Map<number, { pts: Array<[number, number]>; tint: number; seen: number; width: number }>();
  private readonly popups: Popup[] = [];
  private readonly bores: Bore[] = [];
  private readonly streaks: Streak[] = [];
  private readonly wrecks = new Map<string, { x: number; y: number; next: number }>();
  private celebrate: { x: number; y: number; until: number; next: number; tint: number } | null = null;

  /** Theme change: soil-coloured debris and dust follow the new terrain palette (live particles keep theirs). */
  setPalette(theme: ThemePalette): void {
    this.debris.setParticleTint([theme.topsoil, theme.soil, theme.rock, theme.rim].map(hexToInt));
    this.dust.setParticleTint([hexToInt(theme.topsoil), hexToInt(theme.soil)]);
  }

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
        maxAliveParticles: Math.round(300 * a) + 12,
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
        maxAliveParticles: Math.round(380 * a) + 16,
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
        maxAliveParticles: Math.round(460 * a) + 20,
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
        maxAliveParticles: Math.round(340 * a) + 20,
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
        maxAliveParticles: Math.round(200 * a) + 8,
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
        maxAliveParticles: Math.round(260 * a) + 10,
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
        tint: [...CONFETTI_TINTS],
        maxAliveParticles: Math.round(320 * a) + 30,
        emitting: false,
      }),
      depth + 6,
    );
    this.shards = add(
      scene.add.particles(0, 0, 'tk-shard', {
        lifespan: { min: 420, max: 900 },
        speed: { min: 90, max: 260 },
        gravityY: 420,
        rotate: { min: 0, max: 360 },
        scale: { start: 1, end: 0.3 },
        alpha: { start: 0.95, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        maxAliveParticles: Math.round(140 * a) + 16,
        emitting: false,
      }),
      depth + 5,
    );
    this.trailG = add(scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD), depth + 3);
    this.streakG = add(scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD), depth + 7);
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
    this.scene.tweens.add({
      targets: img,
      scaleX: target,
      scaleY: target,
      alpha: 0,
      duration: life,
      ease: 'Cubic.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  private ring(x: number, y: number, radius: number, tint: number, life: number): void {
    if (this.q.amount < 0.2 && radius < 50) return;
    const img = this.scene.add.image(x, y, 'tk-ring').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setAlpha(0.8).setDepth(94);
    img.setScale(0.05);
    this.layer.add(img);
    const target = (radius * 2.3) / 128;
    this.scene.tweens.add({
      targets: img,
      scaleX: target,
      scaleY: target,
      alpha: 0,
      duration: life,
      ease: 'Quad.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  launch(x: number, y: number, angle: number, weapon: WeaponId): void {
    const px = x;
    const py = this.py(y);
    const rad = (angle * Math.PI) / 180;
    const tint = WEAPON_TINT[weapon] ?? 0xffffff;
    if (weapon === 'railgun') {
      // The beam itself arrives as its own event: just a sharp muzzle charge.
      this.flash(px, py, 90, BEAM_TINT.railgun.glow, 220);
      this.sparks.emitParticleAt(px, py, this.n(10));
      return;
    }
    const heavy = weapon === 'nuke' || weapon === 'mininuke' || weapon === 'heavy' || weapon === 'heavyroller';
    this.flash(px, py, heavy ? 110 : 70, tint, heavy ? 260 : 180);
    for (let i = 0; i < this.n(heavy ? 16 : 10); i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      this.smoke.emitParticleAt(px + Math.cos(rad + spread) * 6, py - Math.sin(rad + spread) * 6, 1);
    }
    if (weapon === 'warp') {
      this.sparks.emitParticleAt(px, py, this.n(14));
      return;
    }
    this.fire.emitParticleAt(px + Math.cos(rad) * 4, py - Math.sin(rad) * 4, this.n(heavy ? 14 : 8));
    this.sparks.emitParticleAt(px, py, this.n(6));
  }

  boom(x: number, y: number, r: number, kind: BlastKind, terrain: 'crater' | 'dirt' | 'none', direct: boolean): void {
    const px = x;
    const py = this.py(y);
    if (r <= 0) return;
    if (terrain === 'dirt') {
      this.flash(px, py, r * 2.2, 0xc58b52, 300, 0.6);
      this.ring(px, py, r * 0.9, 0xffd9a6, 420);
      this.debris.emitParticleAt(px, py, this.n(40 + r));
      this.dust.emitParticleAt(px, py, this.n(18 + r * 0.2));
      return;
    }
    if (kind === 'excavator') {
      // A harmless scoop: a dusty whump, no fireball.
      this.flash(px, py, r * 2.4, 0xffcf8a, 380, 0.55);
      this.ring(px, py, r, 0xffe0b0, 520);
      this.debris.emitParticleAt(px, py, this.n(60 + r));
      this.dust.emitParticleAt(px, py, this.n(30));
      return;
    }
    if (kind === 'napalm' || kind === 'hotnapalm') {
      const hot = kind === 'hotnapalm';
      this.flash(px, py, r * 7, hot ? 0x9fd8ff : 0xff7a1f, 520);
      this.fire.emitParticleAt(px, py, this.n(26));
      this.sparks.emitParticleAt(px, py, this.n(16));
      return;
    }
    if (kind === 'mudslide') {
      this.flash(px, py, r * 4, 0x9a6a3a, 360, 0.55);
      this.debris.emitParticleAt(px, py, this.n(46));
      this.dust.emitParticleAt(px, py, this.n(16));
      return;
    }
    if (NUKES.has(kind)) {
      this.nuke(px, py, r, kind === 'nuke');
      return;
    }
    const air = terrain === 'none';
    const big = BIG.has(kind);
    const tint =
      kind === 'airburst' || kind === 'lightning'
        ? 0x7cf5ff
        : kind === 'cluster' || kind === 'bomblet'
          ? 0xff8ae6
          : kind === 'driller'
            ? 0xd9ff8a
            : kind === 'seeker'
              ? 0xff5a5f
              : kind === 'leapfrog'
                ? 0x2de38f
                : kind === 'confetti' || kind === 'popper'
                  ? CONFETTI_TINTS[Math.floor(Math.random() * CONFETTI_TINTS.length)]!
                  : kind === 'meteor'
                    ? 0xff6a1f
                    : 0xffb347;
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
    if (kind === 'confetti' || kind === 'popper') {
      if (!this.q.reducedMotion) this.confetti.emitParticleAt(px, py, this.n(kind === 'popper' ? 30 : 8));
    }
    if (!air) {
      this.debris.emitParticleAt(px, py, this.n(26 + r * 1.1));
      this.dust.emitParticleAt(px, py + r * 0.3, this.n(10));
      // The crater glows hot for a moment, then cools.
      const hot = this.scene.add
        .image(px, py + r * 0.15, 'tk-glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xff6a1f)
        .setDepth(12);
      hot.setDisplaySize(r * 2.4, r * 1.6).setAlpha(0.9);
      this.layer.add(hot);
      this.scene.tweens.add({ targets: hot, alpha: 0, duration: big ? 2200 : 1500, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
    }
    for (let i = 0; i < this.n(big ? 16 : 9); i++) {
      this.smoke.emitParticleAt(px + (Math.random() - 0.5) * r * 1.1, py - Math.random() * r * 0.8, 1);
    }
    if (direct) this.popup(x, y + 26, 'DIRECT HIT', '#ffd23f', 1100, 34, DISPLAY_FONT, 18);
  }

  /** Nuke / mini nuke: a blinding flash, double shockwave, a glowing crater and a mushroom cloud. */
  private nuke(px: number, py: number, r: number, full: boolean): void {
    this.flash(px, py, r * 9, 0xffffff, full ? 1300 : 950);
    this.flash(px, py, r * 5, 0xffd23f, full ? 1100 : 800);
    this.ring(px, py, r * 1.25, 0xffffff, full ? 1100 : 850);
    this.ring(px, py, r * 0.8, 0xff8a3d, full ? 900 : 650);
    if (full) this.ring(px, py, r * 1.8, 0xfff1c1, 1500);
    this.fire.emitParticleAt(px, py, this.n(70 + r * 0.4));
    this.sparks.emitParticleAt(px, py, this.n(70));
    this.debris.emitParticleAt(px, py, this.n(90 + r));
    const hot = this.scene.add
      .image(px, py + r * 0.1, 'tk-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xff5a1f)
      .setDepth(12);
    hot.setDisplaySize(r * 2.6, r * 1.5).setAlpha(1);
    this.layer.add(hot);
    this.scene.tweens.add({ targets: hot, alpha: 0, duration: 3200, ease: 'Quad.easeIn', onComplete: () => hot.destroy() });
    this.mushroom(px, py, r, full);
  }

  /** A rising stem of fire-lit smoke topped by a spreading cap; cools from orange to soot. */
  private mushroom(px: number, py: number, r: number, full: boolean): void {
    const rise = (this.q.reducedMotion ? 0.55 : 1) * r * (full ? 1.9 : 1.6);
    const life = full ? 3600 : 2800;
    const stem = Math.max(3, Math.round((full ? 9 : 6) * Math.max(0.4, this.q.amount)));
    const cap = Math.max(4, Math.round((full ? 14 : 9) * Math.max(0.4, this.q.amount)));
    const hotC = Phaser.Display.Color.ValueToColor(0xffa040);
    const coolC = Phaser.Display.Color.ValueToColor(0x3b3348);
    const puff = (x0: number, y0: number, x1: number, y1: number, s0: number, s1: number, delay: number) => {
      const img = this.scene.add.image(x0, y0, 'tk-puff').setDepth(93).setAlpha(0).setScale(s0);
      img.setTint(0xffa040);
      this.layer.add(img);
      const state = { k: 0 };
      this.scene.tweens.add({
        targets: state,
        k: 1,
        delay,
        duration: life,
        ease: 'Sine.easeOut',
        onUpdate: () => {
          const k = state.k;
          img.setPosition(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
          img.setScale(s0 + (s1 - s0) * k);
          img.setAlpha(k < 0.1 ? k * 8 : 0.8 * (1 - (k - 0.1) / 0.9));
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(hotC, coolC, 100, Math.min(100, k * 160));
          img.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
        },
        onComplete: () => img.destroy(),
      });
    };
    for (let i = 0; i < stem; i++) {
      const k = i / stem;
      puff(
        px + (Math.random() - 0.5) * r * 0.15,
        py,
        px + (Math.random() - 0.5) * r * 0.2,
        py - rise * (0.15 + k * 0.75),
        0.8,
        1.6 + k,
        i * 40,
      );
    }
    for (let i = 0; i < cap; i++) {
      const a = (i / cap) * Math.PI * 2;
      const cx = Math.cos(a) * r * 0.55;
      const cy = Math.sin(a) * r * 0.22;
      puff(px, py - rise * 0.6, px + cx, py - rise + cy, 1.2, 3 + Math.random(), 120 + i * 25);
    }
  }

  bore(x0: number, y0: number, x1: number, y1: number, durMs: number, now: number): void {
    this.bores.push({ x0, y0, x1, y1, start: now, dur: Math.max(60, durMs) });
    this.debris.emitParticleAt(x0, this.py(y0), this.n(26));
    this.sparks.emitParticleAt(x0, this.py(y0), this.n(12));
  }

  split(x: number, y: number, w: WeaponId): void {
    const py = this.py(y);
    const tint = w === 'mirv' ? 0xff6a8a : w === 'popper' ? 0xffd23f : 0xff4fd8;
    this.flash(x, py, w === 'mirv' ? 130 : 90, tint, 260);
    this.sparks.emitParticleAt(x, py, this.n(18));
    if (w === 'popper' && !this.q.reducedMotion) this.confetti.emitParticleAt(x, py, this.n(24));
  }

  /** A beam: railgun line, Sky Lance column or a lightning bolt. World (y-up) coordinates. */
  beam(x0: number, y0: number, x1: number, y1: number, w: BeamKind, now: number): void {
    const tint = BEAM_TINT[w];
    const a: [number, number] = [x0, this.py(y0)];
    const b: [number, number] = [x1, this.py(y1)];
    let pts: Array<[number, number]> = [a, b];
    if (w === 'lightning') {
      // A jagged bolt (visual only).
      pts = [a];
      const steps = 9;
      for (let i = 1; i < steps; i++) {
        const k = i / steps;
        pts.push([a[0] + (b[0] - a[0]) * k + (Math.random() - 0.5) * 34, a[1] + (b[1] - a[1]) * k]);
      }
      pts.push(b);
    }
    const width = w === 'skylance' ? 30 : w === 'lightning' ? 7 : 9;
    this.streaks.push({
      kind: w,
      pts,
      start: now,
      life: w === 'skylance' ? 900 : w === 'lightning' ? 520 : 620,
      core: tint.core,
      glow: tint.glow,
      width,
    });
    this.flash(b[0], b[1], w === 'skylance' ? 260 : 120, tint.glow, w === 'skylance' ? 700 : 380);
    this.ring(b[0], b[1], w === 'skylance' ? 70 : 34, tint.glow, 600);
    this.sparks.emitParticleAt(b[0], b[1], this.n(w === 'skylance' ? 40 : 22));
    if (w !== 'railgun') this.debris.emitParticleAt(b[0], b[1], this.n(30));
  }

  /** A shield took a hit (ripple sparks) or shattered. World coordinates of the tank. */
  shieldHit(x: number, y: number, kind: ShieldKind, broke: boolean): void {
    const tint = kind ? SHIELD_TINT[kind] : 0x5ef0ff;
    const py = this.py(y + 8);
    if (broke) {
      this.flash(x, py, 140, tint, 420);
      this.ring(x, py, 40, tint, 520);
      this.shards.setParticleTint(tint);
      this.shards.emitParticleAt(x, py, this.n(26));
      this.popup(x, y + 46, 'SHIELD DOWN', '#9ff3ff', 1100, 26, DISPLAY_FONT, 14);
    } else {
      this.flash(x, py, 80, tint, 260, 0.6);
      this.sparks.emitParticleAt(x, py - 20, this.n(6));
    }
  }

  deflect(x: number, y: number): void {
    const py = this.py(y);
    this.flash(x, py, 90, SHIELD_TINT.deflector, 260);
    this.ring(x, py, 22, SHIELD_TINT.deflector, 380);
    this.sparks.emitParticleAt(x, py, this.n(16));
    this.popup(x, y + 18, 'DEFLECTED', '#ff9af0', 900, 24, DISPLAY_FONT, 13);
  }

  chute(x: number, y: number): void {
    this.dust.emitParticleAt(x, this.py(y + 34), this.n(6));
    this.popup(x, y + 52, 'CHUTE!', '#f8f6ff', 900, 18, DISPLAY_FONT, 12);
  }

  warp(x0: number, y0: number, x1: number, y1: number, color: number, now: number): void {
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ] as const) {
      const py = this.py(y + 8);
      this.flash(x, py, 120, 0xd98bff, 420);
      this.flash(x, py, 60, color, 300);
      this.ring(x, py, 30, 0xd98bff, 480);
      this.sparks.emitParticleAt(x, py, this.n(20));
    }
    this.streaks.push({
      kind: 'warp',
      pts: [
        [x0, this.py(y0 + 8)],
        [x1, this.py(y1 + 8)],
      ],
      start: now,
      life: 520,
      core: 0xffffff,
      glow: 0xd98bff,
      width: 5,
    });
  }

  /** An item switched on: shield shimmer, battery repair sparkle, fuel puff. */
  item(x: number, y: number, item: 'shield' | 'heavyshield' | 'deflector' | 'battery' | 'fuel'): void {
    const py = this.py(y + 8);
    if (item === 'battery') {
      this.flash(x, py, 110, 0x2de38f, 520);
      this.sparks.emitParticleAt(x, py, this.n(14));
      this.popup(x, y + 36, 'REPAIRED', '#2de38f', 1100, 30, DISPLAY_FONT, 14);
    } else if (item === 'fuel') {
      for (let i = 0; i < this.n(8); i++) this.exhaust.emitParticleAt(x + (Math.random() - 0.5) * 20, py + 4, 1);
      this.popup(x, y + 36, 'FUEL +', '#ffd23f', 1000, 26, DISPLAY_FONT, 13);
    } else {
      const tint = SHIELD_TINT[item];
      this.flash(x, py, 120, tint, 480);
      this.ring(x, py, 34, tint, 520);
      this.sparks.emitParticleAt(x, py, this.n(10));
    }
  }

  /** A shell crossing a wrap-around wall. */
  portal(x: number, y: number): void {
    const py = this.py(y);
    this.flash(x, py, 80, 0x7cf5ff, 320);
    this.ring(x, py, 20, 0x7cf5ff, 360);
    this.sparks.emitParticleAt(x, py, this.n(8));
  }

  /** Mudslide: earth spraying along the columns it raised or slumped. */
  mud(x0: number, x1: number, heightAt: (x: number) => number): void {
    const span = Math.max(1, x1 - x0);
    const count = this.n(Math.min(30, 6 + span / 12));
    for (let i = 0; i < count; i++) {
      const x = x0 + Math.random() * span;
      const y = heightAt(x);
      if (!Number.isFinite(y)) continue;
      this.debris.emitParticleAt(x, this.py(y), 1);
      if (Math.random() < 0.4) this.dust.emitParticleAt(x, this.py(y), 1);
    }
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

  damage(x: number, y: number, amount: number, src: DamageSource, shield: number): void {
    const color =
      src === 'fall' ? '#ffb347' : src === 'burn' ? '#ff8a3d' : src === 'beam' ? '#7cf5ff' : amount >= 40 ? '#ff5a5f' : '#ffd23f';
    const size = amount >= 40 ? 24 : src === 'burn' ? 16 : 19;
    this.popup(x + (Math.random() - 0.5) * 16, y + 32, `-${amount}`, color, 1200, 40, NUM_FONT, size);
    if (shield > 0) this.popup(x + (Math.random() - 0.5) * 16, y + 52, `-${shield} shield`, '#9ff3ff', 1000, 30, NUM_FONT, 13);
  }

  /** A shield soaked the whole hit (no armor lost). */
  absorbed(x: number, y: number, amount: number): void {
    if (amount > 0) this.popup(x + (Math.random() - 0.5) * 16, y + 34, `-${amount} shield`, '#9ff3ff', 1000, 30, NUM_FONT, 15);
  }

  /** Embers from burning ground (the fire renderer asks for a few per frame). */
  ember(x: number, y: number, hot: boolean): void {
    this.fire.emitParticleAt(x, this.py(y), 1);
    if (hot && Math.random() < 0.3) this.sparks.emitParticleAt(x, this.py(y), 1);
  }

  /** Thick smoke over a fire (sparingly). */
  smokeAt(x: number, y: number): void {
    this.smoke.emitParticleAt(x, this.py(y), 1);
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
      .text(x, this.py(y), text, {
        fontFamily: font,
        fontSize: `${size}px`,
        fontStyle: font === NUM_FONT ? '700' : 'normal',
        color,
        stroke: '#07050f',
        strokeThickness: 5,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(120);
    this.layer.add(t);
    this.popups.push({ text: t, born: performance.now(), life, x, y, rise });
  }

  celebrateAt(x: number, y: number, tint: number, ms: number): void {
    this.celebrate = { x, y, until: performance.now() + ms, next: 0, tint };
  }

  /** Per frame: trails, beams, bores, popups, wreck smoke, fireworks. `labelScale` keeps popups readable. */
  update(now: number, projectiles: LiveProjectile[], labelScale: number): void {
    // Trails (one per path id: a wrap-around continuation starts a fresh trail, never a streak across the field).
    const g = this.trailG;
    g.clear();
    for (const p of projectiles) {
      let tr = this.trails.get(p.id);
      if (!tr) {
        const width =
          p.kind === 'tracer'
            ? 0.6
            : p.kind === 'confetti' || p.kind === 'bomblet'
              ? 0.7
              : p.kind === 'meteor' || p.kind === 'nuke'
                ? 1.8
                : 1;
        tr = { pts: [], tint: trailTint(p), seen: now, width };
        this.trails.set(p.id, tr);
      }
      tr.seen = now;
      tr.pts.push([p.x, this.py(p.y)]);
      if (tr.pts.length > (p.kind === 'tracer' ? 60 : 34)) tr.pts.shift();
      const smoky = p.kind === 'seeker' || p.kind === 'meteor' || p.kind === 'nuke' || p.kind === 'mininuke';
      const rolling = p.kind === 'rolling';
      if (p.kind === 'meteor' || p.kind === 'napalm' || p.kind === 'hotnapalm') {
        if (Math.random() < 0.8 * this.q.amount) this.fire.emitParticleAt(p.x, this.py(p.y), 1);
      }
      if (rolling) {
        if (Math.random() < 0.35 * this.q.amount) this.dust.emitParticleAt(p.x, this.py(p.y) + 4, 1);
      } else if (p.kind !== 'tracer' && Math.random() < (smoky ? 0.95 : 0.55) * this.q.amount)
        this.smoke.emitParticleAt(p.x, this.py(p.y), 1);
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
        g.lineStyle((1 + k * 3) * tr.width, tr.tint, k * 0.75);
        g.lineBetween(tr.pts[i - 1]![0], tr.pts[i - 1]![1], tr.pts[i]![0], tr.pts[i]![1]);
      }
    }
    // Beams and warp streaks: bright core and glow, fading out (lightning flickers unless motion is reduced).
    const sg = this.streakG;
    sg.clear();
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i]!;
      const k = (now - s.start) / s.life;
      if (k >= 1) {
        this.streaks.splice(i, 1);
        continue;
      }
      let alpha = 1 - k * k;
      if (s.kind === 'lightning' && !this.q.reducedMotion) alpha *= 0.55 + 0.45 * (Math.floor(now / 45) % 2);
      const grow = s.kind === 'skylance' ? Math.min(1, k * 6) : 1;
      for (const [w, c, a] of [
        [s.width * 2.4 * grow, s.glow, 0.18],
        [s.width * grow, s.glow, 0.45],
        [Math.max(1.5, s.width * 0.3 * grow), s.core, 0.95],
      ] as const) {
        sg.lineStyle(w, c, a * alpha);
        sg.beginPath();
        sg.moveTo(s.pts[0]![0], s.pts[0]![1]);
        for (let j = 1; j < s.pts.length; j++) sg.lineTo(s.pts[j]![0], s.pts[j]![1]);
        sg.strokePath();
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
    this.streaks.length = 0;
    for (const o of [
      this.fire,
      this.smoke,
      this.debris,
      this.sparks,
      this.dust,
      this.exhaust,
      this.confetti,
      this.shards,
      this.trailG,
      this.streakG,
    ])
      o.destroy();
  }
}
