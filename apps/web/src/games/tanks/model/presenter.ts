/**
 * BattlePresenter — turns the authoritative room state + `tanks:shot` scripts into what the
 * battlefield shows this frame. It never decides anything:
 *  - Between scripts it mirrors the synced state (terrain heightmap, tanks, shields), smoothing
 *    drives and turret swings.
 *  - When a script arrives (one turn's shot, a whole volley, or a hazard) it plays it back on
 *    its own copy of the pre-shot terrain: every launch fires at its own moment, projectiles
 *    follow the server's sampled paths, and terrain changes, damage, shields, parachutes, warps,
 *    fires, beams, deaths and speech bubbles land on the script's timeline (see playback.ts —
 *    bit-exact terrain replay). Afterwards it re-adopts the state.
 *  - While the state already says "resolving script N" but the script hasn't arrived yet, it
 *    holds the pre-shot view (so a crater never appears before its shell lands).
 *  - A new battlefield (battle.battleSerial changed — every battle of a match) resets everything.
 * The Phaser scene pulls a frame per render; React reads a small low-frequency UI snapshot.
 */
import {
  TANKS_MSG,
  type BattleStage,
  type BattleTheme,
  type ConcreteWallMode,
  type ShotScript,
  type TanksEvent,
  type TanksPublicState,
  type TankView,
  type TurnMode,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { decodeTerrain, isBuried, restHeight, type Terrain } from '@dascade/game-core/tanks';
import { getStateSnapshot, serverNow, subscribeMessage, useSessionStore } from '../../../net/session.ts';
import { pathAt } from './path.ts';
import {
  applyShotEvent,
  beamTimes,
  expireLayers,
  gravityScale,
  type DisplayTank,
  type FireLayer,
  type FxEvent,
  type LanceMark,
  type LiveProjectile,
  type PlaybackWorld,
  type Quip,
} from './playback.ts';

export type { DisplayTank, FireLayer, FxEvent, LanceMark, LiveProjectile, Quip } from './playback.ts';

/** A persistent dotted line: one tracer shot's path segments (kept for the whole battle). */
export interface TracerGhost {
  owner: string;
  segs: number[][];
}

export interface BattleFrame {
  theme: BattleTheme;
  terrain: Terrain;
  tanks: DisplayTank[];
  projectiles: LiveProjectile[];
  stage: BattleStage;
  /** Turns mode: whose turn it is ('' in volley mode). */
  activeId: string;
  myId: string | null;
  wind: number;
  playing: boolean;
  /** Where the camera should look (world, y-up), or null for "the whole field". */
  focus: { x: number; y: number; weight: number } | null;
  over: boolean;
  walls: ConcreteWallMode;
  /** Gravity multiplier (aim guide). */
  gravity: number;
  turnMode: TurnMode;
  battleSerial: number;
  fires: readonly FireLayer[];
  marks: readonly LanceMark[];
  quips: readonly Quip[];
  tracers: readonly TracerGhost[];
}

export interface PresenterUi {
  version: number;
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  shield: Record<string, number>;
  playing: boolean;
  /** Last script summary for the HUD callout. */
  lastShot: {
    seq: number;
    kind: 'shot' | 'volley' | 'hazard';
    shooters: string[];
    damage: Record<string, number>;
    kills: Array<{ by: string; id: string }>;
  } | null;
}

interface Playback {
  script: ShotScript;
  start: number;
  next: number;
  launched: Set<number>;
  /** Launch indexes already fired (muzzle flash + turret snap). */
  fired: Set<number>;
  /** Main projectile ids that already whistled. */
  whistled: Set<number>;
  /** Path ids of each launch's main projectile. */
  mains: Set<number>;
  beams: number[];
  lastBoom: { x: number; y: number; at: number } | null;
}

export type LocalAim = { angle: number; power: number; weapon: WeaponId } | null;

const DRIVE_SPEED = 120;
const TURRET_SPEED = 220;
/** Tracer ghosts kept per owner. */
const TRACERS_PER_OWNER = 3;

export class BattlePresenter {
  terrain: Terrain | null = null;
  private terrainRev = -1;
  private serial = -1;
  private dirtyLo = Infinity;
  private dirtyHi = -Infinity;
  readonly tanks = new Map<string, DisplayTank>();
  private projectiles: LiveProjectile[] = [];
  private playback: Playback | null = null;
  private playedSeq = -1;
  private adoptedSeq = -1;
  private fxQueue: FxEvent[] = [];
  private fires: FireLayer[] = [];
  private marks: LanceMark[] = [];
  private quips: Quip[] = [];
  private layerSerial = 0;
  private tracers: TracerGhost[] = [];
  private unsubs: Array<() => void> = [];
  private lastNow = 0;
  private lastFocus: { x: number; y: number; at: number } | null = null;
  /** Scorch amount per column (visual only), bumped by explosions and fires. */
  scorch: Float32Array | null = null;
  private ui: PresenterUi = { version: 0, hp: {}, alive: {}, shield: {}, playing: false, lastShot: null };
  private uiListeners = new Set<() => void>();
  /** Each shooter's last main-projectile path segments (flattened x,y) — the "last shot" aiming ghost. */
  readonly lastPaths = new Map<string, number[][]>();
  /** My live aim (for my own turret, so it responds instantly). */
  localAim: () => LocalAim = () => null;

  start(): void {
    const s = getStateSnapshot<TanksPublicState>();
    if (s?.battle) {
      this.playedSeq = s.battle.shotSeq;
      this.adoptedSeq = s.battle.shotSeq;
    }
    this.unsubs.push(subscribeMessage(TANKS_MSG.shot, (payload) => this.onShot(payload as ShotScript)));
    this.unsubs.push(subscribeMessage(TANKS_MSG.event, (payload) => this.onEvent(payload as TanksEvent)));
  }

  /** Room events with something to show on the battlefield: items switched on, hazard warnings. */
  private onEvent(e: TanksEvent): void {
    if (!e || typeof e !== 'object') return;
    if (e.kind === 'item') {
      const t = this.tanks.get(e.playerId);
      if (t) this.fxQueue.push({ kind: 'item', id: t.id, item: e.item, x: t.x, y: t.y });
    } else if (e.kind === 'hazard') {
      this.fxQueue.push({ kind: 'hazard', what: e.what });
    }
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.uiListeners.clear();
  }

  // ---------------------------------------------------------------------------
  // React bridge
  // ---------------------------------------------------------------------------

  subscribeUi = (fn: () => void): (() => void) => {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  };

  getUi = (): PresenterUi => this.ui;

  private publishUi(patch: Partial<PresenterUi>): void {
    this.ui = { ...this.ui, ...patch, version: this.ui.version + 1 };
    for (const l of [...this.uiListeners]) l();
  }

  private syncUiTanks(): void {
    let changed = Object.keys(this.ui.hp).length !== this.tanks.size;
    const hp: Record<string, number> = {};
    const alive: Record<string, boolean> = {};
    const shield: Record<string, number> = {};
    for (const t of this.tanks.values()) {
      hp[t.id] = t.hp;
      alive[t.id] = t.alive;
      shield[t.id] = t.shield;
      if (this.ui.hp[t.id] !== t.hp || this.ui.alive[t.id] !== t.alive || this.ui.shield[t.id] !== t.shield) changed = true;
    }
    if (changed) this.publishUi({ hp, alive, shield });
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  /** Consume the columns redrawn since the last call (for the terrain layer). */
  takeDirty(): { x0: number; x1: number } | null {
    if (this.dirtyHi < this.dirtyLo) return null;
    const r = { x0: Math.max(0, Math.floor(this.dirtyLo)), x1: Math.ceil(this.dirtyHi) };
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
    return r;
  }

  takeFx(): FxEvent[] {
    const fx = this.fxQueue;
    this.fxQueue = [];
    return fx;
  }

  private markDirty(x0: number, x1: number): void {
    if (x1 <= x0) return;
    this.dirtyLo = Math.min(this.dirtyLo, x0);
    this.dirtyHi = Math.max(this.dirtyHi, x1);
  }

  frame(now: number): BattleFrame | null {
    const s = getStateSnapshot<TanksPublicState>();
    const b = s?.battle;
    if (!s || !b || !b.terrain) return null;
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;

    if (!this.terrain || b.battleSerial !== this.serial) this.resetBattle(s);
    if (!this.terrain) return null;

    if (this.playback) this.advance(now);
    const holding = b.stage === 'resolving' && b.shotSeq !== this.playedSeq && serverNow() < b.resolveEndsAt + 300;
    if (!this.playback && !holding) this.adopt(s, now, dt);
    this.animate(now, dt);
    expireLayers({ fires: this.fires, marks: this.marks, quips: this.quips }, now);

    const myId = useSessionStore.getState().playerId;
    return {
      theme: b.theme,
      terrain: this.terrain,
      tanks: [...this.tanks.values()],
      projectiles: this.projectiles,
      stage: b.stage,
      activeId: b.turnMode === 'volley' ? '' : b.activeId,
      myId,
      wind: b.wind,
      playing: Boolean(this.playback),
      focus: this.focus(now, b.activeId, b.stage, b.turnMode, myId),
      over: b.stage === 'over',
      walls: b.walls ?? 'open',
      gravity: gravityScale(b.gravity),
      turnMode: b.turnMode ?? 'turns',
      battleSerial: b.battleSerial,
      fires: this.fires,
      marks: this.marks,
      quips: this.quips,
      tracers: this.tracers,
    };
  }

  private resetBattle(s: TanksPublicState): void {
    const t = decodeTerrain(s.battle.terrain, s.battle.width, s.battle.height);
    if (!t) return;
    this.terrain = t;
    this.terrainRev = s.battle.terrainRev;
    this.serial = s.battle.battleSerial;
    this.scorch = new Float32Array(t.width);
    this.markDirty(0, t.width);
    this.tanks.clear();
    this.lastPaths.clear();
    this.tracers = [];
    this.fires = [];
    this.marks = [];
    this.quips = [];
    this.playback = null;
    this.projectiles = [];
    this.playedSeq = s.battle.shotSeq;
    this.adoptedSeq = s.battle.shotSeq;
    this.lastFocus = null;
    this.publishUi({ lastShot: null, playing: false });
  }

  /** Mirror the synced state (no script is being shown). */
  private adopt(s: TanksPublicState, now: number, dt: number): void {
    const b = s.battle;
    const terrain = this.terrain!;
    if (b.terrainRev !== this.terrainRev) {
      const next = decodeTerrain(b.terrain, terrain.width, terrain.height);
      if (next) {
        let lo = -1;
        let hi = -1;
        for (let i = 0; i < terrain.width; i++) {
          if (terrain.h[i] !== next.h[i]) {
            if (lo < 0) lo = i;
            hi = i;
          }
        }
        if (lo >= 0) {
          terrain.h.set(next.h);
          this.markDirty(lo, hi + 1);
        }
      }
      this.terrainRev = b.terrainRev;
    }
    this.adoptedSeq = b.shotSeq;

    const seen = new Set<string>();
    for (const [id, v] of Object.entries(s.tanks ?? {})) {
      seen.add(id);
      let t = this.tanks.get(id);
      if (!t) {
        t = newDisplayTank(v, now);
        this.tanks.set(id, t);
      }
      t.name = v.name;
      t.color = v.color;
      t.team = v.team;
      t.cpu = v.cpu;
      t.slot = v.slot;
      t.maxHp = v.maxHp;
      t.gone = v.gone;
      t.power = v.power;
      t.weapon = v.weapon;
      t.fuel = v.fuel;
      t.maxFuel = v.maxFuel;
      t.shieldMax = v.shieldMax ?? 0;
      t.locked = Boolean(v.locked);
      if ((v.shield ?? 0) > t.shield && v.shieldKind) t.shieldHitAt = now; // switched on: a quick shimmer
      t.shield = v.shield ?? 0;
      t.shieldKind = v.shieldKind ?? '';
      if (t.hp !== v.hp) {
        if (v.hp < t.hp) t.hitAt = now;
        t.hp = v.hp;
      }
      if (t.alive && !v.alive) t.diedAt = now;
      t.alive = v.alive;
      // Drive smoothly toward the authoritative x; snap on big corrections (a warp, a reconnect).
      const dx = v.x - t.x;
      if (Math.abs(dx) > 160) t.x = v.x;
      else if (dx !== 0) t.x += Math.sign(dx) * Math.min(Math.abs(dx), DRIVE_SPEED * dt);
      if (!t.anim) t.y = Math.abs(t.x - v.x) < 0.01 ? v.y : restHeight(terrain, t.x);
      t.buried = (v.buried ?? 0) > 0 || isBuried(terrain, t.x, t.y);
      this.turnTurret(t, v.angle, dt);
    }
    for (const id of [...this.tanks.keys()]) if (!seen.has(id)) this.tanks.delete(id);
    this.syncUiTanks();
  }

  private turnTurret(t: DisplayTank, target: number, dt: number): void {
    const myId = useSessionStore.getState().playerId;
    const local = t.id === myId && t.alive ? this.localAim() : null;
    const goal = local ? local.angle : target;
    if (local) {
      t.angle = goal;
      t.power = local.power;
      t.weapon = local.weapon;
      return;
    }
    const d = goal - t.angle;
    if (Math.abs(d) < 0.01 || dt === 0) {
      if (dt === 0) t.angle = goal;
      return;
    }
    t.angle += Math.sign(d) * Math.min(Math.abs(d), TURRET_SPEED * dt);
  }

  /** Falls, lifts, parachutes and landing dust. */
  private animate(now: number, dt: number): void {
    for (const t of this.tanks.values()) {
      if (this.playback) this.turnTurret(t, t.angle, dt);
      const a = t.anim;
      if (!a) continue;
      const k = a.dur <= 0 ? 1 : Math.min(1, (now - a.start) / a.dur);
      // Free falls accelerate; parachutes float at a steady rate; lifts ease out.
      const e = a.y1 < a.y0 ? (a.chute ? k : k * k) : 1 - (1 - k) * (1 - k);
      t.y = a.y0 + (a.y1 - a.y0) * e;
      if (k >= 1) {
        if (!a.landed && a.y1 < a.y0 - 6) this.fxQueue.push({ kind: 'land', id: t.id, x: t.x, y: a.y1, drop: a.chute ? 4 : a.y0 - a.y1 });
        t.anim = null;
        t.y = a.y1;
      }
      if (this.playback && this.terrain) t.buried = isBuried(this.terrain, t.x, t.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Script playback
  // ---------------------------------------------------------------------------

  /** The playback world handed to applyShotEvent. */
  private world(): PlaybackWorld {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      terrain: this.terrain!,
      tanks: this.tanks,
      fires: this.fires,
      marks: this.marks,
      quips: this.quips,
      fx: this.fxQueue,
      markDirty: (x0, x1) => self.markDirty(x0, x1),
      scorch: (x, r, amount) => self.addScorch(x, r, amount),
      get serial() {
        return self.layerSerial;
      },
      set serial(v: number) {
        self.layerSerial = v;
      },
    };
  }

  private onShot(script: ShotScript): void {
    if (!script || !Array.isArray(script.events) || !Array.isArray(script.projectiles) || !Array.isArray(script.launches)) return;
    if (this.playback) this.finishPlayback(true);
    if (script.seq === this.adoptedSeq || script.seq === this.playedSeq || !this.terrain) {
      this.playedSeq = script.seq;
      return;
    }
    const mains = new Set<number>();
    for (const l of script.launches) {
      const segs = script.projectiles.filter((p) => p.owner === l.shooterId && p.kind === l.weapon && p.t0 >= l.t0 - 1);
      const first = segs[0];
      if (first) mains.add(first.id);
      // Aiming ghost (every segment, so a wrap-around shot never draws a streak across the field).
      if (segs.length)
        this.lastPaths.set(
          l.shooterId,
          segs.map((p) => p.pts),
        );
      if (l.weapon === 'tracer' && segs.length) {
        this.tracers.push({ owner: l.shooterId, segs: segs.map((p) => p.pts) });
        const mine = this.tracers.filter((g) => g.owner === l.shooterId);
        if (mine.length > TRACERS_PER_OWNER) this.tracers.splice(this.tracers.indexOf(mine[0]!), 1);
      }
    }
    this.playback = {
      script,
      start: performance.now(),
      next: 0,
      launched: new Set(),
      fired: new Set(),
      whistled: new Set(),
      mains,
      beams: beamTimes(script),
      lastBoom: null,
    };
    this.publishUi({ playing: true });
  }

  private advance(now: number): void {
    const pb = this.playback!;
    const s = pb.script;
    const t = now - pb.start;
    const w = this.world();
    // Launches first (muzzle flash + turret snap at each launch's own moment).
    s.launches.forEach((l, i) => {
      if (pb.fired.has(i) || t < l.t0) return;
      pb.fired.add(i);
      this.fxQueue.push({ kind: 'launch', x: l.origin[0], y: l.origin[1], angle: l.angle, weapon: l.weapon, shooterId: l.shooterId });
      const shooter = this.tanks.get(l.shooterId);
      if (shooter) {
        shooter.angle = l.angle;
        shooter.power = l.power;
        shooter.weapon = l.weapon;
      }
    });
    const events = s.events;
    while (pb.next < events.length && events[pb.next]!.t <= t) {
      const e = events[pb.next++]!;
      applyShotEvent(w, e, now, false, pb.beams);
      if (e.k === 'boom') pb.lastBoom = { x: e.x, y: e.y, at: now };
      if (e.k === 'dmg' || e.k === 'death' || e.k === 'shield') this.syncUiTanks();
    }

    const width = this.terrain!.width;
    const live: LiveProjectile[] = [];
    for (const p of s.projectiles) {
      if (t < p.t0) continue;
      if (!pb.launched.has(p.id)) pb.launched.add(p.id);
      if (t >= p.t1) {
        const endKey = -1 - p.id;
        if (!pb.launched.has(endKey)) {
          pb.launched.add(endKey);
          const ex = p.pts[p.pts.length - 2]!;
          const ey = p.pts[p.pts.length - 1]!;
          if (p.end === 'out') this.fxQueue.push({ kind: 'lost', x: ex, y: ey });
          else if (p.end === 'wrap') {
            this.fxQueue.push({ kind: 'portal', x: Math.max(0, Math.min(width, ex)), y: ey });
            this.fxQueue.push({ kind: 'portal', x: ex < width / 2 ? width : 0, y: ey });
          }
        }
        continue;
      }
      const pos = pathAt(p.pts, t - p.t0, p.t1 - p.t0);
      live.push({ id: p.id, kind: p.kind, owner: p.owner, ...pos, age: t - p.t0 });
      if (pb.mains.has(p.id) && !pb.whistled.has(p.id) && pos.dy < 0) {
        pb.whistled.add(p.id);
        this.fxQueue.push({ kind: 'whistle', durMs: Math.max(200, p.t1 - t), weapon: p.kind as WeaponId });
      }
    }
    this.projectiles = live;
    if (t >= s.durationMs) this.finishPlayback(false);
  }

  private addScorch(x: number, r: number, amount = 1): void {
    const sc = this.scorch;
    if (!sc) return;
    const reach = r * 1.35;
    for (let i = Math.max(0, Math.floor(x - reach)); i < Math.min(sc.length, Math.ceil(x + reach)); i++) {
      const k = (1 - Math.abs(i + 0.5 - x) / reach) * amount;
      if (k > sc[i]!) sc[i] = Math.min(1, k * 1.15);
    }
    this.markDirty(Math.floor(x - reach), Math.ceil(x + reach));
  }

  private finishPlayback(fastForward: boolean): void {
    const pb = this.playback;
    if (!pb) return;
    const now = performance.now();
    if (fastForward) {
      const w = this.world();
      while (pb.next < pb.script.events.length) applyShotEvent(w, pb.script.events[pb.next++]!, now, true, pb.beams);
      for (const t of this.tanks.values()) {
        if (t.anim) {
          t.y = t.anim.y1;
          t.anim = null;
        }
      }
      this.syncUiTanks();
    }
    this.playedSeq = pb.script.seq;
    this.playback = null;
    this.projectiles = [];
    if (pb.lastBoom) this.lastFocus = { x: pb.lastBoom.x, y: pb.lastBoom.y, at: now };
    const s = pb.script;
    this.publishUi({
      playing: false,
      lastShot: {
        seq: s.seq,
        kind: s.kind,
        shooters: s.launches.map((l) => l.shooterId),
        damage: { ...s.damage },
        kills: s.kills.map((k) => ({ ...k })),
      },
    });
  }

  private focus(now: number, activeId: string, stage: BattleStage, turnMode: TurnMode, myId: string | null): BattleFrame['focus'] {
    const pb = this.playback;
    if (pb) {
      if (this.projectiles.length) {
        let x = 0;
        let y = 0;
        for (const p of this.projectiles) {
          x += p.x;
          y += p.y;
        }
        return { x: x / this.projectiles.length, y: y / this.projectiles.length, weight: 1 };
      }
      if (pb.lastBoom) return { x: pb.lastBoom.x, y: pb.lastBoom.y, weight: 0.8 };
      const first = pb.script.launches[0];
      const shooter = first ? this.tanks.get(first.shooterId) : undefined;
      if (shooter) return { x: shooter.x, y: shooter.y, weight: 0.6 };
    }
    if (this.lastFocus && now - this.lastFocus.at < 900) return { x: this.lastFocus.x, y: this.lastFocus.y, weight: 0.6 };
    if (stage === 'aim' || stage === 'idle' || stage === 'intro' || stage === 'shop') {
      // Volley: everyone aims at once — look at my own tank (spectators see the whole field).
      const id = turnMode === 'volley' || stage === 'shop' || stage === 'intro' ? myId : activeId;
      const t = id ? this.tanks.get(id) : undefined;
      if (t && t.alive) return { x: t.x, y: t.y, weight: 0.5 };
    }
    return null;
  }
}

function newDisplayTank(v: TankView, now: number): DisplayTank {
  return {
    id: v.id,
    name: v.name,
    color: v.color,
    team: v.team,
    cpu: v.cpu,
    slot: v.slot,
    x: v.x,
    y: v.y,
    hp: v.hp,
    maxHp: v.maxHp,
    alive: v.alive,
    gone: v.gone,
    angle: v.angle,
    power: v.power,
    weapon: v.weapon,
    fuel: v.fuel,
    maxFuel: v.maxFuel,
    shield: v.shield ?? 0,
    shieldMax: v.shieldMax ?? 0,
    shieldKind: v.shieldKind ?? '',
    buried: (v.buried ?? 0) > 0,
    locked: Boolean(v.locked),
    anim: null,
    hitAt: 0,
    diedAt: v.alive ? 0 : now - 10_000,
    shieldHitAt: 0,
    warpAt: 0,
  };
}
