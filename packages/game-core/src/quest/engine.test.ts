import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { diceRng, lab, labRun, seeds } from './test-fixtures.ts';
import { evaluate, unavailableReason } from './conditions.ts';
import { applyEffects, tickStatuses } from './effects.ts';
import { atLeastOdds, checkOdds, dieOdds, difficultyLabel, effectiveDc, rollCheck } from './checks.ts';
import { checkModifier } from './stats.ts';
import {
  availableChoices,
  buildResults,
  computeAwards,
  createRun,
  enterNode,
  omensFor,
  presentScene,
  recordVotes,
  resolveChoice,
  restoreRun,
  snapshotRun,
  useItem,
} from './engine.ts';
import { formatClock, interpolate, joinNames } from './interpolate.ts';
import type { Check } from './schema.ts';

const check = (partial: Partial<Check> & Pick<Check, 'stat' | 'dc'>): Check => ({ who: 'best', tags: [], ...partial });

describe('run creation', () => {
  it('builds heroes from archetypes, applies kits, credits and the start node', () => {
    const { run, enter } = labRun('tinker', 'analyst', 'guardian');
    expect(run.heroes.map((h) => [h.slot, h.archetype, h.hp, h.maxHp])).toEqual([
      [0, 'tinker', 8, 8],
      [1, 'analyst', 7, 7],
      [2, 'guardian', 12, 12],
    ]);
    expect(run.inventory).toEqual({ tape: 1, duck: 1 });
    expect(run.credits).toBe(2);
    expect(run.nodeId).toBe('start');
    expect(run.visited).toEqual(['start']);
    expect(enter.checkpoint).toBe(true);
    expect(run.packVersion).toBe('1.2.3');
  });

  it('gives a solo hero bonus HP', () => {
    const { run } = labRun('analyst');
    expect(run.heroes[0]!.maxHp).toBe(11);
  });

  it('rejects empty and oversized parties', () => {
    const adv = lab();
    expect(() => createRun(adv, [], { runId: 'x' }, diceRng([]))).toThrow();
    const many = seeds(...Array.from({ length: 13 }, () => 'scout' as const));
    expect(() => createRun(adv, many, { runId: 'x' }, diceRng([]))).toThrow();
  });
});

describe('conditions', () => {
  it('evaluates items, archetypes, credits, flags, counters, AND / OR / NOT', () => {
    const { adv, run } = labRun('tinker', 'scout');
    expect(evaluate(adv, run, { hasItem: 'tape' })).toBe(true);
    expect(evaluate(adv, run, { hasItem: 'tape', qty: 2 })).toBe(false);
    expect(evaluate(adv, run, { archetype: 'tinker' })).toBe(true);
    expect(evaluate(adv, run, { archetype: 'analyst' })).toBe(false);
    expect(evaluate(adv, run, { credits: 2 })).toBe(true);
    expect(evaluate(adv, run, { credits: 3 })).toBe(false);
    run.flags.won = true;
    run.flags.k = 3;
    expect(evaluate(adv, run, { flag: 'won' })).toBe(true);
    expect(evaluate(adv, run, { flag: 'won', equals: false })).toBe(false);
    expect(evaluate(adv, run, { flag: 'k', equals: 3 })).toBe(true);
    expect(evaluate(adv, run, { counter: 'k', atLeast: 3 })).toBe(true);
    expect(evaluate(adv, run, { counter: 'k', below: 3 })).toBe(false);
    expect(evaluate(adv, run, { counter: 'missing', below: 1 })).toBe(true);
    expect(evaluate(adv, run, { all: [{ archetype: 'tinker' }, { hasItem: 'tape' }] })).toBe(true);
    expect(evaluate(adv, run, { all: [{ archetype: 'tinker' }, { hasItem: 'key' }] })).toBe(false);
    expect(evaluate(adv, run, { any: [{ archetype: 'analyst' }, { hasItem: 'tape' }] })).toBe(true);
    expect(evaluate(adv, run, { not: { hasItem: 'key' } })).toBe(true);
    expect(evaluate(adv, run, { visited: 'start' })).toBe(true);
    expect(evaluate(adv, run, { partySize: { min: 2, max: 2 } })).toBe(true);
    expect(evaluate(adv, run, { partySize: { min: 3 } })).toBe(false);
    expect(evaluate(adv, run, { stat: 'REFLEX', atLeast: 4 })).toBe(true);
    expect(evaluate(adv, run, { stat: 'CHARM', atLeast: 3 })).toBe(false);
  });

  it('ignores knocked-out heroes for archetype, stat and status conditions', () => {
    const { adv, run } = labRun('tinker', 'scout');
    run.heroes[0]!.ko = true;
    run.heroes[0]!.hp = 0;
    expect(evaluate(adv, run, { archetype: 'tinker' })).toBe(false);
    expect(evaluate(adv, run, { stat: 'WITS', atLeast: 4 })).toBe(false);
    expect(evaluate(adv, run, { anyKo: true })).toBe(true);
    expect(evaluate(adv, run, { partyHp: { belowPct: 0.6 } })).toBe(true);
  });

  it('explains why a choice is unavailable', () => {
    const { adv, run } = labRun('scout');
    expect(unavailableReason(adv, run, { hasItem: 'key' })).toBe('Requires: Keycard');
    expect(unavailableReason(adv, run, { archetype: 'tinker' })).toBe('Tinker only');
    expect(unavailableReason(adv, run, { all: [{ archetype: 'tinker' }, { hasItem: 'key' }] })).toBe('Requires: Tinker + Keycard');
    expect(unavailableReason(adv, run, { credits: 5 })).toBe('Requires: 5 credits');
    expect(unavailableReason(adv, run, { any: [{ hasItem: 'key' }, { hasItem: 'lens' }] })).toBe('Requires: Keycard or Lens');
    run.heroes.push({ ...structuredClone(run.heroes[0]!), slot: 1, archetype: 'tinker', ko: true, hp: 0 });
    expect(unavailableReason(adv, run, { archetype: 'tinker' })).toBe('Tinker is knocked out');
  });
});

