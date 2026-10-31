/**
 * Battle-level rules for DAS Tanks (one battlefield of a match): spawning, turn order (sides
 * alternate; in teams mode the two teams alternate and rotate through their members), volleys
 * (everyone aims at once, then every locked-in shot flies together), wind, fuel, driving,
 * items (shields, batteries, fuel cans; parachutes are spent by the simulation), firing,
 * hazards, eliminations, victory, round limits, forfeits and placements.
 *
 * Each tank spends from its crew's inventory (`ammo` / `items` are the match fleet's objects,
 * shared by reference), so whatever is left carries over to the next battle.
 *
 * Pure and deterministic: every random decision takes the injected Rng.
 */
import type { Rng } from '@dascade/shared';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  BATTERY_HP,
  FUEL_CAN,
  GRAVITY_SCALE,
  POWER_MAX,
  POWER_MIN,
  SHIELD_HP,
  TANKS_WORLD,
  TANK_GEOM,
  type Ammo,
  type BattleTheme,
  type ConcreteTerrainStyle,
  type ConcreteWallMode,
  type GravityLevel,
  type Items,
  type ShotScript,
  type TalkLevel,
  type TanksEndReason,
  type TurnMode,
  type UsableItemId,
  type WallMode,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { flattenPad, generateTerrain, isBuried, restHeight, TERRAIN_STYLE_LIST, type Terrain } from './terrain.ts';
import { resolveHazard, resolveShots, type ShotInput, type ShotRules, type SimTank, type SimWorld } from './sim.ts';
import { pickQuip } from './talk.ts';

export interface BattleEntrant {
  id: string;
  name: string;
  color: string;
  /** Team index in teams mode (0/1); ignored in free-for-all. */
  team: number;
  /** This entrant's side takes the first turn. */
  first?: boolean;
  /** Driven by the CPU gunner. */
  cpu?: boolean;
  /** The crew's inventory — the battle spends from these very objects. */
  ammo: Ammo;
  items: Items;
}

export interface BattleConfig {
  mode: 'ffa' | 'teams';
  turnMode: TurnMode;
  style: ConcreteTerrainStyle | 'random';
  walls: WallMode;
  gravity: GravityLevel;
  windMax: number;
  fuelPerTurn: number;
  armor: number;
  maxRounds: number;
  friendlyFire: boolean;
  theme: BattleTheme;
  talk: TalkLevel;
  /** 'given': entrants arrive in turn order (losers first); 'shuffle': random order. */
  order: 'given' | 'shuffle';
}

export interface BattleTank extends SimTank {
  name: string;
  color: string;
  slot: number;
  maxHp: number;
  /** Player left the match; the tank was scuttled. */
  gone: boolean;
  cpu: boolean;
  angle: number;
  power: number;
  weapon: WeaponId;
  fuel: number;
  ammo: Ammo;
  items: Items;
  /** Volley mode: locked in for this volley. */
  locked: boolean;
  /** This battle. */
  kills: number;
  damage: number;
  teamDamage: number;
  teamKills: number;
  shots: number;
  hits: number;
  place: number;
}

interface Side {
  /** Team index (teams mode) or the tank's slot (free-for-all). */
  key: number;
  members: string[];
  /** Index into members of the member who played last (-1 = none yet). */
  cursor: number;
}

export interface BattleResult {
  reason: TanksEndReason;
  /** Winning team in teams mode, else -1. */
  winnerTeam: number;
  winners: string[];
  /** Tank ids grouped by place, best first. */
  placements: string[][];
}

export interface Battle {
  config: BattleConfig;
  style: ConcreteTerrainStyle;
  walls: ConcreteWallMode;
  terrain: Terrain;
  tanks: BattleTank[];
  wind: number;
  /** 1-based round of the current turn/volley (0 before the first). */
  round: number;
  turnId: number;
  /** Turns mode: the tank taking its turn. */
  activeId: string | null;
  /** Volley mode: the tanks aiming in the current volley, and their locked-in shots. */
  acting: string[];
  volley: Map<string, ShotInput>;
  shotSeq: number;
  sides: Side[];
  sideIdx: number;
  /** Groups of tanks eliminated together, in order. */
  eliminations: string[][];
  result: BattleResult | null;
}

