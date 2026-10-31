/**
 * Match-level rules for DAS Tanks: the fleet (every crew in the match — players and CPU
 * gunners), credits and the shop, inventories that carry over between battles, battle
 * earnings, the running score, the next battle's turn order (losers first) and the final
 * standings.
 *
 * Pure and deterministic: every random decision takes the injected Rng.
 */
import type { Rng } from '@dascade/shared';
import {
  EARNINGS,
  MAX_STOCK,
  SCORING,
  SHOP_IDS,
  STOCKED_LOADOUT,
  emptyAmmo,
  emptyItems,
  isItemId,
  shopInfo,
  type Ammo,
  type Economy,
  type Items,
  type Persona,
  type ShopId,
  type TanksEndReason,
} from '@dascade/shared/games/tanks';
import { groupByScore, tankById, type Battle, type BattleEntrant } from './battle.ts';

export interface Earnings {
  base: number;
  damage: number;
  kills: number;
  survive: number;
  win: number;
  penalty: number;
  total: number;
}

export interface FleetMember {
  id: string;
  name: string;
  color: string;
  /** Team index in teams mode, -1 in free-for-all. */
  team: number;
  cpu: boolean;
  persona: '' | Persona;
  credits: number;
  score: number;
  wins: number;
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  ammo: Ammo;
  items: Items;
  /** Shop: done shopping. */
  ready: boolean;
  /** Bundles bought during this shop visit (they can be sold back for a full refund). */
  basket: Map<ShopId, number>;
  /** Last battle. */
  earn: Earnings;
  battleScore: number;
  /** Final match place (0 = undecided). */
  place: number;
  /** Left the match. */
  gone: boolean;
}

export interface MatchConfig {
  battles: number;
  economy: Economy;
  startCredits: number;
  mode: 'ffa' | 'teams';
}

export interface MatchResult {
  reason: TanksEndReason;
  /** Winning team in teams mode, else -1. */
  winnerTeam: number;
  winners: string[];
  /** Ids grouped by place, best first. */
  placements: string[][];
}

export interface Match {
  config: MatchConfig;
  fleet: FleetMember[];
  /** 1-based number of the current battle (0 before the first). */
  battleNo: number;
  result: MatchResult | null;
}

export type ShopError = 'closed' | 'unknown' | 'credits' | 'full' | 'blocked' | 'not_in_basket';

const ZERO: Earnings = { base: 0, damage: 0, kills: 0, survive: 0, win: 0, penalty: 0, total: 0 };

export interface MatchMember {
  id: string;
  name: string;
  color: string;
  team: number;
  cpu?: boolean;
  persona?: '' | Persona;
}

export function createMatch(members: MatchMember[], config: MatchConfig): Match {
  const credits = config.economy === 'shop' ? config.startCredits : 0;
  return {
    config,
    battleNo: 0,
    result: null,
    fleet: members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      team: config.mode === 'teams' ? (m.team === 0 ? 0 : 1) : -1,
      cpu: Boolean(m.cpu),
      persona: m.persona ?? '',
      credits,
      score: 0,
      wins: 0,
      kills: 0,
      damage: 0,
      shots: 0,
      hits: 0,
      ammo: emptyAmmo(),
      items: emptyItems(),
      ready: false,
      basket: new Map(),
      earn: { ...ZERO },
      battleScore: 0,
      place: 0,
      gone: false,
    })),
  };
}

export function fleetMember(m: Match, id: string): FleetMember | undefined {
  return m.fleet.find((f) => f.id === id);
}

function setStock(f: FleetMember, id: ShopId, n: number): void {
  if (isItemId(id)) f.items[id] = n;
  else f.ammo[id] = n;
}