describe('scene presentation', () => {
  it('interpolates variables and never emits markup', () => {
    const { adv, run } = labRun('tinker', 'scout');
    const scene = presentScene(adv, run, { leaderSlot: 1, rev: 4 });
    expect(scene.paragraphs[0]).toBe('Hello H0 and H1 (2). Leader H1. 2 credits, 1 tape, clock 6:47 PM. H0. {unknown.var}');
    expect(scene.rev).toBe(4);
    expect(scene.chapterTitle).toBe('One');
    expect(scene.checkpoint).toBe(true);
  });

  it('shows disabled choices with reasons, hides hidden ones and reveals secrets only to Scouts', () => {
    const { adv, run } = labRun('guardian');
    const scene = presentScene(adv, run);
    const byId = Object.fromEntries(scene.choices.map((c) => [c.id, c]));
    expect(byId.hidden).toBeUndefined();
    expect(byId.secret).toBeUndefined();
    expect(byId.keyed).toMatchObject({ available: false, reason: 'Requires: Keycard' });
    expect(byId.tinker_only).toMatchObject({ available: false, reason: 'Tinker only' });
    expect(byId.custom).toMatchObject({ available: false, reason: 'Requires: a fortune' });
    expect(byId.plain!.available).toBe(true);
    const withScout = labRun('scout');
    const scout = presentScene(withScout.adv, withScout.run);
    expect(scout.choices.find((c) => c.id === 'secret')).toMatchObject({ secret: true, available: true });
    withScout.run.heroes[0]!.ko = true;
    expect(presentScene(withScout.adv, withScout.run).choices.find((c) => c.id === 'secret')).toBeUndefined();
  });

  it('hides exact DCs and odds unless an Analyst is conscious', () => {
    const plain = labRun('guardian', 'scout');
    const wits = presentScene(plain.adv, plain.run).choices.find((c) => c.id === 'wits')!;
    expect(wits.check).toMatchObject({ stat: 'WITS', difficulty: 'Moderate', advantage: false });
    expect(wits.check!.dc).toBeUndefined();
    expect(wits.check!.odds).toBeUndefined();
    const smart = labRun('analyst', 'scout');
    const scene = presentScene(smart.adv, smart.run);
    expect(scene.revealOdds).toBe(true);
    const w = scene.choices.find((c) => c.id === 'wits')!;
    // Analyst WITS +2, duo assist −1 → DC 11. Needs 9+ → 12/20.
    expect(w.check).toMatchObject({ dc: 11, odds: 0.6, rollerName: 'H0' });
  });
});

