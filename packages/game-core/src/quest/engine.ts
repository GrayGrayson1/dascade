/**
 * DASQuest engine: pure, deterministic under an injected Rng. The server owns a
 * RunState and drives it with these functions; tests drive them directly.
 *
 *   createRun → enterNode(start) → presentScene → (votes) → resolveChoice → enterNode(next) → …
 *
 * resolveChoice rolls the check (if any) and applies consequences but does NOT enter
 * the next node, so the server can play the dice animation in between.
 */
import type { Rng } from '@dascade/shared';
import {
  QUEST_ARCHETYPES,
  type QuestArchetypeId,
  type QuestAwardView,
  type QuestChangeView,
  type QuestChoiceView,
  type QuestResultView,
  type QuestSceneView,
} from '@dascade/shared/games/quest';
import type { Adventure, AdventureNode, Choice } from './schema.ts';
import { emptyStats, RunStateSchema, TIMELINE_LIMIT, type RunHero, type RunState } from './state.ts';
import { consciousHeroes, evaluate, hasConscious, unavailableReason } from './conditions.ts';
import { allKnockedOut, applyEffects, healHero, isHpEffect, tickStatuses, type EffectContext } from './effects.ts';
import { bestHero, checkOdds, difficultyLabel, effectiveDc, rollCheck, type CheckResult } from './checks.ts';
import { formatClock, interpolate } from './interpolate.ts';

export const MAX_HEROES = 12;
export const SOLO_HP_BONUS = 4;
export const CRIT_SCORE = 50;
export const SUCCESS_SCORE = 20;

export interface HeroSeed {
  playerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId;
}

export interface RunOptions {
  runId: string;
  dcShift?: number;
  leaderSlot?: number;
}

export interface EnterResult {
  nodeId: string;
  changes: QuestChangeView[];
  /** Ending id when the run is over. */
  ending: string | null;
  defeated: boolean;
  checkpoint: boolean;
  chapterChanged: boolean;
  /** Nodes passed through via routes. */
  path: string[];
}

export function getNode(adv: Adventure, id: string): AdventureNode {
  const node = adv.nodeMap.get(id);
  if (!node) throw new Error(`Unknown node "${id}" in pack "${adv.id}"`);
  return node;
}

// ---------------------------------------------------------------------------
// Run creation
// ---------------------------------------------------------------------------

export function makeHero(adv: Adventure, seed: HeroSeed, slot: number, partySize: number): RunHero {
  const base = QUEST_ARCHETYPES[seed.archetype].maxHp;
  const maxHp = base + (partySize === 1 ? SOLO_HP_BONUS : 0);
  void adv;
  return {
    slot,
    playerId: seed.playerId,
    name: seed.name,
    color: seed.color,
    archetype: seed.archetype,
    hp: maxHp,
    maxHp,
    ko: false,
    statuses: [],
    stats: emptyStats(),
  };
}

/** Create a run and enter the start node. */
export function createRun(adv: Adventure, seeds: readonly HeroSeed[], opts: RunOptions, rng: Rng): { run: RunState; enter: EnterResult } {
  if (seeds.length === 0) throw new Error('A run needs at least one hero');
  if (seeds.length > MAX_HEROES) throw new Error(`At most ${MAX_HEROES} heroes`);
  const run: RunState = {
    v: 1,
    runId: opts.runId,
    packId: adv.id,
    packVersion: adv.version,
    nodeId: adv.startNode,
    chapter: getNode(adv, adv.startNode).chapter,
    turn: 0,
    heroes: seeds.map((s, i) => makeHero(adv, s, i, seeds.length)),
    inventory: {},
    credits: adv.startCredits,
    score: 0,
    flags: {},
    visited: [],
    taken: [],
    shieldUsed: [],
    rerollUsed: [],
    dcShift: opts.dcShift ?? 0,
    timeline: [],
    endingId: null,
  };
  for (const hero of run.heroes) {
    for (const kit of adv.kits[hero.archetype] ?? []) run.inventory[kit.item] = (run.inventory[kit.item] ?? 0) + kit.qty;
  }
  const enter = enterNode(adv, run, adv.startNode, rng, { leaderSlot: opts.leaderSlot });
  return { run, enter };
}

// ---------------------------------------------------------------------------
// Entering nodes
// ---------------------------------------------------------------------------

