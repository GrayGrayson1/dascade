/**
 * Skill checks: d20 + modifier vs DC.
 *
 * Rules
 *  - Natural 20 always succeeds (critical success); natural 1 always fails (critical failure).
 *  - Advantage: roll two d20, keep the higher.
 *  - Effective DC = authored DC + difficulty shift + small-party assist (solo −2, duo −1).
 *  - who: best | chosen (best among the heroes whose players voted for it) | all (group:
 *    at least half of the conscious heroes must succeed) | random.
 *  - Trickster "Silver Tongue": once per chapter a failed social/Charm check is rerolled.
 * All randomness comes from the injected Rng (the server's crypto RNG in production).
 */
import type { Rng } from '@dascade/shared';
import type { QuestDieView, QuestDifficultyLabel } from '@dascade/shared/games/quest';
import type { Adventure, Check } from './schema.ts';
import type { RunHero, RunState } from './state.ts';
import { consciousHeroes, evaluate } from './conditions.ts';
import { checkModifier } from './stats.ts';

export function sizeAssist(run: RunState): number {
  if (run.heroes.length <= 1) return -2;
  if (run.heroes.length === 2) return -1;
  return 0;
}

export function effectiveDc(run: RunState, check: Pick<Check, 'dc'>): number {
  return Math.max(2, check.dc + run.dcShift + sizeAssist(run));
}

export function difficultyLabel(dc: number): QuestDifficultyLabel {
  if (dc <= 5) return 'Trivial';
  if (dc <= 9) return 'Easy';
  if (dc <= 12) return 'Moderate';
  if (dc <= 15) return 'Hard';
  if (dc <= 18) return 'Very hard';
  return 'Heroic';
}

/** Probability that a single die succeeds (natural 20 / natural 1 rules included). */
export function dieOdds(modifier: number, dc: number, advantage = false): number {
  let wins = 0;
  for (let f = 1; f <= 20; f++) if (f === 20 || (f !== 1 && f + modifier >= dc)) wins++;
  const p = wins / 20;
  return advantage ? 1 - (1 - p) * (1 - p) : p;
}

/** Probability that at least `needed` of independent events with probabilities `ps` happen. */
export function atLeastOdds(ps: readonly number[], needed: number): number {
  let dist = [1];
  for (const p of ps) {
    const next = new Array<number>(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] = (next[k] ?? 0) + q * (1 - p);
      next[k + 1] = (next[k + 1] ?? 0) + q * p;
    });
    dist = next;
  }
  let total = 0;
  for (let k = needed; k < dist.length; k++) total += dist[k] ?? 0;
  return Math.min(1, Math.max(0, total));
}

export function groupNeeded(n: number): number {
  return Math.max(1, Math.ceil(n / 2));
}

function canReroll(run: RunState, check: Check): RunHero | undefined {
  const social = check.stat === 'CHARM' || check.tags.includes('social');
  if (!social) return undefined;
  return run.heroes.find((h) => !h.ko && h.archetype === 'trickster' && !run.rerollUsed.includes(h.slot));
}

/** The best conscious hero for a check (highest modifier, lowest slot on ties). */
export function bestHero(adv: Adventure, run: RunState, check: Check, pool?: readonly RunHero[]): RunHero | undefined {
  const heroes = (pool ?? consciousHeroes(run)).filter((h) => !h.ko);
  let best: RunHero | undefined;
  let bestMod = -Infinity;
  for (const h of heroes) {
    const mod = checkModifier(adv, run, h, check.stat, check.tags).total;
    if (mod > bestMod || (mod === bestMod && best && h.slot < best.slot)) {
      best = h;
      bestMod = mod;
    }
  }
  return best;
}

/** Party odds of success for a check (used for tie-breaks and the Analyst's display). */
export function checkOdds(adv: Adventure, run: RunState, check: Check, voterSlots: readonly number[] = []): number {
  const dc = effectiveDc(run, check);
  const advantage = check.advantageIf ? evaluate(adv, run, check.advantageIf) : false;
  const alive = consciousHeroes(run);
  if (alive.length === 0) return 0;
  const odds = (h: RunHero) => dieOdds(checkModifier(adv, run, h, check.stat, check.tags).total, dc, advantage);
  const reroll = canReroll(run, check) !== undefined;
  const withReroll = (p: number) => (reroll ? p + (1 - p) * p : p);
  switch (check.who) {
    case 'all':
      return atLeastOdds(alive.map(odds), groupNeeded(alive.length));
    case 'random':
      return withReroll(alive.reduce((s, h) => s + odds(h), 0) / alive.length);
    case 'chosen': {
      const voters = alive.filter((h) => voterSlots.includes(h.slot));
      const hero = bestHero(adv, run, check, voters.length ? voters : alive);
      return hero ? withReroll(odds(hero)) : 0;
    }
    case 'best':
    default: {
      const hero = bestHero(adv, run, check);
      return hero ? withReroll(odds(hero)) : 0;
    }
  }
}

