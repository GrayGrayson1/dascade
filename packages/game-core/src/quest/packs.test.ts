import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import { QUEST_ARCHETYPE_IDS, type QuestArchetypeId } from '@dascade/shared/games/quest';
import { BUILT_IN_PACKS, getPack, hasPack, packCatalog, packIds, registerPack } from './packs/index.ts';
import { AdventureError, exploreAdventure, loadAdventure, validateAdventure } from './validate.ts';
import { availableChoices, createRun, enterNode, presentScene, resolveChoice } from './engine.ts';
import type { AdventureInput } from './schema.ts';
import { LAB_PACK } from './test-fixtures.ts';

const PARTIES: QuestArchetypeId[][] = [
  ['guardian'],
  ['scout'],
  ['tinker', 'analyst'],
  ['trickster', 'seer'],
  ['guardian', 'scout', 'tinker', 'trickster', 'analyst', 'seer'],
  ['seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer', 'seer'],
];

describe('pack registry', () => {
  it('ships the starter adventure and a mini pack, all valid', () => {
    expect(packIds()).toEqual(['glitch-beneath', 'missing-beans']);
    const catalog = packCatalog((id, err) => {
      throw new Error(`${id}: ${String(err)}`);
    });
    expect(catalog.map((p) => p.id)).toEqual(['glitch-beneath', 'missing-beans']);
    expect(catalog[0]).toMatchObject({ chapters: 5, endings: 7 });
    expect(catalog[0]!.kits.tinker).toEqual([{ name: 'Duct Tape', qty: 1 }]);
  });

  it('drops in a new pack without touching the engine', () => {
    const extra: AdventureInput = { ...LAB_PACK, id: 'drop-in-pack', title: 'Drop-in' };
    expect(hasPack('drop-in-pack')).toBe(false);
    registerPack(extra);
    expect(hasPack('drop-in-pack')).toBe(true);
    const adv = getPack('drop-in-pack');
    const { run } = createRun(adv, [{ playerId: 'p', name: 'P', color: '#ffffff', archetype: 'scout' }], { runId: 'r' }, createSeededRng(1));
    expect(presentScene(adv, run).title).toBe('Start');
    expect(() => getPack('nope')).toThrow(/Unknown adventure pack/);
  });
});

