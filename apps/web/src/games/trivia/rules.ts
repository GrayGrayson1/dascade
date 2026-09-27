/**
 * In-game rules reference for the RulesDrawer (built from the live settings so it always
 * matches what the host picked).
 */
import { TRIVIA_SCORING, type TriviaSettings } from '@dascade/shared/games/trivia';
import type { RulesSection } from '../_party/index.ts';

export const RULES_STAGE_TITLE: Record<string, string> = {
  intro: 'How a question works',
  question: 'How a question works',
  reveal: 'Scoring',
  scores: 'Scoring',
  wager: 'Final wager',
};

export function triviaRules(s: TriviaSettings): RulesSection[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const sections: RulesSection[] = [
    {
      title: 'How a question works',
      icon: 'play',
      items: [
        `Each question has a ${s.answerSeconds}-second timer. Answer privately — nobody sees what you picked.`,
        'Tapping an option locks it in. Typed, number and order answers lock when you press “Lock in”. One answer per question.',
        'The strip at the bottom only shows WHO has locked in, never what they chose.',
        'When everyone has answered (or time runs out) the correct answer is revealed with how many picked each option.',
      ],
    },
    {
      title: 'Question types',
      icon: 'star',
      items: [
        'Multiple choice and true/false: pick one option.',
        'Type the answer: spelling is forgiving — case, accents, punctuation and a leading “the/a/an” don’t matter, and small typos on longer answers are accepted.',
        `Closest number: the guess (or guesses) closest to the answer win full points — ties share the win, over or under. Other guesses within ${pct(TRIVIA_SCORING.numberNearShare)} of the answer earn half points.`,
        'Put in order: tap the items from one end to the other. All in the right place = full points; otherwise you get a share of half the points for each item in the right position.',
      ],
    },
    {
      title: 'Scoring',
      icon: 'trophy',
      items: [
        `A correct answer is worth ${s.basePoints} points${s.difficultyBonus ? ' × difficulty (easy ×1, medium ×1.5, hard ×2)' : ''}.`,
        s.speedBonus
          ? `Speed bonus: up to +${pct(TRIVIA_SCORING.speedShare)} for answering instantly, shrinking to 0 as the timer runs out.`
          : 'Speed bonus is off: answer time doesn’t matter.',
        s.streakBonus
          ? `Streak bonus: +${pct(TRIVIA_SCORING.streakShare)} for every correct answer in a row after the first (max +${pct(TRIVIA_SCORING.streakCapShare)}).`
          : 'Streak bonus is off.',
        'Wrong or no answer: 0 points (never negative) and your streak resets.',
      ],
    },
  ];
  if (s.mode === 'teams') {
    sections.push({
      title: 'Teams',
      icon: 'users',
      items: [
        `Players are split into ${s.teamCount} balanced teams at the start; late joiners join the smallest team.`,
        'Everyone still answers on their own device.',
        s.teamScoring === 'average'
          ? 'Team score = the average of its players’ scores (fair for uneven teams).'
          : 'Team score = the total of its players’ scores.',
        'The team with the highest score wins; every member shares the placing.',
      ],
    });
  }
  if (s.finalWager) {
    sections.push({
      title: 'Final wager',
      icon: 'chip',
      items: [
        'Before the last question you only see its category. Privately wager game points — from 0 up to your score (or up to the base points if your score is lower).',
        'Correct: win your wager. Wrong or no answer: lose it. Your score never drops below zero.',
        'No speed or streak bonus on the final. These are game points only — nothing of value.',
      ],
    });
  }
  sections.push({
    title: 'Winning',
    icon: 'crown',
    items: [
      'Highest score after the last question wins. Equal scores share a place.',
      'The host can pause the timer or skip ahead at any time.',
    ],
  });
  return sections;
}
