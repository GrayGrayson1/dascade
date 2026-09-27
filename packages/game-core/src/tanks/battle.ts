/**
 * Match-level rules for DAS Tanks: spawning, turn order (sides alternate; in teams mode
 * the two teams alternate and rotate through their members), wind, fuel, driving,
 * ammo, firing, eliminations, victory, round limits, forfeits and placements.
 *
 * Pure and deterministic: every random decision takes the injected Rng.
 */
import type { Rng } from '@dascade/shared';
import {
  ANGLE_MAX,
  ANGLE_MIN,
  POWER_MAX,
  POWER_MIN,
  TANKS_WORLD,
  TANK_GEOM,
  startingAmmo,
  type ArsenalId,
  type BattleTheme,
  type ConcreteTerrainStyle,
  type ShotScript,
  type TanksEndReason,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { flattenPad, generateTerrain, restHeight, TERRAIN_STYLE_LIST, type Terrain } from './terrain.ts';
import { resolveShot, type SimTank } from './sim.ts';

export interface BattleEntrant {
  id: string;
  name: string;
  color: string;
  /** Team index in teams mode (0/1); ignored in free-for-all. */
  team: number;
  /** Tournament "first" side: this entrant's side takes the first turn. */
  first?: boolean;
  /** Driven by the CPU gunner. */
  cpu?: boolean;
}

export interface BattleConfig {
  mode: 'ffa' | 'teams';
  style: ConcreteTerrainStyle | 'random';
  windMax: number;
  fuelPerTurn: number;
  armor: number;
  arsenal: ArsenalId;
  maxRounds: number;
  friendlyFire: boolean;
  theme: BattleTheme;
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
  ammo: Record<WeaponId, number>;
  kills: number;
  damage: number;
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
  terrain: Terrain;
  tanks: BattleTank[];
  wind: number;
  /** 1-based round of the current turn (0 before the first turn). */
  round: number;
  turnId: number;
  activeId: string | null;
  shotSeq: number;
  sides: Side[];
  sideIdx: number;
  /** Groups of tanks eliminated together, in order. */
  eliminations: string[][];
  result: BattleResult | null;
}

export type TurnResult =
  | { kind: 'turn'; activeId: string; round: number; wind: number; turnId: number }
  | { kind: 'round_limit' }
  | { kind: 'over' };

export type FireError = 'over' | 'not_your_turn' | 'dead' | 'no_ammo';

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
  for (const e of shuffle(entries.filter((x) => x.pick !== 0 && x.pick !== 1), rng)) {
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

export function createBattle(rng: Rng, entrants: BattleEntrant[], config: BattleConfig): Battle {
  if (entrants.length < 1) throw new Error('no entrants');
  const style: ConcreteTerrainStyle = config.style === 'random' ? TERRAIN_STYLE_LIST[rng.int(TERRAIN_STYLE_LIST.length)]! : config.style;
  const terrain = generateTerrain(rng, style);
  const teams = config.mode === 'teams';

  // Left-to-right placement.
  let lineup: BattleEntrant[];
  if (teams) {
    const a = shuffle(entrants.filter((e) => e.team === 0), rng);
    const b = shuffle(entrants.filter((e) => e.team !== 0), rng);
    lineup = rng.int(2) === 0 ? [...a, ...b] : [...b, ...a];
  } else {
    lineup = shuffle([...entrants], rng);
  }
  const xs = spawnXs(rng, lineup.length, terrain.width);
  const ammo = startingAmmo(config.arsenal);
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
      name: e.name,
      color: e.color,
      slot,
      gone: false,
      cpu: Boolean(e.cpu),
      angle: facingRight ? 50 : 130,
      power: 58,
      weapon: 'shell',
      fuel: 0,
      ammo: { ...ammo },
      kills: 0,
      damage: 0,
      shots: 0,
      hits: 0,
      place: 0,
    };
  });
  for (const t of tanks) t.y = restHeight(terrain, t.x);

  // Turn order.
  let sides: Side[];
  if (teams) {
    const byTeam = [0, 1].map((team) => ({
      key: team,
      members: shuffle(
        tanks.filter((t) => t.team === team).map((t) => t.id),
        rng,
      ),
      cursor: -1,
    }));
    const firstTeam = (() => {
      const first = entrants.find((e) => e.first);
      if (first) return first.team === 0 ? 0 : 1;
      return rng.int(2);
    })();
    sides = firstTeam === 0 ? byTeam : [byTeam[1]!, byTeam[0]!];
    sides = sides.filter((s) => s.members.length > 0);
  } else {
    const order = shuffle([...tanks], rng);
    const firstIdx = order.findIndex((t) => entrants.find((e) => e.id === t.id)?.first);
    if (firstIdx > 0) order.unshift(...order.splice(firstIdx, 1));
    sides = order.map((t) => ({ key: t.slot, members: [t.id], cursor: -1 }));
  }

  return {
    config,
    style,
    terrain,
    tanks,
    wind: 0,
    round: 0,
    turnId: 0,
    activeId: null,
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

/** Find the next (side, member) after the current turn without committing. */
function peekNext(b: Battle, sideIdx: number, cursors: number[], round: number): { sideIdx: number; member: number; round: number } | null {
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
    for (let k = 1; k <= m; k++) {
      const mi = (cursors[idx]! + k + m) % m;
      if (isAlive(b, side.members[mi]!)) return { sideIdx: idx, member: mi, round: r };
    }
  }
  return null;
}

