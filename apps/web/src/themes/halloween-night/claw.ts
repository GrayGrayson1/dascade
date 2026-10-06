/**
 * Halloween Night's claw machine: the same four plushies in costume — friendly ghosts, black cats,
 * wrapped candy and jack-o'-lanterns — in a purple case with cobwebs and an orange neon sign. Same
 * sprite sizes and visible bounds as the machine's own art (clawArt.ts), so the pile and the prize
 * shelf are untouched underneath.
 */
import type { ClawCostume } from '../../arcade/clawArt.ts';

// prettier-ignore
export const HALLOWEEN_CLAW: ClawCostume = {
  id: 'halloween-night',
  plush: {
    // blob → a friendly ghost: dome head, rosy cheeks, a little "boo" mouth, wavy hem.
    blob: {
      name: 'ghost',
      rows: [
        '...aaaaaa...',
        '..aeeaaaaa..',
        '.aeaaaaaaaa.',
        '.awkaaaawka.',
        'aapaakkaapaa',
        'daaaaaaaaaad',
        '.aaaaaaaaaa.',
        '.dd..dd..dd.',
      ],
      colors: ['#f4f0ff', '#e4d9ff', '#dcffd2', '#ffe6cc', '#d6f2ff', '#ffdcee'],
      shades: ['#c4b8e6', '#b3a1e3', '#9fd49a', '#e0b48e', '#9ec6e0', '#e3a8c4'],
      lights: ['#ffffff', '#f6f1ff', '#f2fff0', '#fff7ee', '#f1fbff', '#fff1f8'],
      // Dark button eyes (an eye-white would vanish into a white ghost).
      ink: { w: '#3b2d5c', k: '#160c26' },
    },
    // bunny → a sitting black cat: pointy ears, glowing eyes, pink nose, whiskers, curled tail.
    bunny: {
      name: 'black cat',
      rows: [
        '.a......a.',
        '.aa....aa.',
        '.aea..aea.',
        '.aaaaaaaa.',
        'aaaaaaaaaa',
        'awkaaaawka',
        'aaaappaaaa',
        'eaaaaaaaae',
        '.aaaaaaaa.',
        '..aaaaaa.a',
        '.aaeeeaa.a',
        '.aaeeeaa.a',
        '.daaaaaada',
        '.dd...dd..',
      ],
      // Plush black, not ink black: they still read against the case's misty floor.
      colors: ['#2e2640', '#283149', '#3b2346', '#46414f', '#4a3a66', '#352a2c'],
      shades: ['#1b1528', '#161d2e', '#24142b', '#2b2731', '#2d2240', '#201819'],
      lights: ['#8d7cab', '#7c86a8', '#a685b3', '#9a98a6', '#b39be6', '#c48e6a'],
      ink: { w: '#d6f25a', k: '#120a1c' },
    },
    // star → a wrapped candy: a round sweet with a face, twisted wrapper ends.
    star: {
      name: 'candy',
      rows: [
        'a............a',
        'ae...aaaa...ea',
        'aee.aaaaaa.eea',
        'aeedwkaawkdeea',
        'aee.paddap.eea',
        'ae...aaaa...ea',
        'a............a',
      ],
      colors: ['#ff8a3d', '#a259e6', '#7ed957', '#ffc93c', '#ff6fa8', '#2ec4b6'],
      shades: ['#c2601f', '#7339b0', '#4f9e36', '#c49a1c', '#c24a7c', '#1f8f85'],
      lights: ['#ffd2b0', '#e2c8ff', '#d4f7c4', '#fff1b0', '#ffd0e4', '#bff2ec'],
    },
    // bot → a jack-o'-lantern: curly stem, candle-lit triangle eyes and a toothy grin.
    bot: {
      name: 'pumpkin',
      rows: [
        '.....d.....',
        '.....dd....',
        '..aaadaaa..',
        '.aaaadaaaa.',
        '.aawaaawaa.',
        '.dwwwawwwd.',
        '.deeaeaeed.',
        '.daeeeeead.',
        '.ddaaaaadd.',
        '..ddddddd..',
      ],
      colors: ['#f07a1a', '#e15c1f', '#ffa62b', '#f1e7d2', '#7cc242', '#8e44d6'],
      shades: ['#a84a0c', '#9a3a10', '#c4741a', '#c9b892', '#4f8a2a', '#5e2a96'],
      lights: ['#ffe27a', '#ffd84f', '#fff2a6', '#ffb347', '#fff27a', '#ffe9a8'],
      ink: { w: '#ffe27a' },
    },
  },
  interior: {
    neon: '#ff7a2e',
    bg: ['#2a1240', '#1a0b2a', '#0d0616'],
    wall: ['#3b1a5c', '#22103a'],
    floor: ['#56457a', '#6a5690'],
    sign: 'SPOOKY CUTIES',
    webs: true,
    light: '#ffc98a',
    winLight: '#ffc93c',
    glass: ['#24123c', '#0d0616'],
  },
  copy: { plate: 'TREAT!', restock: 'FRESH TREATS!', floorWon: 'You won a treat!' },
};
