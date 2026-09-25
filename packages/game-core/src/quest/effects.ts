/**
 * Effect application: HP, KO/revive, statuses, party inventory, credits, flags,
 * score and narration. Every mutation returns a readable change for the outcome card.
 */
import type { Rng } from '@dascade/shared';
import type { QuestChangeView } from '@dascade/shared/games/quest';
import type { Adventure, Effect, Target } from './schema.ts';
import type { RunHero, RunState } from './state.ts';
import { consciousHeroes } from './conditions.ts';

export interface EffectContext {
  rng: Rng;
  /** Heroes the outcome applies to (roller / group subset). Empty → party. */
  rollerSlots?: readonly number[];
  /** Item target. */
  targetSlot?: number;
  /** Party leader (host's hero). */
  leaderSlot?: number;
  /** Explorer mode: skip harm so reachability walks never KO the party. */
  noHarm?: boolean;
  /** Hero credited with healing (item user). */
  healerSlot?: number;
}

function bySlot(run: RunState, slot: number | undefined): RunHero | undefined {
  return slot === undefined ? undefined : run.heroes.find((h) => h.slot === slot);
}

/** Resolve a target to heroes. `aliveOnly` limits to conscious heroes where it matters. */
export function resolveTarget(run: RunState, target: Target, ctx: EffectContext, aliveOnly: boolean): RunHero[] {
  const pool = (list: RunHero[]) => (aliveOnly ? list.filter((h) => !h.ko) : list);
  switch (target) {
    case 'party':
      return pool(run.heroes);
    case 'roller': {
      if (!ctx.rollerSlots || ctx.rollerSlots.length === 0) return pool(run.heroes);
      return run.heroes.filter((h) => ctx.rollerSlots!.includes(h.slot));
    }
    case 'random': {
      const alive = consciousHeroes(run);
      if (alive.length === 0) return [];
      return [alive[ctx.rng.int(alive.length)] as RunHero];
    }
    case 'weakest': {
      const alive = consciousHeroes(run);
      if (alive.length === 0) return [];
      return [alive.reduce((a, b) => (b.hp < a.hp || (b.hp === a.hp && b.slot < a.slot) ? b : a))];
    }
    case 'leader': {
      const leader = bySlot(run, ctx.leaderSlot) ?? run.heroes[0];
      return leader ? [leader] : [];
    }
    case 'target': {
      const t = bySlot(run, ctx.targetSlot);
      return t ? [t] : [];
    }
  }
}

function heroLabel(heroes: RunHero[], run: RunState): string {
  if (heroes.length === run.heroes.length && heroes.length > 1) return 'Party';
  if (heroes.length === 1) return heroes[0]!.name;
  return heroes.map((h) => h.name).join(', ');
}

/** Damage one hero; returns changes including a KO. */
export function damageHero(hero: RunHero, amount: number): QuestChangeView[] {
  if (hero.ko || amount <= 0) return [];
  const dealt = Math.min(hero.hp, amount);
  hero.hp -= dealt;
  hero.stats.damageTaken += dealt;
  const out: QuestChangeView[] = [];
  if (hero.hp <= 0) {
    hero.hp = 0;
    hero.ko = true;
    out.push({ kind: 'ko', text: `${hero.name} is knocked out!`, tone: 'bad', heroPlayerId: hero.playerId });
  }
  return out;
}

export function healHero(hero: RunHero, amount: number): number {
  if (hero.ko || amount <= 0) return 0;
  const healed = Math.min(hero.maxHp - hero.hp, amount);
  hero.hp += healed;
  return healed;
}

export function allKnockedOut(run: RunState): boolean {
  return run.heroes.length > 0 && run.heroes.every((h) => h.ko);
}

export function addStatus(adv: Adventure, hero: RunHero, id: string, turns?: number): boolean {
  const def = adv.statuses[id];
  if (!def) return false;
  const duration = turns ?? def.turns;
  const existing = hero.statuses.find((s) => s.id === id);
  if (existing) {
    existing.turns = existing.turns === 0 || duration === 0 ? 0 : Math.max(existing.turns, duration);
    return false;
  }
  hero.statuses.push({ id, turns: duration });
  return true;
}

