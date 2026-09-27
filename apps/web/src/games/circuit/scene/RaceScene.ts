/**
 * RaceScene — renders whatever the RaceController says the race looks like this
 * frame. It never touches the network: it pulls a RaceFrame, updates sprites,
 * effects and the camera, and drives the world (buildings lean with the camera).
 */
import Phaser from 'phaser';
import { CHASSIS } from '@dascade/game-core/circuit';
import type { RaceController, RaceFrame } from '../race/controller.ts';
import { CarView } from './cars.ts';
import { Effects } from './effects.ts';
import { makeFxTextures } from './textures.ts';
import { World } from './world.ts';
import { circuitWorldPalette, type Materials } from '../themeAdapter.ts';

export type FxLevel = 'high' | 'low' | 'off';

export interface SceneOptions {
  controller: RaceController;
  fx: FxLevel;
  reducedMotion: boolean;
  mobile: boolean;
  onProgress: (progress: number, ready: boolean) => void;
  /** Last-resort degrade step (the host lowers the render resolution). */
  onDegrade?: () => void;
  /** Theme materials at creation (empty under Delta Neon = the game's own palette). */
  materials?: Materials;
  /** Theme asks for ambient rain (already gated by fx / reduced motion). */
  ambientRain?: boolean;
}

export class RaceScene extends Phaser.Scene {
  private readonly opts: SceneOptions;
  private world: World | null = null;
  private worldTrack = '';
  private fx!: Effects;
  private readonly cars = new Map<number, CarView>();
  private camX = 0;
  private camY = 0;
  private camZoom = 1;
  private lastNow = 0;
  private reported = -1;
  private raceId = -1;
  dpr = 1;
  viewW = 1280;
  viewH = 720;
  private bloom: Phaser.Filters.ParallelFilters | null = null;
  private vignette: Phaser.Filters.Vignette | null = null;
  /** Adaptive quality: frame-time watchdog that steps effects down on weak hardware. */
  private readonly perf = { acc: 0, frames: 0, slow: 0, level: 0, since: 0 };
  private materials: Materials;
  private ambientRain: boolean;

  constructor(opts: SceneOptions) {
    super({ key: 'circuit-race' });
    this.opts = opts;
    this.materials = opts.materials ?? {};
    this.ambientRain = opts.ambientRain ?? false;
  }

  create(): void {
    makeFxTextures(this);
    const fx = this.opts.fx;
    this.fx = new Effects(this, this.fxQuality());
    this.buildWorld();
    const cam = this.cameras.main;
    cam.setBackgroundColor(this.world?.background ?? '#070814');
    if (fx === 'high' && this.game.renderer.type === Phaser.WEBGL) {
      const bloom = Phaser.Actions.AddEffectBloom(cam, { threshold: 0.62, blurRadius: 2, blurSteps: 3, blurQuality: 0, blendAmount: 0.55 });
      this.bloom = bloom[0]?.parallelFilters ?? null;
    }
    if (fx !== 'off' && this.game.renderer.type === Phaser.WEBGL) {
      this.vignette = cam.filters.external.addVignette(0.5, 0.5, 0.85, 0.42);
    }
    const start = this.opts.controller.track.grid[0]!;
    this.camX = start.x;
    this.camY = start.y;
  }

  private fxQuality() {
    const fx = this.opts.fx;
    return {
      amount: fx === 'high' ? 1 : fx === 'low' ? 0.45 : 0.12,
      skidMarks: fx === 'high' ? 1400 : fx === 'low' ? 600 : 160,
      trails: fx !== 'off',
      reducedMotion: this.opts.reducedMotion,
    };
  }

  private quality() {
    const fx = this.opts.fx;
    const tileScale = fx === 'high' && !this.opts.mobile ? 1 : fx === 'off' ? 0.5 : 0.75;
    return { tileScale, detail: fx, lean: this.opts.reducedMotion ? 0.07 : 0.16 } as const;
  }

