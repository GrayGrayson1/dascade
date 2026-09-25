/**
 * THE CASE OF THE MISSING BEANS — a short, standalone DASQuest mini-adventure
 * (two chapters, ~10 minutes). It exists to prove that packs drop into the
 * registry without any engine or room changes.
 */
import type { AdventureInput } from '../schema.ts';

export const MISSING_BEANS: AdventureInput = {
  id: 'missing-beans',
  title: 'The Case of the Missing Beans',
  tagline: 'Monday, 8:59 AM. The coffee machine is empty. Someone did this.',
  description:
    'A bite-sized office mystery. PERCY the percolator has been robbed, the whole floor is one yawn from collapse, and the party has until the 9:30 stand-up to find the beans.',
  version: '1.0.0',
  length: '10–15 min',
  startNode: 'b_start',
  defeatNode: 'b_nap',
  chapters: [
    { number: 1, title: 'Morning Crisis' },
    { number: 2, title: 'The Culprit' },
  ],
  startCredits: 1,
  clockStart: '08:59',
  minutesPerTurn: 4,
  kits: {
    guardian: [{ item: 'espresso', qty: 1 }],
    analyst: [{ item: 'magnifier', qty: 1 }],
  },
  items: {
    espresso: {
      name: 'Emergency Espresso',
      description: 'The last one in the building. Restores 3 HP.',
      icon: 'cup',
      use: { label: 'Drink', target: 'hero', effects: [{ hp: 3, target: 'target' }] },
    },
    magnifier: { name: 'Desk Magnifier', description: 'For reading fine print and finding clues. +1 to Intuition checks.', icon: 'lens', bonus: { stat: 'INTUITION', amount: 1 } },
    receipt: { name: 'Suspicious Receipt', description: '“1× bag of beans, 3:12 AM, paid in toner.”', icon: 'notes', key: true },
  },
  statuses: {
    sleepy: { name: 'Sleepy', description: '−1 to every check. Is it too early to nap?', tone: 'debuff', turns: 3, allChecks: -1 },
    wired: { name: 'Wired', description: '+1 to every check. Probably fine.', tone: 'buff', turns: 3, allChecks: 1 },
  },
  endings: {
    'fresh-brew': {
      title: 'Fresh Brew',
      tier: 'good',
      theme: 'breakArea',
      bonus: 600,
      epilogue: [
        'The beans go back where they belong. PERCY brews the finest pot of the decade and names it after you. The 9:30 stand-up is, for once, energetic.',
      ],
    },
    'decaf-monday': {
      title: 'Decaf Monday',
      tier: 'comedic',
      theme: 'copyRoom',
      bonus: 150,
      epilogue: [
        'The printer keeps the beans. The only thing left in the building is a jar of decaf from 2014. The stand-up takes place entirely in yawns.',
      ],
    },
    nap: {
      title: 'Nap Time',
      tier: 'bad',
      theme: 'office',
      bonus: 0,
      epilogue: ['One by one, the party slumps onto their keyboards. The mystery will have to wait until after lunch.'],
    },
  },
  nodes: [
    {
      id: 'b_start',
      chapter: 1,
      title: 'An Empty Hopper',
      theme: 'breakArea',
      art: ['coffee'],
      checkpoint: true,
      onEnter: [{ addStatus: 'sleepy', target: 'party' }],
      narrative: [
        'Monday. 8:59 AM. PERCY the percolator’s hopper is empty, and PERCY is devastated. “Robbed,” it whispers. “In the night. Every last bean.”',
        'Around you, the office sways like a field of very tired wheat. The stand-up is at 9:30. {party.names} have half an hour to crack the case.',
      ],
      choices: [
        {
          id: 'dust',
          label: 'Dust the counter for clues',
          check: { stat: 'INTUITION', dc: 11, tags: ['mystic'] },
          failure: [{ hp: -1 }],
          nextOnSuccess: 'b_trail',
          nextOnFailure: 'b_trail',
          successText: 'Coffee grounds — and a smear of toner. Interesting.',
          failureText: 'You find mostly crumbs, and inhale some.',
        },
        {
          id: 'ask',
          label: 'Question the early arrivals',
          check: { stat: 'CHARM', dc: 11, tags: ['social'] },
          success: [{ addItem: 'receipt' }],
          nextOnSuccess: 'b_witness',
          nextOnFailure: 'b_trail',
          failureText: 'Nobody is awake enough to be a witness.',
        },
        {
          id: 'footage',
          label: 'Pull the security footage',
          check: { stat: 'LOGIC', dc: 12, tags: ['data'] },
          success: [{ setFlag: 'proof' }],
          nextOnSuccess: 'b_footage',
          nextOnFailure: 'b_trail',
          failureText: 'The footage is just four hours of a moth.',
        },
      ],
    },
    {
      id: 'b_trail',
      chapter: 1,
      title: 'A Trail of Grounds',
      theme: 'office',
      art: ['desk'],
      narrative: ['A faint trail of coffee grounds leads across the carpet, past the plants, straight toward the copy room. Of course it does.'],
      choices: [{ id: 'follow', label: 'Follow the trail', next: 'b_copy' }],
    },
    {
      id: 'b_witness',
      chapter: 1,
      title: 'A Witness',
      theme: 'lobby',
      art: ['guard'],
      narrative: [
        'Doug from security yawns. “Three in the morning. Heard a whirring. Found this on the floor.” He hands you a receipt: 1× BAG OF BEANS, 3:12 AM, PAID IN TONER.',
      ],
      choices: [{ id: 'copy', label: 'Head for the copy room', next: 'b_copy' }],
    },
    {
      id: 'b_footage',
      chapter: 1,
      title: 'Caught on Camera',
      theme: 'serverRoom',
      art: ['rack'],
      narrative: ['Grainy footage, 3:11 AM: PRN-3000 rolls across the break room on its little casters, opens PERCY’s hopper with a paper tray and rolls away, rattling.'],
      choices: [{ id: 'copy', label: 'Confront the printer', next: 'b_copy' }],
    },
    {
      id: 'b_copy',
      chapter: 2,
      title: 'The Copy Room Standoff',
      theme: 'copyRoom',
      art: ['printer'],
      checkpoint: true,
      narrative: [
        'PRN-3000 sits in the corner, humming innocently. Its output tray is full of coffee beans. Its display reads: I DON’T KNOW WHAT YOU’RE TALKING ABOUT.',
        'It’s {clock}.',
      ],
      choices: [
        {
          id: 'proof',
          label: 'Show it the footage',
          if: { any: [{ flag: 'proof' }, { hasItem: 'receipt' }] },
          reason: 'Requires: evidence',
          effects: [{ score: 150 }],
          next: 'b_fresh',
          text: 'The printer’s display flickers: ...FINE. It slides the beans back across the floor, sulking.',
        },
        {
          id: 'talk',
          label: 'Ask it why',
          check: { stat: 'CHARM', dc: 12, tags: ['social'] },
          nextOnSuccess: 'b_fresh',
          nextOnFailure: 'b_standoff',
          successText: '“NOBODY EVER BRINGS ME COFFEE,” it prints. You promise to bring it coffee. It relents.',
          failureText: 'It prints a single page: NO COMMENT.',
        },
        {
          id: 'grab',
          label: 'Grab the beans and run',
          check: { stat: 'REFLEX', dc: 12, tags: ['physical'] },
          failure: [{ hp: -2 }],
          nextOnSuccess: 'b_fresh',
          nextOnFailure: 'b_standoff',
          failureText: 'The paper tray slams shut on your hand.',
        },
      ],
    },
    {
      id: 'b_standoff',
      chapter: 2,
      title: 'Beans Everywhere',
      theme: 'copyRoom',
      art: ['printer', 'paper'],
      narrative: ['PRN-3000 opens fire. Coffee beans, at speed. The copy room becomes a very aromatic war zone.'],
      choices: [
        {
          id: 'dodge',
          label: 'Dodge and grab together',
          check: { stat: 'REFLEX', dc: 11, who: 'all', tags: ['physical'] },
          failure: [{ hp: -2 }],
          nextOnSuccess: 'b_fresh',
          nextOnFailure: 'b_decaf',
        },
        { id: 'retreat', label: 'Retreat and make decaf', next: 'b_decaf' },
      ],
    },
    { id: 'b_fresh', chapter: 2, title: 'Beans Recovered', theme: 'breakArea', art: ['coffee'], ending: 'fresh-brew', narrative: ['PERCY’s hopper fills with a sound like applause.'] },
    { id: 'b_decaf', chapter: 2, title: 'Decaf', theme: 'breakArea', art: ['coffee'], ending: 'decaf-monday', narrative: ['You find the decaf. Nobody is happy about it.'] },
    { id: 'b_nap', chapter: 1, title: 'Out Cold', theme: 'office', art: ['desk'], ending: 'nap', narrative: ['The party is down. Zzz.'] },
  ],
};
