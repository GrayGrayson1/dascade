/**
 * CPU gunners. Each has a skill (how precisely it aims) and a persona (how it picks targets,
 * which weapons it likes, how it shops). To aim, it searches angle × power with the real shot
 * simulation on a scratch copy of the world — so it accounts for wind, gravity, walls, hills,
 * shields and splash — for a few candidate weapons, then adds skill-dependent aiming error.
 * Pure: all randomness comes from the injected Rng.
 */
import type { Rng } from '@dascade/shared';
import {
  GRAVITY_SCALE,
  POWER_MAX,
  POWER_MIN,
  shopInfo,
  type CpuSkill,
  type Persona,
  type ShopId,
  type UsableItemId,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { cloneTerrain, isBuried } from './terrain.ts';
import { resolveShot, type ShotRules, type SimWorld } from './sim.ts';
import { isTeams, tankById, type Battle, type BattleTank } from './battle.ts';
import { isHarmless } from './weapons.ts';
import type { FleetMember } from './match.ts';

export interface BotPlan {
  angle: number;
  power: number;
  weapon: WeaponId;
  targetId: string | null;
  /** Predicted score of the un-jittered shot (enemy damage minus own losses). */
  expected: number;
}

export interface BotContext {
  skill: CpuSkill;
  persona: Persona;
  /** Match scores, for bullies who chase the leader. */
  scores?: Record<string, number>;
}

/** Aiming error (± degrees / ± power) per skill. */
export const BOT_NOISE: Record<CpuSkill, { angle: number; power: number }> = {
  rookie: { angle: 8, power: 12 },
  veteran: { angle: 3, power: 6 },
  ace: { angle: 1, power: 2 },
};

const DEFAULT_ANGLES = [25, 35, 45, 55, 65, 76];
const PERSONA_ANGLES: Partial<Record<Persona, number[]>> = {
  lobber: [58, 64, 70, 76, 82],
  sniper: [16, 24, 32, 40, 48, 56],
};

/** Weapons each persona reaches for first (the shell is always a candidate). */
const WEAPON_TASTE: Record<Persona, WeaponId[]> = {
  gunner: ['heavy', 'cluster', 'mirv', 'roller', 'airburst', 'seeker'],
  lobber: ['mirv', 'napalm', 'hotnapalm', 'cluster', 'popper', 'leapfrog'],
  sniper: ['railgun', 'seeker', 'heavy', 'tonofdirt', 'skylance'],
  bully: ['mininuke', 'nuke', 'hotnapalm', 'napalm', 'heavy', 'skylance'],
  vulture: ['popper', 'cluster', 'airburst', 'leapfrog', 'roller'],
  hoarder: ['heavy', 'roller', 'dirtball', 'tonofdirt', 'mudslide'],
  maniac: ['nuke', 'mininuke', 'mirv', 'hotnapalm', 'heavyroller', 'napalm'],
  cyborg: ['mirv', 'seeker', 'railgun', 'heavy', 'hotnapalm', 'napalm', 'mininuke', 'popper', 'heavyroller', 'skylance', 'tonofdirt'],
};

/** What each persona buys, in priority order, up to the count it wants in stock. */
const SHOP_TASTE: Record<Persona, Array<[ShopId, number]>> = {
  gunner: [
    ['parachute', 3],
    ['shield', 1],
    ['heavy', 4],
    ['cluster', 3],
    ['battery', 2],
    ['mirv', 2],
    ['roller', 4],
    ['seeker', 2],
  ],
  lobber: [
    ['parachute', 3],
    ['mirv', 2],
    ['napalm', 3],
    ['cluster', 3],
    ['shield', 1],
    ['popper', 2],
    ['leapfrog', 3],
  ],
  sniper: [
    ['parachute', 3],
    ['railgun', 2],
    ['seeker', 2],
    ['deflector', 1],
    ['heavy', 4],
    ['tonofdirt', 2],
    ['skylance', 1],
  ],
  bully: [
    ['mininuke', 2],
    ['shield', 1],
    ['hotnapalm', 2],
    ['heavy', 4],
    ['parachute', 3],
    ['nuke', 1],
    ['skylance', 1],
  ],
  vulture: [
    ['popper', 2],
    ['cluster', 3],
    ['airburst', 3],
    ['battery', 2],
    ['leapfrog', 3],
    ['parachute', 3],
    ['roller', 4],
  ],
  hoarder: [
    ['heavyshield', 1],
    ['battery', 2],
    ['parachute', 3],
    ['excavator', 3],
    ['heavy', 4],
    ['dirtball', 3],
    ['tonofdirt', 2],
  ],
  maniac: [
    ['nuke', 1],
    ['mininuke', 2],
    ['mirv', 2],
    ['hotnapalm', 2],
    ['heavyroller', 3],
    ['napalm', 3],
  ],
  cyborg: [
    ['parachute', 3],
    ['heavyshield', 1],
    ['mirv', 2],
    ['seeker', 2],
    ['excavator', 3],
    ['heavy', 4],
    ['battery', 2],
    ['hotnapalm', 2],
    ['railgun', 2],
  ],
};

/** Upper bound on simulations per plan (keeps a CPU turn to a few tens of milliseconds). */
const SIM_BUDGET = 420;

interface Trial {
  score: number;
  landX: number;
}

function enemiesOf(b: Battle, bot: BattleTank): BattleTank[] {
  return b.tanks.filter((t) => t.alive && t.id !== bot.id && (!isTeams(b) || t.team !== bot.team));
}

class Planner {
  sims = 0;
  private readonly b: Battle;
  private readonly bot: BattleTank;
  private readonly rules: ShotRules;
  private readonly selfCare: number;

  constructor(b: Battle, bot: BattleTank, persona: Persona) {
    this.b = b;
    this.bot = bot;
    this.rules = { teams: isTeams(b), friendlyFire: b.config.friendlyFire };
    this.selfCare = persona === 'maniac' ? 0.6 : 1.4;
  }

  simulate(angle: number, power: number, weapon: WeaponId): Trial {
    this.sims++;
    const b = this.b;
    const bot = this.bot;
    const tanks = b.tanks.map((t) => ({
      id: t.id,
      team: t.team,
      x: t.x,
      y: t.y,
      hp: t.hp,
      alive: t.alive,
      shield: t.shield,
      shieldKind: t.shieldKind,
      chutes: t.items.parachute,
    }));
    const before = new Map(tanks.map((t) => [t.id, t.hp]));
    const terrain = cloneTerrain(b.terrain);
    const world: SimWorld = { terrain, tanks, wind: b.wind, walls: b.walls, gravity: GRAVITY_SCALE[b.config.gravity] };
    const s = resolveShot(world, { shooterId: bot.id, angle, power, weapon }, this.rules);
    let score = 0;
    for (const t of tanks) {
      const original = tankById(b, t.id)!;
      if (!original.alive) continue;
      const lost = (before.get(t.id) ?? 0) - t.hp;
      if (t.id === bot.id)
        score -=
          lost * this.selfCare +
          (t.alive ? 0 : 400) +
          (t.alive && isBuried(terrain, t.x, t.y) && !isBuried(b.terrain, original.x, original.y) ? 30 : 0);
      else if (isTeams(b) && t.team === bot.team) score -= lost * 1.6 + (t.alive ? 0 : 120);
      else
        score +=
          lost + (t.alive ? 0 : 35) + (t.alive && isBuried(terrain, t.x, t.y) && !isBuried(b.terrain, original.x, original.y) ? 22 : 0);
    }
    const first = s.events.find((e) => e.k === 'boom' || e.k === 'bore' || e.k === 'mark' || e.k === 'beam');
    const p = s.projectiles[0];
    const landX = first
      ? first.k === 'boom' || first.k === 'mark'
        ? first.x
        : first.k === 'bore'
          ? first.x0
          : first.x1
      : p
        ? p.pts[p.pts.length - 2]!
        : bot.x;
    return { score, landX };
  }

  /** Search angle × power for the best shot with `weapon` at `target`. */
  search(target: BattleTank, weapon: WeaponId, angles: number[]): { angle: number; power: number; trial: Trial } | null {
    const bot = this.bot;
    const right = target.x >= bot.x;
    let best: { angle: number; power: number; trial: Trial } | null = null;
    const better = (t: Trial, cur: Trial | undefined) =>
      !cur ||
      t.score > cur.score + 0.5 ||
      (Math.abs(t.score - cur.score) <= 0.5 && Math.abs(t.landX - target.x) < Math.abs(cur.landX - target.x));
    if (weapon === 'railgun') {
      // A straight beam: sweep the angle, power doesn't matter.
      for (let a = 0; a <= 88 && this.sims < SIM_BUDGET; a += 2) {
        const angle = right ? a : 180 - a;
        const t = this.simulate(angle, 60, weapon);
        if (better(t, best?.trial)) best = { angle, power: 60, trial: t };
      }
      return best;
    }
    for (const a of angles) {
      if (this.sims >= SIM_BUDGET) break;
      const angle = right ? a : 180 - a;
      // Coarse scan for the power bracket that brackets the target, then bisect.
      let prev: { power: number; d: number } | null = null;
      let bracket: [number, number] | null = null;
      for (let power = 20; power <= POWER_MAX; power += 12) {
        const t = this.simulate(angle, power, weapon);
        const d = (t.landX - target.x) * (right ? 1 : -1);
        if (better(t, best?.trial)) best = { angle, power, trial: t };
        if (prev && prev.d < 0 && d >= 0) {
          bracket = [prev.power, power];
          break;
        }
        prev = { power, d };
      }
      if (!bracket) continue;
      let [lo, hi] = bracket;
      while (hi - lo > 1 && this.sims < SIM_BUDGET) {
        const mid = Math.round((lo + hi) / 2);
        const t = this.simulate(angle, mid, weapon);
        if (better(t, best?.trial)) best = { angle, power: mid, trial: t };
        const d = (t.landX - target.x) * (right ? 1 : -1);
        if (d < 0) lo = mid;
        else hi = mid;
      }
    }
    return best;
  }
}

function pickTarget(bot: BattleTank, enemies: BattleTank[], ctx: BotContext, rng: Rng): BattleTank {
  const dist = (t: BattleTank) => Math.abs(t.x - bot.x);
  const jitter = () => 1 + (rng.next() - 0.5) * (ctx.skill === 'rookie' ? 0.6 : 0.15);
  const by = (score: (t: BattleTank) => number) => [...enemies].sort((a, c) => score(a) - score(c))[0]!;
  switch (ctx.persona) {
    case 'sniper':
    case 'vulture':
      return by((t) => (t.hp + t.shield) * 4 + dist(t) * 0.2 * jitter());
    case 'bully': {
      const scores = ctx.scores ?? {};
      const top = Math.max(...enemies.map((t) => scores[t.id] ?? 0));
      const leaders = enemies.filter((t) => (scores[t.id] ?? 0) === top);
      return leaders.length < enemies.length || top > 0
        ? by((t) => (leaders.includes(t) ? 0 : 1e6) + dist(t))
        : by((t) => dist(t) * jitter());
    }
    case 'maniac':
      // The tank with the most other enemies around it (one big bang for all of them).
      return by((t) => -enemies.filter((o) => o !== t && Math.abs(o.x - t.x) < 140).length * 1000 + dist(t) * jitter());
    case 'lobber':
      return enemies[rng.int(enemies.length)]!;
    default:
      return by((t) => dist(t) * (0.55 + t.hp / t.maxHp) * jitter());
  }
}

function candidates(bot: BattleTank, ctx: BotContext, target: BattleTank, rng: Rng): WeaponId[] {
  const owned = (w: WeaponId) => bot.ammo[w] !== 0;
  const max = ctx.persona === 'cyborg' ? 4 : ctx.skill === 'rookie' ? 1 : ctx.skill === 'veteran' ? 2 : 3;
  // Specials are precious: big ones are kept for healthy targets, and not every turn.
  const worth = (w: WeaponId) => {
    if ((w === 'nuke' || w === 'mininuke') && target.hp + target.shield < 55 && ctx.persona !== 'maniac') return false;
    if (isHarmless(w) && w !== 'tonofdirt' && w !== 'dirtball' && w !== 'mudslide') return false;
    return true;
  };
  const eager = ctx.persona === 'maniac' || ctx.persona === 'cyborg' ? 1 : ctx.persona === 'hoarder' ? 0.35 : 0.7;
  const out: WeaponId[] = [];
  for (const w of WEAPON_TASTE[ctx.persona]) {
    if (out.length >= max) break;
    if (owned(w) && worth(w) && rng.next() < eager) out.push(w);
  }
  out.push('shell');
  return out;
}

/** Plan a CPU tank's shot. */
export function planShot(b: Battle, botId: string, ctx: BotContext, rng: Rng): BotPlan {
  const bot = tankById(b, botId);
  const fallback: BotPlan = { angle: 60, power: 55, weapon: 'shell', targetId: null, expected: 0 };
  if (!bot || !bot.alive) return fallback;
  const enemies = enemiesOf(b, bot);
  if (enemies.length === 0) return { ...fallback, angle: bot.x < b.terrain.width / 2 ? 60 : 120 };

  // Buried: dig out first.
  if (isBuried(b.terrain, bot.x, bot.y)) {
    if (bot.ammo.excavator !== 0) return { angle: 90, power: 20, weapon: 'excavator', targetId: null, expected: 0 };
    if (bot.ammo.driller !== 0)
      return { angle: enemies[0]!.x >= bot.x ? 60 : 120, power: 60, weapon: 'driller', targetId: enemies[0]!.id, expected: 0 };
  }

  const target = pickTarget(bot, enemies, ctx, rng);
  const angles = PERSONA_ANGLES[ctx.persona] ?? DEFAULT_ANGLES;
  const planner = new Planner(b, bot, ctx.persona);
  let best: { angle: number; power: number; weapon: WeaponId; score: number } | null = null;
  for (const weapon of candidates(bot, ctx, target, rng)) {
    if (planner.sims >= SIM_BUDGET && best) break;
    const r = planner.search(target, weapon, angles);
    if (!r) continue;
    // Prefer the free shell unless a special clearly does more.
    const value = r.trial.score - (weapon === 'shell' ? 0 : 6);
    if (!best || value > best.score) best = { angle: r.angle, power: r.power, weapon, score: value };
  }
  if (!best) return { ...fallback, angle: target.x >= bot.x ? 55 : 125, weapon: 'shell', targetId: target.id };

  const noise = BOT_NOISE[ctx.skill];
  const jitter = (range: number) => Math.round((rng.next() * 2 - 1) * range);
  const steady = best.weapon === 'railgun' ? 0.4 : 1;
  const angle = Math.max(0, Math.min(180, best.angle + Math.round(jitter(noise.angle) * steady)));
  const power = Math.max(POWER_MIN, Math.min(POWER_MAX, best.power + jitter(noise.power)));
  return { angle, power, weapon: best.weapon, targetId: target.id, expected: best.score };
}

/** Items a CPU tank switches on at the start of its turn (in order). */
export function planItems(b: Battle, botId: string, ctx: BotContext, rng: Rng): UsableItemId[] {
  const bot = tankById(b, botId);
  if (!bot || !bot.alive) return [];
  const out: UsableItemId[] = [];
  if (bot.shield <= 0 && (ctx.skill !== 'rookie' || rng.next() < 0.5)) {
    const pick = (['heavyshield', 'deflector', 'shield'] as const).find((s) => bot.items[s] > 0);
    if (pick) out.push(pick);
  }
  if (bot.items.battery > 0 && bot.hp <= bot.maxHp - 25 && bot.hp < bot.maxHp * 0.6) out.push('battery');
  return out;
}

/**
 * What a CPU crew buys this shop visit (in order). Hoarders keep half their credits back
 * unless it's the last battle; rookies shop in a random order.
 */
export function planShop(
  f: FleetMember,
  ctx: BotContext,
  rng: Rng,
  opts: { lastBattle: boolean; blocked?: ReadonlySet<ShopId> },
): ShopId[] {
  const keep = opts.lastBattle ? 0 : ctx.persona === 'hoarder' ? 0.5 : 0.12;
  let budget = Math.floor(f.credits * (1 - keep));
  const wish = [...SHOP_TASTE[ctx.persona]];
  if (ctx.skill === 'rookie') {
    for (let i = wish.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = wish[i]!;
      wish[i] = wish[j]!;
      wish[j] = tmp;
    }
  }
  const stock = { ...f.ammo, ...f.items } as Record<ShopId, number>;
  const out: ShopId[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const [id, want] of wish) {
      if (opts.blocked?.has(id)) continue;
      const info = shopInfo(id);
      const target = pass === 0 ? want : want * 2;
      while ((stock[id] ?? 0) < target && info.price <= budget) {
        budget -= info.price;
        stock[id] = (stock[id] ?? 0) + info.bundle;
        out.push(id);
      }
    }
  }
  return out;
}