  private buildWorld(): void {
    const ctrl = this.opts.controller;
    if (this.world && this.worldTrack === ctrl.trackId) return;
    if (this.world) {
      // Track changed while mounted (defensive): rebuild everything for the new track.
      for (const v of this.cars.values()) v.destroy();
      this.cars.clear();
      this.children.removeAll(true);
      this.fx = new Effects(this, this.fxQuality());
    }
    this.worldTrack = ctrl.trackId;
    this.world = new World(this, ctrl.track, ctrl.decor, this.quality(), circuitWorldPalette(ctrl.track.def.theme, this.materials));
    this.world.setPalette(circuitWorldPalette(ctrl.track.def.theme, this.materials), this.ambientRain);
    this.cameras?.main?.setBackgroundColor(this.world.background);
  }

  /**
   * Theme changed: re-present the world in place (no scene restart, no state reset, no timing
   * change). Safe to call before create() — the values are used when the world is built.
   */
  setTheme(materials: Materials, ambientRain: boolean): void {
    this.materials = materials;
    this.ambientRain = ambientRain;
    const world = this.world;
    if (!world) return;
    world.setPalette(circuitWorldPalette(this.opts.controller.track.def.theme, materials), ambientRain);
    this.cameras.main.setBackgroundColor(world.background);
  }

  /** Called by the host when the container resizes. */
  setView(cssW: number, cssH: number, dpr: number): void {
    this.viewW = cssW;
    this.viewH = cssH;
    this.dpr = dpr;
  }

  private baseZoom(): number {
    const w = this.viewW;
    const h = this.viewH;
    const portrait = h > w * 1.1;
    const z = portrait ? Math.min(w / 600, h / 1100) : 1.2 * (0.5 * (w / 1440) + 0.5 * (h / 900));
    return Math.max(0.5, Math.min(1.35, z));
  }

  override update(_time: number, deltaMs: number): void {
    const ctrl = this.opts.controller;
    if (ctrl.trackId !== this.worldTrack) this.buildWorld();
    const world = this.world;
    if (!world) return;
    const now = performance.now();
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : deltaMs;
    this.lastNow = now;

    if (!world.ready) world.pump(this.reported < 0.35 ? 14 : 7);
    else world.pumpRepaint(6);
    const progress = world.progress;
    if (progress !== this.reported) {
      this.reported = progress;
      this.opts.onProgress(progress, world.ready);
    }

    this.watchPerformance(dt, now, world.ready);
    const frame = ctrl.frame(now);
    if (ctrl.net.raceId !== this.raceId) {
      this.raceId = ctrl.net.raceId;
      for (const v of this.cars.values()) v.destroy();
      this.cars.clear();
    }
    this.syncCars(frame, now, dt);
    this.handleEvents(frame, now);
    this.updateCamera(frame, dt);
    const focus = frame.cars.find((c) => c.slot === frame.followSlot);
    const underDeck = Boolean(focus && focus.elevated < 0.35 && ctrl.track.bridges.some((b) => Math.hypot(focus.x - b.x, focus.y - b.y) < 300));
    world.update(this.cameras.main, now, dt, frame.lights, underDeck);
    this.fx.drawTrails();
    this.fx.tickCelebration(now, this.cameras.main.worldView);
    const flashRate = frame.status === 'grid' ? 0.35 : ctrl.getUi().finished ? 0.6 : 0.04;
    this.fx.cameraFlashes(ctrl.decor.stands, flashRate);
  }

  private watchPerformance(dt: number, now: number, ready: boolean): void {
    const p = this.perf;
    if (!ready || document.hidden) {
      p.since = now;
      p.acc = 0;
      p.frames = 0;
      return;
    }
    if (now - p.since < 4000) return;
    p.acc += dt;
    p.frames++;
    if (p.acc < 2000) return;
    const avg = p.acc / p.frames;
    p.acc = 0;
    p.frames = 0;
    p.slow = avg > 25 ? p.slow + 1 : 0;
    if (p.slow < 2 || p.level >= 3) return;
    p.slow = 0;
    p.level++;
    if (p.level === 1) {
      if (this.bloom) this.bloom.active = false;
      if (this.vignette) this.vignette.active = false;
    } else if (p.level === 2) {
      this.fx.degrade();
      this.world?.degrade();
    } else if (p.level === 3) {
      this.opts.onDegrade?.();
    }
  }