export function enterNode(
  adv: Adventure,
  run: RunState,
  nodeId: string,
  rng: Rng,
  opts: { leaderSlot?: number; noHarm?: boolean } = {},
): EnterResult {
  const changes: QuestChangeView[] = [];
  const path: string[] = [];
  let id = nodeId;
  let chapterChanged = false;
  let checkpoint = false;
  const ctx: EffectContext = { rng, leaderSlot: opts.leaderSlot, noHarm: opts.noHarm };

  for (let hop = 0; hop < 10; hop++) {
    const node = getNode(adv, id);
    path.push(id);
    if (node.chapter !== run.chapter) {
      chapterChanged = true;
      run.rerollUsed = [];
    }
    run.chapter = node.chapter;
    run.nodeId = id;
    run.shieldUsed = [];
    if (!run.visited.includes(id)) run.visited.push(id);
    if (node.checkpoint) checkpoint = true;
    changes.push(...applyEffects(adv, run, node.onEnter, ctx, 'party'));

    if (allKnockedOut(run) && id !== adv.defeatNode) {
      id = adv.defeatNode;
      continue;
    }
    if (node.ending) {
      run.endingId = node.ending;
      return { nodeId: id, changes, ending: node.ending, defeated: id === adv.defeatNode, checkpoint, chapterChanged, path };
    }
    const route = node.routes.find((r) => evaluate(adv, run, r.if));
    if (route) {
      id = route.to;
      continue;
    }
    return { nodeId: id, changes, ending: null, defeated: false, checkpoint, chapterChanged, path };
  }
  throw new Error(`Route loop detected entering "${nodeId}"`);
}

// ---------------------------------------------------------------------------
// Scene presentation
// ---------------------------------------------------------------------------

export function isVisible(adv: Adventure, run: RunState, node: AdventureNode, choice: Choice): boolean {
  if (choice.once && run.taken.includes(`${node.id}/${choice.id}`)) return false;
  if (choice.secret && !hasConscious(run, 'scout')) return false;
  if (choice.unavailable === 'hide' && choice.if && !evaluate(adv, run, choice.if)) return false;
  return true;
}

export function isAvailable(adv: Adventure, run: RunState, node: AdventureNode, choice: Choice): boolean {
  return isVisible(adv, run, node, choice) && (!choice.if || evaluate(adv, run, choice.if));
}

export function availableChoices(adv: Adventure, run: RunState): Choice[] {
  const node = getNode(adv, run.nodeId);
  return node.choices.filter((c) => isAvailable(adv, run, node, c));
}

export function choiceOdds(adv: Adventure, run: RunState, choice: Choice, voterSlots: readonly number[] = []): number {
  return choice.check ? checkOdds(adv, run, choice.check, voterSlots) : 1;
}