export type TurnResult =
  | { kind: 'turn'; activeId: string; round: number; wind: number; turnId: number }
  | { kind: 'volley'; ids: string[]; round: number; wind: number; turnId: number }
  | { kind: 'round_limit' }
  | { kind: 'over' };

export type FireError = 'over' | 'not_your_turn' | 'dead' | 'no_ammo' | 'locked';
export type ItemError = 'not_your_turn' | 'none_left' | 'full_armor' | 'no_driving';

/** Gap between the launches of a volley (ms) — everyone fires "at once", a beat apart. */
export const VOLLEY_STAGGER_MS = 160;

export function isTeams(b: Battle): boolean {
  return b.config.mode === 'teams';
}

export function tankById(b: Battle, id: string): BattleTank | undefined {
  return b.tanks.find((t) => t.id === id);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Spawn columns: evenly spread with a little jitter, never closer than 2 hull widths. */
export function spawnXs(rng: Rng, n: number, width: number = TANKS_WORLD.width): number[] {
  const margin = 80;
  const usable = width - margin * 2;
  const spacing = usable / Math.max(1, n);
  const jitter = Math.min(46, spacing * 0.22);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(Math.round(margin + spacing * (i + 0.5) + (rng.next() * 2 - 1) * jitter));
  return xs;
}

/**
 * Teams mode: keep every explicit pick (0/1) and deal the unpicked (-1) entries one at a
 * time to the smaller team (ties broken by the rng). Returns id → team.
 */
export function assignTeams(entries: Array<{ id: string; pick: number }>, rng: Rng): Map<string, number> {
  const out = new Map<string, number>();
  const size = [0, 0];
  for (const e of entries) {
    if (e.pick === 0 || e.pick === 1) {
      out.set(e.id, e.pick);
      size[e.pick]!++;
    }
  }
  for (const e of shuffle(
    entries.filter((x) => x.pick !== 0 && x.pick !== 1),
    rng,
  )) {
    const team = size[0]! < size[1]! ? 0 : size[1]! < size[0]! ? 1 : rng.int(2);
    out.set(e.id, team);
    size[team]!++;
  }
  return out;
}

/** Next wind: a random walk that keeps some memory of the previous turn. */
export function nextWind(rng: Rng, prev: number, max: number): number {
  if (max <= 0) return 0;
  const raw = prev * 0.35 + (rng.next() * 2 - 1) * max;
  return clampInt(raw, -max, max);
}

const CONCRETE_WALLS: readonly ConcreteWallMode[] = ['open', 'wrap', 'bounce', 'concrete'];

export function createBattle(rng: Rng, entrants: BattleEntrant[], config: BattleConfig): Battle {
  if (entrants.length < 1) throw new Error('no entrants');
  const style: ConcreteTerrainStyle = config.style === 'random' ? TERRAIN_STYLE_LIST[rng.int(TERRAIN_STYLE_LIST.length)]! : config.style;
  const walls: ConcreteWallMode = config.walls === 'random' ? CONCRETE_WALLS[rng.int(CONCRETE_WALLS.length)]! : config.walls;
  const terrain = generateTerrain(rng, style);
  const teams = config.mode === 'teams';

  // Left-to-right placement (always random: nobody gets a favourite spot).
  let lineup: BattleEntrant[];
  if (teams) {
    const a = shuffle(
      entrants.filter((e) => e.team === 0),
      rng,
    );
    const b = shuffle(
      entrants.filter((e) => e.team !== 0),
      rng,
    );
    lineup = rng.int(2) === 0 ? [...a, ...b] : [...b, ...a];
  } else {
    lineup = shuffle([...entrants], rng);
  }
  const xs = spawnXs(rng, lineup.length, terrain.width);
  const tanks: BattleTank[] = lineup.map((e, slot) => {
    const x = xs[slot]!;
    flattenPad(terrain, x);
    const facingRight = x < terrain.width / 2;
    return {
      id: e.id,
      team: teams ? (e.team === 0 ? 0 : 1) : -1,
      x,
      y: 0,
      hp: config.armor,
      maxHp: config.armor,
      alive: true,
      shield: 0,
      shieldKind: '',
      chutes: e.items.parachute,
      name: e.name,
      color: e.color,
      slot,
      gone: false,
      cpu: Boolean(e.cpu),
      angle: facingRight ? 50 : 130,
      power: 58,
      weapon: 'shell',
      fuel: 0,
      ammo: e.ammo,
      items: e.items,
      locked: false,
      kills: 0,
      damage: 0,
      teamDamage: 0,
      teamKills: 0,
      shots: 0,
      hits: 0,
      place: 0,
    };
  });
  for (const t of tanks) t.y = restHeight(terrain, t.x);

  // Turn order.
  let sides: Side[];
  if (teams) {
    const byTeam = [0, 1].map((team) => {
      const ids = entrants.filter((e) => (e.team === 0 ? 0 : 1) === team).map((e) => e.id);
      return { key: team, members: config.order === 'shuffle' ? shuffle(ids, rng) : ids, cursor: -1 };
    });
    const firstTeam = (() => {
      const first = entrants.find((e) => e.first);
      if (first) return first.team === 0 ? 0 : 1;
      if (config.order === 'given') return entrants[0]!.team === 0 ? 0 : 1;
      return rng.int(2);
    })();
    sides = firstTeam === 0 ? byTeam : [byTeam[1]!, byTeam[0]!];
    sides = sides.filter((s) => s.members.length > 0);
  } else {
    const order = config.order === 'shuffle' ? shuffle([...entrants], rng) : [...entrants];
    const firstIdx = order.findIndex((e) => e.first);
    if (firstIdx > 0) order.unshift(...order.splice(firstIdx, 1));
    sides = order.map((e) => ({ key: tanks.find((t) => t.id === e.id)!.slot, members: [e.id], cursor: -1 }));
  }

  return {
    config,
    style,
    walls,
    terrain,
    tanks,
    wind: 0,
    round: 0,
    turnId: 0,
    activeId: null,
    acting: [],
    volley: new Map(),
    shotSeq: 0,
    sides,
    sideIdx: sides.length - 1,
    eliminations: [],
    result: null,
  };
}

function isAlive(b: Battle, id: string): boolean {
  const t = tankById(b, id);
  return Boolean(t && t.alive);
}

/** Whether a tank's crew is at the controls (the room passes presence; CPU tanks always are). */
export type PresentFn = (id: string) => boolean;

const EVERYONE: PresentFn = () => true;

/**
 * Find the next (side, member) after the current turn without committing. Within a side the next
 * living tank whose crew is present is preferred, so an absent teammate never burns the team's
 * turn; a side with nobody present still gets its turn (the room skips it quickly).
 */
function peekNext(
  b: Battle,
  sideIdx: number,
  cursors: number[],
  round: number,
  present: PresentFn = EVERYONE,
): { sideIdx: number; member: number; round: number } | null {
  let idx = sideIdx;
  let r = round;
  for (let n = 0; n < b.sides.length; n++) {
    idx++;
    if (idx >= b.sides.length) {
      idx = 0;
      r++;
    }
    const side = b.sides[idx]!;
    const m = side.members.length;
    let fallback = -1;
    for (let k = 1; k <= m; k++) {
      const mi = (cursors[idx]! + k + m) % m;
      const id = side.members[mi]!;
      if (!isAlive(b, id)) continue;
      if (present(id)) return { sideIdx: idx, member: mi, round: r };
      if (fallback < 0) fallback = mi;
    }
    if (fallback >= 0) return { sideIdx: idx, member: fallback, round: r };
  }
  return null;
}

/** Turns mode: advance to the next turn — next side with a living tank (present crews first), new wind, refuelled tank. */
export function nextTurn(b: Battle, rng: Rng, present: PresentFn = EVERYONE): TurnResult {
  if (b.result) return { kind: 'over' };
  const next = peekNext(
    b,
    b.sideIdx,
    b.sides.map((s) => s.cursor),
    b.round,
    present,
  );
  if (!next) return { kind: 'over' };
  if (next.round > b.config.maxRounds) return { kind: 'round_limit' };
  b.sideIdx = next.sideIdx;
  const side = b.sides[next.sideIdx]!;
  side.cursor = next.member;
  b.round = next.round;
  b.turnId = (b.turnId + 1) & 0xffff;
  b.activeId = side.members[next.member]!;
  b.wind = nextWind(rng, b.wind, b.config.windMax);
  const tank = tankById(b, b.activeId)!;
  tank.fuel = b.config.fuelPerTurn;
  return { kind: 'turn', activeId: b.activeId, round: b.round, wind: b.wind, turnId: b.turnId };
}

/** Volley mode: open the next volley — every living tank aims at once, with fresh wind and fuel. */
export function beginVolley(b: Battle, rng: Rng): TurnResult {
  if (b.result) return { kind: 'over' };
  if (b.round + 1 > b.config.maxRounds) return { kind: 'round_limit' };
  b.round++;
  b.turnId = (b.turnId + 1) & 0xffff;
  b.activeId = null;
  b.wind = nextWind(rng, b.wind, b.config.windMax);
  b.volley.clear();
  b.acting = b.tanks.filter((t) => t.alive).map((t) => t.id);
  for (const t of b.tanks) {
    t.locked = false;
    if (t.alive) t.fuel = b.config.fuelPerTurn;
  }
  return { kind: 'volley', ids: [...b.acting], round: b.round, wind: b.wind, turnId: b.turnId };
}

/** The next `n` tanks to play after the current one (turns mode, for the HUD). */
export function upcoming(b: Battle, n: number, present: PresentFn = EVERYONE): string[] {
  const out: string[] = [];
  let sideIdx = b.sideIdx;
  const cursors = b.sides.map((s) => s.cursor);
  let round = b.round;
  for (let i = 0; i < n; i++) {
    const next = peekNext(b, sideIdx, cursors, round, present);
    if (!next) break;
    const id = b.sides[next.sideIdx]!.members[next.member]!;
    if (out.length && id === out[0]) break;
    out.push(id);
    sideIdx = next.sideIdx;
    cursors[next.sideIdx] = next.member;
    round = next.round;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player intents
// ---------------------------------------------------------------------------

/** May this tank aim, drive, use items or fire right now? */
export function canAct(b: Battle, id: string): boolean {
  if (b.result) return false;
  const t = tankById(b, id);
  if (!t || !t.alive) return false;
  if (b.config.turnMode === 'volley') return b.acting.includes(id) && !t.locked;
  return b.activeId === id;
}

/** Update an acting tank's aim. Returns false (and changes nothing) if not allowed. */
export function setAim(b: Battle, id: string, angle: number, power: number, weapon: WeaponId): boolean {
  if (!canAct(b, id)) return false;
  const t = tankById(b, id)!;
  t.angle = clampInt(angle, ANGLE_MIN, ANGLE_MAX);
  t.power = clampInt(power, POWER_MIN, POWER_MAX);
  if (t.ammo[weapon] !== 0) t.weapon = weapon;
  return true;
}

export type DriveBlock = 'fuel' | 'edge' | 'steep' | 'cliff' | 'tank' | 'buried';

/** Maximum climb per unit driven. */
export const MAX_CLIMB = 1.6;
/** Maximum drop per unit driven (steeper and the tank refuses — no driving off cliffs). */
export const MAX_DROP = 4;

/**
 * Drive an acting tank up to `step` units (unit by unit, following the ground). Stops early
 * at steep slopes, cliffs, the world edge or another tank; buried tanks can't move. Costs fuel
 * for what was driven.
 */
export function drive(b: Battle, id: string, dir: -1 | 1, step: number): { moved: number; blocked: DriveBlock | null } {
  if (!canAct(b, id)) return { moved: 0, blocked: null };
  const t = tankById(b, id)!;
  if (isBuried(b.terrain, t.x, t.y)) return { moved: 0, blocked: 'buried' };
  const budget = Math.min(step, Math.floor(t.fuel));
  if (budget <= 0) return { moved: 0, blocked: 'fuel' };
  const lo = TANK_GEOM.halfWidth + 2;
  const hi = b.terrain.width - TANK_GEOM.halfWidth - 2;
  let moved = 0;
  let blocked: DriveBlock | null = null;
  for (let i = 0; i < budget; i++) {
    const nx = t.x + dir;
    if (nx < lo || nx > hi) {
      blocked = 'edge';
      break;
    }
    const ground = restHeight(b.terrain, nx);
    if (ground - t.y > MAX_CLIMB + 0.001) {
      blocked = 'steep';
      break;
    }
    if (t.y - ground > MAX_DROP + 0.001) {
      blocked = 'cliff';
      break;
    }
    const bump = b.tanks.some(
      (o) => o !== t && o.alive && Math.abs(o.x - nx) < TANK_GEOM.halfWidth * 2 - 2 && Math.abs(o.x - nx) < Math.abs(o.x - t.x),
    );
    if (bump) {
      blocked = 'tank';
      break;
    }
    t.x = nx;
    t.y = ground;
    moved++;
  }
  t.fuel = Math.max(0, t.fuel - moved);
  if (blocked === null && moved < step) blocked = 'fuel';
  return { moved, blocked };
}

/** Switch on an item from the crew's inventory. */
export function useItem(b: Battle, id: string, item: UsableItemId): ItemError | null {
  if (!canAct(b, id)) return 'not_your_turn';
  const t = tankById(b, id)!;
  if (t.items[item] <= 0) return 'none_left';
  if (item === 'battery') {
    if (t.hp >= t.maxHp) return 'full_armor';
    t.hp = Math.min(t.maxHp, t.hp + BATTERY_HP);
  } else if (item === 'fuel') {
    if (b.config.fuelPerTurn <= 0) return 'no_driving';
    t.fuel += FUEL_CAN;
  } else {
    // A new shield replaces whatever is left of the old one.
    t.shieldKind = item;
    t.shield = SHIELD_HP[item];
  }
  t.items[item]--;
  return null;
}

export interface ShotOptions {
  /** Seed for the script's random rolls. */
  seed: number;
  /** Speech bubbles (the battle's talk level picks how often). */
  rng?: Rng;
}

function world(b: Battle): SimWorld {
  return { terrain: b.terrain, tanks: b.tanks, wind: b.wind, walls: b.walls, gravity: GRAVITY_SCALE[b.config.gravity] };
}

function rules(b: Battle): ShotRules {
  return { teams: isTeams(b), friendlyFire: b.config.friendlyFire };
}

function quipFn(b: Battle, rng: Rng | undefined): ((kind: 'fire' | 'death', id: string) => string | null) | undefined {
  if (!rng || b.config.talk === 'off') return undefined;
  return (kind) => pickQuip(kind, b.config.talk, rng);
}

/** Run a script against the battle and book its results (stats, eliminations, the outcome). */
function play(b: Battle, run: () => ShotScript): ShotScript {
  for (const t of b.tanks) t.chutes = t.items.parachute;
  b.shotSeq = (b.shotSeq + 1) & 0xffff;
  const aliveBefore = new Set(b.tanks.filter((x) => x.alive).map((x) => x.id));
  const script = run();
  for (const t of b.tanks) t.items.parachute = t.chutes;
  for (const [by, dmg] of Object.entries(script.damage)) {
    const t = tankById(b, by);
    if (!t) continue;
    t.damage += dmg;
    if (dmg > 0) t.hits++;
  }
  for (const k of script.kills) {
    const t = tankById(b, k.by);
    if (t) t.kills++;
  }
  // Damage and kills on teammates (penalized by the match economy).
  if (isTeams(b)) {
    for (const e of script.events) {
      if (e.k === 'dmg' && e.by && e.by !== e.id) {
        const by = tankById(b, e.by);
        const victim = tankById(b, e.id);
        if (by && victim && by.team === victim.team) by.teamDamage += e.amount;
      } else if (e.k === 'death' && e.by && e.by !== e.id) {
        const by = tankById(b, e.by);
        const victim = tankById(b, e.id);
        if (by && victim && by.team === victim.team) by.teamKills++;
      }
    }
  }
  const died = b.tanks.filter((x) => aliveBefore.has(x.id) && !x.alive).map((x) => x.id);
  if (died.length) b.eliminations.push(died);
  settleResult(b);
  return script;
}

/** Spend one round of `weapon` (the shell is free). Falls back to the shell when the stock runs out. */
function spend(t: BattleTank, weapon: WeaponId): void {
  if (t.ammo[weapon] > 0) t.ammo[weapon]--;
  t.shots++;
  if (t.ammo[t.weapon] === 0) t.weapon = 'shell';
}

/** Turns mode: fire the active tank's weapon. Mutates the battle and returns the script (or why not). */
export function fire(
  b: Battle,
  id: string,
  angle: number,
  power: number,
  weapon: WeaponId,
  opts: ShotOptions = { seed: 0 },
): ShotScript | FireError {
  if (b.result) return 'over';
  // Volley shots are locked in with lock() and fly together in resolveVolley().
  if (b.config.turnMode === 'volley' || b.activeId !== id) return 'not_your_turn';
  const t = tankById(b, id);
  if (!t || !t.alive) return 'dead';
  if (t.ammo[weapon] === 0) return 'no_ammo';
  t.angle = clampInt(angle, ANGLE_MIN, ANGLE_MAX);
  t.power = clampInt(power, POWER_MIN, POWER_MAX);
  t.weapon = weapon;
  spend(t, weapon);
  b.activeId = null;
  return play(b, () =>
    resolveShots(world(b), [{ shooterId: id, angle: t.angle, power: t.power, weapon }], rules(b), {
      seq: b.shotSeq & 0xffff,
      turnId: b.turnId,
      kind: 'shot',
      seed: opts.seed,
      quip: quipFn(b, opts.rng),
    }),
  );
}

/** Volley mode: lock in a tank's shot for this volley. Returns null when locked, or why not. */
export function lock(b: Battle, id: string, angle: number, power: number, weapon: WeaponId): FireError | null {
  if (b.result) return 'over';
  const t = tankById(b, id);
  if (!t || !t.alive) return 'dead';
  if (!b.acting.includes(id)) return 'not_your_turn';
  if (t.locked) return 'locked';
  if (t.ammo[weapon] === 0) return 'no_ammo';
  t.angle = clampInt(angle, ANGLE_MIN, ANGLE_MAX);
  t.power = clampInt(power, POWER_MIN, POWER_MAX);
  t.weapon = weapon;
  t.locked = true;
  b.volley.set(id, { shooterId: id, angle: t.angle, power: t.power, weapon });
  return null;
}

/** Volley mode: every living tank whose crew is present has locked in. */
export function allLocked(b: Battle, present: PresentFn = EVERYONE): boolean {
  return b.acting.every((id) => {
    const t = tankById(b, id);
    return !t || !t.alive || t.locked || !present(id);
  });
}

/**
 * Volley mode: fire every locked-in shot together, in the battle's turn order (losers first),
 * a beat apart. Unlocked tanks hold fire this volley. Returns null when nobody locked in.
 */
export function resolveVolley(b: Battle, opts: ShotOptions = { seed: 0 }): ShotScript | null {
  if (b.result) return null;
  const order = b.sides.flatMap((s) => s.members);
  const inputs = order.map((id) => b.volley.get(id)).filter((x): x is ShotInput => Boolean(x));
  b.acting = [];
  b.volley.clear();
  for (const t of b.tanks) t.locked = false;
  if (!inputs.length) return null;
  for (const input of inputs) spend(tankById(b, input.shooterId)!, input.weapon);
  return play(b, () =>
    resolveShots(world(b), inputs, rules(b), {
      seq: b.shotSeq & 0xffff,
      turnId: b.turnId,
      kind: 'volley',
      seed: opts.seed,
      staggerMs: VOLLEY_STAGGER_MS,
      quip: quipFn(b, opts.rng),
    }),
  );
}

/** A hazard strikes: a meteor shower (1–3 rocks) or lightning (1–2 bolts near tanks). */
export function strikeHazard(b: Battle, rng: Rng, what: 'meteor' | 'lightning', opts: ShotOptions = { seed: 0 }): ShotScript {
  const W = b.terrain.width;
  const alive = b.tanks.filter((t) => t.alive);
  const strikes: Array<{ x: number; vx?: number }> = [];
  if (what === 'meteor') {
    const n = 1 + rng.int(3);
    for (let i = 0; i < n; i++) strikes.push({ x: 60 + rng.next() * (W - 120), vx: (rng.next() * 2 - 1) * 120 });
  } else {
    const n = 1 + rng.int(2);
    for (let i = 0; i < n; i++) {
      const near = alive.length ? alive[rng.int(alive.length)]! : null;
      const x = near ? near.x + (rng.next() * 2 - 1) * 46 : 60 + rng.next() * (W - 120);
      strikes.push({ x: Math.max(4, Math.min(W - 4, x)) });
    }
  }
  return play(b, () =>
    resolveHazard(world(b), { what, strikes }, rules(b), {
      seq: b.shotSeq & 0xffff,
      turnId: b.turnId,
      seed: opts.seed,
      quip: quipFn(b, opts.rng),
    }),
  );
}

/** A player left: their tank is scuttled (counts as eliminated now). */
export function abandon(b: Battle, id: string): boolean {
  const t = tankById(b, id);
  if (!t || t.gone) return false;
  t.gone = true;
  if (t.alive) {
    t.alive = false;
    t.shield = 0;
    t.shieldKind = '';
    b.eliminations.push([id]);
  }
  if (b.activeId === id) b.activeId = null;
  b.acting = b.acting.filter((x) => x !== id);
  b.volley.delete(id);
  settleResult(b);
  return true;
}

/** Skip the active turn (timeout / absent player). */
export function skipTurn(b: Battle): void {
  b.activeId = null;
}

/** Whether a tank sits buried under the current terrain. */
export function tankBuried(b: Battle, t: BattleTank): boolean {
  return t.alive && isBuried(b.terrain, t.x, t.y);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function sideKey(b: Battle, t: BattleTank): number {
  return isTeams(b) ? t.team : t.slot;
}

function aliveSideKeys(b: Battle, filter: (t: BattleTank) => boolean = () => true): Set<number> {
  return new Set(b.tanks.filter((t) => t.alive && filter(t)).map((t) => sideKey(b, t)));
}

/** Group entries by descending score (ties share a group). */
export function groupByScore<T>(items: T[], score: (x: T) => number): T[][] {
  const sorted = [...items].sort((a, c) => score(c) - score(a));
  const out: T[][] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && score(last[0]!) === score(x)) last.push(x);
    else out.push([x]);
  }
  return out;
}

function teamMembers(b: Battle, team: number): string[] {
  return b.tanks.filter((t) => t.team === team).map((t) => t.id);
}

function finalize(b: Battle, reason: TanksEndReason, placements: string[][]): BattleResult {
  const clean = placements.map((g) => g.filter(Boolean)).filter((g) => g.length > 0);
  const winners = clean[0] ?? [];
  let winnerTeam = -1;
  if (isTeams(b) && winners.length) {
    const teams = new Set(winners.map((id) => tankById(b, id)!.team));
    if (teams.size === 1) winnerTeam = [...teams][0]!;
  }
  let place = 1;
  for (const group of clean) {
    for (const id of group) tankById(b, id)!.place = place;
    place += group.length;
  }
  const result: BattleResult = { reason, winnerTeam, winners, placements: clean };
  b.result = result;
  b.activeId = null;
  b.acting = [];
  b.volley.clear();
  for (const t of b.tanks) t.locked = false;
  return result;
}

function eliminatedDescending(b: Battle, exclude: Set<string> = new Set()): string[][] {
  return [...b.eliminations].reverse().map((g) => g.filter((id) => !exclude.has(id)));
}

/** Rank the survivors (and in teams mode, whole teams) by remaining hit points. */
function rankByHp(b: Battle, reason: TanksEndReason): BattleResult {
  if (isTeams(b)) {
    const teams = [0, 1].filter((team) => b.tanks.some((t) => t.team === team));
    const hp = (team: number) => b.tanks.filter((t) => t.team === team && t.alive).reduce((s, t) => s + t.hp, 0);
    const groups = groupByScore(teams, hp).map((g) => g.flatMap((team) => teamMembers(b, team)));
    return finalize(b, groups.length === 1 && teams.length > 1 ? 'draw' : reason, groups);
  }
  const alive = b.tanks.filter((t) => t.alive);
  const groups = groupByScore(alive, (t) => t.hp).map((g) => g.map((t) => t.id));
  return finalize(b, reason, [...groups, ...eliminatedDescending(b)]);
}

/** Decide the battle if only one side (or none) is left. Sets and returns b.result. */
export function settleResult(b: Battle): BattleResult | null {
  if (b.result) return b.result;
  const sides = aliveSideKeys(b);
  if (sides.size >= 2) return null;
  if (isTeams(b)) {
    if (sides.size === 1) {
      const team = [...sides][0]!;
      return finalize(b, 'team_win', [teamMembers(b, team), teamMembers(b, team === 0 ? 1 : 0)]);
    }
    return finalize(b, 'draw', [b.tanks.map((t) => t.id)]);
  }
  if (sides.size === 1) {
    const winner = b.tanks.find((t) => t.alive)!;
    return finalize(b, 'last_standing', [[winner.id], ...eliminatedDescending(b)]);
  }
  // Mutual destruction: the last group eliminated shares first place.
  return finalize(b, 'draw', eliminatedDescending(b));
}

/** The round limit was reached: healthiest tank / team wins. */
export function endByRounds(b: Battle): BattleResult {
  return b.result ?? rankByHp(b, 'round_limit');
}

/**
 * Forfeit check: if every living tank that is still manned belongs to one side, that side
 * wins and the absent sides forfeit (listed last). With nobody present, rank by hit points.
 */
export function checkForfeit(b: Battle, present: (id: string) => boolean): BattleResult | null {
  if (b.result) return b.result;
  const all = aliveSideKeys(b);
  if (all.size < 2) return settleResult(b);
  const manned = aliveSideKeys(b, (t) => present(t.id));
  if (manned.size >= 2) return null;
  if (manned.size === 0) return rankByHp(b, 'forfeit');
  const key = [...manned][0]!;
  if (isTeams(b)) {
    return finalize(b, 'forfeit', [teamMembers(b, key), teamMembers(b, key === 0 ? 1 : 0)]);
  }
  const winner = b.tanks.find((t) => t.alive && t.slot === key)!;
  const absent = b.tanks.filter((t) => t.alive && t.id !== winner.id).map((t) => t.id);
  return finalize(b, 'forfeit', [[winner.id], ...eliminatedDescending(b), absent]);
}
