/**
 * The rules reference (RulesDrawer sections). Every number comes from the shared scoring
 * constants, so the drawer can never disagree with the server.
 */
import { MP_LIMITS, MP_POINTS } from '@dascade/shared/games/masterpiece';
import type { RulesSection } from '../_party/index.ts';

export const RULES_TITLE = 'How DASterpiece works';

export const RULE_SECTIONS: RulesSection[] = [
  {
    title: 'Write',
    icon: 'pencil',
    items: [
      'Every exhibition has a theme: captions, terrible advice, fake definitions, pitches and more.',
      'You get your prompt privately. Write something funny and hand it in before the timer runs out.',
      'Each answer is final once handed in. Stuck? Tap “Need a spark?” for a starter line.',
      'Keep it office-friendly — rude words are masked automatically.',
    ],
  },
  {
    title: 'Vote',
    icon: 'check',
    items: [
      'Answers go on the wall anonymously, in a random order. Nobody knows who wrote what.',
      'Favourite: pick the answer you love most — never your own.',
      'Head-to-Head: two answers to the same prompt (three when numbers are odd). The authors sit out; everyone else votes.',
      `Top Three: rank gold, silver and bronze (needs ${MP_LIMITS.rankedMinAnswers}+ answers).`,
      'Votes lock when cast, unless the host lets you change your mind until you lock in.',
      'Votes stay secret. Only the totals are shown after voting closes.',
    ],
  },
  {
    title: 'Score',
    icon: 'trophy',
    items: [
      `+${MP_POINTS.vote} per vote (Top Three: +${MP_POINTS.ranked[0]} gold, +${MP_POINTS.ranked[1]} silver, +${MP_POINTS.ranked[2]} bronze).`,
      `+${MP_POINTS.win} for winning the showdown (ties share it).`,
      `+${MP_POINTS.sweep} for a sweep — every possible vote went to you: “It’s a DASterpiece!”`,
      `+${MP_POINTS.audience} for the audience favourite, when spectators vote.`,
      `+${MP_POINTS.walkover} for an unopposed answer when your rival never handed one in.`,
      'The final exhibition can score double. Most points at the end wins.',
    ],
  },
  {
    title: 'Reveal',
    icon: 'eye',
    items: ['Authors are revealed only after the votes are counted — then take a bow.', 'After each exhibition, the leaderboard updates with everyone’s gains.'],
  },
];
