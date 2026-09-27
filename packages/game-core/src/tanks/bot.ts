/**
 * CPU gunner. Picks a target and a weapon, then searches angle × power with the real
 * shot simulation on a scratch copy of the world (so it accounts for wind, hills and
 * splash) and finally adds skill-dependent aiming error. Pure: all randomness comes
 * from the injected Rng.
 */
import type { Rng } from '@dascade/shared';
import { POWER_MAX, POWER_MIN, type CpuSkill, type WeaponId } from '@dascade/shared/games/tanks';
import { cloneTerrain } from './terrain.ts';
import { resolveShot, type ShotRules } from './sim.ts';
import { isTeams, tankById, type Battle, type BattleTank } from './battle.ts';

export interface BotPlan {
  angle: number;
  power: number;
  weapon: WeaponId;
  targetId: string | null;
  /** Predicted score of the un-jittered shot (enemy damage minus own losses). */
  expected: number;
}

/** Aiming error (± degrees / ± power) per skill. */
export const BOT_NOISE: Record<CpuSkill, { angle: number; power: number }> = {
  rookie: { angle: 8, power: 12 },
  veteran: { angle: 3, power: 6 },
  ace: { angle: 1, power: 2 },
};

const ANGLES = [25, 35, 42, 48, 55, 62, 70, 78];

interface Trial {
  score: number;
  landX: number;
}

function enemiesOf(b: Battle, bot: BattleTank): BattleTank[] {
  return b.tanks.filter((t) => t.alive && t.id !== bot.id && (!isTeams(b) || t.team !== bot.team));
}

function simulate(b: Battle, bot: BattleTank, angle: number, power: number, weapon: WeaponId, rules: ShotRules): Trial {
  const tanks = b.tanks.map((t) => ({ id: t.id, team: t.team, x: t.x, y: t.y, hp: t.hp, alive: t.alive }));
  const before = new Map(tanks.map((t) => [t.id, t.hp]));
  const s = resolveShot({ terrain: cloneTerrain(b.terrain), tanks, wind: b.wind }, { shooterId: bot.id, angle, power, weapon }, rules);
  let score = 0;
  for (const t of tanks) {
    const lost = (before.get(t.id) ?? 0) - t.hp;
    const original = tankById(b, t.id)!;
    if (!original.alive) continue;
    if (t.id === bot.id) score -= lost * 1.4 + (t.alive ? 0 : 400);
    else if (isTeams(b) && t.team === bot.team) score -= lost * 1.6 + (t.alive ? 0 : 120);
    else score += lost + (t.alive ? 0 : 35);
  }
  const first = s.events.find((e) => e.k === 'boom' || e.k === 'bore');
  const p = s.projectiles[0]!;
  const landX = first ? (first.k === 'boom' ? first.x : first.x0) : p.pts[p.pts.length - 2]!;
  return { score, landX };
}

function chooseWeapon(bot: BattleTank, target: BattleTank, rng: Rng): WeaponId {
  const has = (w: WeaponId) => bot.ammo[w] !== 0;
  const roll = rng.next();
  if (target.hp > 45 && has('heavy') && roll < 0.3) return 'heavy';
  if (has('cluster') && roll < 0.5) return 'cluster';
  if (has('airburst') && roll < 0.65) return 'airburst';
  return 'shell';
}

/** Search angle × power for the best shot with `weapon` at `target`. */
function search(b: Battle, bot: BattleTank, target: BattleTank, weapon: WeaponId, rules: ShotRules): { angle: number; power: number; trial: Trial } | null {
  const right = target.x >= bot.x;
  let best: { angle: number; power: number; trial: Trial } | null = null;
  const better = (t: Trial, cur: Trial | undefined) =>
    !cur || t.score > cur.score + 0.5 || (Math.abs(t.score - cur.score) <= 0.5 && Math.abs(t.landX - target.x) < Math.abs(cur.landX - target.x));
  for (const a of ANGLES) {
    const angle = right ? a : 180 - a;
    // Coarse scan for the power bracket that brackets the target, then bisect.
    let prev: { power: number; d: number } | null = null;
    let bracket: [number, number] | null = null;
    for (let power = 20; power <= POWER_MAX; power += 10) {
      const t = simulate(b, bot, angle, power, weapon, rules);
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
    while (hi - lo > 1) {
      const mid = Math.round((lo + hi) / 2);
      const t = simulate(b, bot, angle, mid, weapon, rules);
      if (better(t, best?.trial)) best = { angle, power: mid, trial: t };
      const d = (t.landX - target.x) * (right ? 1 : -1);
      if (d < 0) lo = mid;
      else hi = mid;
    }
  }
  return best;
}

export function planShot(b: Battle, botId: string, skill: CpuSkill, rng: Rng): BotPlan {
  const bot = tankById(b, botId);
  const fallback: BotPlan = { angle: 60, power: 55, weapon: 'shell', targetId: null, expected: 0 };
  if (!bot || !bot.alive) return fallback;
  const enemies = enemiesOf(b, bot);
  if (enemies.length === 0) return { ...fallback, angle: bot.x < b.terrain.width / 2 ? 60 : 120 };
  const rules: ShotRules = { teams: isTeams(b), friendlyFire: b.config.friendlyFire };

  // Prefer close, weak targets (rookies are less picky).
  const pickiness = skill === 'rookie' ? 0.6 : 0.15;
  const target = [...enemies].sort((a, c) => {
    const w = (t: BattleTank) => Math.abs(t.x - bot.x) * (0.55 + t.hp / t.maxHp) * (1 + (rng.next() - 0.5) * pickiness);
    return w(a) - w(c);
  })[0]!;

  let weapon = chooseWeapon(bot, target, rng);
  let plan = search(b, bot, target, weapon, rules);
  if (weapon !== 'shell' && (!plan || plan.trial.score <= 0)) {
    // Special round has no good line: blast through with a driller or fall back to shells.
    const alt: WeaponId = bot.ammo.driller !== 0 && skill !== 'rookie' ? 'driller' : 'shell';
    const second = search(b, bot, target, alt, rules);
    if (second && (!plan || second.trial.score > plan.trial.score)) {
      plan = second;
      weapon = alt;
    }
  }
  if (!plan) return { ...fallback, angle: target.x >= bot.x ? 55 : 125, weapon: 'shell', targetId: target.id };

  const noise = BOT_NOISE[skill];
  const jitter = (range: number) => Math.round((rng.next() * 2 - 1) * range);
  const angle = Math.max(0, Math.min(180, plan.angle + jitter(noise.angle)));
  const power = Math.max(POWER_MIN, Math.min(POWER_MAX, plan.power + jitter(noise.power)));
  return { angle, power, weapon, targetId: target.id, expected: plan.trial.score };
}