describe('checks', () => {
  it('computes modifiers from stats, statuses, gear and abilities', () => {
    const { adv, run } = labRun('tinker', 'analyst');
    const tinker = run.heroes[0]!;
    expect(checkModifier(adv, run, tinker, 'WITS', ['tech'])).toEqual({
      total: 6,
      parts: [
        { label: 'WIT', value: 4 },
        { label: 'Jury-Rig', value: 2 },
      ],
    });
    tinker.statuses.push({ id: 'buzzed', turns: 2 });
    run.inventory.lens = 1;
    const mystic = checkModifier(adv, run, tinker, 'INTUITION', ['mystic']);
    expect(mystic.total).toBe(1 + 1 + 2);
    expect(mystic.parts.map((p) => p.label)).toEqual(['INT', 'Buzzed', 'Lens']);
    const analyst = run.heroes[1]!;
    expect(checkModifier(adv, run, analyst, 'LOGIC', []).total).toBe(5);
  });

  it('applies difficulty shift and small-party assist to the DC', () => {
    const { run } = labRun('scout');
    expect(effectiveDc(run, { dc: 12 })).toBe(10);
    run.dcShift = 2;
    expect(effectiveDc(run, { dc: 12 })).toBe(12);
    const trio = labRun('scout', 'tinker', 'guardian').run;
    expect(effectiveDc(trio, { dc: 12 })).toBe(12);
    expect(difficultyLabel(4)).toBe('Trivial');
    expect(difficultyLabel(9)).toBe('Easy');
    expect(difficultyLabel(12)).toBe('Moderate');
    expect(difficultyLabel(15)).toBe('Hard');
    expect(difficultyLabel(18)).toBe('Very hard');
    expect(difficultyLabel(21)).toBe('Heroic');
  });

  it('natural 20 always succeeds and natural 1 always fails', () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker');
    const impossible = check({ stat: 'LOGIC', dc: 30 });
    const r20 = rollCheck(adv, run, impossible, diceRng([20]));
    expect(r20).toMatchObject({ success: true, crit: 'success' });
    const trivial = check({ stat: 'GRIT', dc: 2 });
    const r1 = rollCheck(adv, run, trivial, diceRng([1]));
    expect(r1).toMatchObject({ success: false, crit: 'failure' });
    expect(run.heroes[0]!.stats).toMatchObject({ rolls: 1, crits: 0, fumbles: 1 });
  });

  it('uses the best hero, compares total against the DC and reports the math', () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker');
    const r = rollCheck(adv, run, check({ stat: 'WITS', dc: 15, tags: ['tech'] }), diceRng([9]));
    expect(r.dice).toHaveLength(1);
    expect(r.dice[0]).toMatchObject({ name: 'H2', kept: 9, modifier: 6, total: 15, success: true, crit: null });
    const miss = rollCheck(adv, run, check({ stat: 'WITS', dc: 15, tags: ['tech'] }), diceRng([8]));
    expect(miss.success).toBe(false);
  });

  it('advantage rolls two dice and keeps the higher', () => {
    const { adv, run } = labRun('analyst', 'guardian', 'scout');
    const c = check({ stat: 'LOGIC', dc: 15, advantageIf: { hasItem: 'duck' } });
    const r = rollCheck(adv, run, c, diceRng([3, 11]));
    expect(r.dice[0]).toMatchObject({ naturals: [3, 11], kept: 11, total: 16, success: true });
  });

  it("group checks need at least half of the party and apply outcomes to each hero's result", () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker', 'analyst');
    const c = check({ stat: 'REFLEX', dc: 11, who: 'all' });
    // Mods: guardian 1, scout 4, tinker 0, analyst 0.
    const r = rollCheck(adv, run, c, diceRng([10, 7, 11, 2]));
    expect(r.needed).toBe(2);
    expect(r.dice.map((d) => d.success)).toEqual([true, true, true, false]);
    expect(r.success).toBe(true);
    expect(r.passedSlots).toEqual([0, 1, 2]);
    expect(r.failedSlots).toEqual([3]);
    expect(r.crit).toBeNull();
    const fail = rollCheck(adv, run, c, diceRng([2, 2, 2, 20]));
    expect(fail.success).toBe(false);
  });

  it("'chosen' checks are rolled by the best hero among the voters", () => {
    const { adv, run } = labRun('trickster', 'guardian', 'scout');
    const c = check({ stat: 'CHARM', dc: 12, who: 'chosen', tags: ['social'] });
    const r = rollCheck(adv, run, c, diceRng([15]), [1, 2]);
    expect(r.dice[0]!.name).toBe('H1');
    const all = rollCheck(adv, run, c, diceRng([15]), []);
    expect(all.dice[0]!.name).toBe('H0');
  });

  it("'random' checks pick a conscious hero with the injected RNG", () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker');
    run.heroes[0]!.ko = true;
    const r = rollCheck(adv, run, check({ stat: 'GRIT', dc: 10, who: 'random' }), diceRng([12]));
    expect(r.dice[0]!.name).toBe('H1');
  });

  it('knocked-out heroes never roll', () => {
    const { adv, run } = labRun('tinker', 'scout');
    run.heroes[0]!.ko = true;
    const r = rollCheck(adv, run, check({ stat: 'WITS', dc: 10 }), diceRng([10]));
    expect(r.dice[0]!.name).toBe('H1');
  });

  it('Trickster rerolls one failed social check per chapter', () => {
    const { adv, run } = labRun('trickster', 'guardian', 'scout');
    const c = check({ stat: 'CHARM', dc: 15, tags: ['social'] });
    const r = rollCheck(adv, run, c, diceRng([3, 14]));
    expect(r.success).toBe(true);
    expect(r.rerollBy?.name).toBe('H0');
    expect(r.dice[0]).toMatchObject({ kept: 14, rerolledFrom: 3 });
    expect(run.rerollUsed).toEqual([0]);
    const again = rollCheck(adv, run, c, diceRng([3]));
    expect(again.success).toBe(false);
    expect(again.rerollBy).toBeUndefined();
    // A new chapter refreshes it.
    enterNode(adv, run, 'two', diceRng([]));
    expect(run.rerollUsed).toEqual([]);
    const nonSocial = rollCheck(adv, run, check({ stat: 'GRIT', dc: 30 }), diceRng([2]));
    expect(nonSocial.rerollBy).toBeUndefined();
  });

  it('computes exact odds, including advantage, groups and rerolls', () => {
    expect(dieOdds(0, 11)).toBe(0.5);
    expect(dieOdds(0, 30)).toBe(0.05);
    expect(dieOdds(20, 2)).toBe(0.95);
    expect(dieOdds(0, 11, true)).toBe(0.75);
    expect(atLeastOdds([0.5, 0.5], 1)).toBeCloseTo(0.75);
    expect(atLeastOdds([0.5, 0.5, 0.5], 2)).toBeCloseTo(0.5);
    const { adv, run } = labRun('trickster', 'guardian', 'scout');
    const social = check({ stat: 'CHARM', dc: 15, tags: ['social'] });
    // Trickster CHARM 4 vs DC 15 → 10/20 = 0.5; with reroll 0.75.
    expect(checkOdds(adv, run, social)).toBeCloseTo(0.75);
    run.rerollUsed = [0];
    expect(checkOdds(adv, run, social)).toBeCloseTo(0.5);
  });
});

