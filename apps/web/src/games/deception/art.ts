/**
 * DASception art: original 12×12 pixel role emblems + the role/team palette.
 * Declared once here so a future theme can override the game-art colours.
 * PixelArt rows: '.' transparent, '#' = role colour, other letters = @dascade/ui PALETTE.
 */
import type { DxIconName } from './Icon.tsx';
import type { DeceptionRole, DeceptionTeam } from '@dascade/shared/games/deception';

export const ROLE_COLOR: Record<DeceptionRole, string> = {
  sysop: '#22d3ee',
  scanner: '#60a5fa',
  firewall: '#ff8a3d',
  tracer: '#a3e635',
  sudo: '#ffd23f',
  glitch: '#ff5a5f',
  jammer: '#ff4fd8',
};

export const TEAM_COLOR: Record<DeceptionTeam, string> = {
  sysops: '#2de38f',
  glitches: '#ff5a5f',
};

/** Pixel icon paired with each team (meaning is never colour alone). */
export const TEAM_ICON: Record<DeceptionTeam, DxIconName> = {
  sysops: 'check',
  glitches: 'skull',
};

export const ROLE_ART: Record<DeceptionRole, string[]> = {
  // A terminal with a blinking prompt.
  sysop: [
    '............',
    '.##########.',
    '.#kkkkkkkk#.',
    '.#kwkkkkkk#.',
    '.#kkwkkkkk#.',
    '.#kwkkwwkk#.',
    '.#kkkkkkkk#.',
    '.##########.',
    '.....##.....',
    '...######...',
    '............',
    '............',
  ],
  // A radar eye.
  scanner: [
    '....####....',
    '..##....##..',
    '.#..####..#.',
    '#..#wwww#..#',
    '#.#ww##ww#.#',
    '#.#w#kk#w#.#',
    '#.#w#kk#w#.#',
    '#.#ww##ww#.#',
    '#..#wwww#..#',
    '.#..####..#.',
    '..##....##..',
    '....####....',
  ],
  // A brick shield.
  firewall: [
    '.wwwwwwwwww.',
    'w##k###k###w',
    'wkkkkkkkkkkw',
    'w#k###k###kw',
    'wkkkkkkkkkkw',
    'w##k###k###w',
    '.wkkkkkkkkw.',
    '.w#k###k##w.',
    '..wkkkkkkw..',
    '...w##k#w...',
    '....wkkw....',
    '.....ww.....',
  ],
  // A dotted trail ending in a target.
  tracer: [
    '.......####.',
    '......#....#',
    '......#.ww.#',
    '......#.ww.#',
    '.......####.',
    '.....#......',
    '............',
    '...#........',
    '............',
    '.#..........',
    '............',
    '#...........',
  ],
  // A golden root key.
  sudo: [
    '............',
    '............',
    '.####.......',
    '#....#......',
    '#.ww.#######',
    '#.ww.#######',
    '#....#..#.##',
    '.####...#.##',
    '............',
    '............',
    '............',
    '............',
  ],
  // A corrupted skull with chromatic offsets.
  glitch: [
    '..########..',
    '.##########.',
    '##kkk##kkk##',
    '##kkk##kkkp#',
    '##########pc',
    'c####kk#####',
    '.##########.',
    '..#.#.#.#.#.',
    '..#########.',
    'p..c........',
    '.........c..',
    '............',
  ],
  // A mast broadcasting static.
  jammer: [
    '#...#..#...#',
    '.#.#....#.#.',
    '..#......#..',
    '.#.#.##.#.#.',
    '#...####...#',
    '.....##.....',
    '.....##.....',
    '....####....',
    '....#..#....',
    '...#....#...',
    '..#......#..',
    '.##########.',
  ],
};

/** Unknown / hidden role (a node behind a question mark). */
export const HIDDEN_ART: string[] = [
  '...######...',
  '..##....##..',
  '.##..##..##.',
  '.#..#..#..#.',
  '.....#..#...',
  '....#..#....',
  '...#..#.....',
  '...#..#.....',
  '............',
  '...#..#.....',
  '...####.....',
  '............',
];