  private syncCars(frame: RaceFrame, now: number, dt: number): void {
    const glowAlpha = this.opts.fx === 'high' ? 0.5 : this.opts.fx === 'low' ? 0.34 : 0.2;
    const labelScale = Math.max(0.85, Math.min(1.5, 1 / Math.max(0.4, this.camZoom)));
    for (const car of frame.cars) {
      let view = this.cars.get(car.slot);
      const local = car.slot === frame.localSlot;
      if (!view) {
        view = new CarView(this, car, local, glowAlpha);
        this.cars.set(car.slot, view);
      }
      view.update(car, local, now, labelScale, true);
      this.fx.car(car, view, dt);
      // Immediate local feedback for barrier hits (prediction knows before the server).
      if (local) {
        const info = this.opts.controller.net.predInfo;
        if (info && info.wallImpact > 120) {
          this.fx.impact(car.x + Math.cos(car.heading) * 18, car.y + Math.sin(car.heading) * 18, info.wallImpact);
          if (!this.opts.reducedMotion && info.wallImpact > 260) this.cameras.main.shake(140, Math.min(0.006, info.wallImpact / 90000));
        }
      }
    }
    for (const [slot, view] of this.cars) {
      if (view.seen !== now) {
        view.destroy();
        this.cars.delete(slot);
        this.fx.forget(slot);
      }
    }
  }

  private handleEvents(frame: RaceFrame, now: number): void {
    for (const ev of frame.events) {
      if (ev.kind === 'impact') {
        const car = frame.cars.find((c) => c.slot === ev.slot);
        if (!car || (ev.slot === frame.localSlot && ev.impact < 200)) continue;
        this.fx.impact(car.x, car.y, ev.impact);
        if (ev.slot === frame.localSlot && !this.opts.reducedMotion && ev.impact > 260) this.cameras.main.shake(160, Math.min(0.007, ev.impact / 80000));
      } else if (ev.kind === 'finish') {
        this.fx.celebrate(now, this.opts.reducedMotion ? 2500 : 5000);
      } else if (ev.kind === 'gate') {
        this.world?.flashGate(ev.gate, now);
      } else if (ev.kind === 'lap') {
        this.world?.flashGate(0, now);
      }
    }
  }

  private updateCamera(frame: RaceFrame, dt: number): void {
    const cam = this.cameras.main;
    const focus = frame.cars.find((c) => c.slot === frame.followSlot);
    let tx = this.camX;
    let ty = this.camY;
    let speed01 = 0;
    let boosting = false;
    if (focus) {
      const spec = CHASSIS[focus.look.chassis] ?? CHASSIS.volt;
      speed01 = Math.min(1.3, focus.speed / spec.maxSpeed);
      const lead = this.opts.reducedMotion ? 0.14 : 0.26;
      const lx = Math.max(-240, Math.min(240, focus.vx * lead));
      const ly = Math.max(-180, Math.min(180, focus.vy * lead));
      tx = focus.x + lx;
      ty = focus.y + ly;
      boosting = (focus.flags & 2) !== 0;
    }
    const k = 1 - Math.exp(-(dt / 1000) * (focus ? 7 : 2));
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const zoomOut = this.opts.reducedMotion ? 0.06 : 0.15;
    const target = this.baseZoom() * (1 - zoomOut * Math.min(1, speed01)) * (boosting && !this.opts.reducedMotion ? 0.95 : 1);
    this.camZoom += (target - this.camZoom) * (1 - Math.exp(-(dt / 1000) * 2.2));
    cam.setZoom(this.camZoom * this.dpr);
    cam.centerOn(this.camX, this.camY);
  }
}
