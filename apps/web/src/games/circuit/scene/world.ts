/**
 * The static-but-alive world: city ground, parks and lots, progressive track
 * tiles, the flyover deck, 2.5D buildings (perspective lean from the camera),
 * gantries (with the start lights), lamps, billboards, grandstands, ambient
 * traffic, searchlights and rain.
 */
import Phaser from 'phaser';
import type { Building, Decor, Track } from '@dascade/game-core/circuit';
import { artRng, hexToInt, NEON, shade } from '../art/palette.ts';
import {
  TILE,
  TRACKSIDE_BAND,
  WALL_TONES,
  billboardCanvas,
  cityTileCanvas,
  drawTrackTile,
  lotCanvas,
  parkCanvas,
  renderDeck,
  roofCanvas,
  signCanvas,
  standCanvas,
  trackTiles,
} from '../art/worldArt.ts';

export interface WorldQuality {
  tileScale: number;
  detail: 'high' | 'low' | 'off';
  lean: number;
}

export const DEPTH = {
  ground: 0,
  lots: 1,
  track: 2,
  skid: 3,
  traffic: 5,
  stands: 7,
  dust: 8,
  shadow: 10,
  glow: 11,
  smoke: 13,
  trail: 15,
  flame: 17,
  car: 20,
  carFx: 21,
  deck: 24,
  upperShadow: 25,
  upperCar: 27,
  upperFx: 28,
  sparks: 30,
  gantry: 33,
  props: 34,
  buildings: 40,
  sky: 70,
  label: 80,
  celebrate: 90,
} as const;

interface BuildingView {
  b: Building;
  g: Phaser.GameObjects.Graphics | null;
  roof: Phaser.GameObjects.Image | null;
  sign: Phaser.GameObjects.Image | null;
  beacon: Phaser.GameObjects.Image | null;
  windows: Array<{ face: number; row: number; u0: number; u1: number; color: number }>;
}

interface Vehicle {
  sprite: Phaser.GameObjects.Image;
  light: Phaser.GameObjects.Image;
  street: number;
  t: number;
  dir: number;
  speed: number;
}

const WINDOW_COLORS = [0xffd28a, 0xffe7b3, 0x9fe8ff, 0xff9fe6, 0xfff3d6];