export function presentScene(adv: Adventure, run: RunState, opts: { leaderSlot?: number; rev?: number } = {}): QuestSceneView {
  const node = getNode(adv, run.nodeId);
  const revealOdds = hasConscious(run, 'analyst');
  const text = (s: string) => interpolate(adv, run, s, opts.leaderSlot);
  const choices: QuestChoiceView[] = [];
  for (const choice of node.choices) {
    if (!isVisible(adv, run, node, choice)) continue;
    const available = !choice.if || evaluate(adv, run, choice.if);
    const view: QuestChoiceView = {
      id: choice.id,
      label: text(choice.label),
      flavor: text(choice.flavor),
      available,
    };
    if (!available) view.reason = choice.reason ?? unavailableReason(adv, run, choice.if!);
    if (choice.secret) view.secret = true;
    if (choice.check) {
      const dc = effectiveDc(run, choice.check);
      const roller = choice.check.who === 'best' ? bestHero(adv, run, choice.check) : undefined;
      view.check = {
        stat: choice.check.stat,
        who: choice.check.who,
        tags: [...choice.check.tags],
        difficulty: difficultyLabel(dc),
        advantage: choice.check.advantageIf ? evaluate(adv, run, choice.check.advantageIf) : false,
        rollerName:
          choice.check.who === 'all' ? 'Everyone rolls' : choice.check.who === 'random' ? 'A random hero' : choice.check.who === 'chosen' ? 'Best volunteer' : roller?.name,
      };
      if (revealOdds) {
        view.check.dc = dc;
        view.check.odds = Math.round(checkOdds(adv, run, choice.check) * 1000) / 1000;
      }
    }
    choices.push(view);
  }
  return {
    nodeId: node.id,
    rev: opts.rev ?? 0,
    chapter: node.chapter,
    chapterTitle: adv.chapterTitle(node.chapter),
    title: text(node.title),
    theme: node.theme,
    art: [...node.art],
    paragraphs: node.narrative.map(text),
    clock: formatClock(adv, run.turn),
    checkpoint: node.checkpoint,
    ending: Boolean(node.ending),
    revealOdds,
    choices,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveContext {
  leaderSlot?: number;
  /** Slots whose players voted for the winning choice ('chosen' checks). */
  voterSlots?: readonly number[];
  votes?: number;
  voters?: number;
  tieRule?: string;
}

export interface Resolution {
  choice: Choice;
  fromNodeId: string;
  fromTitle: string;
  check: CheckResult | null;
  success: boolean | null;
  crit: 'success' | 'failure' | null;
  text: string;
  changes: QuestChangeView[];
  next: string;
  defeated: boolean;
}

/** Pay a choice's up-front effects (costs, consumed items) — applied before any roll. */
export function payChoiceCosts(adv: Adventure, run: RunState, choice: Choice, rng: Rng, ctx: { leaderSlot?: number; noHarm?: boolean } = {}): QuestChangeView[] {
  const node = getNode(adv, run.nodeId);
  if (choice.once) run.taken.push(`${node.id}/${choice.id}`);
  return applyEffects(adv, run, choice.effects, { rng, leaderSlot: ctx.leaderSlot, noHarm: ctx.noHarm }, 'party');
}

/**
 * Apply a known outcome (after costs were paid). Used by resolveChoice with a real
 * roll, and by the reachability explorer with forced successes/failures.
 */
export function applyOutcome(
  adv: Adventure,
  run: RunState,
  choice: Choice,
  outcome: { success: boolean | null; check: CheckResult | null },
  rng: Rng,
  ctx: ResolveContext & { noHarm?: boolean } = {},
): Pick<Resolution, 'success' | 'crit' | 'text' | 'changes' | 'next' | 'defeated'> {
  const node = getNode(adv, run.nodeId);
  const effectCtx: EffectContext = { rng, leaderSlot: ctx.leaderSlot, noHarm: ctx.noHarm };
  // The scene is over: statuses tick (damage over time, durations) before new consequences land,
  // so a status with `turns: 3` affects the next three decisions.
  const changes: QuestChangeView[] = tickStatuses(adv, run, ctx.noHarm);
  const { check } = outcome;
  const success = choice.check ? outcome.success : null;
  let crit: Resolution['crit'] = null;
  let next: string;
  let text: string;

  if (choice.check && success !== null) {
    const slots = check ? (success ? check.passedSlots : check.failedSlots) : [];
    const outcomeCtx: EffectContext = { ...effectCtx, rollerSlots: slots.length ? slots : undefined };
    changes.push(...applyEffects(adv, run, success ? choice.success : choice.failure, outcomeCtx, 'roller'));
    crit = check?.crit ?? null;
    if (success) run.score += SUCCESS_SCORE;
    const critSlot = check && check.rollerSlots.length === 1 ? check.rollerSlots[0] : undefined;
    const hero = critSlot === undefined ? undefined : run.heroes.find((h) => h.slot === critSlot);
    if (crit && hero && !ctx.noHarm) {
      if (crit === 'success') {
        run.score += CRIT_SCORE;
        const healed = healHero(hero, 1);
        changes.push({ kind: 'score', text: `Critical success! +${CRIT_SCORE} score${healed ? `, ${hero.name} +1 HP` : ''}`, tone: 'good', heroPlayerId: hero.playerId });
      } else {
        const hurt = applyEffects(adv, run, [{ hp: -1, target: 'target' }], { ...effectCtx, targetSlot: hero.slot });
        changes.push(...hurt.map((c) => (c.kind === 'hp' ? { ...c, text: `Critical fumble! ${c.text}` } : c)));
      }
    }
    next = (success ? choice.nextOnSuccess : choice.nextOnFailure) ?? choice.next ?? run.nodeId;
    text = interpolate(adv, run, (success ? choice.successText : choice.failureText) ?? choice.text ?? '', ctx.leaderSlot);
  } else {
    next = choice.next ?? run.nodeId;
    text = interpolate(adv, run, choice.text ?? '', ctx.leaderSlot);
  }

  run.turn += 1;
  run.timeline.push({
    turn: run.turn,
    chapter: node.chapter,
    nodeId: node.id,
    nodeTitle: interpolate(adv, run, node.title, ctx.leaderSlot),
    choiceId: choice.id,
    choiceLabel: interpolate(adv, run, choice.label, ctx.leaderSlot),
    votes: ctx.votes ?? 0,
    voters: ctx.voters ?? 0,
    ...(ctx.tieRule ? { tieRule: ctx.tieRule } : {}),
    ...(choice.check ? { stat: choice.check.stat, success: success ?? undefined, crit } : {}),
  });
  if (run.timeline.length > TIMELINE_LIMIT) run.timeline.splice(0, run.timeline.length - TIMELINE_LIMIT);

  const defeated = allKnockedOut(run);
  if (defeated) next = adv.defeatNode;
  return { success, crit, text, changes, next, defeated };
}

/** Resolve the winning choice: pay costs, roll (server RNG) and apply consequences. */
export function resolveChoice(adv: Adventure, run: RunState, choiceId: string, rng: Rng, ctx: ResolveContext = {}): Resolution {
  const node = getNode(adv, run.nodeId);
  const choice = node.choices.find((c) => c.id === choiceId);
  if (!choice || !isAvailable(adv, run, node, choice)) throw new Error(`Choice "${choiceId}" is not available at "${node.id}"`);
  const fromTitle = interpolate(adv, run, node.title, ctx.leaderSlot);
  const costs = payChoiceCosts(adv, run, choice, rng, ctx);
  const check = choice.check && !allKnockedOut(run) ? rollCheck(adv, run, choice.check, rng, ctx.voterSlots ?? []) : null;
  const res = applyOutcome(adv, run, choice, { success: check ? check.success : choice.check ? false : null, check }, rng, ctx);
  return { choice, fromNodeId: node.id, fromTitle, check, ...res, changes: [...costs, ...res.changes] };
}

// ---------------------------------------------------------------------------
// Votes bookkeeping
// ---------------------------------------------------------------------------

/** Track per-hero voting stats for awards. `votes` maps hero slot → choice id. */
export function recordVotes(run: RunState, votes: ReadonlyMap<number, string>, winner: string): void {
  for (const [slot, choiceId] of votes) {
    const hero = run.heroes.find((h) => h.slot === slot);
    if (!hero) continue;
    hero.stats.votes += 1;
    if (choiceId === winner) hero.stats.majorityVotes += 1;
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type UseItemResult = { ok: true; changes: QuestChangeView[]; itemName: string } | { ok: false; error: string };

export function useItem(adv: Adventure, run: RunState, itemId: string, actorSlot: number | undefined, targetSlot: number, rng: Rng): UseItemResult {
  const def = adv.items[itemId];
  if (!def) return { ok: false, error: 'That item does not exist.' };
  if (!def.use) return { ok: false, error: `${def.name} can't be used directly.` };
  if ((run.inventory[itemId] ?? 0) <= 0) return { ok: false, error: `The party has no ${def.name}.` };
  const target = run.heroes.find((h) => h.slot === targetSlot);
  if (def.use.target === 'hero') {
    if (!target) return { ok: false, error: 'Pick a hero to use it on.' };
    if (def.use.requires === 'conscious' && target.ko) return { ok: false, error: `${target.name} is knocked out — that won't help.` };
    if (def.use.requires === 'ko' && !target.ko) return { ok: false, error: `${target.name} is still on their feet.` };
  }
  const left = (run.inventory[itemId] ?? 0) - 1;
  if (left > 0) run.inventory[itemId] = left;
  else delete run.inventory[itemId];
  const actor = run.heroes.find((h) => h.slot === actorSlot);
  if (actor) actor.stats.itemsUsed += 1;
  const changes = applyEffects(adv, run, def.use.effects, { rng, targetSlot: target?.slot, healerSlot: actor?.slot }, def.use.target === 'party' ? 'party' : 'target');
  return { ok: true, changes, itemName: def.name };
}

// ---------------------------------------------------------------------------
// Signal Seer omens
// ---------------------------------------------------------------------------

function leadsToEnding(adv: Adventure, id: string | undefined): boolean {
  return Boolean(id && adv.nodeMap.get(id)?.ending);
}

const CALM_OMENS = [
  'The signal is steady. Safe, as far as the building is concerned.',
  'A low, contented hum. Nothing down this way wants to hurt you.',
  'The lights hold still when you think about this one.',
  'Quiet static — the kind that means “go on, then.”',
];

function variant(list: readonly string[], key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return list[h % list.length]!;
}

function autoOmen(adv: Adventure, node: AdventureNode, choice: Choice): string {
  const targets = [choice.next, choice.nextOnSuccess, choice.nextOnFailure];
  if (targets.some((t) => leadsToEnding(adv, t))) return 'The static falls silent. Something ends down this path.';
  const hurts = (list: Choice['failure']) => list.some((e) => isHpEffect(e) && e.hp < 0);
  const gains = (list: Choice['success']) => list.some((e) => 'addItem' in e || (isHpEffect(e) && e.hp > 0) || 'credits' in e);
  if (choice.check) {
    if (hurts(choice.failure)) return 'A sharp crackle in the signal: failure here will sting.';
    if (gains(choice.success)) return 'A warm hum: something worth having waits for the bold.';
    return 'The signal wavers — this one could go either way.';
  }
  if (gains(choice.effects)) return 'A soft chime in the static. A small gift, freely given.';
  if (hurts(choice.effects)) return 'The lights dim when you look this way. It will cost you.';
  const next = choice.next ? adv.nodeMap.get(choice.next) : undefined;
  if (next) {
    if (next.checkpoint && next.chapter !== node.chapter) return 'The hum drops an octave. A new chapter waits below.';
    const risky = next.choices.some((c) => c.check && hurts(c.failure)) || next.onEnter.some((e) => isHpEffect(e) && e.hp < 0);
    const rewarding = next.choices.some((c) => gains(c.effects) || (c.check && gains(c.success))) || next.onEnter.some((e) => 'addItem' in e);
    if (risky && rewarding) return 'Trouble and treasure, tangled together. Tread carefully.';
    if (risky) return 'Beyond this, the static crackles. Nothing you can’t handle — probably.';
    if (rewarding) return 'Something useful hums faintly in that direction.';
  }
  return variant(CALM_OMENS, `${node.id}/${choice.id}`);
}

/** Omens for every visible choice (sent privately to Signal Seer players). */
export function omensFor(adv: Adventure, run: RunState): Array<{ choiceId: string; text: string }> {
  if (!hasConscious(run, 'seer')) return [];
  const node = getNode(adv, run.nodeId);
  return node.choices
    .filter((c) => isVisible(adv, run, node, c))
    .map((c) => ({ choiceId: c.id, text: interpolate(adv, run, c.omen ?? autoOmen(adv, node, c)) }));
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface AwardSpec {
  id: string;
  title: string;
  description: string;
  value: (h: RunHero) => number;
  min: number;
}

const AWARDS: AwardSpec[] = [
  { id: 'clutch', title: 'Clutch Roller', description: 'Most successful checks', value: (h) => h.stats.successes, min: 1 },
  { id: 'lucky', title: 'Lucky Charm', description: 'Most natural 20s', value: (h) => h.stats.crits, min: 1 },
  { id: 'shield', title: 'Human Shield', description: 'Most damage absorbed or taken for the team', value: (h) => h.stats.damagePrevented + h.stats.damageTaken, min: 1 },
  { id: 'medic', title: 'Team Medic', description: 'Most healing handed out', value: (h) => h.stats.healing, min: 1 },
  { id: 'voice', title: 'Voice of the People', description: 'Voted with the party most often', value: (h) => h.stats.majorityVotes, min: 1 },
  { id: 'rebel', title: 'Contrarian', description: 'Outvoted the most (and proud of it)', value: (h) => h.stats.votes - h.stats.majorityVotes, min: 2 },
  { id: 'fumble', title: 'Butterfingers', description: 'Most natural 1s', value: (h) => h.stats.fumbles, min: 1 },
];

export function computeAwards(run: RunState, max = 5): QuestAwardView[] {
  const awarded = new Set<number>();
  const out: QuestAwardView[] = [];
  const allowRepeat = run.heroes.length <= 2;
  for (const spec of AWARDS) {
    if (out.length >= max) break;
    const ranked = run.heroes
      .map((h) => ({ h, v: spec.value(h) }))
      .filter((x) => x.v >= spec.min)
      .sort((a, b) => b.v - a.v || a.h.slot - b.h.slot);
    // Prefer spreading awards across the party; tiny parties may repeat a winner.
    const pick = ranked.find((x) => !awarded.has(x.h.slot)) ?? (allowRepeat ? ranked[0] : undefined);
    if (!pick) continue;
    awarded.add(pick.h.slot);
    out.push({
      id: spec.id,
      title: spec.title,
      description: `${spec.description} (${pick.v})`,
      heroPlayerId: pick.h.playerId,
      name: pick.h.name,
      color: pick.h.color,
      archetype: pick.h.archetype,
    });
  }
  return out;
}

export function buildResults(adv: Adventure, run: RunState, opts: { endingsFound?: number } = {}): QuestResultView {
  const endingId = run.endingId ?? getNode(adv, adv.defeatNode).ending ?? '';
  const ending = adv.endings[endingId];
  if (!ending) throw new Error(`Unknown ending "${endingId}"`);
  const survivors = run.heroes.filter((h) => !h.ko).length;
  const score = Math.max(0, run.score + ending.bonus + survivors * 25);
  return {
    endingId,
    title: ending.title,
    tier: ending.tier,
    epilogue: ending.epilogue.map((p) => interpolate(adv, run, p)),
    theme: ending.theme,
    score,
    turns: run.turn,
    clock: formatClock(adv, run.turn),
    packTitle: adv.title,
    endingsFound: opts.endingsFound ?? 1,
    endingsTotal: Object.keys(adv.endings).length,
    heroes: run.heroes.map((h) => ({
      playerId: h.playerId,
      name: h.name,
      color: h.color,
      archetype: h.archetype,
      hp: h.hp,
      maxHp: h.maxHp,
      ko: h.ko,
      rolls: h.stats.rolls,
      successes: h.stats.successes,
      crits: h.stats.crits,
      fumbles: h.stats.fumbles,
      damageTaken: h.stats.damageTaken,
      healing: h.stats.healing,
    })),
    awards: computeAwards(run),
    timeline: run.timeline.map((t) => ({
      turn: t.turn,
      chapter: t.chapter,
      nodeTitle: t.nodeTitle,
      choiceLabel: t.choiceLabel,
      votes: t.votes,
      voters: t.voters,
      ...(t.tieRule ? { tieRule: t.tieRule } : {}),
      ...(t.stat ? { stat: t.stat as QuestResultView['timeline'][number]['stat'], success: t.success, crit: t.crit ?? null } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Snapshots (saves)
// ---------------------------------------------------------------------------

/** A save-ready copy of the run with player bindings removed. */
export function snapshotRun(run: RunState): RunState {
  const copy = structuredClone(run);
  for (const h of copy.heroes) h.playerId = '';
  return copy;
}

export type RestoreResult = { ok: true; run: RunState } | { ok: false; error: string };

/** Validate an untrusted snapshot against the schema and the pack. */
export function restoreRun(adv: Adventure, raw: unknown): RestoreResult {
  const parsed = RunStateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'The save file is damaged.' };
  const run = parsed.data as RunState;
  if (run.packId !== adv.id) return { ok: false, error: 'That save belongs to a different adventure.' };
  if (run.packVersion !== adv.version) return { ok: false, error: `That save was made with version ${run.packVersion} of this adventure (now ${adv.version}).` };
  const node = adv.nodeMap.get(run.nodeId);
  if (!node || node.ending) return { ok: false, error: 'That save points at a scene that no longer exists.' };
  // Checkpoints are only ever taken mid-adventure: a finished run can't be resumed.
  if (run.endingId !== null) return { ok: false, error: 'That adventure is already over.' };
  if (run.chapter !== node.chapter) return { ok: false, error: 'The save file is damaged.' };
  for (const id of Object.keys(run.inventory)) if (!adv.items[id]) return { ok: false, error: 'The save contains unknown items.' };
  for (const h of run.heroes) {
    for (const s of h.statuses) if (!adv.statuses[s.id]) return { ok: false, error: 'The save contains unknown statuses.' };
    if (!adv.archetypes.includes(h.archetype)) return { ok: false, error: 'The save contains a hero this adventure does not allow.' };
    if (h.hp > h.maxHp || (h.ko && h.hp > 0)) return { ok: false, error: 'The save file is damaged.' };
  }
  const slots = new Set(run.heroes.map((h) => h.slot));
  if (slots.size !== run.heroes.length) return { ok: false, error: 'The save file is damaged.' };
  return { ok: true, run };
}

/** Reassign party slots 0..n-1 in order (after dropping/adding heroes). */
export function compactSlots(run: RunState): void {
  const map = new Map<number, number>();
  run.heroes.forEach((h, i) => {
    map.set(h.slot, i);
    h.slot = i;
  });
  run.shieldUsed = run.shieldUsed.map((s) => map.get(s)).filter((s): s is number => s !== undefined);
  run.rerollUsed = run.rerollUsed.map((s) => map.get(s)).filter((s): s is number => s !== undefined);
}

export function isRunOver(run: RunState): boolean {
  return run.endingId !== null || consciousHeroes(run).length === 0;
}