describe('effects', () => {
  it('damages, knocks out and heals within bounds', () => {
    const { adv, run } = labRun('analyst', 'scout', 'tinker');
    const rng = diceRng([]);
    const changes = applyEffects(adv, run, [{ hp: -9, target: 'leader' }], { rng, leaderSlot: 0 });
    expect(run.heroes[0]).toMatchObject({ hp: 0, ko: true });
    expect(changes.map((c) => c.kind)).toEqual(['hp', 'ko']);
    applyEffects(adv, run, [{ hp: 5, target: 'party' }], { rng });
    expect(run.heroes[0]!.hp).toBe(0);
    expect(run.heroes[1]!.hp).toBe(9);
    applyEffects(adv, run, [{ revive: 'party', hp: 3 }], { rng });
    expect(run.heroes[0]).toMatchObject({ hp: 3, ko: false });
    expect(run.heroes[0]!.stats.damageTaken).toBe(7);
  });

  it("the Guardian's Shield Wall absorbs one party-wide hit per scene", () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker');
    const rng = diceRng([]);
    const first = applyEffects(adv, run, [{ hp: -3, target: 'party' }], { rng });
    expect(first[0]).toMatchObject({ kind: 'shield', tone: 'good' });
    expect(run.heroes.map((h) => h.hp)).toEqual([12, 9, 8]);
    expect(run.heroes[0]!.stats.damagePrevented).toBe(9);
    applyEffects(adv, run, [{ hp: -3, target: 'party' }], { rng });
    expect(run.heroes.map((h) => h.hp)).toEqual([9, 6, 5]);
    enterNode(adv, run, 'hub', rng);
    applyEffects(adv, run, [{ hp: -1, target: 'party' }], { rng });
    expect(run.heroes.map((h) => h.hp)).toEqual([9, 6, 5]);
    // Single-target hits are never absorbed.
    applyEffects(adv, run, [{ hp: -1, target: 'weakest' }], { rng });
    expect(run.heroes[2]!.hp).toBe(4);
  });

  it('manages statuses with durations, damage over time and removal', () => {
    const { adv, run } = labRun('scout', 'tinker');
    const rng = diceRng([]);
    applyEffects(adv, run, [{ addStatus: 'burn', target: 'party' }, { addStatus: 'forever', target: 'leader' }], { rng, leaderSlot: 0 });
    expect(run.heroes[0]!.statuses.map((s) => s.id)).toEqual(['burn', 'forever']);
    const t1 = tickStatuses(adv, run);
    expect(run.heroes.map((h) => h.hp)).toEqual([8, 7]);
    expect(t1.some((c) => c.text.includes('wore off'))).toBe(false);
    expect(run.heroes[0]!.statuses).toEqual([
      { id: 'burn', turns: 1 },
      { id: 'forever', turns: 0 },
    ]);
    const t2 = tickStatuses(adv, run);
    expect(run.heroes.map((h) => h.hp)).toEqual([7, 6]);
    expect(t2.filter((c) => c.text.includes('wore off'))).toHaveLength(2);
    expect(run.heroes[0]!.statuses.map((s) => s.id)).toEqual(['forever']);
    tickStatuses(adv, run);
    expect(run.heroes[0]!.statuses.map((s) => s.id)).toEqual(['forever']);
    applyEffects(adv, run, [{ removeStatus: 'forever', target: 'party' }], { rng });
    expect(run.heroes[0]!.statuses).toEqual([]);
  });

  it('adds and removes party items, credits, flags, counters, score and notes', () => {
    const { adv, run } = labRun('scout');
    const rng = diceRng([]);
    const changes = applyEffects(
      adv,
      run,
      [
        { addItem: 'key', qty: 2 },
        { removeItem: 'key' },
        { removeItem: 'lens' },
        { credits: -5 },
        { setFlag: 'x' },
        { setFlag: 'n', value: 4 },
        { addCounter: 'c' },
        { addCounter: 'c', by: 2 },
        { score: 30 },
        { note: 'A note.' },
      ],
      { rng },
    );
    expect(run.inventory.key).toBe(1);
    expect(run.inventory.lens).toBeUndefined();
    expect(run.credits).toBe(0);
    expect(run.flags).toMatchObject({ x: true, n: 4, c: 3 });
    expect(run.score).toBe(30);
    expect(changes.map((c) => c.text)).toEqual(['+2 Keycard', '− Keycard', '−2 credits', '+30 score', 'A note.']);
  });
});

