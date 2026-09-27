/**
 * DASphalt GP renderer — the only entry point the client lane needs:
 *
 *   const r = createKartRenderer(canvas, { track, quality, reducedMotion, fx });
 *   r.setRoster(entries); r.frame(view) every rAF; r.triggerFx(kind, at); r.setThemeTokens(t);
 *   r.resize(w, h, dpr); r.dispose();
 *
 * No networking here: the client feeds interpolated poses. Presentation only.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { KartTrack } from '@dascade/game-core/kart';
import type { ThemeTokens } from '@dascade/ui';
import { clearItemArtCache, itemModel } from '../art/items.ts';
import { clearKartArtCache } from '../art/karts.ts';
import { makeVoxelMaterial, rimOf } from '../art/materials.ts';
import { DRIFT_STAGE_COLORS, ITEM_COLORS, PRISM, mixInt } from '../art/palette.ts';
import { BIOMES, OFFROAD, paletteSig, worldPalette, type BiomeStyle } from './biomes.ts';
import { CameraRig } from './camera.ts';
import { Particles, Rings, SHAPE_SOFT, SHAPE_SQUARE, SHAPE_STAR, Skids, SpeedLines, Streaks } from './fx.ts';
import { clearHazardCache } from './hazards.ts';
import { KartLayer, type KartVisEvents } from './karts.ts';
import { clearLandmarkCache } from './landmarks.ts';
import { KF, type KartFxAt, type KartFxKind, type KartFxLevel, type KartPose, type KartQuality, type KartRenderStats, type KartRendererOptions, type KartRosterEntry, type KartView } from './types.ts';
import { KartWorld } from './world.ts';
import { contactShadowTexture } from './textures.ts';

export interface CreateKartRendererOptions extends KartRendererOptions {
  track: KartTrack;
}

export interface KartRenderer {
  setRoster(entries: readonly KartRosterEntry[]): void;
  /** Time-trial ghost look (null = none). Its pose comes in `view.ghost`. */
  setGhostLook(look: { racer: KartRosterEntry['racer']; body: KartRosterEntry['body']; paint: string } | null): void;
  frame(view: KartView): void;
  triggerFx(kind: KartFxKind, at: KartFxAt): void;
  setOptions(o: Partial<KartRendererOptions>): void;
  setThemeTokens(tokens: Pick<ThemeTokens, 'materials'> | null): void;
  resize(width: number, height: number, dpr: number): void;
  /** Track-space point → CSS px on the canvas. `out.visible` false when behind the camera/off screen. */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void;
  stats(): KartRenderStats;
  dispose(): void;
}

const QUALITY_ORDER: KartQuality[] = ['low', 'medium', 'high'];
const PIXEL_CAP: Record<KartQuality, number> = { low: 1, medium: 1.5, high: 2 };
const LOD_DIST: Record<KartQuality, number> = { low: 34, medium: 50, high: 70 };
const PARTICLES: Record<KartQuality, number> = { low: 900, medium: 1800, high: 3200 };

