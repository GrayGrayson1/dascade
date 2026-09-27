/**
 * BattlePresenter — turns the authoritative room state + `tanks:shot` scripts into what the
 * battlefield shows this frame. It never decides anything:
 *  - Between shots it mirrors the synced state (terrain heightmap, tanks), smoothing drives
 *    and turret swings.
 *  - When a shot script arrives it plays it back on its own copy of the pre-shot terrain:
 *    projectiles follow the server's sampled paths; craters/dirt/bores are replayed with the
 *    same engine functions (bit-exact, see sim.test "client replay"); damage, falls and
 *    deaths land on the script's timeline. Afterwards it re-adopts the state.
 *  - While the state already says "resolving shot N" but the script hasn't arrived yet, it
 *    holds the pre-shot view (so a crater never appears before its shell lands).
 * The Phaser scene pulls a frame per render; React reads a small low-frequency UI snapshot.
 */
import {
  TANKS_MSG,
  type BattleStage,
  type BattleTheme,
  type BlastKind,
  type ProjectileKind,
  type ShotEvent,
  type ShotScript,
  type TanksPublicState,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { addDirt, carveCapsule, carveCircle, decodeTerrain, restHeight, WEAPON_SPECS, type Terrain } from '@dascade/game-core/tanks';
import { getStateSnapshot, serverNow, subscribeMessage, useSessionStore } from '../../../net/session.ts';
import { pathAt } from './path.ts';

export interface DisplayTank {
  id: string;
  name: string;
  color: string;
  team: number;
  cpu: boolean;
  slot: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  gone: boolean;
  angle: number;
  power: number;
  weapon: WeaponId;
  fuel: number;
  maxFuel: number;
  /** Falling / lifted animation (performance.now() based). */
  anim: { start: number; y0: number; y1: number; dur: number; landed: boolean } | null;
  hitAt: number;
  diedAt: number;
}

export interface LiveProjectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export type FxEvent =
  | { kind: 'launch'; x: number; y: number; angle: number; weapon: WeaponId; shooterId: string }
  | { kind: 'whistle'; durMs: number; weapon: WeaponId }
  | { kind: 'boom'; x: number; y: number; r: number; w: BlastKind; terrain: 'crater' | 'dirt' | 'none'; direct?: string }
  | { kind: 'bore'; x0: number; y0: number; x1: number; y1: number; r: number; durMs: number }
  | { kind: 'split'; x: number; y: number }
  | { kind: 'damage'; id: string; amount: number; hp: number; src: 'blast' | 'fall'; x: number; y: number }
  | { kind: 'death'; id: string; x: number; y: number; color: string }
  | { kind: 'land'; id: string; x: number; y: number; drop: number }
  | { kind: 'lost'; x: number; y: number };

export interface BattleFrame {
  theme: BattleTheme;
  terrain: Terrain;
  tanks: DisplayTank[];
  projectiles: LiveProjectile[];
  stage: BattleStage;
  activeId: string;
  myId: string | null;
  wind: number;
  playing: boolean;
  /** Where the camera should look (world, y-up), or null for "the whole field". */
  focus: { x: number; y: number; weight: number } | null;
  over: boolean;
}

export interface PresenterUi {
  version: number;
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  playing: boolean;
  /** Last shot summary for the HUD callout. */
  lastShot: { seq: number; shooterId: string; damage: number; kills: string[] } | null;
}

interface Playback {
  script: ShotScript;
  start: number;
  next: number;
  launched: Set<number>;
  whistled: boolean;
  lastBoom: { x: number; y: number; at: number } | null;
}

export type LocalAim = { angle: number; power: number; weapon: WeaponId } | null;

const DRIVE_SPEED = 120;
const TURRET_SPEED = 220;

export class BattlePresenter {
  terrain: Terrain | null = null;
  private terrainRev = -1;
  private battleKey = '';
  private dirtyLo = Infinity;
  private dirtyHi = -Infinity;
  readonly tanks = new Map<string, DisplayTank>();
  private projectiles: LiveProjectile[] = [];
  private playback: Playback | null = null;
  private playedSeq = -1;
  private adoptedSeq = -1;
  private fxQueue: FxEvent[] = [];
  private unsubs: Array<() => void> = [];
  private lastNow = 0;
  private lastFocus: { x: number; y: number; at: number } | null = null;
  /** Scorch amount per column (visual only), bumped by explosions. */
  scorch: Float32Array | null = null;
  private ui: PresenterUi = { version: 0, hp: {}, alive: {}, playing: false, lastShot: null };
  private uiListeners = new Set<() => void>();
  /** Each shooter's last main-projectile path (flattened x,y) — the "last shot" aiming ghost. */
  readonly lastPaths = new Map<string, number[]>();
  /** My live aim (for my own turret, so it responds instantly). */
  localAim: () => LocalAim = () => null;

  start(): void {
    const s = getStateSnapshot<TanksPublicState>();
    if (s?.battle) {
      this.playedSeq = s.battle.shotSeq;
      this.adoptedSeq = s.battle.shotSeq;
    }
    this.unsubs.push(subscribeMessage(TANKS_MSG.shot, (payload) => this.onShot(payload as ShotScript)));
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
    let changed = false;
    const hp: Record<string, number> = {};
    const alive: Record<string, boolean> = {};
    for (const t of this.tanks.values()) {
      hp[t.id] = t.hp;
      alive[t.id] = t.alive;
      if (this.ui.hp[t.id] !== t.hp || this.ui.alive[t.id] !== t.alive) changed = true;
    }
    if (Object.keys(this.ui.hp).length !== this.tanks.size) changed = true;
    if (changed) this.publishUi({ hp, alive });
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

    const key = `${b.theme}:${b.terrain.slice(0, 32)}:${Object.keys(s.tanks ?? {}).length}`;
    if (!this.terrain || (key !== this.battleKey && b.shotSeq === 0 && !this.playback)) {
      this.resetBattle(s, key);
    }
    if (!this.terrain) return null;

    if (this.playback) this.advance(now);
    const holding = b.stage === 'resolving' && b.shotSeq !== this.playedSeq && serverNow() < b.resolveEndsAt + 300;
    if (!this.playback && !holding) this.adopt(s, now, dt);
    this.animate(now, dt);

    const myId = useSessionStore.getState().playerId;
    return {
      theme: b.theme,
      terrain: this.terrain,
      tanks: [...this.tanks.values()],
      projectiles: this.projectiles,
      stage: b.stage,
      activeId: b.activeId,
      myId,
      wind: b.wind,
      playing: Boolean(this.playback),
      focus: this.focus(now, b.activeId, b.stage),
      over: b.stage === 'over',
    };
  }

  private resetBattle(s: TanksPublicState, key: string): void {
    const t = decodeTerrain(s.battle.terrain, s.battle.width, s.battle.height);
    if (!t) return;
    this.terrain = t;
    this.terrainRev = s.battle.terrainRev;
    this.battleKey = key;
    this.scorch = new Float32Array(t.width);
    this.markDirty(0, t.width);
    this.tanks.clear();
    this.lastPaths.clear();
    this.playback = null;
    this.projectiles = [];
    this.playedSeq = s.battle.shotSeq;
    this.adoptedSeq = s.battle.shotSeq;
    this.lastFocus = null;
    this.publishUi({ lastShot: null, playing: false });
  }

  /** Mirror the synced state (no shot is being shown). */
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
        t = {
          id,
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
          anim: null,
          hitAt: 0,
          diedAt: v.alive ? 0 : now - 10_000,
        };
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
      if (t.hp !== v.hp) {
        if (v.hp < t.hp) t.hitAt = now;
        t.hp = v.hp;
      }
      if (t.alive && !v.alive) t.diedAt = now;
      t.alive = v.alive;
      // Drive smoothly toward the authoritative x; snap on big corrections.
      const dx = v.x - t.x;
      if (Math.abs(dx) > 160) t.x = v.x;
      else if (dx !== 0) t.x += Math.sign(dx) * Math.min(Math.abs(dx), DRIVE_SPEED * dt);
      if (!t.anim) t.y = Math.abs(t.x - v.x) < 0.01 ? v.y : restHeight(terrain, t.x);
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

  /** Falls, lifts and landing dust. */
  private animate(now: number, dt: number): void {
    for (const t of this.tanks.values()) {
      if (this.playback) this.turnTurret(t, t.angle, dt);
      const a = t.anim;
      if (!a) continue;
      const k = a.dur <= 0 ? 1 : Math.min(1, (now - a.start) / a.dur);
      const e = a.y1 < a.y0 ? k * k : 1 - (1 - k) * (1 - k);
      t.y = a.y0 + (a.y1 - a.y0) * e;
      if (k >= 1) {
        if (!a.landed && a.y1 < a.y0 - 6) this.fxQueue.push({ kind: 'land', id: t.id, x: t.x, y: a.y1, drop: a.y0 - a.y1 });
        t.anim = null;
        t.y = a.y1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shot playback
  // ---------------------------------------------------------------------------

  private onShot(script: ShotScript): void {
    if (!script || !Array.isArray(script.events) || !Array.isArray(script.projectiles)) return;
    if (this.playback) this.finishPlayback(true);
    if (script.seq === this.adoptedSeq || script.seq === this.playedSeq || !this.terrain) {
      this.playedSeq = script.seq;
      return;
    }
    this.playback = { script, start: performance.now(), next: 0, launched: new Set(), whistled: false, lastBoom: null };
    const main = script.projectiles[0];
    if (main) this.lastPaths.set(script.shooterId, main.pts);
    this.publishUi({ playing: true });
  }

  private advance(now: number): void {
    const pb = this.playback!;
    const s = pb.script;
    const t = now - pb.start;
    const events = s.events;
    while (pb.next < events.length && events[pb.next]!.t <= t) this.apply(events[pb.next++]!, now, pb);

    const live: LiveProjectile[] = [];
    for (const p of s.projectiles) {
      if (!pb.launched.has(p.id) && t >= p.t0) {
        pb.launched.add(p.id);
        if (p.id === 0) {
          const shooter = this.tanks.get(s.shooterId);
          this.fxQueue.push({ kind: 'launch', x: s.origin[0], y: s.origin[1], angle: s.angle, weapon: s.weapon, shooterId: s.shooterId });
          if (shooter) {
            shooter.angle = s.angle;
            shooter.power = s.power;
          }
        }
      }
      if (t < p.t0) continue;
      if (t >= p.t1) {
        if (p.end === 'out' && !pb.launched.has(-1 - p.id)) {
          pb.launched.add(-1 - p.id);
          this.fxQueue.push({ kind: 'lost', x: p.pts[p.pts.length - 2]!, y: p.pts[p.pts.length - 1]! });
        }
        continue;
      }
      const pos = pathAt(p.pts, t - p.t0, p.t1 - p.t0);
      live.push({ id: p.id, kind: p.kind, ...pos });
      if (p.id === 0 && !pb.whistled && pos.dy < 0) {
        pb.whistled = true;
        this.fxQueue.push({ kind: 'whistle', durMs: Math.max(200, p.t1 - t), weapon: s.weapon });
      }
    }
    this.projectiles = live;
    if (t >= s.durationMs) this.finishPlayback(false);
  }

  private apply(e: ShotEvent, now: number, pb: Playback): void {
    const terrain = this.terrain!;
    switch (e.k) {
      case 'boom': {
        if (e.terrain === 'crater') {
          const r = carveCircle(terrain, e.x, e.y, e.r);
          this.markDirty(r.x0, r.x1);
          this.addScorch(e.x, e.r);
        } else if (e.terrain === 'dirt') {
          const r = addDirt(terrain, e.x, e.y, e.r);
          this.markDirty(r.x0, r.x1);
        }
        pb.lastBoom = { x: e.x, y: e.y, at: now };
        this.fxQueue.push({ kind: 'boom', x: e.x, y: e.y, r: e.r, w: e.w, terrain: e.terrain, direct: e.direct });
        break;
      }
      case 'bore': {
        const r = carveCapsule(terrain, e.x0, e.y0, e.x1, e.y1, e.r);
        this.markDirty(r.x0, r.x1);
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        const speed = WEAPON_SPECS.driller.drill?.speed ?? 320;
        this.fxQueue.push({ kind: 'bore', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, r: e.r, durMs: (len / speed) * 1000 });
        break;
      }
      case 'split':
        this.fxQueue.push({ kind: 'split', x: e.x, y: e.y });
        break;
      case 'dmg': {
        const t = this.tanks.get(e.id);
        if (!t) break;
        t.hp = e.hp;
        t.hitAt = now;
        this.fxQueue.push({ kind: 'damage', id: e.id, amount: e.amount, hp: e.hp, src: e.src, x: t.x, y: t.y });
        this.syncUiTanks();
        break;
      }
      case 'move': {
        const t = this.tanks.get(e.id);
        if (!t) break;
        t.anim = { start: now, y0: e.y0, y1: e.y1, dur: e.dur, landed: false };
        break;
      }
      case 'death': {
        const t = this.tanks.get(e.id);
        if (!t) break;
        t.alive = false;
        t.hp = 0;
        t.diedAt = now;
        this.fxQueue.push({ kind: 'death', id: e.id, x: t.x, y: t.anim ? t.anim.y1 : t.y, color: t.color });
        this.syncUiTanks();
        break;
      }
    }
  }

  private addScorch(x: number, r: number): void {
    const sc = this.scorch;
    if (!sc) return;
    const reach = r * 1.35;
    for (let i = Math.max(0, Math.floor(x - reach)); i < Math.min(sc.length, Math.ceil(x + reach)); i++) {
      const k = 1 - Math.abs(i + 0.5 - x) / reach;
      if (k > sc[i]!) sc[i] = Math.min(1, k * 1.15);
    }
  }

  private finishPlayback(fastForward: boolean): void {
    const pb = this.playback;
    if (!pb) return;
    const now = performance.now();
    if (fastForward) {
      while (pb.next < pb.script.events.length) this.apply(pb.script.events[pb.next++]!, now, pb);
      for (const t of this.tanks.values()) {
        if (t.anim) {
          t.y = t.anim.y1;
          t.anim = null;
        }
      }
    }
    this.playedSeq = pb.script.seq;
    this.playback = null;
    this.projectiles = [];
    if (pb.lastBoom) this.lastFocus = { x: pb.lastBoom.x, y: pb.lastBoom.y, at: now };
    this.publishUi({ playing: false, lastShot: { seq: pb.script.seq, shooterId: pb.script.shooterId, damage: pb.script.damage, kills: pb.script.kills } });
  }

  private focus(now: number, activeId: string, stage: BattleStage): BattleFrame['focus'] {
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
      const shooter = this.tanks.get(pb.script.shooterId);
      if (shooter) return { x: shooter.x, y: shooter.y, weight: 0.6 };
    }
    if (this.lastFocus && now - this.lastFocus.at < 900) return { x: this.lastFocus.x, y: this.lastFocus.y, weight: 0.6 };
    if (stage === 'aim' || stage === 'idle') {
      const t = this.tanks.get(activeId);
      if (t) return { x: t.x, y: t.y, weight: 0.5 };
    }
    return null;
  }
}