describe('resolution', () => {
  it('pays costs, rolls with the server RNG, applies success effects and advances', () => {
    const { adv, run } = labRun('tinker', 'scout');
    const res = resolveChoice(adv, run, 'wits', diceRng([10]), { leaderSlot: 1, votes: 2, voters: 2 });
    expect(res.check?.dice[0]).toMatchObject({ kept: 10, total: 16 });
    expect(res.success).toBe(true);
    expect(res.next).toBe('hub');
    expect(res.text).toBe('Nice, H1.');
    expect(run.credits).toBe(1);
    expect(run.inventory.key).toBe(1);
    expect(run.flags.won).toBe(true);
    expect(run.turn).toBe(1);
    expect(run.timeline[0]).toMatchObject({ nodeId: 'start', choiceId: 'wits', stat: 'WITS', success: true, votes: 2, voters: 2 });
    const enter = enterNode(adv, run, res.next, diceRng([]));
    expect(enter.nodeId).toBe('hub');
  });

  it('applies failure effects to the roller and crit bonuses', () => {
    const { adv, run } = labRun('tinker', 'scout');
    const res = resolveChoice(adv, run, 'wits', diceRng([1]));
    expect(res.success).toBe(false);
    expect(res.crit).toBe('failure');
    expect(run.heroes[0]!.hp).toBe(8 - 2 - 1);
    expect(run.heroes[0]!.statuses.map((s) => s.id)).toEqual(['wet']);
    expect(res.changes.some((c) => c.text.startsWith('Critical fumble!'))).toBe(true);
    const again = labRun('tinker', 'scout');
    const crit = resolveChoice(again.adv, again.run, 'wits', diceRng([20]));
    expect(crit.crit).toBe('success');
    expect(again.run.score).toBe(20 + 50);
  });

  it('statuses gained from a choice affect the next decisions and tick down as scenes resolve', () => {
    const { adv, run } = labRun('tinker', 'scout');
    // Failure adds Wet (turns 2) to the roller.
    resolveChoice(adv, run, 'wits', diceRng([2]));
    enterNode(adv, run, 'hub', diceRng([]));
    expect(run.heroes[0]!.statuses).toEqual([{ id: 'wet', turns: 2 }]);
    resolveChoice(adv, run, 'to2', diceRng([]));
    expect(run.heroes[0]!.statuses).toEqual([{ id: 'wet', turns: 1 }]);
    enterNode(adv, run, 'two', diceRng([]));
    const res = resolveChoice(adv, run, 'win', diceRng([]));
    expect(run.heroes[0]!.statuses).toEqual([]);
    expect(res.changes.some((c) => c.text === 'H0: Wet wore off')).toBe(true);
  });

  it('rejects unavailable choices', () => {
    const { adv, run } = labRun('scout');
    expect(() => resolveChoice(adv, run, 'keyed', diceRng([]))).toThrow(/not available/);
    expect(() => resolveChoice(adv, run, 'nope', diceRng([]))).toThrow(/not available/);
  });

  it('removes once-only choices after use and follows routes', () => {
    const { adv, run } = labRun('scout');
    enterNode(adv, run, 'hub', diceRng([]));
    resolveChoice(adv, run, 'once', diceRng([]));
    expect(availableChoices(adv, run).map((c) => c.id)).not.toContain('once');
    expect(run.flags.k).toBe(3);
    const enter = enterNode(adv, run, 'two', diceRng([]));
    expect(enter.path).toEqual(['two', 'bonus']);
    expect(run.nodeId).toBe('bonus');
    expect(enter.chapterChanged).toBe(true);
  });

  it('sends the party to the defeat ending when everyone is knocked out', () => {
    const { adv, run } = labRun('scout', 'tinker');
    enterNode(adv, run, 'hub', diceRng([]));
    for (const h of run.heroes) h.hp = 3;
    const res = resolveChoice(adv, run, 'party_hit', diceRng([]));
    expect(res.defeated).toBe(true);
    expect(res.next).toBe('dead');
    const enter = enterNode(adv, run, res.next, diceRng([]));
    expect(enter).toMatchObject({ ending: 'lose', defeated: true });
    expect(run.endingId).toBe('lose');
  });

  it('entering a checkpoint chapter revives knocked-out heroes', () => {
    const { adv, run } = labRun('scout', 'tinker');
    run.heroes[0]!.ko = true;
    run.heroes[0]!.hp = 0;
    const enter = enterNode(adv, run, 'two', diceRng([]));
    expect(run.heroes[0]).toMatchObject({ ko: false, hp: 3 });
    expect(enter.checkpoint).toBe(true);
    expect(enter.changes.some((c) => c.kind === 'revive')).toBe(true);
  });
});

