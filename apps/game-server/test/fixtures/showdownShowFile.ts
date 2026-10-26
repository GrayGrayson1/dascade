/**
 * A made-up show file for the Presenter Showcase tests: two ranked Top-10 boards with a special #5,
 * shaped like a real DAS-O-Ween show file (which lives outside the repo, ADM-01). Nothing here is
 * real show content.
 */
import type { ShowdownRoundInput } from '@dascade/shared/games/showdown';

const board = (prompt: string, title: string, answers: string[]): ShowdownRoundInput => ({
  prompt,
  title,
  source: 'Test Host Picks',
  special: 5,
  answers: answers.map((text, i) => ({ text, points: 0, note: `Note ${title} ${i + 1}`, aliases: [] })),
});

export const TEST_SHOW_FILE: ShowdownRoundInput[] = [
  board('Name the Top 10 test tunes.', 'Test Tunes', [
    'Quartz Lantern Waltz',
    'Copper Moth Polka',
    'Velvet Owl Shuffle',
    'Marble Fern Reel',
    'Saffron Kite Jig',
    'Cobalt Wren Tango',
    'Amber Frog Two-Step',
    'Indigo Yak Mambo',
    'Silver Newt Samba',
    'Garnet Lynx Stomp',
  ]),
  board('Name the Top 10 test films.', 'Test Films', [
    'The Paper Lighthouse',
    'Night of the Teapots',
    'Return of the Glove',
    'The Midnight Ferry',
    'Attack of the Socks',
    'The Hollow Kettle',
    'Curse of the Mittens',
    'The Velvet Hallway',
    'Revenge of the Spoons',
    'The Lantern Keeper',
  ]),
];
