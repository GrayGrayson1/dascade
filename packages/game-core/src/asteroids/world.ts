/**
 * Asteroid Run — the authoritative world simulation (solo and co-op, 1–4 pilots).
 *
 * A wrap-around belt (1600 × 1000). Each 60 Hz tick:
 *   ships fly (see ship.ts) → bullets, rocks and drops drift → bullets hit rocks (rocks crack,
 *   split and may drop a power-up) → ships collide with rocks (the shield soaks the hit and the
 *   ship bounces; without enough shield the ship is lost) → pickups → wave flow.
 *
 * Rocks: stone (one hit per size), iron (armoured, several hits), crystal (splits three ways,
 * scores double, drops power-ups more often). Large → 2 medium → 2 small (crystal: 3).
 * Waves grow with the wave number and the number of pilots; clearing one pays a bonus and (in
 * co-op with revive on) brings downed pilots back with one ship.
 * The run ends when every pilot is out of ships at the same time.
 */
import type { Rng } from '@dascade/shared';
import type { PowerKind, RockKind } from '@dascade/shared/games/asteroids';
import { dirIndexOf, dirVec } from '../classics/shared/index.ts';
import { SHIP, WORLD, delta, f32, stepShipMotion, wrap, type BulletSpawn, type ShipMotion } from './ship.ts';

export type Difficulty = 'cadet' | 'pilot' | 'ace';

export interface AsteroidsRules {
  difficulty: Difficulty;
  lives: number;
  revive: boolean;
}

export const DIFFICULTY: Record<Difficulty, { speed: number; extra: number; damage: number; regen: number }> = {
  cadet: { speed: 0.82, extra: -1, damage: 0.8, regen: 1.35 },
  pilot: { speed: 1, extra: 0, damage: 1, regen: 1 },
  ace: { speed: 1.18, extra: 2, damage: 1.25, regen: 0.8 },
};

export const ROCK = {
  radius: [0, 17, 33, 56] as readonly number[],
  /** Base drift speed by size (units/tick). */
  speed: [0, 2.7, 1.9, 1.3] as readonly number[],
  points: {
    stone: [0, 100, 50, 20],
    iron: [0, 200, 120, 60],
    crystal: [0, 220, 110, 45],
  } as Record<RockKind, readonly number[]>,
  hp: {
    stone: [0, 1, 1, 1],
    iron: [0, 2, 3, 4],
    crystal: [0, 1, 1, 1],
  } as Record<RockKind, readonly number[]>,
  /** Shield cost of a collision by size. */
  damage: [0, 22, 34, 50] as readonly number[],
  dropChance: { stone: 0.045, iron: 0.09, crystal: 0.24 } as Record<RockKind, number>,
  maxRocks: 72,
} as const;

export const RULES = {
  shieldMax: 100,
  /** Shield regained per tick once regen starts. */
  shieldRegen: 0.1,
  /** Ticks after a hit before the shield recharges. */
  regenDelay: 100,
  respawnTicks: 120,
  invulnTicks: 150,
  /** Brief grace after a shield hit so one rock can't hit twice in a row. */
  bumpGrace: 18,
  interTicks: 150,
  waveBonus: 250,
  dropTtl: 600,
  powerTicks: 600,
  novaRadius: 300,
  maxLives: 5,
  pickupRadius: 34,
  /** Rocks spawn at least this far from any ship. */
  safeSpawn: 320,
} as const;

export interface Ship extends ShipMotion {
  slot: number;
  id: string;
  alive: boolean;
  lives: number;
  shield: number;
  regenIn: number;
  invuln: number;
  respawnIn: number;
  /** No ships left (may be revived in co-op). */
  out: boolean;
  /** Left the match for good. */
  retired: boolean;
  score: number;
  kills: number;
}

export interface Rock {
  id: number;
  kind: RockKind;
  size: number;
  hp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual spin (−3..3). */
  spin: number;
}