describe('pack validation', () => {
  it('reports broken references, missing exits and unfinishable loops', () => {
    const broken = structuredClone(LAB_PACK) as AdventureInput;
    const nodes = broken.nodes as Array<Record<string, unknown>>;
    (nodes[0]!.choices as Array<Record<string, unknown>>)[0]!.next = 'nowhere';
    (nodes[0]!.choices as Array<Record<string, unknown>>)[1] = { id: 'bad_item', label: 'Bad', if: { hasItem: 'unobtainium' }, next: 'hub' };
    nodes.push({ id: 'loop_a', chapter: 1, title: 'Loop', theme: 'office', narrative: ['x'], choices: [{ id: 'l', label: 'L', next: 'loop_b' }] });
    nodes.push({ id: 'loop_b', chapter: 1, title: 'Loop', theme: 'office', narrative: ['x'], choices: [{ id: 'l', label: 'L', next: 'loop_a' }] });
    nodes.push({ id: 'stuck', chapter: 1, title: 'Stuck', theme: 'office', narrative: ['x'], choices: [{ id: 'k', label: 'K', if: { hasItem: 'key' }, next: 'hub' }] });
    nodes.push({ id: 'chk', chapter: 1, title: 'Chk', theme: 'office', narrative: ['x'], choices: [{ id: 'c', label: 'C', check: { stat: 'GRIT', dc: 10 }, nextOnSuccess: 'hub' }] });
    (nodes.find((n) => n.id === 'hub')!.choices as Array<Record<string, unknown>>).splice(
      0,
      3,
      { id: 'to_loop', label: 'Loop', next: 'loop_a' },
      { id: 'to_stuck', label: 'Stuck', next: 'stuck' },
      { id: 'to_chk', label: 'Chk', next: 'chk' },
    );
    let error: AdventureError | null = null;
    try {
      loadAdventure(broken);
    } catch (e) {
      error = e as AdventureError;
    }
    expect(error).toBeInstanceOf(AdventureError);
    const issues = error!.issues.join('\n');
    expect(issues).toMatch(/target node "nowhere" does not exist/);
    expect(issues).toMatch(/unknown item "unobtainium"/);
    expect(issues).toMatch(/stuck: needs at least one always-available choice/);
    expect(issues).toMatch(/chk\/c: a check needs "next" or both/);
  });

  it('reports loops that can never reach an ending', () => {
    const looping = structuredClone(LAB_PACK) as AdventureInput;
    const nodes = looping.nodes as Array<Record<string, unknown>>;
    nodes.push({ id: 'loop_a', chapter: 1, title: 'Loop', theme: 'office', narrative: ['x'], choices: [{ id: 'l', label: 'L', next: 'loop_b' }] });
    nodes.push({ id: 'loop_b', chapter: 1, title: 'Loop', theme: 'office', narrative: ['x'], choices: [{ id: 'l', label: 'L', next: 'loop_a' }] });
    (nodes.find((n) => n.id === 'hub')!.choices as Array<Record<string, unknown>>).push({ id: 'to_loop', label: 'Loop', next: 'loop_a' });
    expect(() => loadAdventure(looping)).toThrow(AdventureError);
    try {
      loadAdventure(looping);
    } catch (e) {
      expect((e as AdventureError).issues.join('\n')).toMatch(/loop_a" can never reach an ending/);
    }
  });

  it('rejects schema violations such as HTML-ish ids and unknown keys', () => {
    const bad = structuredClone(LAB_PACK) as AdventureInput & Record<string, unknown>;
    (bad.nodes as Array<Record<string, unknown>>)[0]!.id = '<script>';
    expect(() => loadAdventure(bad)).toThrow(AdventureError);
    const typo = structuredClone(LAB_PACK) as AdventureInput;
    ((typo.nodes as Array<Record<string, unknown>>)[0]!.choices as Array<Record<string, unknown>>)[0]!.nxt = 'hub';
    expect(() => loadAdventure(typo)).toThrow(AdventureError);
  });

  it('warns about unknown variables and unused content', () => {
    const adv = loadAdventure(LAB_PACK);
    const { errors, warnings } = validateAdventure(adv);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('{unknown.var}'))).toBe(true);
  });
});

