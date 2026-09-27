/**
 * BattleScene — renders whatever the BattlePresenter says the battlefield looks like this
 * frame. Two cameras: the background camera draws the parallax sky in screen pixels; the
 * world camera draws terrain, tanks, projectiles and effects, and follows the action.
 * It never touches the network.
 */
import Phaser from 'phaser';
import type { BattleTheme, TanksPublicState } from '@dascade/shared/games/tanks';
import { previewArc, type Terrain } from '@dascade/game-core/tanks';
import { getStateSnapshot } from '../../../net/session.ts';
import type { BattleFrame, BattlePresenter, FxEvent } from '../model/presenter.ts';
import { DISPLAY_FONT, THEMES, TEAM_TINT, WEAPON_TINT, hexToInt, type ThemePalette } from '../art/themes.ts';
import { tankSfx } from '../audio.ts';
import { Effects } from './fx.ts';
import { Sky } from './sky.ts';
import { TerrainLayer } from './terrainLayer.ts';
import { TankView } from './tankView.ts';
import { makeFxTextures } from './textures.ts';

export type FxLevel = 'high' | 'low' | 'off';

export interface SceneOptions {
  presenter: BattlePresenter;
  fx: FxLevel;
  reducedMotion: boolean;
  mobile: boolean;
  onReady: () => void;
  onDegrade?: () => void;
}

const DEPTH = { terrain: 10, tanks: 20, projectiles: 40, fx: 50, overlay: 90 } as const;

export class BattleScene extends Phaser.Scene {
  private readonly opts: SceneOptions;
  private bgLayer!: Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private sky: Sky | null = null;
  private skyTheme: BattleTheme | null = null;
  private terrainLayer: TerrainLayer | null = null;
  private terrainRef: Terrain | null = null;
  private fx: Effects | null = null;
  private theme: ThemePalette = THEMES.dusk;
  private readonly tanks = new Map<string, TankView>();
  private readonly shells = new Map<number, { core: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }>();
  private overlay!: Phaser.GameObjects.Graphics;
  private edges!: Phaser.GameObjects.Graphics;
  private ready = false;
  private lastNow = 0;
  private camX = 800;
  private camTop = 0;
  private zoom = 0.8;
  private camInit = false;
  private maxTerrain = 500;
  private celebrated = false;
  private lastX = new Map<string, number>();
  dpr = 1;
  viewW = 1280;
  viewH = 720;
  insetTop = 64;
  insetBottom = 120;
  overview = false;
  private readonly perf = { acc: 0, frames: 0, slow: 0, level: 0, since: 0 };

  constructor(opts: SceneOptions) {
    super({ key: 'tanks-battle' });
    this.opts = opts;
  }

  setView(cssW: number, cssH: number, dpr: number): void {
    this.viewW = cssW;
    this.viewH = cssH;
    this.dpr = dpr;
  }

  setInsets(top: number, bottom: number): void {
    this.insetTop = top;
    this.insetBottom = bottom;
  }

