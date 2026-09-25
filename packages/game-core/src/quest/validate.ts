/**
 * Pack loading and validation.
 *
 * loadAdventure()      Zod parse + cross-reference checks; throws AdventureError on errors.
 * validateAdventure()  errors (broken references, dead ends, unfinishable nodes) and
 *                      warnings (unreachable nodes, flags read but never set, …).
 * exploreAdventure()   exhaustive state-space walk (BFS) over everything that can affect
 *                      control flow, forcing both outcomes of every check, to prove that
 *                      every ending is reachable and no reachable state is a dead end.
 */
import { createSeededRng } from '@dascade/shared';
import { QUEST_ARCHETYPE_IDS, type QuestArchetypeId } from '@dascade/shared/games/quest';
import { AdventureSchema, type Adventure, type AdventureInput, type AdventureNode, type Choice, type Condition, type Effect } from './schema.ts';
import type { RunState } from './state.ts';
import { VARIABLE_RE, isKnownVariable } from './interpolate.ts';
import { applyOutcome, availableChoices, createRun, enterNode, payChoiceCosts } from './engine.ts';

export class AdventureError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'AdventureError';
  }
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

function index(data: ReturnType<typeof AdventureSchema.parse>): Adventure {
  const nodeMap = new Map<string, AdventureNode>();
  for (const n of data.nodes) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  const titles = new Map(data.chapters.map((c) => [c.number, c.title]));
  return { ...data, nodeMap, chapterTitle: (n: number) => titles.get(n) ?? `Chapter ${n}` };
}

/** Parse + validate a pack. Throws AdventureError listing every problem. */
export function loadAdventure(input: AdventureInput): Adventure {
  const parsed = AdventureSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 25).map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new AdventureError(`Adventure pack failed schema validation (${parsed.error.issues.length} issue(s))`, issues);
  }
  const adv = index(parsed.data);
  const report = validateAdventure(adv);
  if (report.errors.length) throw new AdventureError(`Adventure "${adv.id}" is invalid`, report.errors);
  return adv;
}

// ---------------------------------------------------------------------------
// Reference walking helpers
// ---------------------------------------------------------------------------

function walkCondition(cond: Condition, fn: (c: Condition) => void): void {
  fn(cond);
  if ('all' in cond) cond.all.forEach((c) => walkCondition(c, fn));
  else if ('any' in cond) cond.any.forEach((c) => walkCondition(c, fn));
  else if ('not' in cond) walkCondition(cond.not, fn);
}

function allConditions(adv: Adventure): Array<{ where: string; cond: Condition }> {
  const out: Array<{ where: string; cond: Condition }> = [];
  for (const n of adv.nodes) {
    n.routes.forEach((r, i) => out.push({ where: `${n.id}.routes[${i}]`, cond: r.if }));
    for (const c of n.choices) {
      if (c.if) out.push({ where: `${n.id}/${c.id}.if`, cond: c.if });
      if (c.check?.advantageIf) out.push({ where: `${n.id}/${c.id}.check.advantageIf`, cond: c.check.advantageIf });
    }
  }
  return out;
}

function allEffects(adv: Adventure): Array<{ where: string; effect: Effect }> {
  const out: Array<{ where: string; effect: Effect }> = [];
  for (const n of adv.nodes) {
    n.onEnter.forEach((e) => out.push({ where: `${n.id}.onEnter`, effect: e }));
    for (const c of n.choices) {
      for (const list of ['effects', 'success', 'failure'] as const) c[list].forEach((e) => out.push({ where: `${n.id}/${c.id}.${list}`, effect: e }));
    }
  }
  for (const [id, item] of Object.entries(adv.items)) item.use?.effects.forEach((e) => out.push({ where: `items.${id}.use`, effect: e }));
  return out;
}

export function choiceTargets(choice: Choice): string[] {
  return [choice.next, choice.nextOnSuccess, choice.nextOnFailure].filter((x): x is string => Boolean(x));
}

function nodeEdges(node: AdventureNode): string[] {
  return [...node.choices.flatMap(choiceTargets), ...node.routes.map((r) => r.to)];
}

// ---------------------------------------------------------------------------
// Static validation
// ---------------------------------------------------------------------------

