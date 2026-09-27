/**
 * DASterpiece pixel art (12×12 grids for <PixelArt>): '#' = currentColor, other letters use the
 * shared pixel palette (w white, k ink, y yellow, p pink, c cyan, n grey, o orange, b brown, r red, g green, s skin).
 */
import type { MpPromptType } from '@dascade/shared/games/masterpiece';
import { PixelArt, type IconName } from '@dascade/ui';

export const MP_ART = {
  /** Gilded frame with a tiny landscape — the game's mark. */
  frame: [
    'yyyyyyyyyyyy',
    'y##########y',
    'y#cccccccc#y',
    'y#ccccccyc#y',
    'y#cccccccc#y',
    'y#cggcccgc#y',
    'y#gggggggg#y',
    'y#gggggggg#y',
    'y##########y',
    'yyyyyyyyyyyy',
    '....n..n....',
    '...n....n...',
  ],
  easel: [
    '.....##.....',
    '....####....',
    '.wwwwwwwwww.',
    '.wppwwwccww.',
    '.wpppwcccww.',
    '.wwwwwwwwyw.',
    '.wwwyyywwww.',
    '.wwwwwwwwww.',
    '...b....b...',
    '..b..bb..b..',
    '.b...bb...b.',
    'b....bb....b',
  ],
  quill: [
    '..........ww',
    '........wwww',
    '.......www#.',
    '......www#..',
    '.....www#...',
    '....www#....',
    '...www#.....',
    '...ww#......',
    '..#.#.......',
    '..##........',
    '.#..........',
    'k...........',
  ],
  gavel: [
    '....bbbb....',
    '...bbbbbb...',
    '...bbbbbb...',
    '....bbbb.b..',
    '.........b..',
    '..........b.',
    '...........b',
    '............',
    '..nnnnnnnn..',
    '.nnnnnnnnnn.',
    '............',
    '............',
  ],
  ribbon: [
    '...yyyyyy...',
    '..yyyyyyyy..',
    '.yyywwwwyyy.',
    '.yywyyyywyy.',
    '.yywyyyywyy.',
    '.yyywwwwyyy.',
    '..yyyyyyyy..',
    '...yyyyyy...',
    '...rr..rr...',
    '..rrr..rrr..',
    '..rr....rr..',
    '.rr......rr.',
  ],
  spotlight: [
    '....nnnn....',
    '...nkkkkn...',
    '...nkwwkn...',
    '....nnnn....',
    '....wwww....',
    '...wwwwww...',
    '..wwwwwwww..',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    '.wwwwwwwwww.',
    'wwwwwwwwwwww',
    'wwwwwwwwwwww',
  ],
} as const;

/** Icon per round theme (PixelIcon names from @dascade/ui). */
export const THEME_ICON: Record<MpPromptType, IconName> = {
  caption: 'eye',
  finish: 'pencil',
  advice: 'warning',
  definition: 'info',
  pitch: 'bolt',
  explain: 'help',
  hypothetical: 'sparkle',
  story: 'chat',
  name: 'flag',
  custom: 'star',
};

/** The game's mark, sized by CSS. */
export function FrameMark({ className }: { className?: string }) {
  return <PixelArt rows={MP_ART.frame} className={className} />;
}
