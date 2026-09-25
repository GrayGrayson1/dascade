/**
 * Shared fixtures for DASQuest unit tests (not exported from the package index).
 */
import type { Rng } from '@dascade/shared';
import type { QuestArchetypeId } from '@dascade/shared/games/quest';
import type { AdventureInput } from './schema.ts';
import { loadAdventure } from './validate.ts';
import { createRun, type HeroSeed } from './engine.ts';

/** Rng whose d20 rolls come from a script (natural values 1–20); other draws return 0. */
export function diceRng(naturals: number[]): Rng & { remaining: () => number } {
  const queue = [...naturals];
  return {
    int(n: number) {
      if (n === 20) {
        const v = queue.shift();
        if (v === undefined) throw new Error('diceRng ran out of scripted rolls');
        return v - 1;
      }
      return 0;
    },
    next() {
      return 0;
    },
    remaining: () => queue.length,
  };
}

export function seeds(...archetypes: QuestArchetypeId[]): HeroSeed[] {
  return archetypes.map((archetype, i) => ({ playerId: `p${i}`, name: `H${i}`, color: '#a3e635', archetype }));
}

/** A compact pack that exercises every engine feature. */
export const LAB_PACK: AdventureInput = {
  id: 'lab',
  title: 'Test Lab',
  tagline: 'A laboratory for the engine.',
  description: 'Unit-test adventure.',
  version: '1.2.3',
  length: '1 min',
  startNode: 'start',
  defeatNode: 'dead',
  chapters: [
    { number: 1, title: 'One' },
    { number: 2, title: 'Two' },
  ],
  startCredits: 2,
  kits: { tinker: [{ item: 'tape', qty: 1 }], analyst: [{ item: 'duck', qty: 1 }] },
  items: {
    key: { name: 'Keycard', description: 'Opens things.', key: true },
    tape: { name: 'Duct Tape', description: 'Fixes things.', key: true },
    duck: { name: 'Duck', description: '+1 LOGIC.', bonus: { stat: 'LOGIC', amount: 1 } },
    lens: { name: 'Lens', description: '+2 on mystic.', bonus: { tag: 'mystic', amount: 2 } },
    tonic: { name: 'Tonic', description: 'Heal 3.', use: { label: 'Drink', target: 'hero', effects: [{ hp: 3, target: 'target' }] } },
    kit: {
      name: 'Kit',
      description: 'Heal or revive.',
      use: { label: 'Patch', target: 'hero', requires: 'any', effects: [{ hp: 5, target: 'target' }, { revive: 'target', hp: 4 }] },
    },
    phoenix: { name: 'Phoenix', description: 'Revive only.', use: { label: 'Revive', target: 'hero', requires: 'ko', effects: [{ revive: 'target', hp: 2 }] } },
    feast: { name: 'Feast', description: 'Party heal.', use: { label: 'Share', target: 'party', effects: [{ hp: 2, target: 'party' }] } },
  },
  statuses: {
    buzzed: { name: 'Buzzed', description: '+1 all.', tone: 'buff', turns: 2, allChecks: 1 },
    wet: { name: 'Wet', description: '−2 REFLEX.', tone: 'debuff', turns: 2, mods: { REFLEX: -2 } },
    burn: { name: 'Burn', description: '1 dmg per scene.', tone: 'debuff', turns: 2, damagePerScene: 1 },
    forever: { name: 'Forever', description: 'Permanent.', tone: 'buff', turns: 0 },
  },
  endings: {
    win: { title: 'Win', tier: 'great', epilogue: ['You won, {leader}.'], theme: 'dawn', bonus: 100 },
    lose: { title: 'Lose', tier: 'bad', epilogue: ['Oops.'], theme: 'office' },
  },
  nodes: [
    {
      id: 'start',
      chapter: 1,
      title: 'Start',
      theme: 'office',
      checkpoint: true,
      narrative: ['Hello {party.names} ({party.size}). Leader {leader}. {credits} credits, {item.tape} tape, clock {clock}. {hero.tinker}. {unknown.var}'],
      choices: [
        { id: 'plain', label: 'Plain', next: 'hub', text: 'Plain text.' },
        { id: 'keyed', label: 'Keyed', if: { hasItem: 'key' }, next: 'hub' },
        { id: 'tinker_only', label: 'Tinker only', if: { archetype: 'tinker' }, next: 'hub' },
        { id: 'combo', label: 'Combo', if: { all: [{ archetype: 'tinker' }, { hasItem: 'key' }] }, next: 'hub' },
        { id: 'hidden', label: 'Hidden', if: { flag: 'nope' }, unavailable: 'hide', next: 'hub' },
        { id: 'secret', label: 'Secret', secret: true, next: 'hub' },
        { id: 'custom', label: 'Custom reason', if: { credits: 99 }, reason: 'Requires: a fortune', next: 'hub' },
        {
          id: 'wits',
          label: 'Tech check',
          check: { stat: 'WITS', dc: 12, tags: ['tech'] },
          effects: [{ credits: -1 }],
          success: [{ addItem: 'key' }, { setFlag: 'won' }],
          failure: [{ hp: -2 }, { addStatus: 'wet' }],
          nextOnSuccess: 'hub',
          nextOnFailure: 'hub',
          successText: 'Nice, {leader}.',
          failureText: 'Ouch.',
        },
      ],
    },
    {
      id: 'hub',
      chapter: 1,
      title: 'Hub',
      theme: 'office',
      narrative: ['The hub.'],
      choices: [
        { id: 'group', label: 'Group', check: { stat: 'REFLEX', dc: 11, who: 'all' }, success: [{ score: 10 }], failure: [{ hp: -1 }], next: 'hub' },
        { id: 'random', label: 'Random', check: { stat: 'GRIT', dc: 10, who: 'random' }, failure: [{ hp: -1 }], next: 'hub' },
        { id: 'chosen', label: 'Chosen', check: { stat: 'CHARM', dc: 12, who: 'chosen', tags: ['social'] }, next: 'hub' },
        { id: 'adv', label: 'Advantage', check: { stat: 'LOGIC', dc: 15, advantageIf: { hasItem: 'duck' } }, next: 'hub' },
        { id: 'party_hit', label: 'Party hit', effects: [{ hp: -3, target: 'party' }], next: 'hub' },
        { id: 'once', label: 'Once', once: true, effects: [{ addCounter: 'k' }, { addCounter: 'k', by: 2 }], next: 'hub' },
        { id: 'to2', label: 'Chapter two', next: 'two' },
      ],
    },
    {
      id: 'two',
      chapter: 2,
      title: 'Two',
      theme: 'dataRiver',
      checkpoint: true,
      onEnter: [{ revive: 'party', hp: 3 }],
      routes: [{ if: { counter: 'k', atLeast: 3 }, to: 'bonus' }],
      narrative: ['Chapter two.'],
      choices: [
        { id: 'win', label: 'Win', next: 'end_win' },
        { id: 'lose', label: 'Lose', next: 'end_lose' },
      ],
    },
    { id: 'bonus', chapter: 2, title: 'Bonus', theme: 'arcade', narrative: ['Bonus room.'], choices: [{ id: 'win', label: 'Win', next: 'end_win' }] },
    { id: 'end_win', chapter: 2, title: 'Won', theme: 'dawn', ending: 'win', narrative: ['Yay.'] },
    { id: 'end_lose', chapter: 2, title: 'Lost', theme: 'office', ending: 'lose', narrative: ['Nay.'] },
    { id: 'dead', chapter: 1, title: 'Dead', theme: 'office', ending: 'lose', narrative: ['KO.'] },
  ],
};

export function lab() {
  return loadAdventure(LAB_PACK);
}

export function labRun(...archetypes: QuestArchetypeId[]) {
  const adv = lab();
  const { run, enter } = createRun(adv, seeds(...archetypes), { runId: 'test-run', leaderSlot: 0 }, diceRng([]));
  return { adv, run, enter };
}