export function validateAdventure(adv: Adventure): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = adv.nodeMap;

  // Unique ids.
  const seen = new Set<string>();
  for (const n of adv.nodes) {
    if (seen.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    seen.add(n.id);
  }

  if (!nodes.has(adv.startNode)) errors.push(`startNode "${adv.startNode}" does not exist`);
  const defeat = nodes.get(adv.defeatNode);
  if (!defeat) errors.push(`defeatNode "${adv.defeatNode}" does not exist`);
  else if (!defeat.ending) errors.push(`defeatNode "${adv.defeatNode}" must be an ending node`);

  const chapterNumbers = new Set(adv.chapters.map((c) => c.number));
  const allowed = new Set<QuestArchetypeId>(adv.archetypes);
  const stats = new Set(adv.stats);

  for (const n of adv.nodes) {
    if (!chapterNumbers.has(n.chapter)) errors.push(`${n.id}: chapter ${n.chapter} is not declared in chapters`);
    if (n.ending) {
      if (!adv.endings[n.ending]) errors.push(`${n.id}: unknown ending "${n.ending}"`);
      if (n.choices.length) errors.push(`${n.id}: ending nodes cannot have choices`);
      if (n.routes.length) errors.push(`${n.id}: ending nodes cannot have routes`);
    } else {
      if (n.choices.length === 0) errors.push(`${n.id}: non-ending node has no choices`);
      const fallback = n.choices.some((c) => !c.if && !c.secret && !c.once);
      if (n.choices.length && !fallback) errors.push(`${n.id}: needs at least one always-available choice (no condition, not secret, not once) so the party can never get stuck`);
    }
    const choiceIds = new Set<string>();
    for (const c of n.choices) {
      if (choiceIds.has(c.id)) errors.push(`${n.id}: duplicate choice id "${c.id}"`);
      choiceIds.add(c.id);
      if (c.check) {
        if (!c.next && !(c.nextOnSuccess && c.nextOnFailure)) errors.push(`${n.id}/${c.id}: a check needs "next" or both "nextOnSuccess" and "nextOnFailure"`);
        if (!stats.has(c.check.stat)) errors.push(`${n.id}/${c.id}: stat ${c.check.stat} is not in the pack's stats list`);
      } else {
        if (!c.next) errors.push(`${n.id}/${c.id}: needs "next"`);
        if (c.nextOnSuccess || c.nextOnFailure) errors.push(`${n.id}/${c.id}: nextOnSuccess/nextOnFailure need a check`);
        if (c.success.length || c.failure.length) errors.push(`${n.id}/${c.id}: success/failure effects need a check`);
      }
      for (const t of choiceTargets(c)) if (!nodes.has(t)) errors.push(`${n.id}/${c.id}: target node "${t}" does not exist`);
      for (const text of [c.label, c.flavor, c.text, c.successText, c.failureText, c.omen]) checkVars(adv, text, `${n.id}/${c.id}`, warnings);
    }
    for (const r of n.routes) if (!nodes.has(r.to)) errors.push(`${n.id}: route target "${r.to}" does not exist`);
    for (const p of n.narrative) checkVars(adv, p, n.id, warnings);
  }

  // References inside conditions and effects.
  const flagsSet = new Set<string>();
  const flagsRead = new Set<string>();
  for (const { where, cond } of allConditions(adv)) {
    walkCondition(cond, (c) => {
      if ('hasItem' in c && !adv.items[c.hasItem]) errors.push(`${where}: unknown item "${c.hasItem}"`);
      if ('status' in c && !adv.statuses[c.status]) errors.push(`${where}: unknown status "${c.status}"`);
      if ('visited' in c && !nodes.has(c.visited)) errors.push(`${where}: unknown node "${c.visited}"`);
      if ('archetype' in c && !allowed.has(c.archetype)) warnings.push(`${where}: archetype "${c.archetype}" is not allowed in this pack`);
      if ('stat' in c && !stats.has(c.stat)) errors.push(`${where}: stat ${c.stat} is not in the pack's stats list`);
      if ('flag' in c) flagsRead.add(c.flag);
      if ('counter' in c) flagsRead.add(c.counter);
    });
  }
  for (const { where, effect } of allEffects(adv)) {
    if ('addItem' in effect && !adv.items[effect.addItem]) errors.push(`${where}: unknown item "${effect.addItem}"`);
    if ('removeItem' in effect && !adv.items[effect.removeItem]) errors.push(`${where}: unknown item "${effect.removeItem}"`);
    if ('addStatus' in effect && !adv.statuses[effect.addStatus]) errors.push(`${where}: unknown status "${effect.addStatus}"`);
    if ('removeStatus' in effect && !adv.statuses[effect.removeStatus]) errors.push(`${where}: unknown status "${effect.removeStatus}"`);
    if ('setFlag' in effect) flagsSet.add(effect.setFlag);
    if ('addCounter' in effect) flagsSet.add(effect.addCounter);
    if ('note' in effect) checkVars(adv, effect.note, where, warnings);
    const target = 'revive' in effect ? effect.revive : 'hp' in effect || 'addStatus' in effect || 'removeStatus' in effect ? (effect as { target?: string }).target : undefined;
    if (target === 'target' && !where.startsWith('items.')) errors.push(`${where}: target "target" only works in item use effects`);
  }
  for (const f of flagsRead) if (!flagsSet.has(f)) warnings.push(`flag/counter "${f}" is read but never set`);
  for (const [archetype, kit] of Object.entries(adv.kits)) {
    for (const k of kit ?? []) if (!adv.items[k.item]) errors.push(`kits.${archetype}: unknown item "${k.item}"`);
    if (!allowed.has(archetype as QuestArchetypeId)) warnings.push(`kits.${archetype}: archetype not allowed in this pack`);
  }
  for (const [id, item] of Object.entries(adv.items)) {
    const aimsAtTarget = (e: Effect) => ('revive' in e ? e.revive === 'target' : (e as { target?: string }).target === 'target');
    if (item.use?.target === 'hero' && !item.use.effects.some(aimsAtTarget)) {
      warnings.push(`items.${id}: hero-targeted use has no effect aimed at "target"`);
    }
  }

  // Endings used.
  const usedEndings = new Set(adv.nodes.map((n) => n.ending).filter(Boolean));
  for (const id of Object.keys(adv.endings)) if (!usedEndings.has(id)) warnings.push(`ending "${id}" is not used by any node`);

  // Checkpoints per chapter.
  for (const ch of adv.chapters) {
    if (!adv.nodes.some((n) => n.chapter === ch.number && n.checkpoint)) warnings.push(`chapter ${ch.number} has no checkpoint node`);
  }

  if (errors.length) return { errors, warnings };

  // Graph: structural reachability from start.
  const reachable = new Set<string>([adv.startNode, adv.defeatNode]);
  const queue = [adv.startNode];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const next of nodeEdges(nodes.get(id)!)) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const n of adv.nodes) if (!reachable.has(n.id)) warnings.push(`node "${n.id}" is unreachable from the start`);

  // Every reachable node must be able to reach an ending (no inescapable loops).
  const reverse = new Map<string, string[]>();
  for (const n of adv.nodes) for (const to of nodeEdges(n)) reverse.set(to, [...(reverse.get(to) ?? []), n.id]);
  const canEnd = new Set(adv.nodes.filter((n) => n.ending).map((n) => n.id));
  const back = [...canEnd];
  while (back.length) {
    const id = back.shift() as string;
    for (const prev of reverse.get(id) ?? []) {
      if (!canEnd.has(prev)) {
        canEnd.add(prev);
        back.push(prev);
      }
    }
  }
  for (const id of reachable) if (!canEnd.has(id)) errors.push(`node "${id}" can never reach an ending`);

  return { errors, warnings };
}

