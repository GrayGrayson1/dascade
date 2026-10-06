import type { CelebrationSprite, SkinCelebration } from '../celebration.ts';

// prettier-ignore
const BAT: CelebrationSprite = {
  rows: [
    'a.......a',
    'aa.a.a.aa',
    'aaaaaaaaa',
    '.aaeaeaa.',
    '..a.a.a..',
  ],
  ink: { a: '#7b3fc4', e: '#ffc93c' },
};

// prettier-ignore
const CANDY_CORN: CelebrationSprite = {
  rows: [
    '..w..',
    '.www.',
    '.ooo.',
    'ooooo',
    'yyyyy',
  ],
  ink: { w: '#fff6e6', o: '#ff8a3d', y: '#ffc93c' },
};

// prettier-ignore
const MINI_PUMPKIN: CelebrationSprite = {
  rows: [
    '...g...',
    '.oodoo.',
    'ooodooo',
    'ooodooo',
    '.oodoo.',
  ],
  ink: { g: '#4f9a3a', o: '#ff8a3d', d: '#c2601f' },
};

/** Halloween confetti: candy colours plus a sprinkle of bats, candy corn and mini pumpkins. */
export const HALLOWEEN_CELEBRATION: SkinCelebration = {
  colors: ['#e15c1f', '#8e44d6', '#7ed957', '#ffc93c', '#f4f0ff'],
  sprites: [BAT, CANDY_CORN, MINI_PUMPKIN],
  spriteShare: 0.25,
};
