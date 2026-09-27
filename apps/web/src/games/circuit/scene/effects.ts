/**
 * Shared particle emitters and marks: drift smoke, dust, exhaust, boost flames and
 * light trails, sparks, skid marks, crowd camera flashes and the finish celebration.
 * One emitter per effect type (emitParticleAt) keeps draw calls low for 20 cars.
 */
import Phaser from 'phaser';
import { CarFlag } from '@dascade/game-core/circuit';
import { hexToInt, NEON } from '../art/palette.ts';
import type { RaceCar } from '../race/controller.ts';
import type { CarView } from './cars.ts';
import { DEPTH } from './world.ts';

export interface FxQuality {
  /** Particle multiplier 0..1. */
  amount: number;
  skidMarks: number;
  trails: boolean;
  reducedMotion: boolean;
}

/** Live-particle caps per emitter for a quality (see Effects.setQuality). */
function particleCaps(q: FxQuality) {
  const a = q.amount;
  return {
    smoke: Math.round(320 * a) + 10,
    dust: Math.round(160 * a) + 6,
    exhaust: Math.round(120 * a) + 4,
    flames: Math.round(260 * a) + 10,
    driftSparks: Math.round(200 * a) + 6,
    sparks: Math.round(260 * a) + 20,
    fireworks: q.reducedMotion ? 120 : 600,
    confetti: q.reducedMotion ? 80 : 400,
  };
}

interface TrailState {
  pts: Array<[number, number]>;
  color: number;
  upper: boolean;
}

export class Effects {
  private readonly scene: Phaser.Scene;
  private q: FxQuality;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private exhaust: Phaser.GameObjects.Particles.ParticleEmitter;
  private flames: Phaser.GameObjects.Particles.ParticleEmitter;
  private driftSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private flashes: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireworks: Phaser.GameObjects.Particles.ParticleEmitter;
  private confetti: Phaser.GameObjects.Particles.ParticleEmitter;
  private skids: Phaser.GameObjects.Image[] = [];
  private skidIdx = 0;
  private readonly lastWheels = new Map<number, [[number, number], [number, number]]>();
  private readonly trails = new Map<number, TrailState>();
  private trailG: Phaser.GameObjects.Graphics;
  private celebrateUntil = 0;
  private lastFirework = 0;
  private frameCount = 0;

