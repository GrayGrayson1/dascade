/**
 * Condition evaluation and human-readable "why can't we pick this?" reasons.
 */
import { QUEST_ARCHETYPES, QUEST_STAT_INFO } from '@dascade/shared/games/quest';
import type { Adventure, Condition } from './schema.ts';
import type { RunHero, RunState } from './state.ts';
import { heroStatMod } from './stats.ts';

export function consciousHeroes(run: RunState): RunHero[] {
  return run.heroes.filter((h) => !h.ko);
}

export function hasConscious(run: RunState, archetype: RunHero['archetype']): boolean {
  return run.heroes.some((h) => !h.ko && h.archetype === archetype);
}

export function itemCount(run: RunState, id: string): number {
  return run.inventory[id] ?? 0;
}

export function counterValue(run: RunState, id: string): number {
  const v = run.flags[id];
  return typeof v === 'number' ? v : v === true ? 1 : 0;
}

export function partyHpRatio(run: RunState): number {
  let hp = 0;
  let max = 0;
  for (const h of run.heroes) {
    hp += h.hp;
    max += h.maxHp;
  }
  return max > 0 ? hp / max : 0;
}

export function evaluate(adv: Adventure, run: RunState, cond: Condition): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluate(adv, run, c));
  if ('any' in cond) return cond.any.some((c) => evaluate(adv, run, c));
  if ('not' in cond) return !evaluate(adv, run, cond.not);
  if ('hasItem' in cond) return itemCount(run, cond.hasItem) >= (cond.qty ?? 1);
  if ('flag' in cond) {
    const v = run.flags[cond.flag];
    if (cond.equals === undefined) return v !== undefined && v !== false && v !== 0;
    if (typeof cond.equals === 'boolean') return Boolean(v) === cond.equals;
    return v === cond.equals;
  }
  if ('counter' in cond) {
    const v = counterValue(run, cond.counter);
    if (cond.atLeast !== undefined && v < cond.atLeast) return false;
    if (cond.below !== undefined && v >= cond.below) return false;
    return true;
  }
  if ('archetype' in cond) return hasConscious(run, cond.archetype);
  if ('stat' in cond) return consciousHeroes(run).some((h) => heroStatMod(adv, run, h, cond.stat) >= cond.atLeast);
  if ('credits' in cond) return run.credits >= cond.credits;
  if ('partyHp' in cond) {
    const r = partyHpRatio(run);
    if (cond.partyHp.belowPct !== undefined && !(r < cond.partyHp.belowPct)) return false;
    if (cond.partyHp.atLeastPct !== undefined && !(r >= cond.partyHp.atLeastPct)) return false;
    return true;
  }
  if ('anyKo' in cond) return run.heroes.some((h) => h.ko) === cond.anyKo;
  if ('visited' in cond) return run.visited.includes(cond.visited);
  if ('partySize' in cond) {
    const n = run.heroes.length;
    if (cond.partySize.min !== undefined && n < cond.partySize.min) return false;
    if (cond.partySize.max !== undefined && n > cond.partySize.max) return false;
    return true;
  }
  if ('status' in cond) return run.heroes.some((h) => !h.ko && h.statuses.some((s) => s.id === cond.status));
  return false;
}

/** Plain-language description of a requirement (used in reasons). */
export function describe(adv: Adventure, cond: Condition): string {
  if ('all' in cond) return cond.all.map((c) => describe(adv, c)).join(' + ');
  if ('any' in cond) return cond.any.map((c) => describe(adv, c)).join(' or ');
  if ('not' in cond) {
    const inner = cond.not;
    if ('visited' in inner) return 'not having done this already';
    if ('hasItem' in inner) return `no ${adv.items[inner.hasItem]?.name ?? inner.hasItem}`;
    if ('archetype' in inner) return `no ${QUEST_ARCHETYPES[inner.archetype].name}`;
    return 'different circumstances';
  }
  if ('hasItem' in cond) {
    const name = adv.items[cond.hasItem]?.name ?? cond.hasItem;
    return (cond.qty ?? 1) > 1 ? `${cond.qty}× ${name}` : name;
  }
  if ('flag' in cond || 'counter' in cond) return 'a clue you have not found';
  if ('archetype' in cond) return `a conscious ${QUEST_ARCHETYPES[cond.archetype].name}`;
  if ('stat' in cond) return `${QUEST_STAT_INFO[cond.stat].name} +${cond.atLeast}`;
  if ('credits' in cond) return `${cond.credits} credit${cond.credits === 1 ? '' : 's'}`;
  if ('partyHp' in cond) return cond.partyHp.belowPct !== undefined ? 'a battered party' : 'a healthier party';
  if ('anyKo' in cond) return cond.anyKo ? 'a knocked-out hero' : 'everyone on their feet';
  if ('visited' in cond) return `having visited ${adv.nodeMap.get(cond.visited)?.title ?? 'somewhere first'}`;
  if ('partySize' in cond) return cond.partySize.min !== undefined ? `a party of ${cond.partySize.min}+` : `a party of ${cond.partySize.max} or fewer`;
  if ('status' in cond) return adv.statuses[cond.status]?.name ?? cond.status;
  return 'something';
}

/** Only the parts of a condition that currently fail (so reasons stay short and useful). */
export function unmet(adv: Adventure, run: RunState, cond: Condition): Condition[] {
  if (evaluate(adv, run, cond)) return [];
  if ('all' in cond) return cond.all.flatMap((c) => unmet(adv, run, c));
  return [cond];
}

/** "Requires: Keycard", "Tinker only", "Requires: Tinker + Duct Tape". */
export function unavailableReason(adv: Adventure, run: RunState, cond: Condition): string {
  const missing = unmet(adv, run, cond);
  if (missing.length === 0) return 'Not available right now';
  if (missing.length === 1) {
    const only = missing[0] as Condition;
    if ('archetype' in only) {
      const name = QUEST_ARCHETYPES[only.archetype].name;
      return run.heroes.some((h) => h.archetype === only.archetype) ? `${name} is knocked out` : `${name} only`;
    }
  }
  const parts = missing.map((c) => ('archetype' in c ? QUEST_ARCHETYPES[c.archetype].name : describe(adv, c)));
  return `Requires: ${parts.join(' + ')}`;
}
