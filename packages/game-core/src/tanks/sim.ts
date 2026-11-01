/**
 * The authoritative shot simulation. Given the world (terrain, tanks, wind, walls, gravity)
 * and one or more launches — a single turn, a whole volley — or an environmental hazard, it
 * flies every projectile with a fixed-step integrator and resolves everything that follows:
 * craters, dirt, bores, rolling, hopping, splitting, burning fuel, liquid earth, beams, orbital
 * strikes, warps, shields and deflectors, falls (and parachutes), burial, deaths and wreck
 * chain reactions. It mutates the world to the final result and returns a `ShotScript` for
 * clients to animate.
 *
 * Deterministic: same world + same input + same seed → same script, on every JS engine (only
 * + - * / sqrt floor round min max and the integer-degree direction table). Terrain operations
 * use the rounded coordinates the script carries, so clients replay them bit-exactly.
 */
import { createSeededRng, type Rng } from '@dascade/shared';
import {
  TANK_GEOM,
  TANKS_TIMING,
  TANKS_WORLD,
  type BlastKind,
  type ConcreteWallMode,
  type DamageSource,
  type ProjectileEnd,
  type ProjectileKind,
  type ProjectilePath,
  type ShieldKind,
  type ShotEvent,
  type ShotLaunch,
  type ShotScript,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { dcos, dsin } from './trig.ts';
import { addDirt, carveCapsule, carveCircle, heightAt, isBuried, restHeight, type Terrain } from './terrain.ts';
import { MUD_FLOW, NAPALM_FLOW, fireCells, heatUnder, pour, setMud } from './flow.ts';
import {
  LIGHTNING,
  METEOR_BLAST,
  PHYS,
  WEAPON_SPECS,
  WRECK_BLAST,
  blastDamage,
  fallDamage,
  fallDurationMs,
  type BlastSpec,
  type WeaponSpec,
} from './weapons.ts';

export interface SimTank {
  id: string;
  /** -1 in free-for-all. */
  team: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  /** Shield strength left (0 = none). */
  shield: number;
  shieldKind: ShieldKind;
  /** Parachutes left (a fall worth damage uses one). */
  chutes: number;
}

export interface SimWorld {
  terrain: Terrain;
  tanks: SimTank[];
  wind: number;
  walls: ConcreteWallMode;
  /** Gravity scale (1 = Earth). */
  gravity: number;
}

export interface ShotRules {
  teams: boolean;
  /** Teams only: when false nothing a player fires can hurt their teammates (they still take their own splash). */
  friendlyFire: boolean;
}

export interface ShotInput {
  shooterId: string;
  angle: number;
  power: number;
  weapon: WeaponId;
}

export interface ScriptMeta {
  seq: number;
  turnId: number;
  /** 'volley' when every tank fired together. */
  kind?: 'shot' | 'volley';
  /** Seed for the script's random rolls (Party Popper scatter). */
  seed?: number;
  /** Gap between the launches of a volley (ms). */
  staggerMs?: number;
  /** Speech bubbles: a line for a tank that fires or dies, or null. */
  quip?: (kind: 'fire' | 'death', id: string) => string | null;
}

export interface HazardInput {
  what: 'meteor' | 'lightning';
  /** Strike columns (meteors drift with vx). */
  strikes: Array<{ x: number; vx?: number }>;
}

const MS_PER_TICK = PHYS.dt * 1000;
/** Ticks a railgun charges before it fires. */
const RAIL_CHARGE_TICKS = 14;
/** Burn damage arrives in pulses at these fractions of the burn. */
const BURN_PULSES = [0.12, 0.35, 0.6, 0.85] as const;
/** Burn damage per unit of fuel depth summed under a tank's tracks. */
const BURN_PER_HEAT = 0.45;

/** Barrel tip and muzzle velocity for an aim (integer degrees / power 0..100). */
export function launchState(
  tank: { x: number; y: number },
  angle: number,
  power: number,
): { x: number; y: number; vx: number; vy: number } {
  const c = dcos(angle);
  const s = dsin(angle);
  const px = tank.x;
  const py = tank.y + TANK_GEOM.pivot;
  const speed = (PHYS.maxSpeed * Math.max(0, Math.min(100, Math.round(power)))) / 100;
  return { x: px + c * TANK_GEOM.barrel, y: py + s * TANK_GEOM.barrel, vx: c * speed, vy: s * speed };
}

/**
 * The first `seconds` of a shot's arc WITHOUT wind or collisions — the client's aim guide.
 * Deliberately short so it helps with feel, not with solving the shot.
 */
export function previewArc(
  tank: { x: number; y: number },
  angle: number,
  power: number,
  seconds = 0.32,
  stepEvery = 4,
  gravityScale = 1,
): number[] {
  const l = launchState(tank, angle, power);
  const pts: number[] = [l.x, l.y];
  const vx = l.vx;
  let { x, y, vy } = l;
  const g = PHYS.gravity * gravityScale;
  const ticks = Math.round(seconds / PHYS.dt);
  for (let i = 1; i <= ticks; i++) {
    vy -= g * PHYS.dt;
    x += vx * PHYS.dt;
    y += vy * PHYS.dt;
    if (i % stepEvery === 0) pts.push(x, y);
  }
  return pts;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: string;
  /** The weapon that fired it (sub-munitions keep their parent's spec). */
  spec: WeaponSpec;
  blast: BlastSpec;
  blastKind: BlastKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  startTick: number;
  live: boolean;
  /** Apex splitter still waiting for the top of its arc. */
  splits: boolean;
  /** The shooter's own tank (and shield) can't be hit while arming. */
  arming: boolean;
  /** Leapfrog bounces left. */
  hops: number;
  /** Rolling along the ground (+1 right / -1 left). */
  roll: 0 | 1 | -1;
  rollSpeed: number;
  /** Times a roller has rolled back (it settles after a few). */
  reversals: number;
  /** A deflector can't turn the same projectile again before this tick. */
  deflectCool: number;
  path: ProjectilePath;
}

interface Pending {
  tick: number;
  order: number;
  run: () => void;
}

const HAZARD_SPEC: WeaponSpec = { id: 'shell', windScale: 0.4, blast: METEOR_BLAST };

/** One simulation run (a script). */
class Sim {
  private readonly terrain: Terrain;
  private readonly tanks: SimTank[];
  private readonly windAcc: number;
  private readonly g: number;
  private readonly walls: ConcreteWallMode;
  private readonly rng: Rng;
  readonly events: ShotEvent[] = [];
  readonly paths: ProjectilePath[] = [];
  readonly launches: ShotLaunch[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly pending: Pending[] = [];
  private order = 0;
  tick = 0;
  private nextId = 0;
  readonly damage: Record<string, number> = {};
  readonly kills: Array<{ by: string; id: string }> = [];
  private readonly deathBy = new Map<string, { t: number; by: string }>();
  private readonly lastHit = new Map<string, string>();
  private readonly hitR2 = TANK_GEOM.hitRadius * TANK_GEOM.hitRadius;
  private readonly shieldR2 = TANK_GEOM.shieldRadius * TANK_GEOM.shieldRadius;

  private readonly rules: ShotRules;
  private readonly meta: ScriptMeta;

  constructor(world: SimWorld, rules: ShotRules, meta: ScriptMeta) {
    this.rules = rules;
    this.meta = meta;
    this.terrain = world.terrain;
    this.tanks = world.tanks;
    this.windAcc = PHYS.windAccel * world.wind;
    this.g = PHYS.gravity * world.gravity;
    this.walls = world.walls;
    this.rng = createSeededRng(meta.seed ?? 0);
  }

  // --- helpers ----------------------------------------------------------------

  private ms(tk: number): number {
    return round1(tk * MS_PER_TICK);
  }

  private tank(id: string): SimTank | undefined {
    return this.tanks.find((t) => t.id === id);
  }

  private teamOf(id: string): number {
    return this.tank(id)?.team ?? -2;
  }

  /** `tank` is an enemy of the shooter `by` (hazards have no enemies). */
  private enemyOf(by: string, tank: SimTank): boolean {
    if (!by || tank.id === by) return false;
    return !this.rules.teams || tank.team !== this.teamOf(by);
  }

  /** Whatever `by` fired may hurt `tank` (teammates are safe unless friendly fire is on). */
  private canHurt(by: string, tank: SimTank): boolean {
    if (!by || !this.rules.teams || this.rules.friendlyFire || tank.id === by) return true;
    return tank.team !== this.teamOf(by);
  }

  private later(ticks: number, run: () => void): void {
    this.pending.push({ tick: this.tick + Math.max(1, ticks), order: this.order++, run });
  }

  private quip(kind: 'fire' | 'death', id: string, t: number): void {
    const line = this.meta.quip?.(kind, id);
    if (line) this.events.push({ k: 'quip', t: round1(t), id, line });
  }

  // --- damage, settling, deaths ---------------------------------------------------

  private hurt(tank: SimTank, amount: number, t: number, src: DamageSource, by: string): void {
    if (!tank.alive || amount <= 0) return;
    let absorbed = 0;
    if (src !== 'fall' && tank.shield > 0) {
      absorbed = Math.min(tank.shield, amount);
      tank.shield -= absorbed;
      if (tank.shield <= 0) {
        tank.shield = 0;
        tank.shieldKind = '';
      }
      this.events.push({ k: 'shield', t: round1(t), id: tank.id, hp: tank.shield, absorbed });
    }
    const lost = Math.min(tank.hp, amount - absorbed);
    if (lost <= 0) return;
    tank.hp -= lost;
    const ev: ShotEvent = { k: 'dmg', t: round1(t), id: tank.id, amount: lost, hp: tank.hp, src, by };
    if (absorbed > 0) ev.shield = absorbed;
    this.events.push(ev);
    if (this.enemyOf(by, tank)) this.damage[by] = (this.damage[by] ?? 0) + lost;
    this.lastHit.set(tank.id, by);
    if (tank.hp <= 0 && !this.deathBy.has(tank.id)) this.deathBy.set(tank.id, { t, by });
  }

  /** Tanks follow the ground: fall (parachute or fall damage), ride up on earth piled under their tracks, or stay buried when it covers them. */
  private settle(t: number, by: string): void {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const ground = restHeight(this.terrain, tank.x);
      if (ground < tank.y - 0.01) {
        const drop = tank.y - ground;
        const chute = drop > PHYS.safeFall && tank.chutes > 0;
        if (chute) tank.chutes--;
        const dur = fallDurationMs(drop, chute);
        const ev: ShotEvent = { k: 'move', t: round1(t), id: tank.id, y0: tank.y, y1: ground, dur };
        if (chute) ev.chute = true;
        this.events.push(ev);
        tank.y = ground;
        if (!chute && this.canHurt(by, tank)) this.hurt(tank, fallDamage(drop), t + dur, 'fall', by);
      } else if (ground > tank.y + 0.01 && !isBuried(this.terrain, tank.x, tank.y)) {
        // Earth piled under the tracks: the tank rides up on top of it.
        this.events.push({ k: 'move', t: round1(t), id: tank.id, y0: tank.y, y1: ground, dur: 220 });
        tank.y = ground;
      }
    }
  }

  private resolveDeaths(): void {
    for (const tank of this.tanks) {
      if (!tank.alive || tank.hp > 0) continue;
      const d = this.deathBy.get(tank.id) ?? { t: this.tick * MS_PER_TICK, by: this.lastHit.get(tank.id) ?? '' };
      tank.alive = false;
      tank.shield = 0;
      tank.shieldKind = '';
      this.events.push({ k: 'death', t: round1(d.t), id: tank.id, by: d.by });
      if (this.enemyOf(d.by, tank)) this.kills.push({ by: d.by, id: tank.id });
      this.quip('death', tank.id, d.t);
      const wreckTick = Math.max(this.tick + 1, Math.ceil(d.t / MS_PER_TICK)) + PHYS.wreckDelayTicks;
      const wx = tank.x;
      const wy = tank.y + TANK_GEOM.hitCenter - 2;
      this.pending.push({ tick: wreckTick, order: this.order++, run: () => this.explode(wx, wy, WRECK_BLAST, 'wreck', d.by) });
    }
  }

  explode(rawX: number, rawY: number, blast: BlastSpec, kind: BlastKind, owner: string, directId?: string): void {
    const t = this.tick * MS_PER_TICK;
    const x = round1(rawX);
    const y = round1(rawY);
    if (blast.radius > 0) {
      if (blast.terrain === 'crater') carveCircle(this.terrain, x, y, blast.radius);
      else if (blast.terrain === 'dirt') addDirt(this.terrain, x, y, blast.radius);
    }
    const ev: ShotEvent = { k: 'boom', t: round1(t), x, y, r: blast.radius, w: kind, terrain: blast.terrain, owner };
    if (directId) ev.direct = directId;
    this.events.push(ev);
    if (blast.damage > 0) {
      for (const tank of this.tanks) {
        if (!tank.alive || !this.canHurt(owner, tank)) continue;
        const dx = tank.x - x;
        const dy = tank.y + TANK_GEOM.hitCenter - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dmg = directId === tank.id ? blast.damage : blastDamage(blast, dist, TANK_GEOM.hitRadius);
        this.hurt(tank, dmg, t, 'blast', owner);
      }
    }
    if (blast.terrain !== 'none' && blast.radius > 0) this.settle(t, owner);
    this.resolveDeaths();
  }

  // --- projectiles ----------------------------------------------------------------

  private spawn(
    kind: ProjectileKind,
    owner: string,
    spec: WeaponSpec,
    blast: BlastSpec,
    blastKind: BlastKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts: { splits?: boolean; arming?: boolean; hops?: number } = {},
  ): Projectile {
    const t0 = this.tick * MS_PER_TICK;
    const path: ProjectilePath = { id: this.nextId++, kind, owner, t0, t1: t0, pts: [round1(x), round1(y)], end: 'fizzle' };
    const p: Projectile = {
      id: path.id,
      kind,
      owner,
      spec,
      blast,
      blastKind,
      x,
      y,
      vx,
      vy,
      startTick: this.tick,
      live: true,
      splits: Boolean(opts.splits),
      arming: Boolean(opts.arming),
      hops: opts.hops ?? 0,
      roll: 0,
      rollSpeed: 0,
      reversals: 0,
      deflectCool: 0,
      path,
    };
    this.projectiles.push(p);
    this.paths.push(path);
    return p;
  }

  private finish(p: Projectile, x: number, y: number, end: ProjectileEnd): void {
    p.live = false;
    p.x = x;
    p.y = y;
    p.path.end = end;
    p.path.t1 = this.tick * MS_PER_TICK;
    p.path.pts.push(round1(x), round1(y));
  }

  /** Continue a projectile from the opposite edge (wrap-around walls). */
  private wrap(p: Projectile, edgeX: number, y: number, newX: number): void {
    this.finish(p, edgeX, y, 'wrap');
    const q = this.spawn(p.kind, p.owner, p.spec, p.blast, p.blastKind, newX, y, p.vx, p.vy, { splits: p.splits, hops: p.hops });
    q.roll = p.roll;
    q.rollSpeed = p.rollSpeed;
    q.reversals = p.reversals;
  }

  launch(input: ShotInput): void {
    const shooter = this.tank(input.shooterId);
    if (!shooter || !shooter.alive) return;
    const spec = WEAPON_SPECS[input.weapon];
    const l = launchState(shooter, input.angle, input.power);
    const t0 = this.tick * MS_PER_TICK;
    this.launches.push({
      shooterId: shooter.id,
      weapon: input.weapon,
      angle: input.angle,
      power: input.power,
      origin: [round1(l.x), round1(l.y)],
      t0: round1(t0),
    });
    this.quip('fire', shooter.id, t0);
    if (spec.beam) {
      const ox = l.x;
      const oy = l.y;
      this.later(RAIL_CHARGE_TICKS, () => this.rail(shooter.id, spec, ox, oy, input.angle));
      return;
    }
    this.spawn(input.weapon, shooter.id, spec, spec.blast, input.weapon, l.x, l.y, l.vx, l.vy, {
      splits: spec.split?.at === 'apex',
      arming: true,
      hops: spec.hop?.hops ?? 0,
    });
  }

  meteor(x: number, vx: number): void {
    this.spawn('meteor', '', HAZARD_SPEC, METEOR_BLAST, 'meteor', x, TANKS_WORLD.height + 60, vx, -140);
  }

  lightning(x: number): void {
    const t = this.tick * MS_PER_TICK;
    const top = heightAt(this.terrain, x);
    if (!Number.isFinite(top)) return;
    const bx = round1(x);
    this.events.push({ k: 'beam', t: round1(t), x0: bx, y0: TANKS_WORLD.height + 40, x1: bx, y1: round1(top), w: 'lightning' });
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const dx = Math.abs(tank.x - x);
      if (dx <= LIGHTNING.reach) this.hurt(tank, Math.round(LIGHTNING.damage * (1 - dx / (LIGHTNING.reach + 8))), t, 'beam', '');
    }
    this.explode(x, top, { radius: LIGHTNING.crater, damage: 0, terrain: 'crater' }, 'lightning', '');
  }

  private nearestEnemy(owner: string, x: number): SimTank | null {
    let best: SimTank | null = null;
    let bestD = Infinity;
    for (const t of this.tanks) {
      if (!t.alive || !this.enemyOf(owner, t)) continue;
      const d = Math.abs(t.x - x);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private step(p: Projectile): void {
    if (p.roll !== 0) {
      this.rollStep(p);
      return;
    }
    const s = p.spec;
    p.vx += this.windAcc * s.windScale * PHYS.dt;
    p.vy -= this.g * PHYS.dt;
    if (s.seek && p.kind === 'seeker' && p.vy <= 0) {
      const target = this.nearestEnemy(p.owner, p.x);
      if (target) {
        const want = clamp((target.x - p.x) * 2.5, -s.seek.maxVx, s.seek.maxVx);
        p.vx += clamp(want - p.vx, -s.seek.accel * PHYS.dt, s.seek.accel * PHYS.dt);
      }
    }
    let nx = p.x + p.vx * PHYS.dt;
    let ny = p.y + p.vy * PHYS.dt;
    const dx = nx - p.x;
    const dy = ny - p.y;
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / PHYS.collideStep));
    const armed = !p.arming || this.tick - p.startTick >= PHYS.armTicks;
    const air = s.airburst && p.kind === 'airburst' ? s.airburst : null;
    const W = this.terrain.width;
    for (let k = 1; k <= n; k++) {
      const sx = p.x + (dx * k) / n;
      const sy = p.y + (dy * k) / n;
      if (sx < 0 || sx > W) {
        if (this.walls === 'concrete') {
          this.impact(p, sx < 0 ? 0 : W, sy, undefined);
          return;
        }
        if (this.walls === 'wrap') {
          this.wrap(p, sx < 0 ? 0 : W, sy, sx < 0 ? sx + W : sx - W);
          return;
        }
        if (this.walls === 'bounce') {
          // Mirror the rest of this step off the wall.
          p.vx = -p.vx * PHYS.wallBounce;
          nx = sx < 0 ? -sx : 2 * W - sx;
          ny = sy;
          p.arming = false;
          break;
        }
        if (sx < -PHYS.outMargin || sx > W + PHYS.outMargin) {
          this.finish(p, sx, sy, 'out');
          return;
        }
      }
      if (sy < -200) {
        this.finish(p, sx, sy, 'out');
        return;
      }
      let deflected = false;
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        const own = tank.id === p.owner && !armed;
        if (own) continue;
        const hx = sx - tank.x;
        const hy = sy - (tank.y + TANK_GEOM.hitCenter);
        const d2 = hx * hx + hy * hy;
        if (tank.shield > 0 && d2 <= this.shieldR2) {
          if (tank.shieldKind === 'deflector' && this.tick >= p.deflectCool) {
            const r = this.deflect(p, tank, sx, sy);
            nx = r.x;
            ny = r.y;
            deflected = true;
            break;
          }
          if (tank.shieldKind !== 'deflector') {
            this.impact(p, sx, sy, tank.id);
            return;
          }
        }
        if (d2 <= this.hitR2) {
          this.impact(p, sx, sy, tank.id);
          return;
        }
      }
      if (deflected) break;
      if (air) {
        const prox2 = air.proximity * air.proximity;
        for (const tank of this.tanks) {
          if (!tank.alive || !this.enemyOf(p.owner, tank)) continue;
          const hx = sx - tank.x;
          const hy = sy - (tank.y + TANK_GEOM.hitCenter);
          if (hx * hx + hy * hy <= prox2) {
            this.impact(p, sx, sy, undefined);
            return;
          }
        }
        const gnd = heightAt(this.terrain, sx);
        if (p.vy < 0 && Number.isFinite(gnd) && sy - gnd <= air.fuseHeight) {
          this.impact(p, sx, sy, undefined);
          return;
        }
      }
      if (sy <= heightAt(this.terrain, sx)) {
        this.impact(p, sx, sy, undefined);
        return;
      }
    }
    const prevVy = p.vy + this.g * PHYS.dt;
    p.x = nx;
    p.y = ny;
    if ((this.tick - p.startTick) % PHYS.sampleEvery === 0) p.path.pts.push(round1(p.x), round1(p.y));
    if (p.splits && prevVy > 0 && p.vy <= 0) this.splitApex(p);
    else if (this.tick - p.startTick >= PHYS.maxFlight / PHYS.dt) this.finish(p, p.x, p.y, 'fizzle');
  }

  /** Turn a projectile away off a deflector bubble; returns where it continues from. */
  private deflect(p: Projectile, tank: SimTank, sx: number, sy: number): { x: number; y: number } {
    const cx = tank.x;
    const cy = tank.y + TANK_GEOM.hitCenter;
    let nx = sx - cx;
    let ny = sy - cy;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len < 1e-6) {
      nx = 0;
      ny = 1;
    } else {
      nx /= len;
      ny /= len;
    }
    const dot = p.vx * nx + p.vy * ny;
    if (dot < 0) {
      p.vx -= 2 * dot * nx;
      p.vy -= 2 * dot * ny;
    }
    p.arming = false;
    p.deflectCool = this.tick + 8;
    const t = this.tick * MS_PER_TICK;
    this.events.push({ k: 'deflect', t: round1(t), id: tank.id, x: round1(sx), y: round1(sy) });
    const cost = Math.min(tank.shield, PHYS.deflectCost);
    tank.shield -= cost;
    if (tank.shield <= 0) {
      tank.shield = 0;
      tank.shieldKind = '';
    }
    this.events.push({ k: 'shield', t: round1(t), id: tank.id, hp: tank.shield, absorbed: cost });
    const out = TANK_GEOM.shieldRadius + 1.5;
    return { x: cx + nx * out, y: cy + ny * out };
  }

  /** Rolling along the surface: speeds up downhill, slows uphill, explodes when it settles or meets something. */
  private rollStep(p: Projectile): void {
    const t = this.terrain;
    const W = t.width;
    const dir = p.roll;
    const ahead = heightAt(t, p.x + dir * 2);
    const behind = heightAt(t, p.x - dir * 2);
    const slope = Number.isFinite(ahead) && Number.isFinite(behind) ? (ahead - behind) / 4 : 0;
    // Gravity along the slope, rolling resistance and a little drag (so it settles instead of see-sawing).
    p.rollSpeed += (-this.g * slope * 0.9 - 30 - 0.7 * p.rollSpeed) * PHYS.dt;
    if (p.rollSpeed <= 0) {
      // Came to a stop: at rest in a dip (or after rocking a few times) it goes off; on a slope it rolls back.
      if (Math.abs(slope) < 0.06 || p.reversals >= 3) {
        this.impact(p, p.x, p.y, undefined);
        return;
      }
      p.roll = dir === 1 ? -1 : 1;
      p.rollSpeed = -p.rollSpeed;
      p.reversals++;
    }
    const step = p.roll * p.rollSpeed * PHYS.dt;
    let nx = p.x + step;
    if (nx < 0 || nx > W) {
      if (this.walls === 'wrap') {
        this.wrap(p, nx < 0 ? 0 : W, p.y, nx < 0 ? nx + W : nx - W);
        return;
      }
      if (this.walls === 'bounce') {
        p.roll = p.roll === 1 ? -1 : 1;
        nx = nx < 0 ? -nx : 2 * W - nx;
      } else if (this.walls === 'concrete') {
        this.impact(p, nx < 0 ? 0 : W, p.y, undefined);
        return;
      } else {
        this.finish(p, nx, p.y, 'out');
        return;
      }
    }
    const surface = heightAt(t, nx);
    const prevSurface = p.y - 3;
    if (surface - prevSurface > 8) {
      // Ran into a cliff face.
      this.impact(p, p.x, p.y, undefined);
      return;
    }
    const ny = surface + 3;
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const hx = nx - tank.x;
      const hy = ny - (tank.y + TANK_GEOM.hitCenter);
      const d2 = hx * hx + hy * hy;
      if ((tank.shield > 0 && d2 <= this.shieldR2) || (Math.abs(hx) <= TANK_GEOM.halfWidth + 3 && Math.abs(hy) <= 18)) {
        this.impact(p, nx, ny, tank.id);
        return;
      }
    }
    p.x = nx;
    p.y = ny;
    if ((this.tick - p.startTick) % PHYS.sampleEvery === 0) p.path.pts.push(round1(p.x), round1(p.y));
    if (p.spec.roll && (this.tick - p.startTick) * MS_PER_TICK >= p.spec.roll.maxMs) this.impact(p, p.x, p.y, undefined);
  }

  private splitApex(p: Projectile): void {
    const sp = p.spec.split!;
    this.events.push({ k: 'split', t: this.ms(this.tick), x: round1(p.x), y: round1(p.y), w: p.spec.id });
    this.finish(p, p.x, p.y, 'split');
    const half = (sp.count - 1) / 2;
    for (let i = 0; i < sp.count; i++) {
      this.spawn(sp.kind, p.owner, p.spec, sp.sub, sp.kind, p.x, p.y, p.vx + (i - half) * sp.spread, p.vy);
    }
  }

  /** Throw sub-munitions out of an impact point (early cluster/MIRV burst, Party Popper). */
  private scatter(p: Projectile, x: number, y: number): void {
    const sp = p.spec.split!;
    const ground = heightAt(this.terrain, x);
    const sy = Math.max(y, Number.isFinite(ground) ? ground : y) + 4;
    const half = (sp.count - 1) / 2;
    for (let i = 0; i < sp.count; i++) {
      const vx = sp.random ? (this.rng.next() * 2 - 1) * sp.spread : (i - half) * sp.spread * 1.25;
      const vy = sp.random ? sp.popSpeed * (0.55 + this.rng.next() * 0.8) : sp.popSpeed;
      this.spawn(sp.kind, p.owner, p.spec, sp.sub, sp.kind, x, sy, vx, vy);
    }
  }

  private impact(p: Projectile, x: number, y: number, tankId: string | undefined): void {
    const s = p.spec;
    const main = p.kind === s.id;
    const owner = p.owner;
    if (main && s.split && (p.splits || s.split.at === 'impact')) {
      this.finish(p, x, y, 'boom');
      if (s.split.at === 'impact') this.events.push({ k: 'split', t: this.ms(this.tick), x: round1(x), y: round1(y), w: s.id });
      this.explode(x, y, s.blast, s.id, owner, tankId);
      this.scatter(p, x, y);
      return;
    }
    if (main && s.roll && !tankId && p.roll === 0) {
      this.finish(p, x, y, 'roll');
      const surface = heightAt(this.terrain, x);
      const gy = (Number.isFinite(surface) ? surface : y) + 3;
      const r = this.spawn('rolling', owner, s, s.blast, s.id, x, gy, 0, 0);
      const ahead = heightAt(this.terrain, x + 3);
      const behind = heightAt(this.terrain, x - 3);
      const downhill = Number.isFinite(ahead) && Number.isFinite(behind) && Math.abs(ahead - behind) > 1 ? (ahead < behind ? 1 : -1) : 0;
      r.roll = Math.abs(p.vx) > 25 || downhill === 0 ? (p.vx >= 0 ? 1 : -1) : downhill;
      r.rollSpeed = clamp(Math.abs(p.vx) * 0.45, 30, 220);
      return;
    }
    if (main && s.drill && !tankId) {
      this.finish(p, x, y, 'drill');
      this.bore(p, x, y);
      return;
    }
    if (main && s.fire) {
      this.finish(p, x, y, 'boom');
      this.explode(x, y, s.blast, s.id, owner, tankId);
      this.burn(x, owner, s.fire);
      return;
    }
    if (main && s.mud) {
      this.finish(p, x, y, 'boom');
      this.explode(x, y, s.blast, s.id, owner, tankId);
      this.mudslide(x, owner, s.mud.volume);
      return;
    }
    if (main && s.lance) {
      this.finish(p, x, y, 'boom');
      this.strike(x, y, owner, s.lance);
      return;
    }
    if (main && s.warp) {
      const ok = !tankId && this.warpTo(owner, x);
      this.finish(p, x, y, ok ? 'warp' : 'fizzle');
      return;
    }
    if (main && s.id === 'excavator') {
      // The bowl sits above the impact point: it clears earth (and digs out a buried tank) without dropping you into a pit.
      this.finish(p, x, y, 'boom');
      this.explode(x, y + s.blast.radius * 0.55, s.blast, s.id, owner, tankId);
      return;
    }
    if (main && s.tracer) {
      this.finish(p, x, y, 'fizzle');
      return;
    }
    if ((main || p.kind === 'hop') && s.hop) {
      const more = p.hops > 0;
      this.finish(p, x, y, more ? 'hop' : 'boom');
      this.explode(x, y, s.blast, s.id, owner, tankId);
      if (more) {
        const ground = heightAt(this.terrain, x);
        const sy = Math.max(y, Number.isFinite(ground) ? ground : y) + 4;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) * s.hop.keep;
        const vy = Math.max(140, Math.abs(p.vy) * s.hop.keep, speed * 0.7);
        this.spawn('hop', owner, s, s.blast, s.id, x, sy, p.vx * s.hop.keep, vy, { hops: p.hops - 1 });
      }
      return;
    }
    this.finish(p, x, y, 'boom');
    this.explode(x, y, p.blast, p.blastKind, owner, tankId);
  }

  private bore(p: Projectile, x: number, y: number): void {
    const d = p.spec.drill!;
    let dx = p.vx;
    let dy = p.vy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    let ex = x;
    let ey = y;
    let direct: string | undefined;
    const steps = Math.ceil(d.length / 3);
    for (let s = 1; s <= steps; s++) {
      const nx = x + dx * Math.min(d.length, s * 3);
      const ny = y + dy * Math.min(d.length, s * 3);
      if (nx < 1 || nx > this.terrain.width - 1 || ny < TANKS_WORLD.bedrock + 6) break;
      ex = nx;
      ey = ny;
      const hit = this.tanks.find((t) => {
        if (!t.alive) return false;
        const hx = t.x - nx;
        const hy = t.y + TANK_GEOM.hitCenter - ny;
        return hx * hx + hy * hy <= this.hitR2;
      });
      if (hit) {
        direct = hit.id;
        break;
      }
    }
    const seg = { x0: round1(x), y0: round1(y), x1: round1(ex), y1: round1(ey) };
    carveCapsule(this.terrain, seg.x0, seg.y0, seg.x1, seg.y1, d.radius);
    this.events.push({ k: 'bore', t: this.ms(this.tick), ...seg, r: d.radius });
    this.settle(this.tick * MS_PER_TICK, p.owner);
    this.resolveDeaths();
    const boreLen = Math.sqrt((ex - x) * (ex - x) + (ey - y) * (ey - y));
    const delay = Math.max(1, Math.round(boreLen / d.speed / PHYS.dt));
    const owner = p.owner;
    const blast = p.blast;
    const kind = p.blastKind;
    this.later(delay, () => this.explode(ex, ey, blast, kind, owner, direct));
  }

  private burn(x: number, owner: string, fire: NonNullable<WeaponSpec['fire']>): void {
    const t = this.tick * MS_PER_TICK;
    const pool = pour(this.terrain, x, fire.volume, NAPALM_FLOW);
    const { x0, cells } = fireCells(pool);
    if (cells.length) this.events.push({ k: 'fire', t: round1(t), x0, cells, dur: fire.burnMs, hot: fire.hot });
    for (const tank of this.tanks) {
      if (!tank.alive || !this.canHurt(owner, tank)) continue;
      const total = Math.min(fire.damage, Math.round(heatUnder(pool, tank.x, TANK_GEOM.halfWidth) * BURN_PER_HEAT));
      if (total <= 0) continue;
      const base = Math.floor(total / BURN_PULSES.length);
      BURN_PULSES.forEach((f, i) => {
        const amount = base + (i === 0 ? total - base * BURN_PULSES.length : 0);
        if (amount <= 0) return;
        this.later(Math.round((f * fire.burnMs) / MS_PER_TICK), () => {
          this.hurt(tank, amount, this.tick * MS_PER_TICK, 'burn', owner);
          this.resolveDeaths();
        });
      });
    }
  }

  private mudslide(x: number, owner: string, volume: number): void {
    const t = this.tick * MS_PER_TICK;
    const pool = pour(this.terrain, x, volume, MUD_FLOW);
    const patch = setMud(this.terrain, pool);
    if (patch.h.length) this.events.push({ k: 'patch', t: round1(t), x0: patch.x0, h: patch.h });
    this.settle(t, owner);
    this.resolveDeaths();
  }

  private strike(x: number, y: number, owner: string, lance: NonNullable<WeaponSpec['lance']>): void {
    const bx = round1(x);
    this.events.push({ k: 'mark', t: this.ms(this.tick), x: bx, y: round1(y) });
    this.later(Math.round(lance.delayMs / MS_PER_TICK), () => {
      const t = this.tick * MS_PER_TICK;
      const top = heightAt(this.terrain, bx);
      if (!Number.isFinite(top)) return;
      const bottom = round1(Math.max(TANKS_WORLD.bedrock + 4, top - lance.depth));
      this.events.push({ k: 'beam', t: round1(t), x0: bx, y0: TANKS_WORLD.height + 40, x1: bx, y1: bottom, w: 'skylance' });
      const y0 = round1(top + 12);
      carveCapsule(this.terrain, bx, y0, bx, bottom, lance.radius);
      this.events.push({ k: 'bore', t: round1(t), x0: bx, y0, x1: bx, y1: bottom, r: lance.radius });
      for (const tank of this.tanks) {
        if (!tank.alive || !this.canHurt(owner, tank)) continue;
        const dx = Math.abs(tank.x - bx);
        if (dx <= lance.reach) this.hurt(tank, Math.round(lance.damage * (1 - dx / (lance.reach + 12))), t, 'beam', owner);
      }
      this.settle(t, owner);
      this.resolveDeaths();
    });
  }

  /** Move a Warp Shell's shooter to column x (clear of other tanks). */
  private warpTo(id: string, x: number): boolean {
    const tank = this.tank(id);
    if (!tank || !tank.alive) return false;
    const lo = TANK_GEOM.halfWidth + 4;
    const hi = this.terrain.width - TANK_GEOM.halfWidth - 4;
    if (x < lo || x > hi) return false;
    const clearAt = (cx: number) => this.tanks.every((o) => o === tank || !o.alive || Math.abs(o.x - cx) >= TANK_GEOM.halfWidth * 2 + 2);
    let tx = Math.round(x);
    if (!clearAt(tx)) {
      let found = false;
      for (let d = 4; d <= 48 && !found; d += 4) {
        for (const c of [tx - d, tx + d]) {
          if (c >= lo && c <= hi && clearAt(c)) {
            tx = c;
            found = true;
            break;
          }
        }
      }
      if (!found) return false;
    }
    const ty = restHeight(this.terrain, tx);
    const t = this.tick * MS_PER_TICK;
    this.events.push({ k: 'warp', t: round1(t), id, x0: tank.x, y0: tank.y, x1: tx, y1: ty });
    tank.x = tx;
    tank.y = ty;
    return true;
  }

  /** Railgun: a straight beam that pierces earth up to its limit and stops at the first tank or shield. */
  private rail(owner: string, spec: WeaponSpec, ox: number, oy: number, angle: number): void {
    const beam = spec.beam!;
    const shooter = this.tank(owner);
    if (!shooter || !shooter.alive) return;
    const t = this.tick * MS_PER_TICK;
    const W = this.terrain.width;
    let c = dcos(angle);
    const s = dsin(angle);
    let x = ox;
    let y = oy;
    let segX = x;
    let segY = y;
    let traveled = 0;
    let dug = 0;
    let bounces = 0;
    let wraps = 0;
    let under = heightAt(this.terrain, x) >= y;
    let boreX = x;
    let boreY = y;
    const beams: Array<[number, number, number, number]> = [];
    const bores: Array<[number, number, number, number]> = [];
    let hit: SimTank | null = null;
    let stopped = false;
    const STEP = 2;
    while (traveled < beam.range && !stopped) {
      let nx = x + c * STEP;
      const ny = y + s * STEP;
      traveled += STEP;
      if (nx < 0 || nx > W) {
        const edge = nx < 0 ? 0 : W;
        if (this.walls === 'bounce' && bounces < 2) {
          beams.push([segX, segY, edge, ny]);
          bounces++;
          c = -c;
          nx = edge;
          segX = nx;
          segY = ny;
        } else if (this.walls === 'wrap' && wraps < 1) {
          beams.push([segX, segY, edge, ny]);
          wraps++;
          nx = edge === 0 ? W : 0;
          segX = nx;
          segY = ny;
        } else {
          x = edge;
          y = ny;
          break;
        }
      }
      if (ny > TANKS_WORLD.height + 300 || ny < TANKS_WORLD.bedrock) {
        x = nx;
        y = ny;
        break;
      }
      for (const tank of this.tanks) {
        if (!tank.alive || tank.id === owner) continue;
        const hx = nx - tank.x;
        const hy = ny - (tank.y + TANK_GEOM.hitCenter);
        const d2 = hx * hx + hy * hy;
        if ((tank.shield > 0 && d2 <= this.shieldR2) || d2 <= this.hitR2) {
          hit = tank;
          break;
        }
      }
      x = nx;
      y = ny;
      if (hit) break;
      const inside = y <= heightAt(this.terrain, x);
      if (inside) {
        if (!under) {
          under = true;
          boreX = x;
          boreY = y;
        }
        dug += STEP;
        if (dug >= beam.pierce) stopped = true;
      } else if (under) {
        under = false;
        bores.push([boreX, boreY, x, y]);
      }
    }
    if (under) bores.push([boreX, boreY, x, y]);
    beams.push([segX, segY, x, y]);
    for (const [x0, y0, x1, y1] of beams)
      this.events.push({ k: 'beam', t: round1(t), x0: round1(x0), y0: round1(y0), x1: round1(x1), y1: round1(y1), w: 'railgun' });
    for (const [x0, y0, x1, y1] of bores) {
      const seg = { x0: round1(x0), y0: round1(y0), x1: round1(x1), y1: round1(y1) };
      carveCapsule(this.terrain, seg.x0, seg.y0, seg.x1, seg.y1, beam.radius);
      this.events.push({ k: 'bore', t: round1(t), ...seg, r: beam.radius });
    }
    if (hit) this.hurt(hit, beam.damage, t, 'beam', owner);
    const endsInGround = hit !== null || y <= heightAt(this.terrain, x) + 2;
    if (endsInGround && x >= 0 && x <= W) this.explode(x, y, spec.blast, 'railgun', owner, hit?.id);
    else {
      this.settle(t, owner);
      this.resolveDeaths();
    }
  }

  // --- main loop --------------------------------------------------------------------

  private runDue(): void {
    if (!this.pending.length) return;
    const due = this.pending.filter((e) => e.tick <= this.tick).sort((a, b) => a.tick - b.tick || a.order - b.order);
    if (!due.length) return;
    for (const e of due) this.pending.splice(this.pending.indexOf(e), 1);
    for (const e of due) e.run();
  }

  schedule(tick: number, run: () => void): void {
    this.pending.push({ tick, order: this.order++, run });
  }

  run(): void {
    this.tick = 0;
    this.runDue();
    while (this.tick < PHYS.maxTicks) {
      this.tick++;
      const count = this.projectiles.length;
      for (let i = 0; i < count; i++) {
        const p = this.projectiles[i]!;
        if (p.live) this.step(p);
      }
      this.runDue();
      if (this.pending.length === 0 && !this.projectiles.some((p) => p.live)) break;
    }
    for (const p of this.projectiles) if (p.live) this.finish(p, p.x, p.y, 'fizzle');
  }

  script(kind: ShotScript['kind'], wind: number): ShotScript {
    const events = this.events.sort((a, b) => a.t - b.t);
    let last = 900;
    for (const e of events) {
      if (e.k === 'boom' || e.k === 'bore') last = Math.max(last, e.t + 1100);
      else if (e.k === 'move') last = Math.max(last, e.t + e.dur + 500);
      else if (e.k === 'fire') last = Math.max(last, e.t + e.dur + 300);
      else if (e.k === 'beam') last = Math.max(last, e.t + 900);
      else if (e.k === 'quip') last = Math.max(last, e.t + 1200);
      else last = Math.max(last, e.t + 500);
    }
    for (const p of this.paths) last = Math.max(last, p.t1 + 700);
    return {
      seq: this.meta.seq,
      turnId: this.meta.turnId,
      kind,
      launches: this.launches,
      wind,
      projectiles: this.paths,
      events,
      durationMs: Math.round(Math.min(TANKS_TIMING.maxShotMs, last)),
      tanks: this.tanks.map((t) => ({ id: t.id, x: t.x, y: t.y, hp: t.hp, alive: t.alive, shield: t.shield, shieldKind: t.shieldKind })),
      damage: this.damage,
      kills: this.kills,
    };
  }
}