function checkVars(adv: Adventure, text: string | undefined, where: string, warnings: string[]): void {
  if (!text) return;
  for (const m of text.matchAll(VARIABLE_RE)) {
    if (!isKnownVariable(adv, m[1] as string)) warnings.push(`${where}: unknown variable {${m[1]}}`);
  }
}

// ---------------------------------------------------------------------------
// State-space exploration
// ---------------------------------------------------------------------------

export interface ExploreOptions {
  /** Stop after this many expanded states (report.truncated = true). */
  maxStates?: number;
  /**
   * 0 = exact BFS over every distinct live state (small packs).
   * 1 = novelty-pruned BFS (IW(1)): a state is expanded only if it makes some
   *     (node, feature=value) atom true for the first time. Complete for the kinds of
   *     "collect X, then use it at Y" goals adventure packs are made of, and bounded
   *     by nodes × features × values, so it scales to large packs.
   */
  width?: 0 | 1;
}

export interface ExploreReport {
  states: number;
  truncated: boolean;
  endings: Set<string>;
  endingNodes: Set<string>;
  visitedNodes: Set<string>;
  /** Reachable non-ending states with no available choice. */
  deadEnds: string[];
  /** Shortest decision path found to each ending: `nodeId/choiceId[:S|:F]` steps. */
  pathTo: Map<string, string[]>;
}