export function pickRollers(adv: Adventure, run: RunState, check: Check, rng: Rng, voterSlots: readonly number[] = []): RunHero[] {
  const alive = consciousHeroes(run);
  if (alive.length === 0) return [];
  switch (check.who) {
    case 'all':
      return alive;
    case 'random':
      return [alive[rng.int(alive.length)] as RunHero];
    case 'chosen': {
      const voters = alive.filter((h) => voterSlots.includes(h.slot));
      const hero = bestHero(adv, run, check, voters.length ? voters : alive);
      return hero ? [hero] : [];
    }
    case 'best':
    default: {
      const hero = bestHero(adv, run, check);
      return hero ? [hero] : [];
    }
  }
}

export interface CheckResult {
  dc: number;
  dice: QuestDieView[];
  needed: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** Slot of the hero behind each die (parallel to `dice`). */
  rollerSlots: number[];
  /** Slots whose own die succeeded / failed (group effects). */
  passedSlots: number[];
  failedSlots: number[];
  rerollBy?: { slot: number; name: string };
}

function rollDie(rng: Rng, advantage: boolean): number[] {
  const a = rng.int(20) + 1;
  if (!advantage) return [a];
  return [a, rng.int(20) + 1];
}

function makeDie(adv: Adventure, run: RunState, hero: RunHero, check: Check, dc: number, naturals: number[]): QuestDieView {
  const kept = Math.max(...naturals);
  const mod = checkModifier(adv, run, hero, check.stat, check.tags);
  const total = kept + mod.total;
  const crit: QuestDieView['crit'] = kept === 20 ? 'success' : kept === 1 ? 'failure' : null;
  const success = kept === 20 ? true : kept === 1 ? false : total >= dc;
  return {
    heroPlayerId: hero.playerId,
    name: hero.name,
    color: hero.color,
    archetype: hero.archetype,
    naturals,
    kept,
    modifier: mod.total,
    parts: mod.parts,
    total,
    success,
    crit,
  };
}

/** Roll a check. Mutates hero roll stats and Silver Tongue usage. */
export function rollCheck(adv: Adventure, run: RunState, check: Check, rng: Rng, voterSlots: readonly number[] = []): CheckResult {
  const dc = effectiveDc(run, check);
  const advantage = check.advantageIf ? evaluate(adv, run, check.advantageIf) : false;
  const rollers = pickRollers(adv, run, check, rng, voterSlots);
  const dice = rollers.map((h) => makeDie(adv, run, h, check, dc, rollDie(rng, advantage)));
  const group = check.who === 'all';
  const needed = group ? groupNeeded(dice.length) : 1;
  let success = dice.filter((d) => d.success).length >= needed && dice.length > 0;
  let rerollBy: CheckResult['rerollBy'];

  if (!success && dice.length > 0) {
    const trickster = canReroll(run, check);
    if (trickster) {
      // Reroll the failed die closest to success.
      let idx = -1;
      dice.forEach((d, i) => {
        if (!d.success && (idx < 0 || d.total > (dice[idx] as QuestDieView).total)) idx = i;
      });
      if (idx >= 0) {
        const old = dice[idx] as QuestDieView;
        const hero = rollers[idx] as RunHero;
        const fresh = makeDie(adv, run, hero, check, dc, rollDie(rng, advantage));
        fresh.rerolledFrom = old.kept;
        dice[idx] = fresh;
        run.rerollUsed.push(trickster.slot);
        rerollBy = { slot: trickster.slot, name: trickster.name };
        success = dice.filter((d) => d.success).length >= needed;
      }
    }
  }

  const passedSlots: number[] = [];
  const failedSlots: number[] = [];
  dice.forEach((d, i) => {
    const hero = rollers[i] as RunHero;
    hero.stats.rolls += 1;
    hero.stats.rollSum += d.kept;
    if (d.success) {
      hero.stats.successes += 1;
      passedSlots.push(hero.slot);
    } else {
      hero.stats.failures += 1;
      failedSlots.push(hero.slot);
    }
    if (d.crit === 'success') hero.stats.crits += 1;
    if (d.crit === 'failure') hero.stats.fumbles += 1;
  });

  const crit = group || dice.length !== 1 ? null : (dice[0] as QuestDieView).crit;
  return { dc, dice, needed, success, crit, rollerSlots: rollers.map((h) => h.slot), passedSlots, failedSlots, rerollBy };
}