export function createKartRenderer(canvas: HTMLCanvasElement, opts: CreateKartRendererOptions): KartRenderer {
  const track = opts.track;
  let quality: KartQuality = opts.quality;
  let fxLevel: KartFxLevel = opts.fx;
  let reducedMotion = opts.reducedMotion;
  const autoQuality = opts.autoQuality ?? true;

  const renderer = new WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.info.autoReset = false;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  let materials: Partial<Record<string, string>> | null = null;
  let palette = worldPalette(biomeOf(track), track.def.offroad, null);
  const world = new KartWorld(track, palette, { quality, aniso });
  let paletteKey = paletteSig(palette);
  const biome = world.biome;

  const scene = new Scene();
  scene.fog = world.fog;
  scene.background = new Color(biome.fog);
  scene.add(world.root);

  const hemi = new HemisphereLight(biome.hemiSky, biome.hemiGround, biome.hemiIntensity);
  scene.add(hemi);
  const sun = new DirectionalLight(biome.sun, biome.sunIntensity);
  sun.position.set(biome.sunDir[0] * 100, biome.sunDir[1] * 100, biome.sunDir[2] * 100);
  scene.add(sun);
  // a soft fill from the opposite side so karts never go flat-black in shade
  const fill = new DirectionalLight(mixInt(biome.hemiSky, 0xffffff, 0.3), biome.sunIntensity * 0.25);
  fill.position.set(-biome.sunDir[0] * 100, 40, -biome.sunDir[2] * 100);
  scene.add(fill);

  const half = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxY - track.bounds.minY) / 2;
  const far = half + 900;
  const camera = new PerspectiveCamera(70, 16 / 9, 0.15, far);
  scene.add(camera);
  const rig = new CameraRig(camera);
  rig.reducedMotion = reducedMotion;

  const kartMat = makeVoxelMaterial({ rim: true });
  const ghostMat = makeVoxelMaterial({ rim: true, transparent: true, opacity: 0.4, depthWrite: false });
  const rim = rimOf(kartMat);
  if (rim) {
    // back/rim light: sun-warm by day, neon by night, so the kart pops off any road
    rim.rimColor.value.set(biome.night ? mixInt(biome.glow, 0xffffff, 0.55) : mixInt(biome.sun, 0xffffff, 0.35));
    rim.rimStrength.value = biome.night ? 0.7 : 0.6;
  }
  const contactTex = contactShadowTexture();
  const layer = new KartLayer(kartMat, ghostMat, world.dot, contactTex);
  layer.lodDistance = LOD_DIST[quality];
  layer.reducedMotion = reducedMotion;
  if (opts.maxNameTags !== undefined) layer.maxTags = opts.maxNameTags;
  scene.add(layer.group);

  let add = new Particles(PARTICLES[quality], true);
  let alpha = new Particles(Math.round(PARTICLES[quality] * 0.7), false);
  scene.add(add.points, alpha.points);
  const streaks = new Streaks(400);
  scene.add(streaks.lines);
  const speedLines = new SpeedLines(30, camera);
  const skids = new Skids(quality === 'high' ? 2400 : quality === 'medium' ? 1400 : 700);
  scene.add(skids.mesh);
  const rings = new Rings(scene, 10);

  // warm the item shaders/geometry so the first pickup doesn't hitch
  void itemModel('prismShell');

  let width = 1;
  let height = 1;
  let dpr = 1;
  let time = 0;
  let lastNow = 0;
  let frameMs = 16.7;
  let slowTime = 0;
  let fastTime = 0;
  let disposed = false;
  const lastStats: KartRenderStats = { fps: 60, frameMs: 16.7, drawCalls: 0, triangles: 0, quality, pixelRatio: 1 };
  const pending: { at: number; x: number; y: number; z: number; color: number }[] = [];
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const poseBySlot = new Map<number, KartPose>();
  const offroadDust = OFFROAD[track.def.offroad].speck;

  const applyPixelRatio = () => {
    const pr = Math.min(dpr, PIXEL_CAP[quality]);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    add.setScale(height * pr, camera.fov);
    alpha.setScale(height * pr, camera.fov);
  };

  const fxMul = () => (fxLevel === 'high' ? 1 : fxLevel === 'low' ? 0.45 : 0);
  const rnd = (() => {
    let s = 12345;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();

  const burst = (x: number, y: number, z: number, n: number, color: number, speed: number, life: number, size: number, shape = SHAPE_SOFT, gravity = 6, additive = true) => {
    const sys = additive ? add : alpha;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = rnd() * 0.9 + 0.1;
      const s = speed * (0.5 + rnd() * 0.7);
      sys.spawn(x, y, z, Math.cos(a) * s * e, (0.3 + rnd()) * s * 0.7, Math.sin(a) * s * e, life * (0.6 + rnd() * 0.6), size, size * 0.2, color, 1, gravity, 1.5, shape);
    }
  };

  // --- pose-derived events -----------------------------------------------------------------------
  let targetSlot = -1;
  const events: KartVisEvents = {
    stageUp(slot, stage, x, y, z) {
      const c = DRIFT_STAGE_COLORS[stage] ?? 0xffffff;
      const n = fxLevel === 'off' ? 5 : Math.round(18 * (fxLevel === 'high' ? 1 : 0.6));
      burst(x, z + 0.3, -y, n, c, 6, 0.45, 0.35, SHAPE_STAR, 8);
      if (fxLevel !== 'off' && (slot === targetSlot || layer.distOf(slot) < 35)) rings.spawn(x, z + 0.2, -y, 2.2, 0.35, c, 1.5);
    },
    miniTurbo(slot, stage, x, y, z) {
      const c = DRIFT_STAGE_COLORS[stage] ?? 0xffffff;
      burst(x, z + 0.5, -y, fxLevel === 'off' ? 6 : 26, c, 9, 0.5, 0.5, SHAPE_STAR, 4);
      if (fxLevel !== 'off' && (slot === targetSlot || layer.distOf(slot) < 35)) rings.spawn(x, z + 0.4, -y, 3.5 + stage, 0.45, c, 2);
      if (slot === targetSlot) {
        rig.boost();
        rig.kick(0.15);
      }
    },
    landed(slot, x, y, z) {
      if (fxLevel === 'off') return;
      if (slot !== targetSlot && layer.distOf(slot) > 40) return;
      const n = Math.round(14 * fxMul());
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        alpha.spawn(x + Math.cos(a) * 0.8, z + 0.2, -y + Math.sin(a) * 0.8, Math.cos(a) * 5, 0.8, Math.sin(a) * 5, 0.6, 0.6, 1.6, offroadDust, 0.7, 0, 3);
      }
      if (slot === targetSlot) {
        rings.spawn(x, z + 0.1, -y, 2.2, 0.3, offroadDust, 0.5);
        rig.land(0.35);
      }
    },
    hop(slot) {
      if (fxLevel !== 'high') return;
      const p = poseBySlot.get(slot);
      if (p) burst(p.x, p.z + 0.1, -p.y, 5, 0xe6e6f0, 2, 0.35, 0.3, SHAPE_SOFT, 0, false);
    },
  };

  // --- continuous emitters per kart --------------------------------------------------------------
  const emit = (p: KartPose, dt: number, isTarget: boolean) => {
    const dist = layer.distOf(p.slot);
    if (dist > 110 && !isTarget) return;
    const spec = layer.specOf(p.slot);
    if (!spec) return;
    const f = p.flags;
    const m = fxMul();
    const near = dist < 45 || isTarget;
    const spd = Math.abs(p.speed);
    const grounded = (f & KF.airborne) === 0;
    // rear wheels
    for (let w = 2; w < 4; w++) {
      const wh = spec.wheels[w]!;
      const key = (p.slot % 32) * 2 + (w - 2);
      if (!layer.localToWorld(p.slot, wh.x, 0.03, wh.z, tmp)) continue;
      const drifting = (f & KF.drifting) !== 0 && grounded;
      // skid marks
      if (drifting && fxLevel !== 'off' && near) {
        tmp2.set(Math.cos(p.heading), 0, -Math.sin(p.heading));
        skids.mark(key, tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.z, time);
      } else skids.lift(key);
      // drift sparks by stage (essential: a trickle even with fx off)
      if (drifting && p.driftStage > 0) {
        const c = DRIFT_STAGE_COLORS[p.driftStage] ?? 0xffffff;
        const rate = (fxLevel === 'off' ? 10 : 70 * m) * (near ? 1 : 0.4);
        const n = Math.floor(rate * dt + rnd());
        const side = w === 2 ? -1 : 1;
        for (let i = 0; i < n; i++) {
          const bx = -Math.cos(p.heading) * (3 + rnd() * 4);
          const bz = Math.sin(p.heading) * (3 + rnd() * 4);
          add.spawn(tmp.x, tmp.y + 0.05, tmp.z, bx + (rnd() - 0.5) * 3, 1.5 + rnd() * 3.5, bz + (rnd() - 0.5) * 3 + side * 0.5, 0.22 + rnd() * 0.18, p.driftStage >= 3 ? 0.34 : 0.26, 0.05, c, 1, 14, 1, p.driftStage >= 2 ? SHAPE_STAR : SHAPE_SOFT);
        }
      }
      // tyre smoke
      if (drifting && fxLevel === 'high' && near && rnd() < dt * 22) alpha.spawn(tmp.x, tmp.y + 0.2, tmp.z, (rnd() - 0.5) * 1.2, 0.8 + rnd(), (rnd() - 0.5) * 1.2, 0.8, 0.4, 1.5, 0xd8d8e4, 0.22, -0.5, 1.2);
      // off-road kick
      if (f & KF.offroad && grounded && spd > 5 && fxLevel !== 'off' && near) {
        const n = Math.floor(spd * 1.2 * m * dt + rnd());
        for (let i = 0; i < n; i++)
          alpha.spawn(tmp.x, tmp.y + 0.15, tmp.z, -Math.cos(p.heading) * spd * 0.2 + (rnd() - 0.5) * 2, 1.5 + rnd() * 2, Math.sin(p.heading) * spd * 0.2 + (rnd() - 0.5) * 2, 0.45 + rnd() * 0.35, 0.18, 0.55, offroadDust, 0.8, 7, 1.5, track.def.offroad === 'snow' ? SHAPE_SOFT : SHAPE_SQUARE);
      }
      if (f & KF.slick && grounded && fxLevel !== 'off' && rnd() < dt * 20) add.spawn(tmp.x, tmp.y + 0.1, tmp.z, 0, 0.6, 0, 0.35, 0.3, 0.05, 0xbfefff, 0.9, 0, 0, SHAPE_STAR);
    }
    // boost: flame sparks + heat shimmer streaks
    if (f & KF.boosting) {
      for (const e of spec.exhausts) {
        if (!layer.localToWorld(p.slot, e[0] - 0.3, e[1], e[2], tmp)) continue;
        const n = Math.floor((fxLevel === 'off' ? 0 : 40 * m) * dt + rnd());
        for (let i = 0; i < n; i++) {
          const bx = -Math.cos(p.heading) * (4 + rnd() * 3);
          const bz = Math.sin(p.heading) * (4 + rnd() * 3);
          add.spawn(tmp.x, tmp.y, tmp.z, bx, rnd() * 1.5, bz, 0.12 + rnd() * 0.1, 0.32, 0.06, rnd() < 0.5 ? 0xffa040 : 0xff5a2a, 0.6, -2, 2);
        }
        if (fxLevel === 'high' && near && rnd() < dt * 26) {
          streaks.spawn(tmp.x + (rnd() - 0.5) * 0.4, tmp.y + (rnd() - 0.3) * 0.4, tmp.z + (rnd() - 0.5) * 0.4, -Math.cos(p.heading) * 9, 0.3, Math.sin(p.heading) * 9, 1.6, 0.28, 0xfff1d6, 0.55);
        }
      }
    }
    // warp trail
    if (f & KF.warp && fxLevel !== 'off') {
      if (layer.localToWorld(p.slot, -1, 0.6, 0, tmp)) {
        const c = ITEM_COLORS.warp.glow;
        for (let i = 0; i < 2; i++) streaks.spawn(tmp.x + (rnd() - 0.5) * 1.4, tmp.y + (rnd() - 0.5) * 0.8, tmp.z + (rnd() - 0.5) * 1.4, -Math.cos(p.heading) * 2, 0, Math.sin(p.heading) * 2, 3, 0.4, c, 1);
        if (rnd() < dt * 40 * m) add.spawn(tmp.x, tmp.y, tmp.z, (rnd() - 0.5) * 2, rnd(), (rnd() - 0.5) * 2, 0.5, 0.5, 0.1, ITEM_COLORS.warp.main, 1, 0, 1, SHAPE_STAR);
      }
    }
    // magnet tug glow
    if (f & KF.magnet && fxLevel !== 'off' && rnd() < dt * 20) {
      if (layer.localToWorld(p.slot, 2.5 + rnd() * 3, 0.8, (rnd() - 0.5) * 1.5, tmp)) add.spawn(tmp.x, tmp.y, tmp.z, -Math.cos(p.heading) * 6, 0, Math.sin(p.heading) * 6, 0.35, 0.3, 0.1, ITEM_COLORS.magnet.glow, 0.9, 0, 0, SHAPE_SOFT);
    }
  };

  const api: KartRenderer = {
    setRoster(entries) {
      layer.setRoster(entries);
    },
    setGhostLook(look) {
      layer.setGhost(look);
    },
    frame(view) {
      if (disposed) return;
      const now = performance.now();
      if (lastNow) {
        const ms = now - lastNow;
        frameMs += (Math.min(250, ms) - frameMs) * 0.05;
      }
      lastNow = now;
      const dt = Math.min(0.1, Math.max(0, view.dt));
      time += dt;
      targetSlot = view.targetSlot;
      poseBySlot.clear();
      let target: KartPose | null = null;
      for (const p of view.karts) {
        poseBySlot.set(p.slot, p);
        if (p.slot === view.targetSlot && p.active) target = p;
      }
      world.setLights(view.lights ?? -1);
      rig.update(view.camera, target, dt, view.introT ?? 1, time);
      camera.updateMatrixWorld();
      world.update(time, dt, view.tick, reducedMotion, view.boxes, camera.position, far);
      for (const s of world.landedStompers) {
        if (fxLevel !== 'off') burst(s.x, s.z + 0.2, -s.y, Math.round(16 * fxMul()), 0xc8c0b8, 5, 0.6, 1.2, SHAPE_SOFT, 0, false);
        tmp.set(s.x, s.z, -s.y);
        if (target && tmp.distanceTo(camera.position) < 20) rig.kick(0.25);
      }
      skids.beginFrame();
      layer.beginItems();
      layer.update(view.karts, view.ghost, dt, time, camera, view.targetSlot, events);
      layer.drawEntities(view.entities, time);
      for (const e of view.entities) {
        if (e.kind === 'seeker' && fxLevel !== 'off' && rnd() < dt * 30) add.spawn(e.x, e.z + 1.3, -e.y, 0, 0, 0, 0.25, 0.6, 0.1, ITEM_COLORS.seeker.glow, 1, 0, 0);
        if (e.kind === 'mine' && Math.floor(time * 3 + e.id) % 2 === 0 && fxLevel !== 'off' && rnd() < dt * 10) add.spawn(e.x, e.z + 0.5, -e.y, 0, 0.5, 0, 0.3, 0.9, 0.2, ITEM_COLORS.mine.glow, 0.8, 0, 0);
        if (e.kind === 'puck' && fxLevel === 'high' && rnd() < dt * 30) add.spawn(e.x, e.z + 0.35, -e.y, 0, 0.3, 0, 0.3, 0.4, 0.05, ITEM_COLORS.puck.glow, 0.8, 0, 0);
      }
      layer.endItems();
      for (const p of view.karts) if (p.active) emit(p, dt, p.slot === view.targetSlot);
      // fireworks queue
      for (let i = pending.length - 1; i >= 0; i--) {
        const fw = pending[i]!;
        if (time >= fw.at) {
          burst(fw.x, fw.y, fw.z, fxLevel === 'high' ? 60 : 25, fw.color, 11, 1.2, 0.5, SHAPE_STAR, 3);
          rings.spawn(fw.x, fw.y, fw.z, 8, 0.6, fw.color, 3);
          pending.splice(i, 1);
        }
      }
      add.update(dt);
      alpha.update(dt);
      streaks.update(dt);
      rings.update(dt);
      skids.update(time);
      const boosting = target ? (target.flags & KF.boosting) !== 0 : false;
      const sp = target ? Math.abs(target.speed) : 0;
      const intensity = reducedMotion || fxLevel === 'off' || view.camera !== 'chase' ? 0 : Math.max(0, (sp - 30) / 8) * 0.35 + (boosting ? 0.75 : 0);
      speedLines.update(dt, Math.min(1, intensity), sp, boosting ? 0xfff1d6 : 0xffffff, camera.fov, camera.aspect);
      add.setScale(height * renderer.getPixelRatio(), camera.fov);
      alpha.setScale(height * renderer.getPixelRatio(), camera.fov);

      renderer.info.reset();
      renderer.render(scene, camera);
      lastStats.fps = Math.round(1000 / Math.max(1, frameMs));
      lastStats.frameMs = Math.round(frameMs * 10) / 10;
      lastStats.drawCalls = renderer.info.render.calls;
      lastStats.triangles = renderer.info.render.triangles;
      lastStats.quality = quality;
      lastStats.pixelRatio = renderer.getPixelRatio();
      // auto quality: step down after ~3 s of slow frames, never back up automatically
      if (autoQuality) {
        if (frameMs > 26) slowTime += dt;
        else slowTime = Math.max(0, slowTime - dt * 0.5);
        fastTime = frameMs < 14 ? fastTime + dt : 0;
        if (slowTime > 3) {
          slowTime = 0;
          const i = QUALITY_ORDER.indexOf(quality);
          if (i > 0) api.setOptions({ quality: QUALITY_ORDER[i - 1]! });
        }
      }
    },
    triggerFx(kind, at) {
      if (disposed) return;
      const x = at.x;
      const y = at.z;
      const z = -at.y;
      const m = fxMul();
      const isTarget = at.slot !== undefined && at.slot === targetSlot;
      switch (kind) {
        case 'hit':
          burst(x, y + 0.8, z, fxLevel === 'off' ? 6 : Math.round(30 * m + 6), 0xffe14a, 8, 0.6, 0.45, SHAPE_STAR, 6);
          if (fxLevel !== 'off') burst(x, y + 0.8, z, Math.round(16 * m), 0xff4f6d, 6, 0.5, 0.35, SHAPE_SQUARE, 10);
          if (isTarget) rig.kick(0.6);
          break;
        case 'blocked':
          rings.spawn(x, y + 0.8, z, 3.5, 0.45, ITEM_COLORS.shield.main, 2);
          burst(x, y + 0.9, z, Math.round(20 * m + 4), ITEM_COLORS.shield.accent, 6, 0.5, 0.3, SHAPE_SQUARE, 4);
          if (isTarget) rig.kick(0.2);
          break;
        case 'wall':
          burst(x, y + 0.5, z, Math.round(18 * m + 3), 0xffc07a, 7, 0.4, 0.25, SHAPE_STAR, 12);
          if (fxLevel === 'high') for (let i = 0; i < 8; i++) streaks.spawn(x, y + 0.5, z, (rnd() - 0.5) * 16, rnd() * 6, (rnd() - 0.5) * 16, 0.6, 0.25, 0xffd08a, 1);
          if (isTarget) rig.kick(0.35);
          break;
        case 'land':
          events.landed(at.slot ?? -1, at.x, at.y, at.z, true);
          break;
        case 'splash': {
          const water = !!biome.water;
          const c = biome.cloudSea ? 0xffffff : water ? 0x7cc7ff : offroadDust;
          burst(x, y, z, Math.round(40 * m + 8), c, 9, 0.9, 0.7, water ? SHAPE_SOFT : SHAPE_SOFT, 14, false);
          rings.spawn(x, y + 0.1, z, 4, 0.6, c, 1);
          break;
        }
        case 'boost':
          if (!isTarget && (at.slot === undefined || layer.distOf(at.slot) > 45)) break;
          rings.spawn(x, y + 0.3, z, 1.8, 0.3, at.stage ? (DRIFT_STAGE_COLORS[at.stage] ?? 0x35e0ff) : 0x35e0ff, 1);
          if (isTarget) rig.boost();
          break;
        case 'pulse':
          rings.spawn(x, y + 0.8, z, 40, 0.9, ITEM_COLORS.pulse.main, 5);
          rings.spawn(x, y + 0.8, z, 26, 0.7, ITEM_COLORS.pulse.accent, 3);
          burst(x, y + 1, z, Math.round(40 * m + 6), ITEM_COLORS.pulse.glow, 14, 0.7, 0.5, SHAPE_STAR, 0);
          if (isTarget) rig.kick(0.3);
          break;
        case 'pickup':
          for (let i = 0; i < Math.round(16 * m + 4); i++) {
            const c = i % 3 === 0 ? PRISM.a : i % 3 === 1 ? PRISM.b : PRISM.c;
            const a = rnd() * Math.PI * 2;
            add.spawn(x, y + 1.25, z, Math.cos(a) * 5, 2 + rnd() * 4, Math.sin(a) * 5, 0.6, 0.4, 0.1, c, 1, 12, 1, SHAPE_SQUARE);
          }
          if (fxLevel !== 'off') rings.spawn(x, y + 1.25, z, 2.2, 0.3, 0xffffff, 1);
          break;
        case 'confetti': {
          const cols = [0xff4fd8, 0x22d3ee, 0xffd23f, 0x2de38f, 0xff5a5f, 0xa78bfa];
          const n = reducedMotion ? 40 : Math.round(220 * (fxLevel === 'off' ? 0.25 : m));
          // two confetti cannons either side of the kart, then it flutters down around it
          for (let i = 0; i < n; i++) {
            const side = i % 2 ? 1 : -1;
            const a = rnd() * Math.PI * 2;
            const sp = 2 + rnd() * 3;
            alpha.spawn(x + side * 1.5, y + 1.2, z, Math.cos(a) * sp + side * 1.5, 7 + rnd() * 6, Math.sin(a) * sp, 2.6 + rnd() * 1.6, 0.26, 0.22, cols[i % cols.length]!, 1, 7, 1.6, SHAPE_SQUARE);
          }
          if (fxLevel === 'high' && !reducedMotion) {
            for (let k = 0; k < 6; k++) {
              const a = rnd() * Math.PI * 2;
              pending.push({ at: time + 0.4 + k * 0.45, x: x + Math.cos(a) * 16, y: y + 12 + rnd() * 8, z: z + Math.sin(a) * 16, color: cols[k % cols.length]! });
            }
          }
          break;
        }
        case 'trick':
          burst(x, y + 1, z, Math.round(20 * m + 5), 0xfff6c8, 7, 0.5, 0.4, SHAPE_STAR, 0);
          rings.spawn(x, y + 0.8, z, 2.6, 0.35, 0xffd23f, 1.5);
          break;
      }
    },
    setOptions(o) {
      if (o.fx !== undefined) fxLevel = o.fx;
      if (o.reducedMotion !== undefined) {
        reducedMotion = o.reducedMotion;
        rig.reducedMotion = reducedMotion;
        layer.reducedMotion = reducedMotion;
      }
      if (o.maxNameTags !== undefined) layer.maxTags = o.maxNameTags;
      if (o.quality !== undefined && o.quality !== quality) {
        quality = o.quality;
        layer.lodDistance = LOD_DIST[quality];
        applyPixelRatio();
        // resize particle pools (cheap; effects in flight are dropped)
        scene.remove(add.points, alpha.points);
        add.dispose();
        alpha.dispose();
        add = new Particles(PARTICLES[quality], true);
        alpha = new Particles(Math.round(PARTICLES[quality] * 0.7), false);
        scene.add(add.points, alpha.points);
      }
    },
    setThemeTokens(tokens) {
      materials = (tokens?.materials as Partial<Record<string, string>> | undefined) ?? null;
      const p = worldPalette(biome, track.def.offroad, materials);
      const key = paletteSig(p);
      if (key === paletteKey) return;
      paletteKey = key;
      palette = p;
      world.applyPalette(p);
      (scene.background as Color).set(p.fog);
    },
    resize(w, h, d) {
      width = Math.max(1, Math.round(w));
      height = Math.max(1, Math.round(h));
      dpr = d || 1;
      camera.aspect = width / height;
      // frame the kart at ~20% of the width on desktop, a bit bigger on wide phones
      const a = camera.aspect;
      rig.baseFov = a < 1 ? 66 : a < 1.5 ? 60 : a > 1.95 ? 50 : 58;
      rig.chaseDist = a < 1 ? 4.7 : a > 1.95 ? 3.95 : 4.4;
      rig.chaseHeight = a < 1 ? 1.9 : a > 1.95 ? 1.7 : 1.8;
      camera.updateProjectionMatrix();
      applyPixelRatio();
    },
    project(x, y, z, out) {
      tmp.set(x, z, -y).project(camera);
      out.visible = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) <= 1.05 && Math.abs(tmp.y) <= 1.05;
      out.x = ((tmp.x + 1) / 2) * width;
      out.y = ((1 - tmp.y) / 2) * height;
    },
    stats() {
      return { ...lastStats };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      layer.dispose();
      world.dispose();
      add.dispose();
      alpha.dispose();
      streaks.dispose();
      speedLines.dispose();
      skids.dispose();
      rings.dispose();
      kartMat.dispose();
      ghostMat.dispose();
      contactTex.dispose();
      clearKartArtCache();
      clearItemArtCache();
      clearHazardCache();
      clearLandmarkCache();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  void fastTime;
  api.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  return api;
}

function biomeOf(track: KartTrack): BiomeStyle {
  return BIOMES[track.def.biome] ?? BIOMES.city;
}