/**
 * Resolve one or more launches together (a single turn, or every locked-in shot of a volley).
 * MUTATES `world` (terrain + tanks) to the post-shot state and returns the script. The caller
 * has already validated turns, ammo and ranges. Volley launches leave `staggerMs` apart.
 */
export function resolveShots(world: SimWorld, inputs: ShotInput[], rules: ShotRules, meta: ScriptMeta = { seq: 0, turnId: 0 }): ShotScript {
  const sim = new Sim(world, rules, meta);
  const gap = Math.max(0, Math.round((meta.staggerMs ?? 0) / MS_PER_TICK));
  inputs.forEach((input, i) => sim.schedule(i * gap, () => sim.launch(input)));
  sim.run();
  return sim.script(meta.kind ?? (inputs.length > 1 ? 'volley' : 'shot'), world.wind);
}

/** Resolve one shot (convenience wrapper around resolveShots). */
export function resolveShot(world: SimWorld, input: ShotInput, rules: ShotRules, meta: ScriptMeta = { seq: 0, turnId: 0 }): ShotScript {
  return resolveShots(world, [input], rules, meta);
}

/** An environmental hazard: a meteor shower or lightning strikes. Nobody is credited. */
export function resolveHazard(
  world: SimWorld,
  hazard: HazardInput,
  rules: ShotRules,
  meta: ScriptMeta = { seq: 0, turnId: 0 },
): ShotScript {
  const sim = new Sim(world, rules, meta);
  const gap = Math.round(hazard.what === 'meteor' ? 380 / MS_PER_TICK : 520 / MS_PER_TICK);
  hazard.strikes.forEach((s, i) =>
    sim.schedule(i * gap, () => (hazard.what === 'meteor' ? sim.meteor(s.x, s.vx ?? 0) : sim.lightning(s.x))),
  );
  sim.run();
  return sim.script('hazard', world.wind);
}