export class World {
  private readonly scene: Phaser.Scene;
  private readonly track: Track;
  private readonly decor: Decor;
  private q: WorldQuality;
  private readonly key: string;
  private pendingTiles: Array<{ x: number; y: number }> = [];
  private readonly buildings: BuildingView[] = [];
  private gantryG!: Phaser.GameObjects.Graphics;
  private propsG!: Phaser.GameObjects.Graphics;
  private lampGlows: Phaser.GameObjects.Image[] = [];
  private boards: Phaser.GameObjects.Image[] = [];
  private stands: Phaser.GameObjects.Image[] = [];
  private deck: Phaser.GameObjects.Image | null = null;
  private vehicles: Vehicle[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private rain: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private ripples: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private gateFlash = new Map<number, number>();
  private standFrame = 0;
  private lastStandSwap = 0;
  ready = false;
  progress = 0;
  private totalTiles = 0;

  constructor(scene: Phaser.Scene, track: Track, decor: Decor, quality: WorldQuality) {
    this.scene = scene;
    this.track = track;
    this.decor = decor;
    this.q = quality;
    this.key = `${track.def.id}-${quality.tileScale}`;
    this.build();
  }

  private build(): void {
    const scene = this.scene;
    const d = this.decor;
    const b = d.bounds;
    // City ground (repeating street grid).
    const cityKey = `ci-city-${this.q.tileScale}`;
    if (!scene.textures.exists(cityKey)) scene.textures.addCanvas(cityKey, cityTileCanvas(d, this.q.tileScale));
    const city = scene.add.tileSprite(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, cityKey).setOrigin(0, 0).setDepth(DEPTH.ground);
    city.setTileScale(1 / this.q.tileScale, 1 / this.q.tileScale);

    // Parks and parking lots.
    d.parks.forEach((p, i) => {
      const key = `ci-park-${this.track.def.id}-${i}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, parkCanvas(p.w, p.h, p.trees, p.x, p.y, i + 7));
      scene.add.image(p.x, p.y, key).setOrigin(0, 0).setDepth(DEPTH.lots);
    });
    d.lots.forEach((l) => {
      const key = `ci-lot-${Math.round(l.w)}x${Math.round(l.h)}-${l.seed % 4}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, lotCanvas(l.w, l.h, l.seed % 4));
      scene.add.image(l.x, l.y, key).setOrigin(0, 0).setDepth(DEPTH.lots);
    });

    // Track tiles: nearest to the grid first, generated progressively.
    const start = this.track.grid[0]!;
    // Reach covers the trackside band and the lamp light pools that spill past it.
    this.pendingTiles = trackTiles(this.track, Math.max(TRACKSIDE_BAND + 20, 220)).sort(
      (a, c) => Math.hypot(a.x + TILE / 2 - start.x, a.y + TILE / 2 - start.y) - Math.hypot(c.x + TILE / 2 - start.x, c.y + TILE / 2 - start.y),
    );
    this.totalTiles = this.pendingTiles.length;

    // Flyover deck.
    this.track.bridges.forEach((br, i) => {
      const key = `ci-deck-${this.key}-${i}`;
      if (!scene.textures.exists(key)) {
        const deck = renderDeck(this.track, br, this.q.tileScale);
        scene.textures.addCanvas(key, deck.canvas);
        scene.registry.set(`${key}-pos`, { x: deck.x, y: deck.y });
      }
      const pos = scene.registry.get(`${key}-pos`) as { x: number; y: number };
      this.deck = scene.add.image(pos.x, pos.y, key).setOrigin(0, 0).setScale(1 / this.q.tileScale).setDepth(DEPTH.deck);
    });

    // Buildings (views are created lazily when first visible).
    const rnd = artRng(this.track.def.decorSeed);
    for (const bld of d.buildings) {
      const windows: BuildingView['windows'] = [];
      const rows = Math.max(2, Math.min(7, Math.round(bld.height * 8)));
      for (let face = 0; face < 4; face++) {
        for (let row = 0; row < rows; row++) {
          let u = 0.06 + rnd() * 0.2;
          while (u < 0.9) {
            const len = 0.08 + rnd() * 0.3;
            if (rnd() < 0.55) windows.push({ face, row: (row + 0.5) / (rows + 0.6), u0: u, u1: Math.min(0.94, u + len), color: WINDOW_COLORS[Math.floor(rnd() * WINDOW_COLORS.length)]! });
            u += len + 0.05 + rnd() * 0.15;
          }
        }
      }
      this.buildings.push({ b: bld, g: null, roof: null, sign: null, beacon: null, windows });
    }

    this.gantryG = scene.add.graphics().setDepth(DEPTH.gantry);
    this.propsG = scene.add.graphics().setDepth(DEPTH.props);

    // Lamp glows.
    const lampCols = [this.track.def.theme.neonA, this.track.def.theme.neonB, '#ff4fd8'];
    for (const lamp of d.lamps) {
      const glow = scene.add.image(lamp.x, lamp.y, 'ci-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.props + 0.5);
      glow.setTint(hexToInt(lampCols[lamp.tone % lampCols.length]!)).setScale(0.55).setAlpha(0.9);
      this.lampGlows.push(glow);
    }
    // Billboards.
    d.billboards.forEach((bb, i) => {
      const key = `ci-board-${this.track.def.id}-${i}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, billboardCanvas(bb.text, bb.tone, 2));
      // Keep the lettering upright whichever way the track runs.
      const upright = Math.cos(bb.angle) < 0 ? bb.angle + Math.PI : bb.angle;
      const img = scene.add.image(bb.x, bb.y, key).setScale(0.5).setRotation(upright).setDepth(DEPTH.props + 1);
      this.boards.push(img);
    });
    // Grandstands (two frames for a bobbing crowd).
    for (let f = 0; f < 2; f++) {
      const key = `ci-stand-${this.track.def.id}-${f}`;
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, standCanvas(150, 58, f, this.track.def.theme.neonA, 2));
    }
    for (const s of d.stands) {
      const img = scene.add
        .image(s.x, s.y, `ci-stand-${this.track.def.id}-0`)
        .setScale(0.5)
        .setRotation(s.angle + (s.side > 0 ? 0 : Math.PI))
        .setDepth(DEPTH.stands);
      this.stands.push(img);
    }

    // Ambient traffic on the city streets.
    if (this.q.detail !== 'off' && d.streets.length) {
      const count = this.q.detail === 'high' ? 34 : 16;
      const cols = [0xff5a5f, 0xf8f6ff, 0x60a5fa, 0xffd23f, 0x2de38f, 0xa78bfa, 0xfb923c];
      for (let i = 0; i < count; i++) {
        const street = Math.floor(rnd() * d.streets.length);
        const sprite = scene.add.image(0, 0, 'ci-traffic').setDepth(DEPTH.traffic).setTint(cols[i % cols.length]!);
        const light = scene.add.image(0, 0, 'ci-glow').setDepth(DEPTH.traffic).setBlendMode(Phaser.BlendModes.ADD).setScale(0.28).setTint(0xfff1c9).setAlpha(0.7);
        this.vehicles.push({ sprite, light, street, t: rnd(), dir: rnd() < 0.5 ? 1 : -1, speed: 70 + rnd() * 90 });
      }
    }

    // Searchlights from the grandstands.
    if (this.q.detail === 'high') {
      const stands = d.stands.filter((_, i) => i % 5 === 0).slice(0, 3);
      stands.forEach((s, i) => {
        const beam = scene.add.image(s.x, s.y, 'ci-beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.sky);
        beam.setScale(3.2, 2.2).setAlpha(0.06).setTint(hexToInt(NEON[i % NEON.length]!));
        this.beams.push(beam);
      });
    }

    // Weather: drizzle on the Neon Loop.
    if (this.track.def.id === 'neon-loop' && this.q.detail !== 'off') {
      this.rain = scene.add.particles(0, 0, 'ci-rain', {
        lifespan: 380,
        speedX: { min: -90, max: -60 },
        speedY: { min: 700, max: 900 },
        alpha: { start: this.q.detail === 'high' ? 0.28 : 0.18, end: 0 },
        scaleY: { min: 0.5, max: 1.1 },
        rotate: 6,
        emitting: false,
      });
      this.rain.setDepth(DEPTH.sky + 1);
      this.ripples = scene.add.particles(0, 0, 'ci-dot', {
        lifespan: 420,
        scale: { start: 0.2, end: 1.5 },
        alpha: { start: 0.35, end: 0 },
        tint: 0x9fd8ff,
        emitting: false,
      });
      this.ripples.setDepth(DEPTH.skid + 0.5);
    }
  }

  /** Weak hardware: stop drawing lit windows, rain and searchlights. */
  degrade(): void {
    this.q = { ...this.q, detail: this.q.detail === 'high' ? 'low' : 'off' };
    this.rain?.stop();
    this.ripples?.stop();
    this.rain = null;
    this.ripples = null;
    for (const b of this.beams) b.setVisible(false);
    this.beams = [];
  }

  /** Generate pending track tiles within a time budget. Returns true when done. */
  pump(budgetMs: number): boolean {
    if (!this.pendingTiles.length) {
      this.ready = true;
      this.progress = 1;
      return true;
    }
    const t0 = performance.now();
    const scale = this.q.tileScale;
    const quality = this.q.detail === 'high' ? 'high' : 'low';
    while (this.pendingTiles.length && performance.now() - t0 < budgetMs) {
      const tile = this.pendingTiles.shift()!;
      const key = `ci-tile-${this.key}-${tile.x}-${tile.y}`;
      if (!this.scene.textures.exists(key)) {
        const c = document.createElement('canvas');
        c.width = Math.round(TILE * scale);
        c.height = Math.round(TILE * scale);
        drawTrackTile(c.getContext('2d')!, tile.x, tile.y, scale, this.track, this.decor, quality);
        this.scene.textures.addCanvas(key, c);
      }
      this.scene.add
        .image(tile.x, tile.y, key)
        .setOrigin(0, 0)
        .setScale(1 / scale)
        .setDepth(DEPTH.track);
    }
    this.progress = 1 - this.pendingTiles.length / Math.max(1, this.totalTiles);
    this.ready = this.pendingTiles.length === 0;
    return this.ready;
  }

  flashGate(gate: number, now: number): void {
    this.gateFlash.set(gate, now);
  }

  /** Per-frame: lean, lights, traffic, weather. */
  update(cam: Phaser.Cameras.Scene2D.Camera, now: number, dtMs: number, lights: { on: number; out: boolean; sinceGo: number }, underDeck: boolean): void {
    const view = cam.worldView;
    const cx = view.centerX;
    const cy = view.centerY;
    const margin = 260;
    const vx0 = view.x - margin;
    const vy0 = view.y - margin;
    const vx1 = view.right + margin;
    const vy1 = view.bottom + margin;
    const lean = this.q.lean;

    // --- Buildings ---------------------------------------------------------
    const maxDist = Math.hypot(view.width, view.height);
    for (const bv of this.buildings) {
      const b = bv.b;
      const visible = b.x + b.w > vx0 && b.x < vx1 && b.y + b.h > vy0 && b.y < vy1;
      if (!visible) {
        if (bv.g?.visible) {
          bv.g.setVisible(false);
          bv.roof?.setVisible(false);
          bv.sign?.setVisible(false);
          bv.beacon?.setVisible(false);
        }
        continue;
      }
      this.ensureBuilding(bv);
      this.drawBuilding(bv, cx, cy, lean, maxDist);
      if (this.q.lean > 0.1 && this.q.detail !== 'off') this.animateBuilding(bv, now);
    }

    // --- Gantries, lamps, billboards -----------------------------------------
    const g = this.gantryG;
    g.clear();
    for (const gan of this.decor.gantries) {
      if (gan.x < vx0 || gan.x > vx1 || gan.y < vy0 || gan.y > vy1) continue;
      this.drawGantry(g, gan, cx, cy, lean, lights, now);
    }
    const p = this.propsG;
    p.clear();
    const lampH = 0.2 * lean;
    this.decor.lamps.forEach((lamp, i) => {
      const glow = this.lampGlows[i]!;
      const vis = lamp.x > vx0 && lamp.x < vx1 && lamp.y > vy0 && lamp.y < vy1;
      glow.setVisible(vis);
      if (!vis) return;
      const hx = cx + (lamp.x - cx) * (1 + lampH);
      const hy = cy + (lamp.y - cy) * (1 + lampH);
      p.lineStyle(3, 0x0b0914, 0.9);
      p.lineBetween(lamp.x, lamp.y, hx, hy);
      p.lineStyle(1.5, 0x3a4262, 1);
      p.lineBetween(lamp.x, lamp.y, hx, hy);
      p.fillStyle(0xf8f6ff, 1);
      p.fillCircle(hx, hy, 3.2);
      glow.setPosition(hx, hy);
    });
    const boardH = 0.26 * lean;
    this.decor.billboards.forEach((bb, i) => {
      const img = this.boards[i]!;
      const vis = bb.x > vx0 && bb.x < vx1 && bb.y > vy0 && bb.y < vy1;
      img.setVisible(vis);
      if (!vis) return;
      const hx = cx + (bb.x - cx) * (1 + boardH);
      const hy = cy + (bb.y - cy) * (1 + boardH);
      const ax = Math.cos(bb.angle) * 50;
      const ay = Math.sin(bb.angle) * 50;
      p.lineStyle(3, 0x0b0914, 1);
      p.lineBetween(bb.x - ax, bb.y - ay, hx - ax, hy - ay);
      p.lineBetween(bb.x + ax, bb.y + ay, hx + ax, hy + ay);
      p.fillStyle(0x000000, 0.35);
      p.fillRect(bb.x - 8, bb.y - 8, 16, 16);
      img.setPosition(hx, hy).setScale(0.5 * (1 + boardH * 0.6));
    });

    // --- Grandstand crowd ------------------------------------------------------
    if (now - this.lastStandSwap > 320 && this.q.detail !== 'off') {
      this.lastStandSwap = now;
      this.standFrame = 1 - this.standFrame;
      const key = `ci-stand-${this.track.def.id}-${this.standFrame}`;
      for (const s of this.stands) s.setTexture(key);
    }

    // --- Deck transparency when the camera is underneath ----------------------
    if (this.deck) {
      const target = underDeck ? 0.45 : 1;
      this.deck.setAlpha(this.deck.alpha + (target - this.deck.alpha) * Math.min(1, dtMs / 120));
    }

    // --- Traffic --------------------------------------------------------------
    const dt = dtMs / 1000;
    for (const v of this.vehicles) {
      const st = this.decor.streets[v.street]!;
      const len = Math.hypot(st.x2 - st.x1, st.y2 - st.y1) || 1;
      v.t += (v.dir * v.speed * dt) / len;
      if (v.t > 1 || v.t < 0) {
        v.dir = -v.dir;
        v.t = Math.max(0, Math.min(1, v.t));
      }
      const ux = (st.x2 - st.x1) / len;
      const uy = (st.y2 - st.y1) / len;
      const lane = 12 * v.dir;
      const x = st.x1 + (st.x2 - st.x1) * v.t - uy * lane;
      const y = st.y1 + (st.y2 - st.y1) * v.t + ux * lane;
      const ang = Math.atan2(uy * v.dir, ux * v.dir);
      const vis = x > vx0 && x < vx1 && y > vy0 && y < vy1;
      v.sprite.setVisible(vis);
      v.light.setVisible(vis);
      if (!vis) continue;
      v.sprite.setPosition(x, y).setRotation(ang);
      v.light.setPosition(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12);
    }

    // --- Searchlights -------------------------------------------------------
    this.beams.forEach((beam, i) => beam.setRotation(now / 3200 + i * 2.1 + Math.sin(now / 1700 + i) * 0.4));

    // --- Rain -----------------------------------------------------------------
    if (this.rain && this.ripples) {
      const n = this.q.detail === 'high' ? 6 : 3;
      for (let i = 0; i < n; i++) {
        this.rain.emitParticleAt(view.x + Math.random() * (view.width + 200), view.y - 60 + Math.random() * view.height, 1);
      }
      if (Math.random() < 0.7) this.ripples.emitParticleAt(view.x + Math.random() * view.width, view.y + Math.random() * view.height, 1);
    }
  }

  private ensureBuilding(bv: BuildingView): void {
    if (bv.g) return;
    const scene = this.scene;
    const b = bv.b;
    const key = `ci-roof-${b.kind}-${Math.round(b.w)}x${Math.round(b.h)}-${b.tone}-${b.seed % 3}-${b.neon}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, roofCanvas({ ...b, seed: b.seed % 3 === 0 ? 11 : b.seed % 3 === 1 ? 23 : 37 }, 1));
    bv.g = scene.add.graphics();
    bv.roof = scene.add.image(b.x, b.y, key).setOrigin(0, 0);
    if (b.height > 0.7 && this.q.detail !== 'off') {
      bv.beacon = scene.add.image(b.x, b.y, 'ci-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff2a4a).setScale(0.32).setAlpha(0.12);
    }
    if (b.sign) {
      const color = NEON[b.neon % NEON.length]!;
      const skey = `ci-sign-${b.sign}-${b.neon}`;
      if (!scene.textures.exists(skey)) scene.textures.addCanvas(skey, signCanvas(b.sign, color, 2));
      bv.sign = scene.add.image(b.x, b.y, skey).setOrigin(0, 1).setScale(0.5);
    }
  }

  /** Neon signs occasionally stutter; tall towers blink their aircraft beacons. */
  private animateBuilding(bv: BuildingView, now: number): void {
    const seed = bv.b.seed;
    if (bv.sign && seed % 5 === 0) {
      const t = (now / 1000 + (seed % 97) * 0.13) % 7;
      const off = (t > 6.55 && t < 6.62) || (t > 6.74 && t < 6.8) || (t > 6.9 && t < 6.93);
      bv.sign.setAlpha(off ? 0.3 : 1);
    }
    if (bv.beacon) {
      const phase = (now / 1000 + (seed % 13) * 0.21) % 1.6;
      bv.beacon.setAlpha(phase < 0.18 ? 0.95 : 0.12);
    }
  }

  private drawBuilding(bv: BuildingView, cx: number, cy: number, lean: number, maxDist: number): void {
    const b = bv.b;
    const g = bv.g!;
    const roof = bv.roof!;
    const s = b.height * lean;
    const x0 = b.x;
    const y0 = b.y;
    const x1 = b.x + b.w;
    const y1 = b.y + b.h;
    const X0 = cx + (x0 - cx) * (1 + s);
    const Y0 = cy + (y0 - cy) * (1 + s);
    const X1 = cx + (x1 - cx) * (1 + s);
    const Y1 = cy + (y1 - cy) * (1 + s);
    const dist = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
    const depth = DEPTH.buildings + (1 - Math.min(1, dist / maxDist)) * 20;
    g.setVisible(true).setDepth(depth);
    roof.setVisible(true).setDepth(depth + 0.01).setPosition(X0, Y0).setScale(1 + s);
    bv.sign?.setVisible(true).setDepth(depth + 0.02).setPosition(X0 + 6 * (1 + s), Y1 - 4 * (1 + s)).setScale(0.5 * (1 + s));
    bv.beacon?.setVisible(true).setDepth(depth + 0.03).setPosition(X0 + 5.5 * (1 + s), Y0 + 5.5 * (1 + s));

    g.clear();
    // Soft shadow to the south-east.
    g.fillStyle(0x000000, 0.32);
    g.fillRect(x0 + 10 + b.height * 22, y0 + 12 + b.height * 30, b.w, b.h);
    const wall = WALL_TONES[b.tone % WALL_TONES.length]!;
    const lit = hexToInt(shade(wall, 0.18));
    const mid = hexToInt(wall);
    const dark = hexToInt(shade(wall, -0.25));
    const faces: Array<[number, number, number, number, number, number, number, number, number, number]> = [];
    // [ax, ay, bx, by, Bx, By, Ax, Ay, color, faceIndex] base edge a→b, roof edge B←A
    if (Y0 > y0 + 0.5) faces.push([x0, y0, x1, y0, X1, Y0, X0, Y0, lit, 0]);
    if (Y1 < y1 - 0.5) faces.push([x0, y1, x1, y1, X1, Y1, X0, Y1, dark, 1]);
    if (X0 > x0 + 0.5) faces.push([x0, y0, x0, y1, X0, Y1, X0, Y0, mid, 2]);
    if (X1 < x1 - 0.5) faces.push([x1, y0, x1, y1, X1, Y1, X1, Y0, mid, 3]);
    const drawWindows = this.q.detail === 'high';
    for (const f of faces) {
      const [ax, ay, bx, by, Bx, By, Ax, Ay, color, face] = f;
      g.fillStyle(color, 1);
      g.fillTriangle(ax, ay, bx, by, Bx, By);
      g.fillTriangle(ax, ay, Bx, By, Ax, Ay);
      const depthPx = Math.hypot(Ax - ax, Ay - ay);
      if (!drawWindows || depthPx < 7) continue;
      // Lit window strips: u along the base edge, v from base (0) to roof (1).
      for (const w of bv.windows) {
        if (w.face !== face) continue;
        const v0 = w.row;
        const v1 = w.row + 0.06;
        const P = (u: number, v: number): [number, number] => {
          const bxu = ax + (bx - ax) * u;
          const byu = ay + (by - ay) * u;
          const rxu = Ax + (Bx - Ax) * u;
          const ryu = Ay + (By - Ay) * u;
          return [bxu + (rxu - bxu) * v, byu + (ryu - byu) * v];
        };
        const p0 = P(w.u0, v0);
        const p1 = P(w.u1, v0);
        const p2 = P(w.u1, v1);
        const p3 = P(w.u0, v1);
        g.fillStyle(w.color, 0.85);
        g.fillTriangle(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
        g.fillTriangle(p0[0], p0[1], p2[0], p2[1], p3[0], p3[1]);
      }
    }
  }

  private drawGantry(g: Phaser.GameObjects.Graphics, gan: Decor['gantries'][number], cx: number, cy: number, lean: number, lights: { on: number; out: boolean; sinceGo: number }, now: number): void {
    const h = 0.34 * lean;
    const nx = -Math.sin(gan.angle);
    const ny = Math.cos(gan.angle);
    const tx = Math.cos(gan.angle);
    const ty = Math.sin(gan.angle);
    const half = gan.span / 2;
    const up = (x: number, y: number): [number, number] => [cx + (x - cx) * (1 + h), cy + (y - cy) * (1 + h)];
    const baseA: [number, number] = [gan.x + nx * half, gan.y + ny * half];
    const baseB: [number, number] = [gan.x - nx * half, gan.y - ny * half];
    const topA = up(baseA[0], baseA[1]);
    const topB = up(baseB[0], baseB[1]);
    const w = gan.gate === 0 ? 13 : 9;
    const q = (x: number, y: number, o: number): [number, number] => [x + tx * o, y + ty * o];
    // Ground shadow of the beam (sells the height).
    const sx = 26 * (1 + h * 4);
    const sy = 34 * (1 + h * 4);
    const s1 = q(baseA[0], baseA[1], -w);
    const s2 = q(baseA[0], baseA[1], w);
    const s3 = q(baseB[0], baseB[1], w);
    const s4 = q(baseB[0], baseB[1], -w);
    g.fillStyle(0x000000, 0.28);
    g.fillTriangle(s1[0] + sx, s1[1] + sy, s2[0] + sx, s2[1] + sy, s3[0] + sx, s3[1] + sy);
    g.fillTriangle(s1[0] + sx, s1[1] + sy, s3[0] + sx, s3[1] + sy, s4[0] + sx, s4[1] + sy);
    // Pillar feet + pillars.
    for (const [base, top] of [
      [baseA, topA],
      [baseB, topB],
    ] as const) {
      g.fillStyle(0x0b0914, 1);
      g.fillRect(base[0] - 9, base[1] - 9, 18, 18);
      g.fillStyle(0x2a3350, 1);
      g.fillRect(base[0] - 6, base[1] - 6, 12, 12);
      g.lineStyle(11, 0x0b0914, 1);
      g.lineBetween(base[0], base[1], top[0], top[1]);
      g.lineStyle(6, 0x3a4262, 1);
      g.lineBetween(base[0], base[1], top[0], top[1]);
    }
    // Beam (truss): dark body, lit edges, cross bracing.
    const a1 = q(topA[0], topA[1], -w);
    const a2 = q(topA[0], topA[1], w);
    const b1 = q(topB[0], topB[1], -w);
    const b2 = q(topB[0], topB[1], w);
    g.fillStyle(0x151a2c, 1);
    g.fillTriangle(a1[0], a1[1], a2[0], a2[1], b2[0], b2[1]);
    g.fillTriangle(a1[0], a1[1], b2[0], b2[1], b1[0], b1[1]);
    g.lineStyle(1.5, 0x3a4262, 1);
    g.lineBetween(a1[0], a1[1], b1[0], b1[1]);
    g.lineBetween(a2[0], a2[1], b2[0], b2[1]);
    const braces = Math.max(4, Math.round(half / 26));
    g.lineStyle(1, 0x2a3350, 1);
    for (let i = 0; i < braces; i++) {
      const t0 = i / braces;
      const t1 = (i + 1) / braces;
      g.lineBetween(a1[0] + (b1[0] - a1[0]) * t0, a1[1] + (b1[1] - a1[1]) * t0, a2[0] + (b2[0] - a2[0]) * t1, a2[1] + (b2[1] - a2[1]) * t1);
    }
    const flashAt = this.gateFlash.get(gan.gate) ?? -1e9;
    const flash = Math.max(0, 1 - (now - flashAt) / 450);
    const neon = hexToInt(gan.gate === 0 ? '#f8f6ff' : this.track.def.theme.neonA);
    g.lineStyle(2.5, flash > 0 ? 0xffffff : neon, 0.9);
    g.lineBetween(topA[0], topA[1], topB[0], topB[1]);
    if (flash > 0) {
      g.lineStyle(8, 0xffffff, flash * 0.5);
      g.lineBetween(topA[0], topA[1], topB[0], topB[1]);
    }
    if (gan.gate === 0) {
      // Start lights: 5 pairs across the beam centre.
      const mx = (topA[0] + topB[0]) / 2;
      const my = (topA[1] + topB[1]) / 2;
      const spacing = 13 * (1 + h);
      const go = lights.out && lights.sinceGo < 1500 && lights.sinceGo >= 0;
      for (let i = 0; i < 5; i++) {
        const o = (i - 2) * spacing;
        const lx = mx + nx * o;
        const ly = my + ny * o;
        const lit = !lights.out && i < lights.on;
        g.fillStyle(0x07050f, 1);
        g.fillCircle(lx, ly, 6 * (1 + h));
        g.fillStyle(go ? 0x2de38f : lit ? 0xff2a4a : 0x3a0d18, 1);
        g.fillCircle(lx, ly, 4.2 * (1 + h));
        if (lit || go) {
          g.fillStyle(go ? 0x2de38f : 0xff2a4a, 0.25);
          g.fillCircle(lx, ly, 10 * (1 + h));
        }
      }
    }
  }
}