export function removeStatus(hero: RunHero, id: string): boolean {
  const idx = hero.statuses.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  hero.statuses.splice(idx, 1);
  return true;
}

/** HP change effect (the revive effect also carries an optional `hp`). */
export function isHpEffect(e: Effect): e is { hp: number; target?: Target } {
  return 'hp' in e && !('revive' in e);
}

function counter(run: RunState, id: string): number {
  const v = run.flags[id];
  return typeof v === 'number' ? v : v === true ? 1 : 0;
}

/**
 * Apply effects in order. `defaultTarget` is used when an effect omits its target
 * ('roller' for choice outcomes, 'party' for scene entry).
 */
export function applyEffects(adv: Adventure, run: RunState, effects: readonly Effect[], ctx: EffectContext, defaultTarget: Target = 'roller'): QuestChangeView[] {
  const changes: QuestChangeView[] = [];
  for (const effect of effects) changes.push(...applyEffect(adv, run, effect, ctx, defaultTarget));
  return changes;
}

function applyEffect(adv: Adventure, run: RunState, effect: Effect, ctx: EffectContext, defaultTarget: Target): QuestChangeView[] {
  const out: QuestChangeView[] = [];
  if (isHpEffect(effect)) {
    const target = effect.target ?? defaultTarget;
    const heroes = resolveTarget(run, target, ctx, true);
    if (heroes.length === 0 || effect.hp === 0) return out;
    if (effect.hp < 0) {
      if (ctx.noHarm) return out;
      const amount = -effect.hp;
      // Guardian's Shield Wall: once per scene, negate a hit aimed at the whole party.
      if (target === 'party' && heroes.length > 1) {
        const guardian = run.heroes.find((h) => !h.ko && h.archetype === 'guardian' && !run.shieldUsed.includes(h.slot));
        if (guardian) {
          run.shieldUsed.push(guardian.slot);
          guardian.stats.damagePrevented += amount * heroes.length;
          out.push({ kind: 'shield', text: `${guardian.name}'s Shield Wall absorbs the hit!`, tone: 'good', heroPlayerId: guardian.playerId });
          return out;
        }
      }
      out.push({ kind: 'hp', text: `${heroLabel(heroes, run)} −${amount} HP`, tone: 'bad', heroPlayerId: heroes.length === 1 ? heroes[0]!.playerId : undefined });
      for (const h of heroes) out.push(...damageHero(h, amount));
    } else {
      let total = 0;
      for (const h of heroes) {
        const healed = healHero(h, effect.hp);
        total += healed;
      }
      if (ctx.healerSlot !== undefined) {
        const healer = bySlot(run, ctx.healerSlot);
        if (healer) healer.stats.healing += total;
      }
      if (total > 0) out.push({ kind: 'hp', text: `${heroLabel(heroes, run)} +${effect.hp} HP`, tone: 'good', heroPlayerId: heroes.length === 1 ? heroes[0]!.playerId : undefined });
    }
    return out;
  }
  if ('revive' in effect) {
    const heroes = resolveTarget(run, effect.revive, ctx, false).filter((h) => h.ko);
    for (const h of heroes) {
      h.ko = false;
      h.hp = Math.min(h.maxHp, effect.hp ?? Math.ceil(h.maxHp / 2));
      out.push({ kind: 'revive', text: `${h.name} is back on their feet!`, tone: 'good', heroPlayerId: h.playerId });
    }
    return out;
  }
  if ('addStatus' in effect) {
    const def = adv.statuses[effect.addStatus];
    if (!def) return out;
    if (ctx.noHarm && def.tone === 'debuff' && def.damagePerScene > 0) return out;
    const target = effect.target ?? defaultTarget;
    const heroes = resolveTarget(run, target, ctx, target === 'party');
    const added = heroes.filter((h) => addStatus(adv, h, effect.addStatus, effect.turns));
    if (added.length > 0 || heroes.length > 0) {
      out.push({ kind: 'status', text: `${heroLabel(heroes, run)}: ${def.name}`, tone: def.tone === 'buff' ? 'good' : 'bad', heroPlayerId: heroes.length === 1 ? heroes[0]!.playerId : undefined });
    }
    return out;
  }
  if ('removeStatus' in effect) {
    const def = adv.statuses[effect.removeStatus];
    const target = effect.target ?? defaultTarget;
    const heroes = resolveTarget(run, target, ctx, false).filter((h) => removeStatus(h, effect.removeStatus));
    if (heroes.length > 0 && def) {
      out.push({ kind: 'status', text: `${heroLabel(heroes, run)}: no longer ${def.name}`, tone: def.tone === 'debuff' ? 'good' : 'neutral' });
    }
    return out;
  }
  if ('addItem' in effect) {
    const qty = effect.qty ?? 1;
    run.inventory[effect.addItem] = (run.inventory[effect.addItem] ?? 0) + qty;
    const name = adv.items[effect.addItem]?.name ?? effect.addItem;
    out.push({ kind: 'item', text: qty > 1 ? `+${qty} ${name}` : `+ ${name}`, tone: 'good' });
    return out;
  }
  if ('removeItem' in effect) {
    const have = run.inventory[effect.removeItem] ?? 0;
    const qty = Math.min(have, effect.qty ?? 1);
    if (qty <= 0) return out;
    const left = have - qty;
    if (left > 0) run.inventory[effect.removeItem] = left;
    else delete run.inventory[effect.removeItem];
    const name = adv.items[effect.removeItem]?.name ?? effect.removeItem;
    out.push({ kind: 'item', text: qty > 1 ? `−${qty} ${name}` : `− ${name}`, tone: 'neutral' });
    return out;
  }
  if ('credits' in effect) {
    const before = run.credits;
    run.credits = Math.max(0, run.credits + effect.credits);
    const delta = run.credits - before;
    if (delta !== 0) out.push({ kind: 'credits', text: `${delta > 0 ? '+' : '−'}${Math.abs(delta)} credit${Math.abs(delta) === 1 ? '' : 's'}`, tone: delta > 0 ? 'good' : 'neutral' });
    return out;
  }
  if ('setFlag' in effect) {
    run.flags[effect.setFlag] = effect.value ?? true;
    return out;
  }
  if ('addCounter' in effect) {
    run.flags[effect.addCounter] = counter(run, effect.addCounter) + (effect.by ?? 1);
    return out;
  }
  if ('score' in effect) {
    run.score += effect.score;
    if (effect.score !== 0) out.push({ kind: 'score', text: `${effect.score > 0 ? '+' : '−'}${Math.abs(effect.score)} score`, tone: effect.score > 0 ? 'good' : 'bad' });
    return out;
  }
  if ('note' in effect) {
    out.push({ kind: 'note', text: effect.note, tone: 'neutral' });
    return out;
  }
  return out;
}

/**
 * Advance statuses by one scene (called when a scene's choice resolves, before its
 * consequences): damage-over-time for conscious heroes, then decrement durations and
 * drop expired ones.
 */
export function tickStatuses(adv: Adventure, run: RunState, noHarm = false): QuestChangeView[] {
  const out: QuestChangeView[] = [];
  for (const hero of run.heroes) {
    for (const s of [...hero.statuses]) {
      const def = adv.statuses[s.id];
      if (!def) {
        removeStatus(hero, s.id);
        continue;
      }
      if (def.damagePerScene > 0 && !hero.ko && !noHarm) {
        out.push({ kind: 'hp', text: `${hero.name} −${def.damagePerScene} HP (${def.name})`, tone: 'bad', heroPlayerId: hero.playerId });
        out.push(...damageHero(hero, def.damagePerScene));
      }
      if (s.turns > 0) {
        s.turns -= 1;
        if (s.turns === 0) {
          removeStatus(hero, s.id);
          out.push({ kind: 'status', text: `${hero.name}: ${def.name} wore off`, tone: def.tone === 'debuff' ? 'good' : 'neutral', heroPlayerId: hero.playerId });
        }
      }
    }
  }
  return out;
}