describe('items', () => {
  it('uses consumables on heroes with validation', () => {
    const { adv, run } = labRun('scout', 'tinker');
    run.inventory.tonic = 1;
    run.inventory.phoenix = 1;
    run.heroes[1]!.hp = 2;
    expect(useItem(adv, run, 'tape', 0, 1, diceRng([]))).toMatchObject({ ok: false });
    expect(useItem(adv, run, 'nothing', 0, 1, diceRng([]))).toMatchObject({ ok: false });
    expect(useItem(adv, run, 'phoenix', 0, 1, diceRng([]))).toMatchObject({ ok: false, error: expect.stringContaining('still on their feet') });
    const ok = useItem(adv, run, 'tonic', 0, 1, diceRng([]));
    expect(ok.ok).toBe(true);
    expect(run.heroes[1]!.hp).toBe(5);
    expect(run.inventory.tonic).toBeUndefined();
    expect(run.heroes[0]!.stats).toMatchObject({ itemsUsed: 1, healing: 3 });
    expect(useItem(adv, run, 'tonic', 0, 1, diceRng([]))).toMatchObject({ ok: false });
  });

  it('revives knocked-out heroes and refuses to heal them with plain healing', () => {
    const { adv, run } = labRun('scout', 'tinker');
    run.heroes[1]!.ko = true;
    run.heroes[1]!.hp = 0;
    run.inventory.tonic = 1;
    run.inventory.kit = 1;
    expect(useItem(adv, run, 'tonic', 0, 1, diceRng([]))).toMatchObject({ ok: false });
    expect(useItem(adv, run, 'kit', 0, 1, diceRng([]))).toMatchObject({ ok: true });
    expect(run.heroes[1]).toMatchObject({ ko: false, hp: 4 });
  });

  it('party items affect everyone', () => {
    const { adv, run } = labRun('scout', 'tinker');
    run.inventory.feast = 1;
    run.heroes[0]!.hp = 1;
    run.heroes[1]!.hp = 1;
    expect(useItem(adv, run, 'feast', 0, -1, diceRng([]))).toMatchObject({ ok: true });
    expect(run.heroes.map((h) => h.hp)).toEqual([3, 3]);
  });
});