type Feature =
  | { kind: 'item'; id: string; cap: number }
  | { kind: 'flag'; id: string }
  | { kind: 'counter'; id: string; cap: number }
  | { kind: 'visited'; id: string }
  | { kind: 'taken'; id: string }
  | { kind: 'status'; id: string }
  | { kind: 'credits'; cap: number };

function featureName(f: Feature): string {
  return f.kind === 'credits' ? 'credits' : `${f.kind}:${f.id}`;
}

/** Features each node's own conditions/routes read (advantageIf excluded: it only changes odds). */
function localFeatures(node: AdventureNode): Feature[] {
  const out: Feature[] = [];
  const conds: Condition[] = [...node.routes.map((r) => r.if), ...node.choices.flatMap((c) => (c.if ? [c.if] : []))];
  for (const cond of conds) {
    walkCondition(cond, (c) => {
      if ('hasItem' in c) out.push({ kind: 'item', id: c.hasItem, cap: c.qty ?? 1 });
      if ('flag' in c) out.push({ kind: 'flag', id: c.flag });
      if ('counter' in c) out.push({ kind: 'counter', id: c.counter, cap: Math.max(c.atLeast ?? 0, c.below ?? 0) });
      if ('visited' in c) out.push({ kind: 'visited', id: c.visited });
      if ('status' in c) out.push({ kind: 'status', id: c.status });
      if ('credits' in c) out.push({ kind: 'credits', cap: c.credits });
    });
  }
  for (const c of node.choices) if (c.once) out.push({ kind: 'taken', id: `${node.id}/${c.id}` });
  return out;
}

function mergeFeatures(list: Feature[]): Map<string, Feature> {
  const out = new Map<string, Feature>();
  for (const f of list) {
    const key = featureName(f);
    const prev = out.get(key);
    if (prev && 'cap' in prev && 'cap' in f) out.set(key, { ...prev, cap: Math.max(prev.cap, f.cap) } as Feature);
    else if (!prev) out.set(key, f);
  }
  return out;
}

/** Live features per node: everything readable at this node or any node reachable from it. */
function liveFeatures(adv: Adventure): Map<string, Feature[]> {
  const local = new Map(adv.nodes.map((n) => [n.id, localFeatures(n)]));
  const live = new Map<string, Map<string, Feature>>();
  for (const n of adv.nodes) live.set(n.id, mergeFeatures(local.get(n.id) ?? []));
  // Fixed point: live(n) ⊇ live(successor).
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of adv.nodes) {
      const mine = live.get(n.id)!;
      for (const to of nodeEdges(n)) {
        for (const [k, f] of live.get(to) ?? []) {
          const prev = mine.get(k);
          if (!prev) {
            mine.set(k, f);
            changed = true;
          } else if ('cap' in prev && 'cap' in f && f.cap > prev.cap) {
            mine.set(k, { ...prev, cap: f.cap } as Feature);
            changed = true;
          }
        }
      }
    }
  }
  return new Map([...live].map(([id, m]) => [id, [...m.values()]]));
}

