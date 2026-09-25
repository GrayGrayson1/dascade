/**
 * Hero modifiers: archetype stats + statuses + party gear + abilities.
 */
import { QUEST_ARCHETYPES, QUEST_STAT_INFO, type QuestCheckTag, type QuestStat } from '@dascade/shared/games/quest';
import type { Adventure } from './schema.ts';
import type { RunHero, RunState } from './state.ts';

export interface ModPart {
  label: string;
  value: number;
}

/** Tinker bonus on tech checks. */
export const JURY_RIG_BONUS = 2;

/** Stat modifier from archetype + statuses (no gear, no tags) — used by stat conditions. */
export function heroStatMod(adv: Adventure, _run: RunState, hero: RunHero, stat: QuestStat): number {
  let total = QUEST_ARCHETYPES[hero.archetype].stats[stat];
  for (const s of hero.statuses) {
    const def = adv.statuses[s.id];
    if (!def) continue;
    total += (def.mods[stat] ?? 0) + def.allChecks;
  }
  return total;
}

/** Full check modifier with a readable breakdown ("+3 WITS", "+2 Jury-Rig", "−1 Soggy"). */
export function checkModifier(adv: Adventure, run: RunState, hero: RunHero, stat: QuestStat, tags: readonly QuestCheckTag[]): { total: number; parts: ModPart[] } {
  const parts: ModPart[] = [{ label: QUEST_STAT_INFO[stat].short, value: QUEST_ARCHETYPES[hero.archetype].stats[stat] }];
  for (const s of hero.statuses) {
    const def = adv.statuses[s.id];
    if (!def) continue;
    const v = (def.mods[stat] ?? 0) + def.allChecks;
    if (v !== 0) parts.push({ label: def.name, value: v });
  }
  for (const [id, count] of Object.entries(run.inventory)) {
    if (count <= 0) continue;
    const bonus = adv.items[id]?.bonus;
    if (!bonus || bonus.amount === 0) continue;
    const statMatch = bonus.stat !== undefined && bonus.stat === stat;
    const tagMatch = bonus.tag !== undefined && tags.includes(bonus.tag);
    const unconditional = bonus.stat === undefined && bonus.tag === undefined;
    if (statMatch || tagMatch || unconditional) parts.push({ label: adv.items[id]!.name, value: bonus.amount });
  }
  if (hero.archetype === 'tinker' && tags.includes('tech')) parts.push({ label: 'Jury-Rig', value: JURY_RIG_BONUS });
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return { total, parts };
}