describe.each(BUILT_IN_PACKS.map((p) => [p.id]))('shipped pack "%s"', (id) => {
  const adv = getPack(id);

  it('has zero validation errors or warnings', () => {
    expect(validateAdventure(adv)).toEqual({ errors: [], warnings: [] });
  });

  it('gives every chapter a checkpoint at its first scene', () => {
    for (const ch of adv.chapters) {
      const first = adv.nodes.find((n) => n.chapter === ch.number && !n.ending);
      expect(first?.checkpoint, `chapter ${ch.number}`).toBe(true);
    }
  });

  it('every non-ending scene always offers at least one choice (no dead ends under any state)', () => {
    for (const n of adv.nodes) {
      if (n.ending) continue;
      expect(
        n.choices.some((c) => !c.if && !c.secret && !c.once),
        n.id,
      ).toBe(true);
    }
  });

  it.each(PARTIES.map((p) => [p.join('+')]))('BFS reaches every ending with no dead ends for party %s', (partyKey) => {
    const party = partyKey.split('+') as QuestArchetypeId[];
    const report = exploreAdventure(adv, party, { width: id === 'glitch-beneath' ? 1 : 0, maxStates: 100_000 });
    expect(report.truncated).toBe(false);
    expect(report.deadEnds).toEqual([]);
    const reachable = Object.keys(adv.endings).filter((e) => e !== adv.nodeMap.get(adv.defeatNode)!.ending);
    expect([...report.endings].sort()).toEqual(reachable.sort());
    const unvisited = adv.nodes.filter((n) => !report.visitedNodes.has(n.id) && n.id !== adv.defeatNode).map((n) => n.id);
    // Scout-only secret paths are the only scenes a Scout-less party may never see.
    for (const nodeId of unvisited) {
      const onlyViaSecret = adv.nodes.every((n) => n.choices.every((c) => ![c.next, c.nextOnSuccess, c.nextOnFailure].includes(nodeId) || c.secret));
      expect(onlyViaSecret, `${nodeId} unreachable for ${partyKey}`).toBe(true);
    }
  });

  it('survives hundreds of random playthroughs with real dice, damage and item use', () => {
    const endings = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const rng: Rng = createSeededRng(`${id}:${i}`);
      const size = 1 + rng.int(6);
      const party = Array.from({ length: size }, () => QUEST_ARCHETYPE_IDS[rng.int(QUEST_ARCHETYPE_IDS.length)] as QuestArchetypeId);
      const { run, enter } = createRun(
        adv,
        party.map((archetype, s) => ({ playerId: `p${s}`, name: `P${s}`, color: '#ffffff', archetype })),
        { runId: `sim${i}`, dcShift: i % 3 === 0 ? 2 : 0, leaderSlot: 0 },
        rng,
      );
      let ending = enter.ending;
      let turns = 0;
      while (!ending) {
        turns++;
        expect(turns, `run ${i} did not finish`).toBeLessThan(400);
        const choices = availableChoices(adv, run);
        expect(choices.length, `dead end at ${run.nodeId}`).toBeGreaterThan(0);
        const choice = choices[rng.int(choices.length)]!;
        const res = resolveChoice(adv, run, choice.id, rng, { leaderSlot: 0, voterSlots: [0] });
        ending = enterNode(adv, run, res.next, rng, { leaderSlot: 0 }).ending;
      }
      endings.set(ending, (endings.get(ending) ?? 0) + 1);
    }
    // The defeat ending is genuinely reachable through damage alone.
    if (id === 'glitch-beneath') expect(endings.get('all-hands') ?? 0).toBeGreaterThan(0);
    expect(endings.size).toBeGreaterThanOrEqual(2);
  });
});

describe('THE GLITCH BENEATH DELTA ALPHA (content shape)', () => {
  const adv = getPack('glitch-beneath');

  it('is a substantial adventure: 5 chapters, 60+ scenes, 7 endings across every tier', () => {
    expect(adv.chapters).toHaveLength(5);
    expect(adv.nodes.length).toBeGreaterThanOrEqual(60);
    const tiers = new Set(Object.values(adv.endings).map((e) => e.tier));
    expect([...tiers].sort()).toEqual(['bad', 'bittersweet', 'comedic', 'good', 'great']);
    expect(Object.keys(adv.endings)).toHaveLength(7);
    for (const ch of adv.chapters) expect(adv.nodes.filter((n) => n.chapter === ch.number).length).toBeGreaterThanOrEqual(8);
  });

  it('uses every stat, every check style, item gates, archetype gates, secrets and party-inventory puzzles', () => {
    const choices = adv.nodes.flatMap((n) => n.choices);
    const stats = new Set(choices.flatMap((c) => (c.check ? [c.check.stat] : [])));
    expect(stats.size).toBe(6);
    const who = new Set(choices.flatMap((c) => (c.check ? [c.check.who] : [])));
    expect([...who].sort()).toEqual(['all', 'best', 'chosen', 'random']);
    const json = JSON.stringify(adv.nodes);
    expect(choices.filter((c) => c.if && JSON.stringify(c.if).includes('hasItem')).length).toBeGreaterThanOrEqual(10);
    expect(choices.filter((c) => c.if && JSON.stringify(c.if).includes('archetype')).length).toBeGreaterThanOrEqual(5);
    expect(choices.filter((c) => c.secret).length).toBeGreaterThanOrEqual(4);
    expect(choices.filter((c) => c.check?.advantageIf).length).toBeGreaterThanOrEqual(5);
    // Party-inventory puzzle: collect 3 arcade tokens from several sources to buy the Golden Token.
    expect(json).toContain('"removeItem":"arcade_token","qty":3');
    // Crafting combines items.
    expect(json).toContain('"removeItem":"duct_tape"');
    // Routes branch on accumulated state.
    expect(adv.nodes.some((n) => n.routes.length > 0)).toBe(true);
  });
});