/** Advance to the next turn: next side with a living tank, new wind, refuelled tank. */
export function nextTurn(b: Battle, rng: Rng): TurnResult {
  if (b.result) return { kind: 'over' };
  const next = peekNext(
    b,
    b.sideIdx,
    b.sides.map((s) => s.cursor),
    b.round,
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

/** The next `n` tanks to play after the current one (for the HUD). */
export function upcoming(b: Battle, n: number): string[] {
  const out: string[] = [];
  let sideIdx = b.sideIdx;
  const cursors = b.sides.map((s) => s.cursor);
  let round = b.round;
  for (let i = 0; i < n; i++) {
    const next = peekNext(b, sideIdx, cursors, round);
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

export function canAct(b: Battle, id: string): boolean {
  if (b.result || b.activeId !== id) return false;
  const t = tankById(b, id);
  return Boolean(t && t.alive);
}

/** Update the active tank's aim. Returns false (and changes nothing) if not allowed. */
export function setAim(b: Battle, id: string, angle: number, power: number, weapon: WeaponId): boolean {
  if (!canAct(b, id)) return false;
  const t = tankById(b, id)!;
  t.angle = clampInt(angle, ANGLE_MIN, ANGLE_MAX);
  t.power = clampInt(power, POWER_MIN, POWER_MAX);
  if (t.ammo[weapon] !== 0) t.weapon = weapon;
  return true;
}

export type DriveBlock = 'fuel' | 'edge' | 'steep' | 'cliff' | 'tank';

/** Maximum climb per unit driven. */
export const MAX_CLIMB = 1.6;
/** Maximum drop per unit driven (steeper and the tank refuses — no driving off cliffs). */
export const MAX_DROP = 4;

/**
 * Drive the active tank up to `step` units (unit by unit, following the ground). Stops early
 * at steep slopes, cliffs, the world edge or another tank. Costs fuel for what was driven.
 */
export function drive(b: Battle, id: string, dir: -1 | 1, step: number): { moved: number; blocked: DriveBlock | null } {
  if (!canAct(b, id)) return { moved: 0, blocked: null };
  const t = tankById(b, id)!;
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
    const bump = b.tanks.some((o) => o !== t && o.alive && Math.abs(o.x - nx) < TANK_GEOM.halfWidth * 2 - 2 && Math.abs(o.x - nx) < Math.abs(o.x - t.x));
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

/** Fire the active tank's weapon. Mutates the battle and returns the script (or why not). */
export function fire(b: Battle, id: string, angle: number, power: number, weapon: WeaponId): ShotScript | FireError {
  if (b.result) return 'over';
  if (b.activeId !== id) return 'not_your_turn';
  const t = tankById(b, id);
  if (!t || !t.alive) return 'dead';
  if (t.ammo[weapon] === 0) return 'no_ammo';
  t.angle = clampInt(angle, ANGLE_MIN, ANGLE_MAX);
  t.power = clampInt(power, POWER_MIN, POWER_MAX);
  t.weapon = weapon;
  if (t.ammo[weapon] > 0) t.ammo[weapon]--;
  t.shots++;
  b.shotSeq = (b.shotSeq + 1) & 0xffff;
  const aliveBefore = new Set(b.tanks.filter((x) => x.alive).map((x) => x.id));
  const script = resolveShot(
    { terrain: b.terrain, tanks: b.tanks, wind: b.wind },
    { shooterId: id, angle: t.angle, power: t.power, weapon },
    { teams: isTeams(b), friendlyFire: b.config.friendlyFire },
    { seq: b.shotSeq, turnId: b.turnId },
  );
  t.damage += script.damage;
  t.kills += script.kills.length;
  if (script.damage > 0) t.hits++;
  const died = b.tanks.filter((x) => aliveBefore.has(x.id) && !x.alive).map((x) => x.id);
  if (died.length) b.eliminations.push(died);
  // Weapon out of ammo → fall back to the unlimited shell for next time.
  if (t.ammo[t.weapon] === 0) t.weapon = 'shell';
  b.activeId = null;
  settleResult(b);
  return script;
}

/** A player left: their tank is scuttled (counts as eliminated now). */
export function abandon(b: Battle, id: string): boolean {
  const t = tankById(b, id);
  if (!t || t.gone) return false;
  t.gone = true;
  if (t.alive) {
    t.alive = false;
    b.eliminations.push([id]);
  }
  if (b.activeId === id) b.activeId = null;
  settleResult(b);
  return true;
}

/** Skip the active turn (timeout / absent player). */
export function skipTurn(b: Battle): void {
  b.activeId = null;
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
function groupByScore<T>(items: T[], score: (x: T) => number): T[][] {
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

