/**
 * DAS Survey rules reference (RulesDrawer sections). Numbers come from SURVEY_SCORING so the
 * sheet can never drift from the server's scoring.
 */
import { SURVEY_LIMITS, SURVEY_SCORING } from '@dascade/shared/games/survey';
import type { RulesSection } from '../_party/index.ts';

const n = (v: number) => v.toLocaleString('en-US');

export const SURVEY_RULES: RulesSection[] = [
  {
    title: 'How a question works',
    icon: 'help',
    items: [
      'Answer for yourself first — honestly! Nobody ever sees who picked what.',
      'Then predict how the whole room answered. You can predict as soon as you have answered.',
      'When everyone is done (or time runs out) the room’s results are revealed and predictions score.',
      'Not comfortable with a question? Tap “Rather not say” — you can still predict.',
    ],
  },
  {
    title: 'Majority Mind',
    icon: 'crown',
    items: [
      `Predict the option most of the room picked: +${n(SURVEY_SCORING.majorityCorrect)}.`,
      'A tie for the lead means every tied option counts as the majority.',
      `Called it: +${n(SURVEY_SCORING.majorityCalledIt)} more when you were right and fewer than half of the predictions were.`,
    ],
  },
  {
    title: 'Rank the Room',
    icon: 'trophy',
    items: [
      'Vote for your favourite, then order the options from most votes to fewest.',
      `Up to +${n(SURVEY_SCORING.rankMax)}; every spot an option is out of place costs points (a fully reversed order scores 0).`,
      'Options tied on votes share their places — either order is correct.',
      `Perfect order: +${n(SURVEY_SCORING.rankPerfect)} bonus.`,
    ],
  },
  {
    title: 'Guess the Percentage',
    icon: 'sparkle',
    items: [
      'Answer, then guess what percentage of the room picked the highlighted option.',
      `Up to +${n(SURVEY_SCORING.percentMax)}, minus ${SURVEY_SCORING.percentPerPoint} for every percentage point you are off.`,
      `Closest in the room: +${n(SURVEY_SCORING.percentClosest)} (everyone tied for closest gets it).`,
    ],
  },
  {
    title: 'Anonymity',
    icon: 'lock',
    items: [
      'Your answer is sent only to the server and forgotten as soon as answering closes — only the totals remain.',
      `Results are shown only when at least ${SURVEY_LIMITS.minRespondents} people answered; otherwise the question is skipped with no points.`,
      `In small rooms (under ${SURVEY_LIMITS.smallRoomNote} answers) totals can still hint at who picked what — keep it friendly!`,
      'Only predictions score, and awards are about predictions — never about how you answered.',
    ],
  },
];