describe('omens, interpolation, votes stats and results', () => {
  it('gives Signal Seers an omen per visible choice', () => {
    const none = labRun('scout');
    expect(omensFor(none.adv, none.run)).toEqual([]);
    const { adv, run } = labRun('seer');
    const omens = omensFor(adv, run);
    expect(omens.length).toBe(presentScene(adv, run).choices.length);
    expect(omens.find((o) => o.choiceId === 'wits')!.text).toMatch(/sting/);
  });

  it('formats the clock and names', () => {
    expect(formatClock({ clockStart: '18:47', minutesPerTurn: 7 }, 0)).toBe('6:47 PM');
    expect(formatClock({ clockStart: '18:47', minutesPerTurn: 7 }, 10)).toBe('7:57 PM');
    expect(formatClock({ clockStart: '23:50', minutesPerTurn: 15 }, 1)).toBe('12:05 AM');
    expect(formatClock({ clockStart: '11:59', minutesPerTurn: 1 }, 1)).toBe('12:00 PM');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    const { adv, run } = labRun('scout');
    expect(interpolate(adv, run, '{hero.tinker} {item.key} {nope}')).toBe('someone 0 {nope}');
  });

  it('tracks votes and hands out distinct awards', () => {
    const { adv, run } = labRun('guardian', 'scout', 'tinker');
    recordVotes(run, new Map([[0, 'a'], [1, 'b'], [2, 'a']]), 'a');
    recordVotes(run, new Map([[1, 'b'], [2, 'b']]), 'a');
    expect(run.heroes[1]!.stats).toMatchObject({ votes: 2, majorityVotes: 0 });
    run.heroes[0]!.stats.successes = 4;
    run.heroes[1]!.stats.crits = 2;
    run.heroes[2]!.stats.healing = 5;
    const awards = computeAwards(run);
    const winners = awards.map((a) => a.heroPlayerId);
    expect(new Set(winners).size).toBe(winners.length);
    expect(awards.find((a) => a.id === 'clutch')!.heroPlayerId).toBe('p0');
    expect(awards.find((a) => a.id === 'lucky')!.heroPlayerId).toBe('p1');
    expect(awards.find((a) => a.id === 'medic')!.heroPlayerId).toBe('p2');
    void adv;
  });

  it('builds the results screen for an ending', () => {
    const { adv, run } = labRun('scout', 'tinker');
    enterNode(adv, run, 'hub', diceRng([]));
    resolveChoice(adv, run, 'to2', diceRng([]), { votes: 1, voters: 2, tieRule: 'Tie broken by a server coin flip' });
    enterNode(adv, run, 'two', diceRng([]));
    resolveChoice(adv, run, 'win', diceRng([]));
    const enter = enterNode(adv, run, 'end_win', diceRng([]));
    expect(enter.ending).toBe('win');
    const results = buildResults(adv, run, { endingsFound: 1 });
    expect(results).toMatchObject({ endingId: 'win', title: 'Win', tier: 'great', turns: 2, endingsTotal: 2, packTitle: 'Test Lab' });
    expect(results.score).toBe(100 + 2 * 25);
    expect(results.epilogue[0]).toBe('You won, H0.');
    expect(results.timeline[0]).toMatchObject({ choiceLabel: 'Chapter two', votes: 1, voters: 2, tieRule: 'Tie broken by a server coin flip' });
  });
});