export function stockOf(f: FleetMember, id: ShopId): number {
  return isItemId(id) ? f.items[id] : f.ammo[id];
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

/**
 * Start the next battle: bump the battle number, hand out the stocked loadout (or nothing but
 * shells) when the economy isn't the shop, and return the crews still in the match as battle
 * entrants in turn order — lowest score first, ties in random order.
 */
export function prepareBattle(m: Match, rng: Rng): BattleEntrant[] {
  m.battleNo++;
  const active = m.fleet.filter((f) => !f.gone);
  for (const f of active) {
    if (m.config.economy === 'shop') continue;
    f.ammo = emptyAmmo();
    f.items = emptyItems();
    if (m.config.economy === 'stocked')
      for (const [id, n] of Object.entries(STOCKED_LOADOUT) as Array<[ShopId, number]>) setStock(f, id, n);
  }
  const order = shuffle([...active], rng).sort((a, b) => a.score - b.score);
  return order.map((f) => ({ id: f.id, name: f.name, color: f.color, team: f.team, cpu: f.cpu, ammo: f.ammo, items: f.items }));
}

/** The cheapest thing in the shop. */
export const CHEAPEST_PRICE = Math.min(...SHOP_IDS.map((id) => shopInfo(id).price));

/** Whether the shop opens before the next battle (shop economy, and somebody can afford something). */
export function shopOpens(m: Match): boolean {
  return m.config.economy === 'shop' && m.fleet.some((f) => !f.gone && f.credits >= CHEAPEST_PRICE);
}

export function openShop(m: Match): void {
  for (const f of m.fleet) {
    f.ready = f.gone;
    f.basket.clear();
  }
}

/** Buy one bundle. `blocked` lists things this battle can't use (e.g. fuel with driving off). */
export function buy(m: Match, id: string, item: ShopId, blocked: ReadonlySet<ShopId> = new Set()): ShopError | null {
  if (m.config.economy !== 'shop') return 'closed';
  const f = fleetMember(m, id);
  if (!f || f.gone) return 'unknown';
  if (blocked.has(item)) return 'blocked';
  const info = shopInfo(item);
  if (info.price <= 0 || info.bundle <= 0) return 'unknown';
  if (f.credits < info.price) return 'credits';
  const have = stockOf(f, item);
  if (have + info.bundle > MAX_STOCK) return 'full';
  f.credits -= info.price;
  setStock(f, item, have + info.bundle);
  f.basket.set(item, (f.basket.get(item) ?? 0) + 1);
  return null;
}

/** Sell back one bundle bought during this shop visit (full refund). */
export function sell(m: Match, id: string, item: ShopId): ShopError | null {
  if (m.config.economy !== 'shop') return 'closed';
  const f = fleetMember(m, id);
  if (!f || f.gone) return 'unknown';
  const n = f.basket.get(item) ?? 0;
  const info = shopInfo(item);
  if (n <= 0 || stockOf(f, item) < info.bundle) return 'not_in_basket';
  f.credits += info.price;
  setStock(f, item, stockOf(f, item) - info.bundle);
  if (n === 1) f.basket.delete(item);
  else f.basket.set(item, n - 1);
  return null;
}

export function setReady(m: Match, id: string, ready: boolean): boolean {
  const f = fleetMember(m, id);
  if (!f || f.gone) return false;
  f.ready = ready;
  return true;
}

/** Every crew still in the match whose player is at the controls is done shopping (CPU crews shop instantly). */
export function allReady(m: Match, present: (id: string) => boolean): boolean {
  return m.fleet.every((f) => f.gone || f.cpu || f.ready || !present(f.id));
}

/** "id:n,id:n" — the basket as the schema carries it. */
export function basketString(f: FleetMember): string {
  return [...f.basket.entries()].map(([id, n]) => `${id}:${n}`).join(',');
}

/**
 * Book a decided battle: credits (shop economy) and score for every crew that fought, battle
 * wins, and the career totals. Returns each crew's earnings.
 */
export function settleBattle(m: Match, b: Battle): Map<string, Earnings> {
  const out = new Map<string, Earnings>();
  const result = b.result;
  if (!result) return out;
  const draw = result.reason === 'draw';
  const winners = new Set(result.winners);
  const teams = b.config.mode === 'teams';
  for (const f of m.fleet) {
    const t = tankById(b, f.id);
    if (!t) {
      f.earn = { ...ZERO };
      f.battleScore = 0;
      continue;
    }
    const won = winners.has(t.id) && !draw;
    const earn: Earnings = {
      base: f.gone ? 0 : EARNINGS.base,
      damage: t.damage * EARNINGS.perDamage,
      kills: t.kills * EARNINGS.perKill,
      survive: t.alive ? EARNINGS.survive : 0,
      win: won ? EARNINGS.win : 0,
      penalty: t.teamDamage * EARNINGS.perTeamDamage + t.teamKills * EARNINGS.perKill,
      total: 0,
    };
    earn.total = Math.max(0, earn.base + earn.damage + earn.kills + earn.survive + earn.win - earn.penalty);
    let bonus = 0;
    if (teams) bonus = won ? SCORING.place[0]! : 0;
    else if (t.place >= 1 && t.place <= SCORING.place.length) bonus = SCORING.place[t.place - 1]!;
    const battleScore =
      t.damage * SCORING.perDamage +
      t.kills * SCORING.perKill +
      bonus -
      t.teamDamage * SCORING.perTeamDamage -
      t.teamKills * SCORING.perTeamKill;
    f.earn = earn;
    f.battleScore = battleScore;
    f.score += battleScore;
    f.kills += t.kills;
    f.damage += t.damage;
    f.shots += t.shots;
    f.hits += t.hits;
    if (won) f.wins++;
    if (m.config.economy === 'shop') f.credits += earn.total;
    out.set(f.id, earn);
  }
  return out;
}

/** Match standings: by score, then battle wins, then damage. */
export function standings(m: Match): FleetMember[] {
  return [...m.fleet].sort((a, b) => b.score - a.score || b.wins - a.wins || b.damage - a.damage);
}

/** Decide the match on points (teams: summed team score). Sets places and returns the result. */
export function finishMatch(m: Match): MatchResult {
  if (m.result) return m.result;
  let placements: string[][];
  let winnerTeam = -1;
  if (m.config.mode === 'teams') {
    const teams = [0, 1].filter((team) => m.fleet.some((f) => f.team === team));
    const total = (team: number) => m.fleet.filter((f) => f.team === team).reduce((s, f) => s + f.score, 0);
    const groups = groupByScore(teams, total);
    placements = groups.map((g) => g.flatMap((team) => m.fleet.filter((f) => f.team === team).map((f) => f.id)));
    if (groups[0]?.length === 1) winnerTeam = groups[0][0]!;
  } else {
    const key = (f: FleetMember) => f.score * 1e6 + f.wins * 1e3 + Math.min(999, f.damage);
    placements = groupByScore(m.fleet, key).map((g) => g.map((f) => f.id));
  }
  let place = 1;
  for (const group of placements) {
    for (const id of group) fleetMember(m, id)!.place = place;
    place += group.length;
  }
  const result: MatchResult = {
    reason: placements[0] && placements[0].length > 1 && placements.length === 1 ? 'draw' : 'points',
    winnerTeam,
    winners: placements[0] ?? [],
    placements,
  };
  m.result = result;
  return result;
}