function featureValue(run: RunState, f: Feature): string {
  switch (f.kind) {
    case 'item':
      return String(Math.min(f.cap, run.inventory[f.id] ?? 0));
    case 'flag':
      return String(run.flags[f.id] ?? '');
    case 'counter': {
      const v = run.flags[f.id];
      return String(Math.min(f.cap, typeof v === 'number' ? v : v === true ? 1 : 0));
    }
    case 'visited':
      return run.visited.includes(f.id) ? '1' : '0';
    case 'taken':
      return run.taken.includes(f.id) ? '1' : '0';
    case 'status':
      return run.heroes.some((h) => !h.ko && h.statuses.some((s) => s.id === f.id)) ? '1' : '0';
    case 'credits':
      return String(Math.min(f.cap, run.credits));
  }
}

/**
 * Walk the reachable story for a party composition. HP damage is suppressed so the
 * walk measures story reachability rather than luck, and both outcomes of every check
 * are explored. (The defeat ending is reachable from any scene by losing all HP; the
 * engine tests cover it directly.)
 */
export function exploreAdventure(adv: Adventure, party: readonly QuestArchetypeId[], options: ExploreOptions = {}): ExploreReport {
  const maxStates = options.maxStates ?? 200_000;
  const width = options.width ?? 0;
  const rng = createSeededRng(`explore:${adv.id}:${party.join(',')}`);
  const live = liveFeatures(adv);
  const seeds = party.map((archetype, i) => ({ playerId: `p${i}`, name: `Hero ${i + 1}`, color: '#a3e635', archetype }));
  const { run: start } = createRun(adv, seeds, { runId: 'explore' }, rng);
  const report: ExploreReport = { states: 0, truncated: false, endings: new Set(), endingNodes: new Set(), visitedNodes: new Set(), deadEnds: [], pathTo: new Map() };

  const keyOf = (run: RunState) => {
    const feats = live.get(run.nodeId) ?? [];
    return `${run.nodeId}|${feats.map((f) => `${featureName(f)}=${featureValue(run, f)}`).join('|')}`;
  };
  const atoms = new Set<string>();
  const novel = (run: RunState): boolean => {
    let fresh = false;
    const nodeAtom = `@${run.nodeId}`;
    if (!atoms.has(nodeAtom)) {
      atoms.add(nodeAtom);
      fresh = true;
    }
    for (const f of live.get(run.nodeId) ?? []) {
      const atom = `${run.nodeId}|${featureName(f)}=${featureValue(run, f)}`;
      if (!atoms.has(atom)) {
        atoms.add(atom);
        fresh = true;
      }
    }
    return fresh;
  };

  const seen = new Set<string>([keyOf(start)]);
  if (width === 1) novel(start);
  const queue: Array<{ run: RunState; path: string[] }> = [{ run: start, path: [] }];
  const record = (run: RunState, path: string[]) => {
    report.visitedNodes.add(run.nodeId);
    if (run.endingId) {
      report.endings.add(run.endingId);
      report.endingNodes.add(run.nodeId);
      if (!report.pathTo.has(run.endingId)) report.pathTo.set(run.endingId, path);
    }
  };
  record(start, []);

  for (let head = 0; head < queue.length; head++) {
    if (report.states >= maxStates) {
      report.truncated = true;
      break;
    }
    const { run, path } = queue[head]!;
    queue[head] = undefined as never;
    report.states++;
    if (run.endingId) continue;
    const choices = availableChoices(adv, run);
    if (choices.length === 0) {
      report.deadEnds.push(run.nodeId);
      continue;
    }
    for (const choice of choices) {
      const outcomes: Array<boolean | null> = choice.check ? [true, false] : [null];
      for (const success of outcomes) {
        const next = structuredClone(run);
        payChoiceCosts(adv, next, choice, rng, { noHarm: true });
        const res = applyOutcome(adv, next, choice, { success, check: null }, rng, { noHarm: true });
        enterNode(adv, next, res.next, rng, { noHarm: true });
        next.timeline = [];
        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        if (width === 1 && !next.endingId && !novel(next)) continue;
        const nextPath = [...path, `${run.nodeId}/${choice.id}${success === null ? '' : success ? ':S' : ':F'}`];
        record(next, nextPath);
        queue.push({ run: next, path: nextPath });
      }
    }
  }
  return report;
}

export const ALL_ARCHETYPES: readonly QuestArchetypeId[] = QUEST_ARCHETYPE_IDS;
