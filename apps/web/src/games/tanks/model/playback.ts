/**
 * Shot-script playback rules (pure; unit tested). The presenter owns a copy of the battlefield
 * — terrain, display tanks and the visual layers (fires, marks, speech bubbles) — and feeds every
 * `ShotEvent` through `applyShotEvent` when its time comes. Terrain changes use the engine's own
 * functions on the script's rounded coordinates, so the client ends bit-identical to the server.
 * Nothing here decides anything: it only re-enacts the server's timeline.
 */
import {
  GRAVITY_SCALE,
  type BeamKind,
  type BlastKind,
  type DamageSource,
  type GravityLevel,
  type ProjectileKind,
  type ShieldKind,
  type ShotEvent,
  type ShotScript,
  type UsableItemId,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { addDirt, applyPatch, carveCapsule, carveCircle, WEAPON_SPECS, type Terrain } from '@dascade/game-core/tanks';

export interface TankAnim {
  /** performance.now() based. */
  start: number;
  y0: number;
  y1: number;
  dur: number;
  landed: boolean;
  /** A parachute is open for this fall. */
  chute: boolean;
}

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
  shield: number;
  shieldMax: number;
  shieldKind: ShieldKind;
  /** Earth over the hull (derived from the terrain on the client). */
  buried: boolean;
  /** Volley mode: shot locked in. */
  locked: boolean;
  /** Falling / lifted animation. */
  anim: TankAnim | null;
  hitAt: number;
  diedAt: number;
  /** Last time the shield took a hit (ripple) — 0 = never. */
  shieldHitAt: number;
  /** Last warp (shimmer while it settles). */
  warpAt: number;
}

export interface LiveProjectile {
  id: number;
  kind: ProjectileKind;
  owner: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** ms since this path launched. */
  age: number;
}

/** A pool of burning fuel. */
export interface FireLayer {
  key: number;
  x0: number;
  cells: number[];
  /** performance.now() when it ignited, and how long it burns. */
  start: number;
  dur: number;
  hot: boolean;
  /** Column the flames spread out from (the highest burning ground — fuel runs downhill). */
  origin: number;
}

/** A Sky Lance target marker waiting for its beam. */
export interface LanceMark {
  x: number;
  y: number;
  start: number;
  until: number;
}

/** A speech bubble over a tank. */
export interface Quip {
  key: number;
  id: string;
  line: string;
  start: number;
  life: number;
}

export type FxEvent =
  | { kind: 'launch'; x: number; y: number; angle: number; weapon: WeaponId; shooterId: string }
  | { kind: 'whistle'; durMs: number; weapon: WeaponId }
  | { kind: 'boom'; x: number; y: number; r: number; w: BlastKind; terrain: 'crater' | 'dirt' | 'none'; direct?: string; owner: string }
  | { kind: 'bore'; x0: number; y0: number; x1: number; y1: number; r: number; durMs: number }
  | { kind: 'patch'; x0: number; x1: number; raised: boolean }
  | { kind: 'split'; x: number; y: number; w: WeaponId }
  | { kind: 'fire'; x0: number; x1: number; hot: boolean; dur: number }
  | { kind: 'beam'; x0: number; y0: number; x1: number; y1: number; w: BeamKind }
  | { kind: 'mark'; x: number; y: number }
  | { kind: 'damage'; id: string; amount: number; hp: number; src: DamageSource; x: number; y: number; shield: number }
  | { kind: 'shield'; id: string; x: number; y: number; hp: number; absorbed: number; broke: boolean; shieldKind: ShieldKind }
  | { kind: 'deflect'; id: string; x: number; y: number }
  | { kind: 'chute'; id: string; x: number; y: number }
  | { kind: 'warp'; id: string; x0: number; y0: number; x1: number; y1: number; color: string }
  | { kind: 'death'; id: string; x: number; y: number; color: string; by: string }
  | { kind: 'quip'; id: string; line: string }
  | { kind: 'land'; id: string; x: number; y: number; drop: number }
  | { kind: 'portal'; x: number; y: number }
  | { kind: 'item'; id: string; item: UsableItemId; x: number; y: number }
  | { kind: 'hazard'; what: 'meteor' | 'lightning' }
  | { kind: 'lost'; x: number; y: number };