export interface Bullet {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Drop {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

export type WorldStatus = 'play' | 'intermission' | 'over';

export interface World {
  rules: AsteroidsRules;
  tick: number;
  status: WorldStatus;
  wave: number;
  /** Ticks left in the between-waves pause. */
  interLeft: number;
  ships: Ship[];
  rocks: Rock[];
  bullets: Bullet[];
  drops: Drop[];
  nextId: number;
  teamScore: number;
}

export type AsteroidsSimEvent =
  | { type: 'rock'; x: number; y: number; size: number; kind: RockKind; by: number; points: number; destroyed: boolean }
  | { type: 'ship-hit'; slot: number; x: number; y: number; shield: number }
  | { type: 'ship-down'; slot: number; x: number; y: number; lives: number }
  | { type: 'respawn'; slot: number }
  | { type: 'pickup'; slot: number; kind: PowerKind; x: number; y: number }
  | { type: 'nova'; slot: number; x: number; y: number }
  | { type: 'wave'; wave: number; bonus: number }
  | { type: 'revive'; slot: number }
  | { type: 'over' };

const START_SPOTS: ReadonlyArray<[number, number]> = [
  [WORLD.width / 2, WORLD.height / 2],
  [WORLD.width / 2 - 90, WORLD.height / 2 + 60],
  [WORLD.width / 2 + 90, WORLD.height / 2 + 60],
  [WORLD.width / 2, WORLD.height / 2 + 120],
];

function newShip(slot: number, id: string, lives: number): Ship {
  const [x, y] = START_SPOTS[slot % START_SPOTS.length]!;
  return {
    slot,
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    h: 0, // pointing along the belt (screen-up on portrait phones)
    cooldown: 0,
    shots: 0,
    spread: 0,
    rapid: 0,
    thrusting: false,
    alive: true,
    lives,
    shield: RULES.shieldMax,
    regenIn: 0,
    invuln: RULES.invulnTicks,
    respawnIn: 0,
    out: false,
    retired: false,
    score: 0,
    kills: 0,
  };
}

export function createWorld(rules: AsteroidsRules, ids: readonly string[], rng: Rng): World {
  const w: World = {
    rules: { ...rules, lives: Math.max(1, Math.min(RULES.maxLives, Math.floor(rules.lives))) },
    tick: 0,
    status: 'play',
    wave: 0,
    interLeft: 0,
    ships: ids.map((id, slot) => newShip(slot, id, Math.max(1, Math.min(RULES.maxLives, Math.floor(rules.lives))))),
    rocks: [],
    bullets: [],
    drops: [],
    nextId: 1,
    teamScore: 0,
  };
  startWave(w, 1, rng);
  return w;
}

function nextId(w: World): number {
  w.nextId = (w.nextId % 0xfffe) + 1;
  return w.nextId;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = delta(ax, bx, WORLD.width);
  const dy = delta(ay, by, WORLD.height);
  return dx * dx + dy * dy;
}

function activePilots(w: World): number {
  let n = 0;
  for (const s of w.ships) if (!s.retired) n++;
  return Math.max(1, n);
}

function waveFactor(wave: number): number {
  return Math.min(1.6, 1 + (wave - 1) * 0.05);
}

/** How many rocks (and of which kind) a wave opens with. */
export function waveRecipe(wave: number, pilots: number, difficulty: Difficulty): { count: number; crystals: number; irons: number } {
  const count = Math.max(2, Math.min(14, 3 + wave + Math.floor((Math.max(1, pilots) - 1) * 1.5) + DIFFICULTY[difficulty].extra));
  const crystals = wave >= 2 ? Math.min(3, Math.floor(wave / 2)) : 0;
  const irons = wave >= 3 ? Math.min(4, Math.floor((wave - 1) / 2)) : 0;
  return { count, crystals: Math.min(crystals, count), irons: Math.min(irons, Math.max(0, count - crystals)) };
}

function spawnPoint(w: World, rng: Rng): [number, number] {
  let best: [number, number] = [0, 0];
  let bestD = -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const edge = rng.int(2);
    const p: [number, number] = edge === 0 ? [rng.next() * WORLD.width, 0] : [0, rng.next() * WORLD.height];
    let minD = Infinity;
    for (const s of w.ships) if (s.alive) minD = Math.min(minD, dist2(p[0], p[1], s.x, s.y));
    if (minD >= RULES.safeSpawn * RULES.safeSpawn) return p;
    if (minD > bestD) {
      bestD = minD;
      best = p;
    }
  }
  return best;
}

function addRock(w: World, kind: RockKind, size: number, x: number, y: number, vx: number, vy: number, rng: Rng): void {
  if (w.rocks.length >= ROCK.maxRocks) return;
  w.rocks.push({ id: nextId(w), kind, size, hp: ROCK.hp[kind][size]!, x, y, vx, vy, spin: rng.int(7) - 3 });
}

function startWave(w: World, wave: number, rng: Rng): void {
  w.wave = wave;
  w.status = 'play';
  const { count, crystals, irons } = waveRecipe(wave, activePilots(w), w.rules.difficulty);
  const speedK = DIFFICULTY[w.rules.difficulty].speed * waveFactor(wave);
  for (let i = 0; i < count; i++) {
    const kind: RockKind = i < crystals ? 'crystal' : i < crystals + irons ? 'iron' : 'stone';
    const size = wave >= 5 && i % 4 === 3 ? 2 : 3;
    const [x, y] = spawnPoint(w, rng);
    const [dx, dy] = dirVec(rng.int(64));
    const sp = ROCK.speed[size]! * speedK * (0.8 + rng.next() * 0.4);
    addRock(w, kind, size, x, y, dx * sp, dy * sp, rng);
  }
}

function safeRespawn(w: World, rng: Rng): [number, number] {
  const clearOf = (x: number, y: number) => {
    let minD = Infinity;
    for (const r of w.rocks) minD = Math.min(minD, Math.sqrt(dist2(x, y, r.x, r.y)) - ROCK.radius[r.size]!);
    return minD;
  };
  let best: [number, number] = [WORLD.width / 2, WORLD.height / 2];
  let bestD = clearOf(best[0], best[1]);
  if (bestD >= 200) return best;
  for (let i = 0; i < 24; i++) {
    const p: [number, number] = [120 + rng.next() * (WORLD.width - 240), 120 + rng.next() * (WORLD.height - 240)];
    const d = clearOf(p[0], p[1]);
    if (d > bestD) {
      best = p;
      bestD = d;
    }
    if (d >= 220) break;
  }
  return best;
}

function placeShip(s: Ship, x: number, y: number): void {
  s.x = f32(x);
  s.y = f32(y);
  s.vx = 0;
  s.vy = 0;
  s.h = 0;
  s.alive = true;
  s.shield = RULES.shieldMax;
  s.regenIn = 0;
  s.invuln = RULES.invulnTicks;
  s.respawnIn = 0;
  s.cooldown = 0;
}

function award(w: World, slot: number, points: number): void {
  const s = w.ships[slot];
  if (!s || points <= 0) return;
  s.score += points;
  w.teamScore += points;
}

function rollDrop(w: World, r: Rock, rng: Rng): void {
  if (rng.next() >= ROCK.dropChance[r.kind]) return;
  const roll = rng.int(100);
  const kind: PowerKind = roll < 30 ? 'spread' : roll < 60 ? 'rapid' : roll < 85 ? 'shield' : roll < 95 ? 'nova' : 'life';
  const [dx, dy] = dirVec(rng.int(64));
  w.drops.push({ id: nextId(w), kind, x: r.x, y: r.y, vx: dx * 0.6, vy: dy * 0.6, ttl: RULES.dropTtl });
}

/** Hit a rock for `dmg`; destroyed rocks split, score and may drop. `dirIndex` is the hit direction (table units). */
function damageRock(w: World, idx: number, dmg: number, by: number, dirIndex: number, rng: Rng, events: AsteroidsSimEvent[]): void {
  const r = w.rocks[idx];
  if (!r) return;
  r.hp -= dmg;
  if (r.hp > 0) {
    events.push({ type: 'rock', x: r.x, y: r.y, size: r.size, kind: r.kind, by, points: 0, destroyed: false });
    return;
  }
  w.rocks.splice(idx, 1);
  const points = ROCK.points[r.kind][r.size]!;
  if (by >= 0) {
    award(w, by, points);
    const s = w.ships[by];
    if (s) s.kills++;
  }
  events.push({ type: 'rock', x: r.x, y: r.y, size: r.size, kind: r.kind, by, points: by >= 0 ? points : 0, destroyed: true });
  rollDrop(w, r, rng);
  if (r.size > 1) {
    const offsets = r.kind === 'crystal' ? [-21, 0, 21] : [-16, 16];
    const size = r.size - 1;
    const speedK = DIFFICULTY[w.rules.difficulty].speed * waveFactor(w.wave);
    for (const o of offsets) {
      const [dx, dy] = dirVec(dirIndex + o + (rng.int(5) - 2));
      const kick = ROCK.speed[size]! * speedK * (0.85 + rng.next() * 0.35);
      const off = ROCK.radius[size]! * 0.6;
      addRock(w, r.kind, size, wrap(r.x + dx * off, WORLD.width), wrap(r.y + dy * off, WORLD.height), r.vx * 0.5 + dx * kick, r.vy * 0.5 + dy * kick, rng);
    }
  }
}

function shipDown(s: Ship, events: AsteroidsSimEvent[]): void {
  s.alive = false;
  s.lives = Math.max(0, s.lives - 1);
  s.thrusting = false;
  s.spread = 0;
  s.rapid = 0;
  events.push({ type: 'ship-down', slot: s.slot, x: s.x, y: s.y, lives: s.lives });
  if (s.lives > 0) s.respawnIn = RULES.respawnTicks;
  else s.out = true;
}

function applyPickup(w: World, s: Ship, d: Drop, rng: Rng, events: AsteroidsSimEvent[]): void {
  events.push({ type: 'pickup', slot: s.slot, kind: d.kind, x: d.x, y: d.y });
  switch (d.kind) {
    case 'spread':
      s.spread = RULES.powerTicks;
      break;
    case 'rapid':
      s.rapid = RULES.powerTicks;
      break;
    case 'shield':
      s.shield = RULES.shieldMax;
      s.regenIn = 0;
      break;
    case 'life':
      s.lives = Math.min(RULES.maxLives, s.lives + 1);
      break;
    case 'nova': {
      events.push({ type: 'nova', slot: s.slot, x: s.x, y: s.y });
      const r2 = RULES.novaRadius * RULES.novaRadius;
      // Snapshot the targets first: damaged rocks split and new children must not be hit again.
      const targets = w.rocks.filter((r) => dist2(s.x, s.y, r.x, r.y) <= r2).map((r) => r.id);
      for (const id of targets) {
        const idx = w.rocks.findIndex((r) => r.id === id);
        if (idx < 0) continue;
        const r = w.rocks[idx]!;
        damageRock(w, idx, 2, s.slot, dirIndexOf(delta(s.x, r.x, WORLD.width), delta(s.y, r.y, WORLD.height)), rng, events);
      }
      break;
    }
  }
}

/** A pilot left for good: their ship leaves the belt. */
export function retireShip(w: World, slot: number): AsteroidsSimEvent[] {
  const s = w.ships[slot];
  if (!s || s.retired) return [];
  s.retired = true;
  s.alive = false;
  s.out = true;
  s.respawnIn = 0;
  const events: AsteroidsSimEvent[] = [];
  checkOver(w, events);
  return events;
}

function checkOver(w: World, events: AsteroidsSimEvent[]): void {
  if (w.status === 'over') return;
  const anyLeft = w.ships.some((s) => !s.retired && !s.out);
  if (!anyLeft) {
    w.status = 'over';
    w.bullets = [];
    events.push({ type: 'over' });
  }
}

/** Advance one tick. `frames[slot]` is each ship's control frame for this tick. */
export function stepWorld(w: World, frames: readonly number[], rng: Rng): { events: AsteroidsSimEvent[]; fired: BulletSpawn[] } {
  const events: AsteroidsSimEvent[] = [];
  const fired: BulletSpawn[] = [];
  if (w.status === 'over') return { events, fired };
  w.tick++;
  const diff = DIFFICULTY[w.rules.difficulty];

  // Ships.
  for (const s of w.ships) {
    if (s.retired) continue;
    if (!s.alive) {
      if (s.respawnIn > 0 && --s.respawnIn === 0) {
        const [x, y] = safeRespawn(w, rng);
        placeShip(s, x, y);
        events.push({ type: 'respawn', slot: s.slot });
      }
      continue;
    }
    if (s.invuln > 0) s.invuln--;
    if (s.regenIn > 0) s.regenIn--;
    else if (s.shield < RULES.shieldMax) s.shield = Math.min(RULES.shieldMax, s.shield + RULES.shieldRegen * diff.regen);
    const spawned = stepShipMotion(s, frames[s.slot] ?? 0, s.slot, true);
    for (const b of spawned) {
      w.bullets.push({ ...b, owner: s.slot, life: SHIP.bulletLife });
      fired.push(b);
    }
  }

  // Drift.
  for (const r of w.rocks) {
    r.x = wrap(r.x + r.vx, WORLD.width);
    r.y = wrap(r.y + r.vy, WORLD.height);
  }
  for (const d of w.drops) {
    d.x = wrap(d.x + d.vx, WORLD.width);
    d.y = wrap(d.y + d.vy, WORLD.height);
    d.ttl--;
  }
  w.drops = w.drops.filter((d) => d.ttl > 0);

  // Bullets vs rocks (two sub-steps so small rocks are never skipped).
  const survivors: Bullet[] = [];
  for (const b of w.bullets) {
    let hit = false;
    for (let sub = 0; sub < 2 && !hit; sub++) {
      b.x = wrap(b.x + b.vx / 2, WORLD.width);
      b.y = wrap(b.y + b.vy / 2, WORLD.height);
      for (let i = 0; i < w.rocks.length; i++) {
        const r = w.rocks[i]!;
        const rr = ROCK.radius[r.size]! + 3;
        if (dist2(b.x, b.y, r.x, r.y) <= rr * rr) {
          damageRock(w, i, 1, b.owner, dirIndexOf(b.vx, b.vy), rng, events);
          hit = true;
          break;
        }
      }
    }
    b.life--;
    if (!hit && b.life > 0) survivors.push(b);
  }
  w.bullets = survivors;

  // Ships vs rocks.
  for (const s of w.ships) {
    if (!s.alive || s.retired || s.invuln > 0) continue;
    for (let i = 0; i < w.rocks.length; i++) {
      const r = w.rocks[i]!;
      const reach = ROCK.radius[r.size]! + SHIP.radius * 0.8;
      const dx = delta(r.x, s.x, WORLD.width);
      const dy = delta(r.y, s.y, WORLD.height);
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      const cost = ROCK.damage[r.size]! * diff.damage * (r.kind === 'iron' ? 1.2 : 1);
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      if (s.shield >= cost) {
        s.shield -= cost;
        s.regenIn = RULES.regenDelay;
        s.invuln = RULES.bumpGrace;
        // Bounce off the rock and step clear of it.
        const vn = (s.vx - r.vx) * nx + (s.vy - r.vy) * ny;
        if (vn < 0) {
          s.vx -= 1.6 * vn * nx;
          s.vy -= 1.6 * vn * ny;
        }
        s.vx = f32(s.vx + nx * 1.5);
        s.vy = f32(s.vy + ny * 1.5);
        s.x = f32(wrap(r.x + nx * (reach + 1), WORLD.width));
        s.y = f32(wrap(r.y + ny * (reach + 1), WORLD.height));
        events.push({ type: 'ship-hit', slot: s.slot, x: s.x, y: s.y, shield: s.shield });
        damageRock(w, i, 1, s.slot, dirIndexOf(-nx, -ny), rng, events);
      } else {
        shipDown(s, events);
        damageRock(w, i, 1, s.slot, dirIndexOf(-nx, -ny), rng, events);
      }
      break;
    }
  }

  // Pickups.
  for (const s of w.ships) {
    if (!s.alive || s.retired) continue;
    const reach2 = RULES.pickupRadius * RULES.pickupRadius;
    for (let i = w.drops.length - 1; i >= 0; i--) {
      const d = w.drops[i]!;
      if (dist2(s.x, s.y, d.x, d.y) <= reach2) {
        w.drops.splice(i, 1);
        applyPickup(w, s, d, rng, events);
      }
    }
  }

  // Wave flow.
  if (w.status === 'play' && w.rocks.length === 0) {
    const bonus = RULES.waveBonus * w.wave;
    for (const s of w.ships) if (!s.retired && !s.out) award(w, s.slot, bonus);
    events.push({ type: 'wave', wave: w.wave, bonus });
    w.status = 'intermission';
    w.interLeft = RULES.interTicks;
  } else if (w.status === 'intermission' && --w.interLeft <= 0) {
    const coop = w.ships.length > 1;
    if (w.rules.revive && coop) {
      for (const s of w.ships) {
        if (s.retired || !s.out) continue;
        s.out = false;
        s.lives = 1;
        const [x, y] = safeRespawn(w, rng);
        placeShip(s, x, y);
        events.push({ type: 'revive', slot: s.slot });
      }
    }
    startWave(w, w.wave + 1, rng);
  }
  checkOver(w, events);
  return { events, fired };
}
