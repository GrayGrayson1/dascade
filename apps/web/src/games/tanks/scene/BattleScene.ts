/**
 * BattleScene — renders whatever the BattlePresenter says the battlefield looks like this
 * frame. Two cameras: the background camera draws the parallax sky in screen pixels; the
 * world camera draws terrain, tanks, projectiles, fires and effects, and follows the action.
 * It never touches the network.
 */
import Phaser from 'phaser';
import type { BattleTheme, ConcreteWallMode, TanksPublicState } from '@dascade/shared/games/tanks';
import { heightAt, previewArc, type Terrain } from '@dascade/game-core/tanks';
import { getStateSnapshot } from '../../../net/session.ts';
import type { BattleFrame, BattlePresenter, DisplayTank, FxEvent, LiveProjectile } from '../model/presenter.ts';
import { readThemeTokens, subscribeThemeTokens, type ThemeEffects } from '@dascade/ui';
import { CONFETTI_TINTS, DISPLAY_FONT, THEMES, TEAM_TINT, WEAPON_TINT, hexToInt, type ThemePalette } from '../art/themes.ts';
import { materialsSignature, themedPalette, voidColor, type Materials } from '../art/themeAdapter.ts';
import { tankSfx } from '../audio.ts';
import { Effects } from './fx.ts';
import { FireRenderer } from './fire.ts';
import { QuipBubbles } from './bubbles.ts';
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

const DEPTH = { terrain: 10, fire: 16, tanks: 20, projectiles: 40, fx: 50, bubbles: 80, overlay: 90 } as const;

/** Projectile sprite per kind: texture, core size (world units), glow size. */
interface ShellLook {
  tex: string;
  size: number;
  glow: number;
  spin: boolean;
}

