/**
 * The authoritative shot simulation. Given the world (terrain, tanks, wind) and one
 * player's aim, it flies every projectile with a fixed-step integrator, resolves
 * impacts, craters, dirt, bores, blast damage with falloff, falling tanks, deaths and
 * wreck chain reactions, mutates the world to the final result and returns a
 * `ShotScript` for clients to animate.
 *
 * Deterministic: same world + same input → same script, on every JS engine (only
 * + - * / sqrt floor round min max and the integer-degree direction table).
 */
import { TANK_GEOM, TANKS_TIMING, TANKS_WORLD, type BlastKind, type ProjectileEnd, type ProjectileKind, type ProjectilePath, type ShotEvent, type ShotScript, type WeaponId } from '@dascade/shared/games/tanks';
import { dcos, dsin } from './trig.ts';
import { addDirt, carveCapsule, carveCircle, heightAt, restHeight, type Terrain } from './terrain.ts';
import { PHYS, WEAPON_SPECS, WRECK_BLAST, blastDamage, fallDamage, fallDurationMs, type BlastSpec, type WeaponSpec } from './weapons.ts';

export interface SimTank {
  id: string;
  /** -1 in free-for-all. */
  team: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface SimWorld {
  terrain: Terrain;
  tanks: SimTank[];
  wind: number;
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

export interface ShotMeta {
  seq: number;
  turnId: number;
}

const MS_PER_TICK = PHYS.dt * 1000;

/** Barrel tip and muzzle velocity for an aim (integer degrees / power 0..100). */
export function launchState(tank: { x: number; y: number }, angle: number, power: number): { x: number; y: number; vx: number; vy: number } {
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
export function previewArc(tank: { x: number; y: number }, angle: number, power: number, seconds = 0.32, stepEvery = 4): number[] {
  const l = launchState(tank, angle, power);
  const pts: number[] = [l.x, l.y];
  const vx = l.vx;
  let { x, y, vy } = l;
  const ticks = Math.round(seconds / PHYS.dt);
  for (let i = 1; i <= ticks; i++) {
    vy -= PHYS.gravity * PHYS.dt;
    x += vx * PHYS.dt;
    y += vy * PHYS.dt;
    if (i % stepEvery === 0) pts.push(x, y);
  }
  return pts;
}

interface Projectile {
  id: number;
  kind: ProjectileKind;
  spec: WeaponSpec;
  blast: BlastSpec;
  blastKind: BlastKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  startTick: number;
  live: boolean;
  /** Cluster warhead still waiting for its apex. */
  splits: boolean;
  /** Main projectile: can't hit the shooter while arming. */
  arming: boolean;
  path: ProjectilePath;
}

interface Pending {
  tick: number;
  order: number;
  run: () => void;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Resolve one shot. MUTATES `world` (terrain + tanks) to the post-shot state and
 * returns the script. The caller has already validated turn, ammo and ranges.
 */
export function resolveShot(world: SimWorld, input: ShotInput, rules: ShotRules, meta: ShotMeta = { seq: 0, turnId: 0 }): ShotScript {
  const terrain = world.terrain;
  const tanks = world.tanks;
  const shooter = tanks.find((t) => t.id === input.shooterId);
  if (!shooter) throw new Error('unknown shooter');
  const spec = WEAPON_SPECS[input.weapon];
  const windAcc = PHYS.windAccel * world.wind;
  const hitR2 = TANK_GEOM.hitRadius * TANK_GEOM.hitRadius;

  const events: ShotEvent[] = [];
  const paths: ProjectilePath[] = [];
  const projectiles: Projectile[] = [];
  const pending: Pending[] = [];
  let pendingOrder = 0;
  let enemyDamage = 0;
  const kills: string[] = [];
  let tick = 0;
  let nextId = 0;

  const ms = (tk: number) => round1(tk * MS_PER_TICK);
  const isEnemy = (t: SimTank) => t.id !== shooter.id && (!rules.teams || t.team !== shooter.team);
  const canHurt = (t: SimTank) => !rules.teams || rules.friendlyFire || t.id === shooter.id || t.team !== shooter.team;

  const spawn = (kind: ProjectileKind, blast: BlastSpec, blastKind: BlastKind, x: number, y: number, vx: number, vy: number, splits: boolean, arming: boolean) => {
    const path: ProjectilePath = { id: nextId++, kind, t0: tick * MS_PER_TICK, t1: tick * MS_PER_TICK, pts: [round1(x), round1(y)], end: 'fizzle' };
    const p: Projectile = { id: path.id, kind, spec, blast, blastKind, x, y, vx, vy, startTick: tick, live: true, splits, arming, path };
    projectiles.push(p);
    paths.push(path);
    return p;
  };

  const finish = (p: Projectile, x: number, y: number, end: ProjectileEnd) => {
    p.live = false;
    p.x = x;
    p.y = y;
    p.path.end = end;
    p.path.t1 = tick * MS_PER_TICK;
    p.path.pts.push(round1(x), round1(y));
  };

  // --- damage, settling, deaths -------------------------------------------------
  const deathTimes = new Map<string, number>();

  const hurt = (tank: SimTank, amount: number, t: number, src: 'blast' | 'fall') => {
    if (!tank.alive || amount <= 0) return;
    const lost = Math.min(tank.hp, amount);
    if (lost <= 0) return;
    tank.hp -= lost;
    events.push({ k: 'dmg', t: round1(t), id: tank.id, amount: lost, hp: tank.hp, src });
    if (isEnemy(tank)) enemyDamage += lost;
    if (tank.hp <= 0 && !deathTimes.has(tank.id)) deathTimes.set(tank.id, t);
  };

  const settle = (t: number) => {
    for (const tank of tanks) {
      if (!tank.alive) continue;
      const ground = restHeight(terrain, tank.x);
      if (ground < tank.y - 0.01) {
        const drop = tank.y - ground;
        const dur = fallDurationMs(drop);
        events.push({ k: 'move', t: round1(t), id: tank.id, y0: tank.y, y1: ground, dur });
        tank.y = ground;
        if (canHurt(tank)) hurt(tank, fallDamage(drop), t + dur, 'fall');
      } else if (ground > tank.y + 0.01) {
        events.push({ k: 'move', t: round1(t), id: tank.id, y0: tank.y, y1: ground, dur: 220 });
        tank.y = ground;
      }
    }
  };

  const resolveDeaths = () => {
    for (const tank of tanks) {
      if (!tank.alive || tank.hp > 0) continue;
      const t = deathTimes.get(tank.id) ?? tick * MS_PER_TICK;
      tank.alive = false;
      events.push({ k: 'death', t: round1(t), id: tank.id });
      if (isEnemy(tank)) kills.push(tank.id);
      const wreckTick = Math.max(tick + 1, Math.ceil(t / MS_PER_TICK)) + PHYS.wreckDelayTicks;
      const wx = tank.x;
      const wy = tank.y + TANK_GEOM.hitCenter - 2;
      pending.push({ tick: wreckTick, order: pendingOrder++, run: () => explode(wx, wy, WRECK_BLAST, 'wreck') });
    }
  };

  function explode(rawX: number, rawY: number, blast: BlastSpec, kind: BlastKind, directId?: string): void {
    const t = tick * MS_PER_TICK;
    // Terrain ops use the same rounded coordinates the script carries, so clients replay them bit-exactly.
    const x = round1(rawX);
    const y = round1(rawY);
    if (blast.terrain === 'crater') carveCircle(terrain, x, y, blast.radius);
    else if (blast.terrain === 'dirt') addDirt(terrain, x, y, blast.radius);
    const ev: ShotEvent = { k: 'boom', t: round1(t), x, y, r: blast.radius, w: kind, terrain: blast.terrain };
    if (directId) ev.direct = directId;
    events.push(ev);
    if (blast.damage > 0) {
      for (const tank of tanks) {
        if (!tank.alive || !canHurt(tank)) continue;
        const dx = tank.x - x;
        const dy = tank.y + TANK_GEOM.hitCenter - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dmg = directId === tank.id ? blast.damage : blastDamage(blast, dist, TANK_GEOM.hitRadius);
        hurt(tank, dmg, t, 'blast');
      }
    }
    if (blast.terrain !== 'none') settle(t);
    resolveDeaths();
  }

  const bore = (p: Projectile, x: number, y: number) => {
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
      if (nx < 1 || nx > terrain.width - 1 || ny < TANKS_WORLD.bedrock + 6) break;
      ex = nx;
      ey = ny;
      const hit = tanks.find((t) => {
        if (!t.alive) return false;
        const hx = t.x - nx;
        const hy = t.y + TANK_GEOM.hitCenter - ny;
        return hx * hx + hy * hy <= hitR2;
      });
      if (hit) {
        direct = hit.id;
        break;
      }
    }
    const seg = { x0: round1(x), y0: round1(y), x1: round1(ex), y1: round1(ey) };
    carveCapsule(terrain, seg.x0, seg.y0, seg.x1, seg.y1, d.radius);
    events.push({ k: 'bore', t: ms(tick), ...seg, r: d.radius });
    settle(tick * MS_PER_TICK);
    resolveDeaths();
    const boreLen = Math.sqrt((ex - x) * (ex - x) + (ey - y) * (ey - y));
    const delay = Math.max(1, Math.round(boreLen / d.speed / PHYS.dt));
    pending.push({ tick: tick + delay, order: pendingOrder++, run: () => explode(ex, ey, p.blast, p.blastKind, direct) });
  };

  const split = (p: Projectile) => {
    const c = p.spec.cluster!;
    events.push({ k: 'split', t: ms(tick), x: round1(p.x), y: round1(p.y) });
    finish(p, p.x, p.y, 'split');
    const half = (c.count - 1) / 2;
    for (let i = 0; i < c.count; i++) {
      spawn('bomblet', c.bomblet, 'bomblet', p.x, p.y, p.vx + (i - half) * c.spread, p.vy, false, false);
    }
  };

  const impact = (p: Projectile, x: number, y: number, tankId: string | undefined) => {
    if (p.splits && p.spec.cluster) {
      // Early burst: small blast, bomblets thrown out of the impact point.
      const c = p.spec.cluster;
      finish(p, x, y, 'boom');
      explode(x, y, c.impactBlast, input.weapon, tankId);
      const half = (c.count - 1) / 2;
      const ground = heightAt(terrain, x);
      const sy = Math.max(y, Number.isFinite(ground) ? ground : y) + 4;
      for (let i = 0; i < c.count; i++) spawn('bomblet', c.bomblet, 'bomblet', x, sy, (i - half) * c.spread * 1.25, c.popSpeed, false, false);
      return;
    }
    if (p.spec.drill && !tankId && p.kind === 'driller') {
      finish(p, x, y, 'drill');
      bore(p, x, y);
      return;
    }
    finish(p, x, y, 'boom');
    explode(x, y, p.blast, p.blastKind, tankId);
  };

  const step = (p: Projectile) => {
    p.vx += windAcc * p.spec.windScale * PHYS.dt;
    p.vy -= PHYS.gravity * PHYS.dt;
    const nx = p.x + p.vx * PHYS.dt;
    const ny = p.y + p.vy * PHYS.dt;
    const dx = nx - p.x;
    const dy = ny - p.y;
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / PHYS.collideStep));
    const armed = !p.arming || tick - p.startTick >= PHYS.armTicks;
    const air = p.spec.airburst && p.kind === 'airburst' ? p.spec.airburst : null;
    for (let k = 1; k <= n; k++) {
      const sx = p.x + (dx * k) / n;
      const sy = p.y + (dy * k) / n;
      if (sx < -PHYS.outMargin || sx > terrain.width + PHYS.outMargin || sy < -200) {
        finish(p, sx, sy, 'out');
        return;
      }
      for (const tank of tanks) {
        if (!tank.alive || (!armed && tank.id === shooter.id)) continue;
        const hx = sx - tank.x;
        const hy = sy - (tank.y + TANK_GEOM.hitCenter);
        if (hx * hx + hy * hy <= hitR2) {
          impact(p, sx, sy, tank.id);
          return;
        }
      }
      if (air) {
        const prox2 = air.proximity * air.proximity;
        for (const tank of tanks) {
          if (!tank.alive || !isEnemy(tank)) continue;
          const hx = sx - tank.x;
          const hy = sy - (tank.y + TANK_GEOM.hitCenter);
          if (hx * hx + hy * hy <= prox2) {
            impact(p, sx, sy, undefined);
            return;
          }
        }
        const g = heightAt(terrain, sx);
        if (p.vy < 0 && Number.isFinite(g) && sy - g <= air.fuseHeight) {
          impact(p, sx, sy, undefined);
          return;
        }
      }
      if (sy <= heightAt(terrain, sx)) {
        impact(p, sx, sy, undefined);
        return;
      }
    }
    const prevVy = p.vy + PHYS.gravity * PHYS.dt;
    p.x = nx;
    p.y = ny;
    if ((tick - p.startTick) % PHYS.sampleEvery === 0) p.path.pts.push(round1(p.x), round1(p.y));
    if (p.splits && prevVy > 0 && p.vy <= 0) split(p);
    else if (tick - p.startTick >= PHYS.maxFlight / PHYS.dt) finish(p, p.x, p.y, 'fizzle');
  };

  // --- launch -------------------------------------------------------------------
  const launch = launchState(shooter, input.angle, input.power);
  const mainKind: ProjectileKind = input.weapon;
  spawn(mainKind, spec.blast, input.weapon, launch.x, launch.y, launch.vx, launch.vy, Boolean(spec.cluster), true);

  while (tick < PHYS.maxTicks) {
    tick++;
    const count = projectiles.length;
    for (let i = 0; i < count; i++) {
      const p = projectiles[i]!;
      if (p.live) step(p);
    }
    if (pending.length) {
      const due = pending.filter((e) => e.tick <= tick).sort((a, b) => a.tick - b.tick || a.order - b.order);
      if (due.length) {
        for (const e of due) pending.splice(pending.indexOf(e), 1);
        for (const e of due) e.run();
      }
    }
    if (pending.length === 0 && !projectiles.some((p) => p.live)) break;
  }
  for (const p of projectiles) if (p.live) finish(p, p.x, p.y, 'fizzle');

  events.sort((a, b) => a.t - b.t);

  let lastBoom = 0;
  let lastMove = 0;
  let lastPath = 0;
  for (const e of events) {
    if (e.k === 'boom' || e.k === 'bore') lastBoom = Math.max(lastBoom, e.t);
    else if (e.k === 'move') lastMove = Math.max(lastMove, e.t + e.dur);
    else lastMove = Math.max(lastMove, e.t);
  }
  for (const p of paths) lastPath = Math.max(lastPath, p.t1);
  const durationMs = Math.round(Math.min(TANKS_TIMING.maxShotMs, Math.max(lastBoom + 1100, lastMove + 500, lastPath + 700, 900)));

  return {
    seq: meta.seq,
    turnId: meta.turnId,
    shooterId: shooter.id,
    weapon: input.weapon,
    angle: input.angle,
    power: input.power,
    wind: world.wind,
    origin: [round1(launch.x), round1(launch.y)],
    projectiles: paths,
    events,
    durationMs,
    tanks: tanks.map((t) => ({ id: t.id, x: t.x, y: t.y, hp: t.hp, alive: t.alive })),
    damage: enemyDamage,
    kills,
  };
}