describe('snapshots', () => {
  it('round-trips a run through a snapshot', () => {
    const { adv, run } = labRun('scout', 'tinker');
    resolveChoice(adv, run, 'wits', diceRng([15]));
    enterNode(adv, run, 'hub', diceRng([]));
    const snap = JSON.parse(JSON.stringify(snapshotRun(run)));
    expect(snap.heroes.every((h: { playerId: string }) => h.playerId === '')).toBe(true);
    const restored = restoreRun(adv, snap);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.run.nodeId).toBe('hub');
  });

  it('rejects malformed, foreign, outdated or impossible snapshots', () => {
    const { adv, run } = labRun('scout');
    const snap = () => JSON.parse(JSON.stringify(snapshotRun(run)));
    expect(restoreRun(adv, { nope: true })).toMatchObject({ ok: false });
    expect(restoreRun(adv, { ...snap(), packId: 'other' })).toMatchObject({ ok: false, error: expect.stringContaining('different adventure') });
    expect(restoreRun(adv, { ...snap(), packVersion: '0.9.0' })).toMatchObject({ ok: false, error: expect.stringContaining('version') });
    expect(restoreRun(adv, { ...snap(), nodeId: 'end_win' })).toMatchObject({ ok: false });
    expect(restoreRun(adv, { ...snap(), nodeId: 'ghost' })).toMatchObject({ ok: false });
    expect(restoreRun(adv, { ...snap(), inventory: { forged: 1 } })).toMatchObject({ ok: false });
    const bad = snap();
    bad.heroes[0].hp = 500;
    expect(restoreRun(adv, bad)).toMatchObject({ ok: false });
    const extra = snap();
    extra.injected = '<script>';
    expect(restoreRun(adv, extra)).toMatchObject({ ok: false });
  });

  it('rejects schema-valid but inconsistent snapshots (defense in depth if a save key ever leaks)', () => {
    const { adv, run } = labRun('scout', 'tinker');
    const snap = () => JSON.parse(JSON.stringify(snapshotRun(run)));
    // A finished run would jump straight to its ending (and its score) on start.
    const over = snap();
    over.endingId = Object.keys(adv.endings)[0];
    expect(restoreRun(adv, over)).toMatchObject({ ok: false });
    const overheal = snap();
    overheal.heroes[0].maxHp = 10;
    overheal.heroes[0].hp = 60;
    expect(restoreRun(adv, overheal)).toMatchObject({ ok: false });
    const zombie = snap();
    zombie.heroes[0].ko = true;
    expect(restoreRun(adv, zombie)).toMatchObject({ ok: false });
    const warped = snap();
    warped.chapter = warped.chapter === 1 ? 2 : 1;
    expect(restoreRun(adv, warped)).toMatchObject({ ok: false });
    expect(restoreRun(adv, snap())).toMatchObject({ ok: true });
  });
});

describe('determinism', () => {
  it('the same seed produces the same playthrough', () => {
    const play = () => {
      const adv = lab();
      const rng = createSeededRng('same');
      const { run } = createRun(adv, seeds('scout', 'tinker', 'guardian'), { runId: 'r' }, rng);
      enterNode(adv, run, 'hub', rng);
      const out: unknown[] = [];
      for (const id of ['group', 'random', 'adv', 'group']) out.push(resolveChoice(adv, run, id, rng).check?.dice.map((d) => d.kept));
      return out;
    };
    expect(play()).toEqual(play());
  });
});