/** Everything playback mutates. */
export interface PlaybackWorld {
  terrain: Terrain;
  tanks: Map<string, DisplayTank>;
  fires: FireLayer[];
  marks: LanceMark[];
  quips: Quip[];
  fx: FxEvent[];
  /** Columns repainted (terrain layer invalidation). */
  markDirty(x0: number, x1: number): void;
  /** Scorch the ground around x (visual only). */
  scorch(x: number, r: number, amount?: number): void;
  /** Running key for fire layers / quips. */
  serial: number;
}

/** Bubbles shown at once per tank, and how long one lasts. */
export const QUIPS_PER_TANK = 2;
export const QUIP_MS = 2600;
/** How long a Sky Lance marker may wait for its beam before it is dropped. */
const MARK_GRACE_MS = 600;

/** Times (ms) of the script's beams: a bore at the same moment is a beam's channel (instant), not a driller. */
export function beamTimes(script: ShotScript): number[] {
  return script.events.filter((e) => e.k === 'beam').map((e) => e.t);
}

function boreDuration(e: Extract<ShotEvent, { k: 'bore' }>, beams: readonly number[]): number {
  if (beams.some((t) => Math.abs(t - e.t) < 1.5)) return 60;
  const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
  const speed = WEAPON_SPECS.driller.drill?.speed ?? 320;
  return (len / speed) * 1000;
}

/** Highest burning column (fuel spreads from there). */
export function fireOrigin(terrain: Terrain, x0: number, cells: readonly number[]): number {
  let best = x0;
  let top = -Infinity;
  for (let k = 0; k < cells.length; k++) {
    if (!(cells[k]! > 0)) continue;
    const i = x0 + k;
    const h = i >= 0 && i < terrain.width ? terrain.h[i]! : -Infinity;
    if (h > top) {
      top = h;
      best = i;
    }
  }
  return best;
}

/**
 * Apply one script event to the client's battlefield copy at `now` (performance.now()).
 * `quiet` = fast-forwarding a script that was cut short: change the state, skip the show.
 */