  constructor(scene: Phaser.Scene, q: FxQuality) {
    this.scene = scene;
    this.q = { ...q };
    const cap = particleCaps(q);
    this.smoke = scene.add.particles(0, 0, 'ci-puff', {
      lifespan: { min: 900, max: 1500 },
      speed: { min: 8, max: 34 },
      scale: { start: 0.45, end: 2.6 },
      alpha: { start: 0.5, end: 0 },
      tint: [0xe6e9ff, 0xd0d6f2, 0xf4f5ff],
      maxAliveParticles: cap.smoke,
      emitting: false,
    });
    this.smoke.setDepth(DEPTH.smoke);
    this.dust = scene.add.particles(0, 0, 'ci-puff', {
      lifespan: { min: 450, max: 750 },
      speed: { min: 10, max: 40 },
      scale: { start: 0.3, end: 1.3 },
      alpha: { start: 0.3, end: 0 },
      tint: [0x6a6070, 0x7c7188, 0x5b5263],
      maxAliveParticles: cap.dust,
      emitting: false,
    });
    this.dust.setDepth(DEPTH.dust);
    this.exhaust = scene.add.particles(0, 0, 'ci-puff', {
      lifespan: 380,
      speed: { min: 4, max: 16 },
      scale: { start: 0.12, end: 0.45 },
      alpha: { start: 0.25, end: 0 },
      tint: 0x9aa4c8,
      maxAliveParticles: cap.exhaust,
      emitting: false,
    });
    this.exhaust.setDepth(DEPTH.smoke);
    this.flames = scene.add.particles(0, 0, 'ci-flare', {
      lifespan: { min: 140, max: 260 },
      speed: { min: 10, max: 70 },
      scale: { start: 1.15, end: 0.08 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffd23f, 0xf97316, 0x22d3ee, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: cap.flames,
      emitting: false,
    });
    this.flames.setDepth(DEPTH.flame);
    this.driftSparks = scene.add.particles(0, 0, 'ci-dot', {
      lifespan: { min: 180, max: 320 },
      speed: { min: 40, max: 140 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0x22d3ee, 0x9ff3ff, 0xf97316],
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: cap.driftSparks,
      emitting: false,
    });
    this.driftSparks.setDepth(DEPTH.flame);
    this.sparks = scene.add.particles(0, 0, 'ci-spark', {
      lifespan: { min: 220, max: 420 },
      speed: { min: 140, max: 380 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { onEmit: () => 0, onUpdate: (p) => (Math.atan2(p.velocityY, p.velocityX) * 180) / Math.PI },
      tint: [0xffd23f, 0xffb347, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: cap.sparks,
      emitting: false,
    });
    this.sparks.setDepth(DEPTH.sparks);
    this.flashes = scene.add.particles(0, 0, 'ci-flare', {
      lifespan: 140,
      scale: { start: 0.35, end: 0.1 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 40,
      emitting: false,
    });
    this.flashes.setDepth(DEPTH.stands + 0.5);
    this.fireworks = scene.add.particles(0, 0, 'ci-dot', {
      lifespan: { min: 800, max: 1300 },
      speed: { min: 90, max: 300 },
      gravityY: 90,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: cap.fireworks,
      emitting: false,
    });
    this.fireworks.setDepth(DEPTH.celebrate);
    this.confetti = scene.add.particles(0, 0, 'ci-confetti', {
      lifespan: { min: 1800, max: 2800 },
      speedX: { min: -80, max: 80 },
      speedY: { min: 60, max: 180 },
      rotate: { start: 0, end: 540 },
      scale: { min: 0.6, max: 1.1 },
      alpha: { start: 1, end: 0.2 },
      tint: [0x22d3ee, 0xf97316, 0xff4fd8, 0xffd23f, 0x2de38f, 0xf8f6ff],
      maxAliveParticles: cap.confetti,
      emitting: false,
    });
    this.confetti.setDepth(DEPTH.celebrate);
    this.trailG = scene.add.graphics().setDepth(DEPTH.trail).setBlendMode(Phaser.BlendModes.ADD);
    this.sizeSkidPool(q.skidMarks);
  }

  private sizeSkidPool(count: number): void {
    while (this.skids.length > count) this.skids.pop()!.destroy();
    while (this.skids.length < count) {
      this.skids.push(this.scene.add.image(-9999, -9999, 'ci-skid').setDepth(DEPTH.skid).setAlpha(0).setOrigin(0.5));
    }
    this.skidIdx = this.skids.length ? this.skidIdx % this.skids.length : 0;
  }

  /**
   * FX level / reduced motion changed: apply in place (no emitter or scene rebuild). Particle
   * caps, emission amount, light trails and the skid-mark pool follow; live particles and the
   * newest skid marks stay. Also lifts a watchdog degrade (as a rebuild did).
   */
  setQuality(q: FxQuality): void {
    this.q = { ...q };
    const cap = particleCaps(q);
    this.smoke.maxAliveParticles = cap.smoke;
    this.dust.maxAliveParticles = cap.dust;
    this.exhaust.maxAliveParticles = cap.exhaust;
    this.flames.maxAliveParticles = cap.flames;
    this.driftSparks.maxAliveParticles = cap.driftSparks;
    this.sparks.maxAliveParticles = cap.sparks;
    this.fireworks.maxAliveParticles = cap.fireworks;
    this.confetti.maxAliveParticles = cap.confetti;
    if (!q.trails) {
      this.trails.clear();
      this.trailG.clear();
    }
    this.sizeSkidPool(q.skidMarks);
  }

  /** Weak hardware: halve particle emission and drop the light trails. */
  degrade(): void {
    this.q.amount *= 0.5;
    this.q.trails = false;
    this.trails.clear();
    this.trailG.clear();
  }

  private chance(p: number): boolean {
    return Math.random() < p * this.q.amount;
  }

  private skid(a: [number, number], b: [number, number], alpha: number): void {
    if (!this.skids.length) return;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.5 || len > 60) return;
    const img = this.skids[this.skidIdx]!;
    this.skidIdx = (this.skidIdx + 1) % this.skids.length;
    img
      .setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      .setRotation(Math.atan2(dy, dx))
      .setDisplaySize(len + 1, 3.4)
      .setAlpha(alpha);
  }

  /** Per-car emission for this frame. */
  car(car: RaceCar, view: CarView, dtMs: number): void {
    this.frameCount++;
    const sliding = (car.flags & (CarFlag.sliding | CarFlag.drifting)) !== 0 && car.speed > 110;
    const drifting = (car.flags & CarFlag.drifting) !== 0;
    const offroad = (car.flags & CarFlag.offroad) !== 0;
    const boosting = (car.flags & CarFlag.boosting) !== 0;
    const hardBrake = car.brake > 0.5 && car.speed > 240;
    const wheels = view.rearWheels(car);
    const prev = this.lastWheels.get(car.slot);
    const onTrack = car.elevated < 0.05 || car.elevated > 0.95;
    if (prev && (sliding || hardBrake) && !offroad && onTrack) {
      const alpha = drifting ? 0.42 : hardBrake ? 0.3 : 0.34;
      this.skid(prev[0], wheels[0], alpha);
      this.skid(prev[1], wheels[1], alpha);
    }
    this.lastWheels.set(car.slot, wheels);
    const upper = car.elevated > 0.5;
    const smokeDepth = upper ? DEPTH.upperShadow : DEPTH.smoke;
    this.smoke.setDepth(smokeDepth);
    if (sliding && !offroad) {
      for (const w of wheels) if (this.chance(drifting ? 0.8 : 0.5)) this.smoke.emitParticleAt(w[0], w[1], drifting && this.q.amount > 0.8 ? 2 : 1);
    }
    if (offroad && car.speed > 60) {
      for (const w of wheels) if (this.chance(0.45)) this.dust.emitParticleAt(w[0], w[1], 1);
    }
    if (drifting && car.speed > 220) {
      for (const w of wheels) if (this.chance(0.4)) this.driftSparks.emitParticleAt(w[0], w[1], 1);
    }
    const [rx, ry] = view.rear(car);
    if (car.throttle > 0 && car.speed < 260 && this.chance(0.18)) this.exhaust.emitParticleAt(rx, ry, 1);
    if (boosting) {
      this.flames.emitParticleAt(rx, ry, Math.max(1, Math.round(3 * this.q.amount)));
    }
    // Boost light trail.
    if (this.q.trails) {
      let t = this.trails.get(car.slot);
      if (boosting) {
        if (!t) this.trails.set(car.slot, (t = { pts: [], color: view.primary, upper }));
        t.color = view.primary;
        t.upper = upper;
        t.pts.unshift([rx, ry]);
        if (t.pts.length > 26) t.pts.pop();
      } else if (t) {
        t.pts.pop();
        if (t.pts.length > 0) t.pts.pop();
        if (!t.pts.length) this.trails.delete(car.slot);
      }
    }
    void dtMs;
  }

  forget(slot: number): void {
    this.lastWheels.delete(slot);
    this.trails.delete(slot);
  }

  drawTrails(): void {
    const g = this.trailG;
    g.clear();
    for (const t of this.trails.values()) {
      const n = t.pts.length;
      for (let i = 1; i < n; i++) {
        const [x0, y0] = t.pts[i - 1]!;
        const [x1, y1] = t.pts[i]!;
        const k = 1 - i / n;
        g.lineStyle(16 * k + 2, t.color, 0.3 * k);
        g.lineBetween(x0, y0, x1, y1);
        g.lineStyle(6 * k + 1, t.color, 0.55 * k);
        g.lineBetween(x0, y0, x1, y1);
        g.lineStyle(2.2 * k + 0.5, 0xffffff, 0.55 * k);
        g.lineBetween(x0, y0, x1, y1);
      }
    }
  }

  impact(x: number, y: number, strength: number): void {
    const n = Math.min(26, Math.round((strength / 45) * Math.max(0.35, this.q.amount)));
    if (n > 0) this.sparks.emitParticleAt(x, y, n);
  }

  cameraFlashes(points: Array<{ x: number; y: number }>, intensity: number): void {
    if (!points.length || this.q.amount <= 0) return;
    const n = Math.random() < intensity ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const p = points[Math.floor(Math.random() * points.length)]!;
      this.flashes.emitParticleAt(p.x + (Math.random() - 0.5) * 130, p.y + (Math.random() - 0.5) * 40, 1);
    }
  }

  celebrate(now: number, ms: number): void {
    this.celebrateUntil = now + ms;
  }

  /** Fireworks + confetti around the camera during a celebration. */
  tickCelebration(now: number, view: Phaser.Geom.Rectangle): void {
    if (now > this.celebrateUntil) return;
    const every = this.q.reducedMotion ? 700 : 280;
    if (now - this.lastFirework > every) {
      this.lastFirework = now;
      const x = view.x + view.width * (0.15 + Math.random() * 0.7);
      const y = view.y + view.height * (0.12 + Math.random() * 0.45);
      this.fireworks.setParticleTint(hexToInt(NEON[Math.floor(Math.random() * NEON.length)]!));
      this.fireworks.explode(this.q.reducedMotion ? 18 : 46, x, y);
      if (!this.q.reducedMotion) this.confetti.explode(24, view.x + Math.random() * view.width, view.y - 20);
    }
  }
}