function shellLook(kind: LiveProjectile['kind']): ShellLook {
  switch (kind) {
    case 'roller':
    case 'heavyroller':
    case 'rolling':
      return { tex: 'tk-ball', size: kind === 'heavyroller' ? 11 : 8, glow: 22, spin: true };
    case 'dirtclod':
    case 'dirtball':
    case 'tonofdirt':
    case 'mudslide':
      return { tex: 'tk-clod', size: kind === 'tonofdirt' ? 12 : kind === 'dirtball' ? 9 : 7, glow: 14, spin: true };
    case 'nuke':
      return { tex: 'tk-shell', size: 10, glow: 44, spin: false };
    case 'mininuke':
      return { tex: 'tk-shell', size: 8, glow: 36, spin: false };
    case 'meteor':
      return { tex: 'tk-shell', size: 10, glow: 52, spin: false };
    case 'bomblet':
    case 'confetti':
      return { tex: 'tk-shell', size: 4, glow: 18, spin: false };
    case 'tracer':
      return { tex: 'tk-dot', size: 4, glow: 14, spin: false };
    case 'warhead':
    case 'heavy':
      return { tex: 'tk-shell', size: 7, glow: 30, spin: false };
    default:
      return { tex: 'tk-shell', size: 6, glow: 30, spin: false };
  }
}

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
  private fires: FireRenderer | null = null;
  private bubbles: QuipBubbles | null = null;
  private theme: ThemePalette = THEMES.dusk;
  /** Local DASCADE theme materials (presentation only; never synchronized). */
  private mats: Materials = {};
  private matEffects: Pick<ThemeEffects, 'ambient'> | undefined;
  private matSig = '';
  private themeDirty = false;
  private themeRecheck: ReturnType<typeof setTimeout> | null = null;
  private unsubTheme: (() => void) | null = null;
  private readonly tanks = new Map<string, TankView>();
  private readonly shells = new Map<
    number,
    { core: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; look: ShellLook; lastX: number; spin: number }
  >();
  private overlay!: Phaser.GameObjects.Graphics;
  private edges!: Phaser.GameObjects.Graphics;
  private edgeFx!: Phaser.GameObjects.Graphics;
  private walls: ConcreteWallMode | null = null;
  private ready = false;
  private lastNow = 0;
  private camX = 800;
  private camTop = 0;
  private zoom = 0.8;
  private camInit = false;
  private maxTerrain = 500;
  private celebrated = '';
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
    this.readMaterials();
    this.unsubTheme = subscribeThemeTokens(() => {
      this.themeDirty = true;
      // The theme's CSS may land a beat after the switch (transition layer): look once more.
      if (this.themeRecheck) clearTimeout(this.themeRecheck);
      this.themeRecheck = setTimeout(() => {
        this.themeRecheck = null;
        this.themeDirty = true;
      }, 300);
    });
    const disposeTheme = () => {
      this.unsubTheme?.();
      this.unsubTheme = null;
      if (this.themeRecheck) clearTimeout(this.themeRecheck);
      this.themeRecheck = null;
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, disposeTheme);
    this.events.once(Phaser.Scenes.Events.DESTROY, disposeTheme);
    this.bgLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    const bgCam = this.cameras.main;
    bgCam.setBackgroundColor(voidColor(this.theme, this.matSig !== ''));
    this.worldCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'world');
    this.worldCam.transparent = true;
    bgCam.ignore(this.worldLayer);
    this.worldCam.ignore(this.bgLayer);
    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);
    this.edges = this.add.graphics().setDepth(DEPTH.terrain + 2);
    this.edgeFx = this.add
      .graphics()
      .setDepth(DEPTH.terrain + 3)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.worldLayer.add([this.overlay, this.edges, this.edgeFx]);
  }

  /** Reads the local theme's terrain materials (scoped to the game stage). Returns true when they changed. */
  private readMaterials(): boolean {
    const t = readThemeTokens(this.game.canvas?.parentElement ?? null);
    const sig = materialsSignature(t.materials, t.effects);
    const themed = Object.values(t.materials).some(Boolean) ? sig : '';
    if (themed === this.matSig) return false;
    this.matSig = themed;
    this.mats = t.materials;
    this.matEffects = t.effects;
    return true;
  }

  /**
   * Theme switched mid-match: repaint the sky, terrain, field edges and soil debris with the new
   * palette IN PLACE. Tanks, projectiles, effects, camera and every timer are left untouched.
   */
  private restyle(): void {
    this.themeDirty = false;
    if (!this.readMaterials() || !this.sky || !this.skyTheme) return;
    this.theme = themedPalette(THEMES[this.skyTheme] ?? THEMES.dusk, this.mats, this.matEffects);
    this.cameras.main.setBackgroundColor(voidColor(this.theme, this.matSig !== ''));
    this.sky.destroy();
    this.sky = this.makeSky();
    this.terrainLayer?.restyle(this.theme);
    this.fx?.setPalette(this.theme);
    if (this.terrainRef) this.drawEdges(this.terrainRef, this.walls ?? 'open');
  }

  private makeSky(): Sky {
    const fx = this.opts.fx;
    return new Sky(this, this.bgLayer, this.theme, {
      stars: fx === 'off' ? 0.5 : 1,
      clouds: fx === 'off' ? 2 : fx === 'low' ? 4 : 6,
      motes: fx === 'off' || this.opts.reducedMotion ? 0 : fx === 'low' ? 0.5 : 1,
      animate: !this.opts.reducedMotion,
    });
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
      this.theme = themedPalette(THEMES[frame.theme] ?? THEMES.dusk, this.mats, this.matEffects);
      this.sky = this.makeSky();
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
      this.fires?.destroy();
      this.fires = new FireRenderer(this, this.worldLayer, frame.terrain.height, this.quality(), DEPTH.fire);
      this.bubbles?.destroy();
      this.bubbles = new QuipBubbles(this, this.worldLayer, DEPTH.bubbles, this.dpr);
      for (const v of this.tanks.values()) v.destroy();
      this.tanks.clear();
      for (const s of this.shells.values()) {
        s.core.destroy();
        s.glow.destroy();
      }
      this.shells.clear();
      this.celebrated = '';
      this.camInit = false;
      this.walls = frame.walls;
      this.drawEdges(frame.terrain, frame.walls);
    } else if (this.walls !== frame.walls) {
      this.walls = frame.walls;
      this.drawEdges(frame.terrain, frame.walls);
    }
  }

  /**
   * Beyond the field the ground continues as a dark shelf. The boundary itself shows this
   * battle's wall rule: open = a neon fence (shells are lost), wrap = a shimmering portal,
   * bounce = springy rubber posts, concrete = solid walls (shells burst on them).
   */
  private drawEdges(t: Terrain, walls: ConcreteWallMode): void {
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
      switch (walls) {
        case 'concrete': {
          // A tall slab with block seams, standing on the field edge.
          const w = 14;
          const wx = dir < 0 ? x - w : x;
          g.fillStyle(0x5a5870, 1);
          g.fillRect(wx, -400, w, H - h + 400);
          g.fillStyle(0x7d7a96, 1);
          g.fillRect(dir < 0 ? x - 3 : x, -400, 3, H - h + 400);
          g.lineStyle(1, 0x2c2a3a, 0.9);
          for (let y = H - h - 18, row = 0; y > -400; y -= 18, row++) {
            g.lineBetween(wx, y, wx + w, y);
            const sx = wx + (row % 2 === 0 ? w * 0.5 : w * 0.25);
            g.lineBetween(sx, y, sx, y + 18);
          }
          break;
        }
        case 'bounce': {
          // Rubber bumper posts with a spring coil.
          const px = dir < 0 ? x - 5 : x + 5;
          for (let k = 0; k < 4; k++) {
            const y = H - h - 30 - k * 95;
            g.fillStyle(0x2de38f, 0.95);
            g.fillRoundedRect(px - 5, y - 40, 10, 40, 5);
            g.lineStyle(2, 0xa7ffd9, 0.9);
            g.beginPath();
            for (let s = 0; s <= 8; s++) {
              const yy = y + s * 6;
              const xx = px + (s % 2 === 0 ? -5 : 5);
              if (s === 0) g.moveTo(xx, yy);
              else g.lineTo(xx, yy);
            }
            g.strokePath();
          }
          break;
        }
        case 'wrap': {
          // Portal frame (the shimmer animates in edgeFx).
          g.lineStyle(3, 0x7cf5ff, 0.6);
          g.lineBetween(x, H - h, x, H - h - 520);
          g.fillStyle(0x7cf5ff, 0.9);
          g.fillRect(x - 4, H - h - 6, 8, 6);
          break;
        }
        case 'open':
        default: {
          // Boundary fence.
          for (let y = 0; y < 300; y += 14) {
            const a = 0.55 * (1 - y / 300);
            g.lineStyle(3, glow, a);
            g.lineBetween(x, H - h - y, x, H - h - y - 8);
          }
          g.fillStyle(glow, 0.9);
          g.fillRect(x - 3, H - h - 6, 6, 6);
          break;
        }
      }
    }
    g.fillStyle(hexToInt(voidColor(this.theme, this.matSig !== '')), 1);
    g.fillRect(-2400, H, t.width + 4800, 900);
  }

  /** Animated parts of the walls (wrap-around portal shimmer). */
  private drawEdgeFx(t: Terrain, walls: ConcreteWallMode, now: number): void {
    const g = this.edgeFx;
    g.clear();
    if (walls !== 'wrap') return;
    const H = t.height;
    const still = this.opts.reducedMotion;
    for (const [x, h] of [
      [0, t.h[0]!],
      [t.width, t.h[t.width - 1]!],
    ] as const) {
      for (let y = 0; y < 520; y += 16) {
        const phase = still ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240 - y / 40);
        const a = (1 - y / 520) * (0.15 + 0.35 * phase);
        g.lineStyle(10, 0x7cf5ff, a * 0.35);
        g.lineBetween(x, H - h - y, x, H - h - y - 10);
        g.lineStyle(2, 0xd8fdff, a);
        g.lineBetween(x, H - h - y, x, H - h - y - 10);
      }
    }
  }

  override update(_time: number, deltaMs: number): void {
    const now = performance.now();
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : deltaMs;
    this.lastNow = now;
    const frame = this.opts.presenter.frame(now);
    if (!frame) return;
    if (this.themeDirty) this.restyle();
    this.buildWorld(frame);
    const terrainLayer = this.terrainLayer!;
    const fx = this.fx!;
    const W = frame.terrain.width;
    const H = frame.terrain.height;

    const dirty = this.opts.presenter.takeDirty();
    if (dirty) terrainLayer.invalidate(dirty.x0, dirty.x1);
    for (const e of this.opts.presenter.takeFx()) this.handleFx(e, fx, terrainLayer, frame.terrain, now);
    terrainLayer.flush();
    this.maxTerrain = 0;
    for (let i = 0; i < W; i += 8) if (frame.terrain.h[i]! > this.maxTerrain) this.maxTerrain = frame.terrain.h[i]!;

    this.updateCamera(frame, dt);
    const labelScale = Math.max(0.75, Math.min(2.4, 1 / Math.max(0.3, this.zoom)));
    const teams = getStateSnapshot<TanksPublicState>()?.battle.mode === 'teams';
    const volleyAim = frame.turnMode === 'volley' && frame.stage === 'aim' && !frame.playing;

    // Tanks.
    const seen = new Set<string>();
    const byId = new Map<string, DisplayTank>();
    for (const t of frame.tanks) {
      seen.add(t.id);
      byId.set(t.id, t);
      let view = this.tanks.get(t.id);
      if (!view) {
        view = new TankView(this, this.worldLayer, t, DEPTH.tanks + t.slot * 0.01, this.dpr);
        this.tanks.set(t.id, view);
      }
      const active =
        frame.turnMode === 'volley'
          ? volleyAim && !t.locked && t.alive && t.id === frame.myId
          : frame.activeId === t.id && (frame.stage === 'aim' || frame.playing);
      view.update(t, {
        now,
        labelScale,
        active,
        me: frame.myId === t.id,
        wind: frame.wind,
        reducedMotion: this.opts.reducedMotion,
        worldH: H,
        terrain: frame.terrain,
        teams,
        locked: volleyAim && t.locked && t.alive,
        fxOff: this.opts.fx === 'off',
      });
      const px = this.lastX.get(t.id);
      if (px !== undefined && Math.abs(px - t.x) > 0.05 && Math.abs(px - t.x) < 40 && t.alive) {
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
    let rolling = false;
    for (const p of frame.projectiles) {
      live.add(p.id);
      if (p.kind === 'rolling') rolling = true;
      let s = this.shells.get(p.id);
      if (!s) {
        const look = shellLook(p.kind);
        const tint = p.kind === 'confetti' ? CONFETTI_TINTS[p.id % CONFETTI_TINTS.length]! : (WEAPON_TINT[p.kind] ?? 0xffffff);
        const core = this.add
          .image(0, 0, look.tex)
          .setDisplaySize(look.size, look.size)
          .setDepth(DEPTH.projectiles + 1);
        if (look.tex !== 'tk-shell' || p.kind === 'confetti') core.setTint(tint);
        s = {
          glow: this.add
            .image(0, 0, 'tk-glow')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(tint)
            .setDisplaySize(look.glow, look.glow)
            .setDepth(DEPTH.projectiles)
            .setAlpha(p.kind === 'tracer' ? 0.5 : 1),
          core,
          look,
          lastX: p.x,
          spin: 0,
        };
        this.worldLayer.add([s.glow, s.core]);
        this.shells.set(p.id, s);
        if (p.kind === 'meteor') tankSfx.meteor();
      }
      if (s.look.spin) {
        // Rolls: spin by distance travelled.
        s.spin += (p.x - s.lastX) / Math.max(2, s.look.size / 2);
        s.lastX = p.x;
        s.core.setPosition(p.x, H - p.y - (p.kind === 'rolling' ? s.look.size / 2 - 1 : 0)).setRotation(s.spin);
      } else {
        s.core.setPosition(p.x, H - p.y).setRotation(Math.atan2(-p.dy, p.dx));
      }
      s.glow.setPosition(p.x, H - p.y);
      if (p.kind === 'meteor' && !this.opts.reducedMotion) s.glow.setAlpha(0.8 + 0.2 * Math.sin(now / 50 + p.id));
    }
    for (const [id, s] of this.shells) {
      if (!live.has(id)) {
        s.core.destroy();
        s.glow.destroy();
        this.shells.delete(id);
      }
    }
    if (rolling) tankSfx.roll();
    fx.update(now, frame.projectiles, labelScale);
    this.fires!.update(now, frame.fires, frame.terrain, fx);
    const labelLift = 27 * Math.min(1.4, Math.max(0.8, labelScale));
    this.bubbles!.update(now, frame.quips, byId, (t) => H - t.y - labelLift - 16 * labelScale, labelScale);
    this.drawEdgeFx(frame.terrain, frame.walls, now);

    this.drawOverlay(frame, labelScale, now);

    // Battle / match winner fireworks.
    const s = getStateSnapshot<TanksPublicState>();
    const won = frame.stage === 'battle_over' || frame.over;
    const key = won ? `${frame.battleSerial}:${frame.stage}` : '';
    if (won && this.celebrated !== key && s?.battle.winners) {
      this.celebrated = key;
      const winners = s.battle.winners.split(',').filter(Boolean);
      const w = frame.tanks.find((t) => winners.includes(t.id) && t.alive) ?? frame.tanks.find((t) => winners.includes(t.id));
      if (w)
        fx.celebrateAt(
          w.x,
          w.y,
          s.battle.winnerTeam >= 0 ? hexToInt(TEAM_TINT[s.battle.winnerTeam] ?? '#ffd23f') : hexToInt(w.color),
          this.opts.reducedMotion ? 3000 : 6000,
        );
    }
    if (!won) this.celebrated = '';

    const bgCam = this.cameras.main;
    this.sky!.update(
      now,
      dt / 1000,
      {
        w: bgCam.width,
        h: bgCam.height,
        camX: this.camX,
        zoom: this.zoom * this.dpr,
        screenY: (wy: number) => (H - wy - this.camTop) * this.zoom * this.dpr,
        worldWidth: W,
      },
      frame.wind,
    );

    if (!this.ready) {
      this.ready = true;
      this.opts.onReady();
    }
    this.watchPerformance(dt, now);
  }

  private shake(ms: number, intensity: number): void {
    if (this.opts.reducedMotion || this.opts.fx === 'off') return;
    this.worldCam.shake(ms, intensity);
  }

  /** A full-screen flash (nukes, lightning) — never under reduced motion or with effects off. */
  private screenFlash(ms: number, rgb: [number, number, number]): void {
    if (this.opts.reducedMotion || this.opts.fx === 'off') return;
    this.worldCam.flash(ms, rgb[0], rgb[1], rgb[2], false);
  }

  private handleFx(e: FxEvent, fx: Effects, terrain: TerrainLayer, t: Terrain, now: number): void {
    switch (e.kind) {
      case 'launch':
        fx.launch(e.x, e.y, e.angle, e.weapon);
        tankSfx.fire(e.weapon);
        if (e.weapon === 'heavy' || e.weapon === 'nuke' || e.weapon === 'mininuke') this.shake(120, 0.002);
        break;
      case 'whistle':
        tankSfx.whistle(e.durMs, e.weapon);
        break;
      case 'boom': {
        fx.boom(e.x, e.y, e.r, e.w, e.terrain, Boolean(e.direct));
        if (e.terrain === 'crater') terrain.invalidate(e.x - e.r * 1.4, e.x + e.r * 1.4);
        tankSfx.boom(e.r, e.w, e.terrain);
        if (e.w === 'nuke' || e.w === 'mininuke') {
          this.screenFlash(e.w === 'nuke' ? 520 : 360, [255, 246, 220]);
          this.shake(e.w === 'nuke' ? 1100 : 750, e.w === 'nuke' ? 0.02 : 0.014);
        } else if (e.terrain !== 'dirt' && e.r > 0 && e.w !== 'excavator') {
          this.shake(180 + e.r * 3, Math.min(0.012, 0.0022 + e.r / 9000));
        }
        break;
      }
      case 'bore':
        fx.bore(e.x0, e.y0, e.x1, e.y1, e.durMs, now);
        if (e.durMs > 100) tankSfx.drill(e.durMs);
        break;
      case 'patch':
        fx.mud(e.x0, e.x1, (x) => heightAt(t, x));
        terrain.invalidate(e.x0, e.x1);
        tankSfx.mud();
        break;
      case 'split':
        fx.split(e.x, e.y, e.w);
        tankSfx.split(e.w);
        break;
      case 'fire':
        tankSfx.napalm(e.dur, e.hot);
        break;
      case 'beam':
        fx.beam(e.x0, e.y0, e.x1, e.y1, e.w, now);
        tankSfx.beam(e.w);
        if (e.w === 'lightning') this.screenFlash(160, [220, 235, 255]);
        if (e.w !== 'railgun') this.shake(e.w === 'skylance' ? 420 : 200, e.w === 'skylance' ? 0.009 : 0.005);
        break;
      case 'mark':
        tankSfx.lanceMark();
        break;
      case 'damage':
        fx.damage(e.x, e.y, e.amount, e.src, 0);
        if (e.src === 'burn') tankSfx.burn();
        else tankSfx.hit();
        break;
      case 'shield':
        fx.shieldHit(e.x, e.y, e.shieldKind, e.broke);
        if (!e.broke) fx.absorbed(e.x, e.y, e.absorbed);
        if (e.broke) tankSfx.shieldBreak();
        else tankSfx.shieldHit();
        break;
      case 'deflect':
        fx.deflect(e.x, e.y);
        tankSfx.deflect();
        break;
      case 'chute':
        fx.chute(e.x, e.y);
        tankSfx.chute();
        break;
      case 'warp':
        fx.warp(e.x0, e.y0, e.x1, e.y1, hexToInt(e.color), now);
        tankSfx.warp();
        break;
      case 'death':
        fx.death(e.id, e.x, e.y, e.color);
        tankSfx.death();
        this.shake(420, 0.01);
        break;
      case 'quip':
        tankSfx.quip();
        break;
      case 'land':
        fx.land(e.x, e.y, e.drop);
        tankSfx.land(e.drop);
        break;
      case 'portal':
        fx.portal(e.x, e.y);
        tankSfx.portal();
        break;
      case 'item':
        fx.item(e.x, e.y, e.item);
        if (e.item === 'battery') tankSfx.battery();
        else if (e.item === 'fuel') tankSfx.fuel();
        else tankSfx.shieldUp();
        break;
      case 'hazard':
        tankSfx.hazardWarn();
        break;
      case 'lost':
        fx.lost(e.x, e.y);
        tankSfx.lost();
        break;
    }
  }

  /** Aim guide for my turret, shot ghosts, tracer lines, lance markers + off-screen markers. */
  private drawOverlay(frame: BattleFrame, labelScale: number, now: number): void {
    const g = this.overlay;
    g.clear();
    const H = frame.terrain.height;
    const s = Math.min(2, labelScale);
    const me = frame.myId ? frame.tanks.find((t) => t.id === frame.myId) : undefined;
    const myTurn = me && me.alive && frame.stage === 'aim' && (frame.turnMode === 'volley' ? !me.locked : frame.activeId === me.id);

    // Tracer ghosts: every tracer fired this battle stays as a dotted line (mine brighter).
    for (const gh of frame.tracers) {
      const tank = frame.tanks.find((t) => t.id === gh.owner);
      const mine = gh.owner === frame.myId;
      g.fillStyle(tank ? hexToInt(tank.color) : 0x9df7ff, mine ? 0.55 : 0.28);
      for (const pts of gh.segs) for (let i = 0; i < pts.length - 1; i += 6) g.fillCircle(pts[i]!, H - pts[i + 1]!, (mine ? 1.5 : 1.1) * s);
    }

    if (me && me.alive && !frame.playing && frame.stage !== 'over' && frame.stage !== 'battle_over') {
      // Ghost of my previous shot: a faint dotted reference for adjusting the next one.
      const ghost = this.opts.presenter.lastPaths.get(me.id);
      if (ghost && myTurn) {
        g.fillStyle(hexToInt(me.color), 0.32);
        for (const pts of ghost) for (let i = 8; i < pts.length - 1; i += 8) g.fillCircle(pts[i]!, H - pts[i + 1]!, 1.3 * s);
      }
      if (me.weapon === 'railgun') {
        // The railgun flies straight: show a short straight sight line instead of an arc.
        const rad = (me.angle * Math.PI) / 180;
        const ox = me.x;
        const oy = me.y + 13;
        for (let d = 24; d < 150; d += 9) {
          const k = 1 - d / 150;
          g.fillStyle(myTurn ? 0x7cf5ff : 0xd3cdf0, (myTurn ? 0.9 : 0.35) * (0.25 + k * 0.75));
          g.fillCircle(ox + Math.cos(rad) * d, H - (oy + Math.sin(rad) * d), (1 + k * 1.4) * s);
        }
      } else {
        const pts = previewArc(me, me.angle, me.power, 0.34, 4, frame.gravity);
        const alpha = myTurn ? 0.95 : 0.35;
        const color = myTurn ? 0xffd23f : 0xd3cdf0;
        for (let i = 2; i < pts.length; i += 2) {
          const k = 1 - i / pts.length;
          g.fillStyle(color, alpha * (0.25 + k * 0.75));
          g.fillCircle(pts[i]!, H - pts[i + 1]!, (1.2 + k * 1.6) * s);
        }
      }
      if (myTurn && !this.opts.reducedMotion) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        g.lineStyle(1.5 * labelScale, 0xffd23f, 0.25 + pulse * 0.25);
        g.strokeCircle(me.x, H - me.y - 10, 26 + pulse * 3);
      }
    }

    // Sky Lance markers: a turning reticle and a thin targeting line from the sky.
    for (const m of frame.marks) {
      const k = Math.min(1, (now - m.start) / Math.max(1, m.until - m.start));
      const spin = this.opts.reducedMotion ? 0 : now / 300;
      const r = (22 - k * 8) * s;
      g.lineStyle(2 * s, 0xc4a5ff, 0.9);
      g.strokeCircle(m.x, H - m.y, r);
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        g.lineBetween(
          m.x + Math.cos(a) * r * 0.6,
          H - m.y + Math.sin(a) * r * 0.6,
          m.x + Math.cos(a) * r * 1.35,
          H - m.y + Math.sin(a) * r * 1.35,
        );
      }
      g.lineStyle(1, 0xc4a5ff, 0.25 + 0.35 * k);
      g.lineBetween(m.x, H - m.y - r, m.x, H - m.y - 900);
    }

    // Tanks outside the view (small screens follow the action): edge arrows in their colour.
    const view = this.worldCam.worldView;
    const vx0 = view.x;
    const vx1 = view.right;
    let used = 0;
    for (const t of frame.tanks) {
      if (!t.alive || (t.x >= vx0 - 4 && t.x <= vx1 + 4)) continue;
      const left = t.x < vx0;
      const ls = labelScale;
      const ex = left ? vx0 + 16 * ls : vx1 - 16 * ls;
      const ey = Math.max(
        view.y + (this.insetTop * this.dpr) / this.worldCam.zoom + 30 * ls,
        Math.min(view.bottom - (this.insetBottom * this.dpr) / this.worldCam.zoom - 20 * ls, H - t.y - 12),
      );
      const dir = left ? -1 : 1;
      g.fillStyle(0x07050f, 0.85);
      g.fillTriangle(ex + dir * 12 * ls, ey, ex - dir * 4 * ls, ey - 11 * ls, ex - dir * 4 * ls, ey + 11 * ls);
      g.fillStyle(hexToInt(t.color), 1);
      g.fillTriangle(ex + dir * 9 * ls, ey, ex - dir * 2 * ls, ey - 8 * ls, ex - dir * 2 * ls, ey + 8 * ls);
      const label = this.edgeLabel(used++);
      label
        .setText(t.id === frame.myId ? 'YOU' : t.name)
        .setPosition(ex - dir * 8 * ls, ey)
        .setOrigin(left ? 0 : 1, 0.5)
        .setScale(ls)
        .setVisible(true);
    }
    for (let i = used; i < this.edgeLabels.length; i++) this.edgeLabels[i]!.setVisible(false);

    // Off-screen projectiles: a marker at the top edge with the altitude above view.
    const topLimit = view.y + (this.insetTop * this.dpr) / this.worldCam.zoom + 10;
    for (const p of frame.projectiles) {
      const py = H - p.y;
      if (py >= topLimit) continue;
      const x = Math.max(view.x + 20, Math.min(view.right - 20, p.x));
      const ls = labelScale;
      g.fillStyle(p.kind === 'confetti' ? CONFETTI_TINTS[p.id % CONFETTI_TINTS.length]! : (WEAPON_TINT[p.kind] ?? 0xffffff), 0.95);
      g.fillTriangle(x, topLimit + 2 * ls, x - 7 * ls, topLimit + 14 * ls, x + 7 * ls, topLimit + 14 * ls);
      g.fillStyle(0x07050f, 0.8);
      g.fillRect(x - 1.5 * ls, topLimit + 14 * ls, 3 * ls, 6 * ls);
    }
  }

  private edgeLabels: Phaser.GameObjects.Text[] = [];

  private edgeLabel(i: number): Phaser.GameObjects.Text {
    let t = this.edgeLabels[i];
    if (!t) {
      t = this.add
        .text(0, 0, '', {
          fontFamily: DISPLAY_FONT,
          fontSize: '12px',
          color: '#f8f6ff',
          stroke: '#07050f',
          strokeThickness: 4,
          resolution: this.dpr * 2,
        })
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
    if (p.level === 1) {
      this.fx?.degrade();
      this.fires?.degrade();
    } else this.opts.onDegrade?.();
  }
}