export function applyShotEvent(w: PlaybackWorld, e: ShotEvent, now: number, quiet: boolean, beams: readonly number[] = []): void {
  const terrain = w.terrain;
  const fx = (ev: FxEvent) => {
    if (!quiet) w.fx.push(ev);
  };
  switch (e.k) {
    case 'boom': {
      if (e.terrain === 'crater') {
        const r = carveCircle(terrain, e.x, e.y, e.r);
        w.markDirty(r.x0, r.x1);
        w.scorch(e.x, e.r);
      } else if (e.terrain === 'dirt') {
        const r = addDirt(terrain, e.x, e.y, e.r);
        w.markDirty(r.x0, r.x1);
      }
      fx({ kind: 'boom', x: e.x, y: e.y, r: e.r, w: e.w, terrain: e.terrain, direct: e.direct, owner: e.owner });
      break;
    }
    case 'bore': {
      const r = carveCapsule(terrain, e.x0, e.y0, e.x1, e.y1, e.r);
      w.markDirty(r.x0, r.x1);
      fx({ kind: 'bore', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, r: e.r, durMs: boreDuration(e, beams) });
      break;
    }
    case 'patch': {
      let raised = false;
      for (let k = 0; k < e.h.length; k++) {
        const i = e.x0 + k;
        if (i >= 0 && i < terrain.width && e.h[k]! > terrain.h[i]!) {
          raised = true;
          break;
        }
      }
      const r = applyPatch(terrain, e.x0, e.h);
      w.markDirty(r.x0, r.x1);
      fx({ kind: 'patch', x0: e.x0, x1: e.x0 + e.h.length, raised });
      break;
    }
    case 'split':
      fx({ kind: 'split', x: e.x, y: e.y, w: e.w });
      break;
    case 'fire': {
      // The burnt ground stays scorched after the flames die.
      for (let k = 0; k < e.cells.length; k++) {
        const c = e.cells[k]!;
        if (c > 0) w.scorch(e.x0 + k + 0.5, 2.5, Math.min(1, 0.35 + c * 0.07));
      }
      if (!quiet) {
        w.fires.push({
          key: ++w.serial,
          x0: e.x0,
          cells: e.cells.slice(),
          start: now,
          dur: e.dur,
          hot: e.hot,
          origin: fireOrigin(terrain, e.x0, e.cells),
        });
      }
      fx({ kind: 'fire', x0: e.x0, x1: e.x0 + e.cells.length, hot: e.hot, dur: e.dur });
      break;
    }
    case 'beam': {
      if (e.w === 'skylance') {
        // The lance has arrived: drop the marker nearest to it.
        let best = -1;
        let bestD = Infinity;
        w.marks.forEach((m, i) => {
          const d = Math.abs(m.x - e.x0);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0 && bestD < 80) w.marks.splice(best, 1);
      }
      fx({ kind: 'beam', x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, w: e.w });
      break;
    }
    case 'mark': {
      const delay = WEAPON_SPECS.skylance.lance?.delayMs ?? 900;
      if (!quiet) w.marks.push({ x: e.x, y: e.y, start: now, until: now + delay + MARK_GRACE_MS });
      fx({ kind: 'mark', x: e.x, y: e.y });
      break;
    }
    case 'dmg': {
      const t = w.tanks.get(e.id);
      if (!t) break;
      t.hp = e.hp;
      t.hitAt = now;
      if (e.amount > 0) fx({ kind: 'damage', id: e.id, amount: e.amount, hp: e.hp, src: e.src, x: t.x, y: t.y, shield: e.shield ?? 0 });
      break;
    }
    case 'shield': {
      const t = w.tanks.get(e.id);
      if (!t) break;
      const kind = t.shieldKind;
      t.shield = e.hp;
      t.shieldHitAt = now;
      const broke = e.hp <= 0;
      if (broke) {
        t.shieldKind = '';
        t.shield = 0;
      }
      fx({ kind: 'shield', id: e.id, x: t.x, y: t.y, hp: e.hp, absorbed: e.absorbed, broke, shieldKind: kind });
      break;
    }
    case 'deflect': {
      const t = w.tanks.get(e.id);
      if (t) t.shieldHitAt = now;
      fx({ kind: 'deflect', id: e.id, x: e.x, y: e.y });
      break;
    }
    case 'move': {
      const t = w.tanks.get(e.id);
      if (!t) break;
      t.anim = { start: now, y0: e.y0, y1: e.y1, dur: e.dur, landed: false, chute: Boolean(e.chute) };
      if (e.chute) fx({ kind: 'chute', id: e.id, x: t.x, y: e.y0 });
      break;
    }
    case 'warp': {
      const t = w.tanks.get(e.id);
      if (!t) break;
      t.x = e.x1;
      t.y = e.y1;
      t.anim = null;
      t.warpAt = now;
      fx({ kind: 'warp', id: e.id, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, color: t.color });
      break;
    }
    case 'death': {
      const t = w.tanks.get(e.id);
      if (!t) break;
      t.alive = false;
      t.hp = 0;
      t.diedAt = now;
      t.shield = 0;
      t.shieldKind = '';
      fx({ kind: 'death', id: e.id, x: t.x, y: t.anim ? t.anim.y1 : t.y, color: t.color, by: e.by });
      break;
    }
    case 'quip': {
      if (quiet) break;
      const mine = w.quips.filter((q) => q.id === e.id);
      // At most two bubbles per tank: the oldest gives way.
      if (mine.length >= QUIPS_PER_TANK) w.quips.splice(w.quips.indexOf(mine[0]!), 1);
      w.quips.push({ key: ++w.serial, id: e.id, line: e.line, start: now, life: QUIP_MS });
      fx({ kind: 'quip', id: e.id, line: e.line });
      break;
    }
  }
}

/** Drop finished fires, overdue markers and expired bubbles. */
export function expireLayers(w: Pick<PlaybackWorld, 'fires' | 'marks' | 'quips'>, now: number): void {
  for (let i = w.fires.length - 1; i >= 0; i--) if (now - w.fires[i]!.start > w.fires[i]!.dur) w.fires.splice(i, 1);
  for (let i = w.marks.length - 1; i >= 0; i--) if (now > w.marks[i]!.until) w.marks.splice(i, 1);
  for (let i = w.quips.length - 1; i >= 0; i--) if (now - w.quips[i]!.start > w.quips[i]!.life) w.quips.splice(i, 1);
}

/** Gravity multiplier for the aim guide. */
export function gravityScale(level: GravityLevel | undefined): number {
  return GRAVITY_SCALE[level ?? 'normal'] ?? 1;
}