  create(): void {
    makeFxTextures(this);
    this.bgLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    const bgCam = this.cameras.main;
    bgCam.setBackgroundColor('#05040b');
    this.worldCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'world');
    this.worldCam.transparent = true;
    bgCam.ignore(this.worldLayer);
    this.worldCam.ignore(this.bgLayer);
    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);
    this.edges = this.add.graphics().setDepth(DEPTH.terrain + 2);
    this.worldLayer.add([this.overlay, this.edges]);
  }

  private quality() {
    const fx = this.opts.fx;
    return {
      amount: fx === 'high' ? (this.opts.mobile ? 0.7 : 1) : fx === 'low' ? 0.45 : 0.15,
      reducedMotion: this.opts.reducedMotion,
    };
  }

  private buildWorld(frame: BattleFrame): void {
    if (this.skyTheme !== frame.theme || !this.sky) {
      this.sky?.destroy();
      this.theme = THEMES[frame.theme] ?? THEMES.dusk;
      const fx = this.opts.fx;
      this.sky = new Sky(this, this.bgLayer, this.theme, {
        stars: fx === 'off' ? 0.5 : 1,
        clouds: fx === 'off' ? 2 : fx === 'low' ? 4 : 6,
        motes: fx === 'off' || this.opts.reducedMotion ? 0 : fx === 'low' ? 0.5 : 1,
        animate: !this.opts.reducedMotion,
      });
      this.skyTheme = frame.theme;
      this.fx?.destroy();
      this.fx = null;
      this.terrainRef = null;
    }
    if (this.terrainRef !== frame.terrain) {
      this.terrainLayer?.destroy();
      this.terrainLayer = new TerrainLayer(this, this.worldLayer, frame.terrain, this.theme, this.opts.presenter.scorch, DEPTH.terrain);
      this.terrainRef = frame.terrain;
      this.opts.presenter.takeDirty();
      this.fx?.destroy();
      this.fx = new Effects(this, this.worldLayer, this.theme, frame.terrain.height, this.quality(), DEPTH.fx);
      for (const v of this.tanks.values()) v.destroy();
      this.tanks.clear();
      this.celebrated = false;
      this.camInit = false;
      this.drawEdges(frame.terrain);
    }
  }

  private drawEdges(t: Terrain): void {
    // Beyond the field: the ground continues as a dark shelf behind a neon boundary fence
    // (shells that cross it are lost).
    const g = this.edges;
    g.clear();
    const H = t.height;
    const deep = hexToInt(this.theme.deep);
    const rock = hexToInt(this.theme.rock);
    const glow = hexToInt(this.theme.rimGlow);
    const sides: Array<[number, number, number]> = [
      [0, -1, t.h[0]!],
      [t.width, 1, t.h[t.width - 1]!],
    ];
    for (const [x, dir, h] of sides) {
      const x0 = dir < 0 ? x - 2400 : x;
      g.fillStyle(rock, 1);
      g.fillRect(x0, H - h, 2400, h + 800);
      g.fillStyle(deep, 0.75);
      g.fillRect(x0, H - h + 6, 2400, h + 800);
      g.lineStyle(2, glow, 0.35);
      g.lineBetween(dir < 0 ? x - 2400 : x, H - h, dir < 0 ? x : x + 2400, H - h);
      // Boundary fence.
      for (let y = 0; y < 300; y += 14) {
        const a = 0.55 * (1 - y / 300);
        g.lineStyle(3, glow, a);
        g.lineBetween(x, H - h - y, x, H - h - y - 8);
      }
      g.fillStyle(glow, 0.9);
      g.fillRect(x - 3, H - h - 6, 6, 6);
    }
    g.fillStyle(0x05040b, 1);
    g.fillRect(-2400, H, t.width + 4800, 900);
  }

  override update(_time: number, deltaMs: number): void {
    const now = performance.now();
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : deltaMs;
    this.lastNow = now;
    const frame = this.opts.presenter.frame(now);
    if (!frame) return;
    this.buildWorld(frame);
    const terrainLayer = this.terrainLayer!;
    const fx = this.fx!;
    const W = frame.terrain.width;
    const H = frame.terrain.height;

    const dirty = this.opts.presenter.takeDirty();
    if (dirty) terrainLayer.invalidate(dirty.x0, dirty.x1);
    for (const e of this.opts.presenter.takeFx()) this.handleFx(e, fx, terrainLayer);
    terrainLayer.flush();
    this.maxTerrain = 0;
    for (let i = 0; i < W; i += 8) if (frame.terrain.h[i]! > this.maxTerrain) this.maxTerrain = frame.terrain.h[i]!;

    this.updateCamera(frame, dt);
    const labelScale = Math.max(0.75, Math.min(2.4, 1 / Math.max(0.3, this.zoom)));
    const teams = getStateSnapshot<TanksPublicState>()?.battle.mode === 'teams';

    // Tanks.
    const seen = new Set<string>();
    for (const t of frame.tanks) {
      seen.add(t.id);
      let view = this.tanks.get(t.id);
      if (!view) {
        view = new TankView(this, this.worldLayer, t, DEPTH.tanks + t.slot * 0.01, this.dpr);
        this.tanks.set(t.id, view);
      }
      view.update(t, {
        now,
        labelScale,
        active: frame.activeId === t.id && (frame.stage === 'aim' || frame.playing),
        me: frame.myId === t.id,
        wind: frame.wind,
        reducedMotion: this.opts.reducedMotion,
        worldH: H,
        terrain: frame.terrain,
        teams,
      });
      const px = this.lastX.get(t.id);
      if (px !== undefined && Math.abs(px - t.x) > 0.05 && t.alive) {
        fx.drive(t.x, t.y, Math.sign(t.x - px));
        if (t.id === frame.myId) tankSfx.drive();
      }
      this.lastX.set(t.id, t.x);
    }
    for (const [id, v] of this.tanks) {
      if (!seen.has(id)) {
        v.destroy();
        this.tanks.delete(id);
        fx.forgetWreck(id);
      }
    }

    // Projectiles.
    const live = new Set<number>();
    for (const p of frame.projectiles) {
      live.add(p.id);
      let s = this.shells.get(p.id);
      if (!s) {
        const tint = WEAPON_TINT[p.kind] ?? 0xffffff;
        s = {
          glow: this.add.image(0, 0, 'tk-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDisplaySize(30, 30).setDepth(DEPTH.projectiles),
          core: this.add.image(0, 0, 'tk-shell').setDisplaySize(p.kind === 'bomblet' ? 4 : 6, p.kind === 'bomblet' ? 4 : 6).setDepth(DEPTH.projectiles + 1),
        };
        this.worldLayer.add([s.glow, s.core]);
        this.shells.set(p.id, s);
      }
      const ang = Math.atan2(-p.dy, p.dx);
      s.core.setPosition(p.x, H - p.y).setRotation(ang);
      s.glow.setPosition(p.x, H - p.y);
    }
    for (const [id, s] of this.shells) {
      if (!live.has(id)) {
        s.core.destroy();
        s.glow.destroy();
        this.shells.delete(id);
      }
    }
    fx.update(now, frame.projectiles, labelScale);

    this.drawOverlay(frame, labelScale, now);

    // Victory fireworks over the winners.
    if (frame.over && !this.celebrated) {
      this.celebrated = true;
      const s = getStateSnapshot<TanksPublicState>();
      const winners = (s?.battle.winners ?? '').split(',').filter(Boolean);
      const w = frame.tanks.find((t) => winners.includes(t.id));
      if (w) fx.celebrateAt(w.x, w.y, s?.battle.winnerTeam !== undefined && s.battle.winnerTeam >= 0 ? hexToInt(TEAM_TINT[s.battle.winnerTeam] ?? '#ffd23f') : hexToInt(w.color), this.opts.reducedMotion ? 3000 : 6000);
    }
    if (!frame.over) this.celebrated = false;

    const bgCam = this.cameras.main;
    this.sky!.update(now, dt / 1000, {
      w: bgCam.width,
      h: bgCam.height,
      camX: this.camX,
      zoom: this.zoom * this.dpr,
      screenY: (wy: number) => (H - wy - this.camTop) * this.zoom * this.dpr,
      worldWidth: W,
    }, frame.wind);

    if (!this.ready) {
      this.ready = true;
      this.opts.onReady();
    }
    this.watchPerformance(dt, now);
  }

  private handleFx(e: FxEvent, fx: Effects, terrain: TerrainLayer): void {
    const shakeOk = !this.opts.reducedMotion && this.opts.fx !== 'off';
    switch (e.kind) {
      case 'launch':
        fx.launch(e.x, e.y, e.angle, e.weapon);
        tankSfx.fire(e.weapon);
        if (shakeOk && e.weapon === 'heavy') this.worldCam.shake(120, 0.002);
        break;
      case 'whistle':
        tankSfx.whistle(e.durMs);
        break;
      case 'boom':
        fx.boom(e.x, e.y, e.r, e.w, e.terrain, Boolean(e.direct));
        if (e.terrain === 'crater') terrain.invalidate(e.x - e.r * 1.4, e.x + e.r * 1.4);
        tankSfx.boom(e.r, e.w, e.terrain);
        // Reduced motion: no camera shake — the blast's own flash and shockwave carry the impact.
        if (shakeOk && e.terrain !== 'dirt') this.worldCam.shake(180 + e.r * 3, Math.min(0.012, 0.0022 + e.r / 9000));
        break;
      case 'bore':
        fx.bore(e.x0, e.y0, e.x1, e.y1, e.durMs, performance.now());
        tankSfx.drill(e.durMs);
        break;
      case 'split':
        fx.split(e.x, e.y);
        tankSfx.split();
        break;
      case 'damage':
        fx.damage(e.x, e.y, e.amount, e.src);
        tankSfx.hit();
        break;
      case 'death':
        fx.death(e.id, e.x, e.y, e.color);
        tankSfx.death();
        if (shakeOk) this.worldCam.shake(420, 0.01);
        break;
      case 'land':
        fx.land(e.x, e.y, e.drop);
        tankSfx.land(e.drop);
        break;
      case 'lost':
        fx.lost(e.x, e.y);
        tankSfx.lost();
        break;
    }
  }

  /** Aim guide for my turret + off-screen projectile markers. */
  private drawOverlay(frame: BattleFrame, labelScale: number, now: number): void {
    const g = this.overlay;
    g.clear();
    const H = frame.terrain.height;
    const me = frame.myId ? frame.tanks.find((t) => t.id === frame.myId) : undefined;
    const myTurn = me && frame.activeId === me.id && frame.stage === 'aim';
    if (me && me.alive && !frame.playing && frame.stage !== 'over') {
      // Ghost of my previous shot: a faint dotted reference for adjusting the next one.
      const ghost = this.opts.presenter.lastPaths.get(me.id);
      if (ghost && myTurn) {
        const step = 8;
        g.fillStyle(hexToInt(me.color), 0.32);
        for (let i = step; i < ghost.length - 1; i += step) g.fillCircle(ghost[i]!, H - ghost[i + 1]!, 1.3 * Math.min(2, labelScale));
      }
      const pts = previewArc(me, me.angle, me.power, 0.34);
      const alpha = myTurn ? 0.95 : 0.35;
      const color = myTurn ? 0xffd23f : 0xd3cdf0;
      for (let i = 2; i < pts.length; i += 2) {
        const k = 1 - i / pts.length;
        const r = (1.2 + k * 1.6) * Math.min(2, labelScale);
        g.fillStyle(color, alpha * (0.25 + k * 0.75));
        g.fillCircle(pts[i]!, H - pts[i + 1]!, r);
      }
      if (myTurn && !this.opts.reducedMotion) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        g.lineStyle(1.5 * labelScale, 0xffd23f, 0.25 + pulse * 0.25);
        g.strokeCircle(me.x, H - me.y - 10, 26 + pulse * 3);
      }
    }
    // Tanks outside the view (small screens follow the action): edge arrows in their colour.
    const view = this.worldCam.worldView;
    const vx0 = view.x;
    const vx1 = view.right;
    let used = 0;
    for (const t of frame.tanks) {
      if (!t.alive || (t.x >= vx0 - 4 && t.x <= vx1 + 4)) continue;
      const left = t.x < vx0;
      const s = labelScale;
      const ex = left ? vx0 + 16 * s : vx1 - 16 * s;
      const ey = Math.max(view.y + (this.insetTop * this.dpr) / this.worldCam.zoom + 30 * s, Math.min(view.bottom - (this.insetBottom * this.dpr) / this.worldCam.zoom - 20 * s, H - t.y - 12));
      const dir = left ? -1 : 1;
      g.fillStyle(0x07050f, 0.85);
      g.fillTriangle(ex + dir * 12 * s, ey, ex - dir * 4 * s, ey - 11 * s, ex - dir * 4 * s, ey + 11 * s);
      g.fillStyle(hexToInt(t.color), 1);
      g.fillTriangle(ex + dir * 9 * s, ey, ex - dir * 2 * s, ey - 8 * s, ex - dir * 2 * s, ey + 8 * s);
      const label = this.edgeLabel(used++);
      label.setText(t.id === frame.myId ? 'YOU' : t.name).setPosition(ex - dir * 8 * s, ey).setOrigin(left ? 0 : 1, 0.5).setScale(s).setVisible(true);
    }
    for (let i = used; i < this.edgeLabels.length; i++) this.edgeLabels[i]!.setVisible(false);

    // Off-screen projectiles: a marker at the top edge with the altitude above view.
    const topLimit = view.y + (this.insetTop * this.dpr) / this.worldCam.zoom + 10;
    for (const p of frame.projectiles) {
      const py = H - p.y;
      if (py >= topLimit) continue;
      const x = Math.max(view.x + 20, Math.min(view.right - 20, p.x));
      const s = labelScale;
      g.fillStyle(WEAPON_TINT[p.kind] ?? 0xffffff, 0.95);
      g.fillTriangle(x, topLimit + 2 * s, x - 7 * s, topLimit + 14 * s, x + 7 * s, topLimit + 14 * s);
      g.fillStyle(0x07050f, 0.8);
      g.fillRect(x - 1.5 * s, topLimit + 14 * s, 3 * s, 6 * s);
    }
  }

  private edgeLabels: Phaser.GameObjects.Text[] = [];

  private edgeLabel(i: number): Phaser.GameObjects.Text {
    let t = this.edgeLabels[i];
    if (!t) {
      t = this.add
        .text(0, 0, '', { fontFamily: DISPLAY_FONT, fontSize: '12px', color: '#f8f6ff', stroke: '#07050f', strokeThickness: 4, resolution: this.dpr * 2 })
        .setDepth(DEPTH.overlay + 1);
      this.worldLayer.add(t);
      this.edgeLabels.push(t);
    }
    return t;
  }

  private updateCamera(frame: BattleFrame, dt: number): void {
    const W = frame.terrain.width;
    const H = frame.terrain.height;
    const vw = this.viewW;
    const vh = this.viewH;
    const availH = Math.max(120, vh - this.insetTop - this.insetBottom);
    const needH = Math.min(H, this.maxTerrain + 190);
    const widthFit = vw / W;
    const heightFit = availH / needH;
    // Prefer filling the width when that only tucks a little sky under the top HUD.
    const fit = heightFit >= widthFit * 0.88 ? widthFit : Math.min(widthFit, heightFit);
    const portrait = vh > vw * 1.15;
    const follow = Math.max(0.42, Math.min(portrait ? 0.8 : 0.9, availH / 470, vw / (portrait ? 620 : 700)));
    // Wide screens see the whole field; small or tall ones zoom in and follow the action
    // (unless the player switched to the overview).
    const zoom = this.overview || fit >= (portrait ? 0.75 : 0.5) ? fit : Math.max(fit, follow);
    const k = this.camInit ? 1 - Math.exp(-(dt / 1000) * 3) : 1;
    this.zoom += (zoom - this.zoom) * k;

    const visW = vw / this.zoom;
    const visH = vh / this.zoom;
    const focus = frame.focus;
    let tx = W / 2;
    if (visW < W - 1 && focus) tx = Math.max(visW / 2 - 40, Math.min(W - visW / 2 + 40, focus.x));
    else if (visW < W - 1) tx = Math.max(visW / 2 - 40, Math.min(W - visW / 2 + 40, this.camX));
    // Bottom of the world sits on the control deck; rise to keep the focus (e.g. a high shell) in view.
    const baseTop = H - (vh - this.insetBottom) / this.zoom;
    let top = baseTop;
    if (focus) {
      const fy = H - focus.y;
      const want = fy - 110 - this.insetTop / this.zoom;
      if (want < top) top = Math.max(want, H - 1500);
      // Deck-aware bound: never rise so far that my tank or the one taking its turn (when in view)
      // sinks under the control deck — a shell above the view keeps its top-edge marker instead.
      for (const t of frame.tanks) {
        if (!t.alive || (t.id !== frame.myId && t.id !== frame.activeId) || Math.abs(t.x - tx) > visW / 2) continue;
        const keep = H - t.y + 14 / this.zoom - (vh - this.insetBottom) / this.zoom;
        top = Math.max(top, Math.min(baseTop, keep));
      }
      // A focus on the ground (the tank taking its turn, a blast) always stays in view under the top HUD.
      if (focus.weight < 1) top = Math.min(top, fy - 28 - this.insetTop / this.zoom);
    }
    const kf = this.camInit ? 1 - Math.exp(-(dt / 1000) * (this.opts.reducedMotion ? 2 : 3.5)) : 1;
    this.camX += (tx - this.camX) * kf;
    this.camTop += (top - this.camTop) * kf;
    this.camInit = true;

    const cam = this.worldCam;
    const bg = this.cameras.main;
    if (cam.width !== bg.width || cam.height !== bg.height) cam.setSize(bg.width, bg.height);
    cam.setZoom(this.zoom * this.dpr);
    cam.centerOn(this.camX, this.camTop + visH / 2);
  }

  /** CSS pixel → world (y-up) coordinates. */
  screenToWorld(cssX: number, cssY: number): { x: number; y: number } | null {
    if (!this.worldCam || !this.terrainRef) return null;
    const v = this.worldCam.worldView;
    const x = v.x + (cssX * this.dpr) / this.worldCam.zoom;
    const py = v.y + (cssY * this.dpr) / this.worldCam.zoom;
    return { x, y: this.terrainRef.height - py };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } | null {
    if (!this.worldCam || !this.terrainRef) return null;
    const v = this.worldCam.worldView;
    return { x: ((x - v.x) * this.worldCam.zoom) / this.dpr, y: ((this.terrainRef.height - y - v.y) * this.worldCam.zoom) / this.dpr };
  }

  private watchPerformance(dt: number, now: number): void {
    const p = this.perf;
    if (document.hidden) {
      p.since = now;
      p.acc = 0;
      p.frames = 0;
      return;
    }
    if (!p.since) p.since = now;
    if (now - p.since < 4000) return;
    p.acc += dt;
    p.frames++;
    if (p.acc < 2000) return;
    const avg = p.acc / p.frames;
    p.acc = 0;
    p.frames = 0;
    p.slow = avg > 28 ? p.slow + 1 : 0;
    if (p.slow < 2 || p.level >= 2) return;
    p.slow = 0;
    p.level++;
    if (p.level === 1) this.fx?.degrade();
    else this.opts.onDegrade?.();
  }
}
