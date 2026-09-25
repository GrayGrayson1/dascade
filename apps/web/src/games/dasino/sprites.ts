/**
 * Original DASino pixel art (16×16 grids). Each character maps to a colour in
 * SPRITE_PALETTE; '.' is transparent. Rendered crisp as SVG rects (<Sprite>)
 * or into canvases for the slot reels (spriteCanvas).
 */
import type { SlotSymbol } from '@dascade/game-core/dasino';

export const SPRITE_PALETTE: Record<string, string> = {
  k: '#0d0818',
  w: '#ffffff',
  r: '#ff3b5c',
  R: '#a3123a',
  p: '#ffb3c1',
  g: '#4ade80',
  G: '#15803d',
  y: '#ffd23f',
  Y: '#c7920a',
  l: '#fff3b0',
  o: '#ff8a3d',
  O: '#c2410c',
  c: '#5eead4',
  C: '#0f766e',
  a: '#b8fff4',
  v: '#c084fc',
  V: '#7e22ce',
  u: '#e9d5ff',
  n: '#9a93bf',
  N: '#4c4577',
  b: '#60a5fa',
  B: '#1e40af',
  s: '#eceaff',
  S: '#b4aed6',
  m: '#ff4fd8',
};

export const SLOT_SPRITES: Record<SlotSymbol, readonly string[]> = {
  cherry: [
    '................',
    '..........kkk...',
    '.........kgggk..',
    '........kgGggk..',
    '.......kGk.kk...',
    '......kGk..kGk..',
    '.....kGk....kGk.',
    '....kGk......kGk',
    '..kkkkk.....kkkk',
    '.krrprrk...krrpk',
    'krrpwprrk.krrpwk',
    'krrrprrRkkrrrprk',
    'krrrrrrRkkrrrrRk',
    '.kRrrrRRk.kRrrRk',
    '..kRRRRk...kRRk.',
    '...kkkk.....kk..',
  ],
  joystick: [
    '......kkkk......',
    '.....krrpwk.....',
    '....krrrrpwk....',
    '....krrrrrrk....',
    '....kRrrrrRk....',
    '.....kRRRRk.....',
    '......kSSk......',
    '......kSnk......',
    '......kSnk......',
    '..kkkkkSnkkkkk..',
    '.kvvvvvvvvvvvvk.',
    'kvukvvvvvvyykvVk',
    'kvvvvvvvvkyyYkVk',
    'kVVVVVVVVVkkkVVk',
    '.kVVVVVVVVVVVVk.',
    '..kkkkkkkkkkkk..',
  ],
  floppy: [
    '................',
    '.kkkkkkkkkkkkk..',
    '.kbbkssssssskbk.',
    '.kbbksSSkSSskbbk',
    '.kbbksSSkSSskbbk',
    '.kbbksssssssbbbk',
    '.kbbbbbbbbbbbbbk',
    '.kbbwwwwwwwwwbbk',
    '.kbbwmmmmmmmwbbk',
    '.kbbwwwwwwwwwbbk',
    '.kbbwnnnnnnwwbbk',
    '.kbbwwwwwwwwwbbk',
    '.kbbwnnnnwwwwbbk',
    '.kBbwwwwwwwwwbBk',
    '.kBBBBBBBBBBBBBk',
    '.kkkkkkkkkkkkkkk',
  ],
  bell: [
    '......kkkk......',
    '......kyyk......',
    '....kkccCCkk....',
    '...kcaacccCCk...',
    '..kcawaccccCCk..',
    '..kcaacccccCCk..',
    '..kcaacccccCCk..',
    '..kcacccccccCk..',
    '..kcacccccccCk..',
    '.kcaccccccccCCk.',
    '.kcaccccccccCCk.',
    'kcacccccccccccCk',
    'kCCCCCCCCCCCCCCk',
    '.kkkkkkkkkkkkkk.',
    '......kyyYk.....',
    '.......kkk......',
  ],
  coin: [
    '.....kkkkkk.....',
    '...kkyyyyyykk...',
    '..kyylllllyyYk..',
    '.kyllyyyyyyyYYk.',
    '.kylyyyYyyyyyYk.',
    'kylyyyYYYyyyyyYk',
    'kylyYYYYYYYyyyYk',
    'kylyyYYYYYyyyyYk',
    'kyyyyYYyYYyyyyYk',
    'kyyyyYyyyYyyyyYk',
    'kyyyyyyyyyyyyYYk',
    '.kyyyyyyyyyyyYk.',
    '.kYyyyyyyyyyYYk.',
    '..kYYyyyyyYYYk..',
    '...kkYYYYYYkk...',
    '.....kkkkkk.....',
  ],
  rocket: [
    '.......kk.......',
    '......krrk......',
    '.....krrprk.....',
    '.....kRrrrk.....',
    '....kssssssk....',
    '....ksskkssk....',
    '....kskbbkSk....',
    '....kskbakSk....',
    '....ksskkSSk....',
    '..krkssssSSkrk..',
    '.krrkssssSSkrrk.',
    'krrRkssssSSkRrrk',
    'kRRkkkkkkkkkkRRk',
    '.kk..kyooyk..kk.',
    '......koyok.....',
    '.......kk.......',
  ],
  seven: [
    '................',
    'kkkkkkkkkkkkkkkk',
    'kyyyyyyyyyyyyyyk',
    'kylppppppppppryk',
    'kyrrrrrrrrrrrryk',
    'kyRRRRRRRRrrrryk',
    'kyykkkkkkkrrrRyk',
    'kkk.....krrrRyyk',
    '.......krrrRyyk.',
    '.......krrrRyk..',
    '......krrrRyyk..',
    '......krrrRyk...',
    '.....krrrRyyk...',
    '.....krrrRyk....',
    '.....kyyyyyk....',
    '.....kkkkkkk....',
  ],
  das: [
    '................',
    '.kkkkkkkkkkkkkk.',
    'kvvvvvvvvvvvvvVk',
    'kvuuuuuuuuuuuvVk',
    'kvukkkkkkkkkkuVk',
    'kvkyyk.yyk.yyyVk',
    'kvkykYkykYkykkVk',
    'kvkykYkyyYkyyyVk',
    'kvkykYkykYkkkYVk',
    'kvkyyYkykYkyyYVk',
    'kvkkkkkkkkkkkkVk',
    'kvukkkkkkkkkkuVk',
    'kvvvvwvvvvwvvvVk',
    'kVVVVVVVVVVVVVVk',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
};

/** A die face for the pixel dice (9×9), '#' = pip. */
export const DIE_PIPS: Record<number, readonly string[]> = {
  1: ['.........', '.........', '.........', '.........', '....#....', '.........', '.........', '.........', '.........'],
  2: ['.........', '.......#.', '.........', '.........', '.........', '.........', '.........', '.#.......', '.........'],
  3: ['.........', '.......#.', '.........', '.........', '....#....', '.........', '.........', '.#.......', '.........'],
  4: ['.........', '.#.....#.', '.........', '.........', '.........', '.........', '.........', '.#.....#.', '.........'],
  5: ['.........', '.#.....#.', '.........', '.........', '....#....', '.........', '.........', '.#.....#.', '.........'],
  6: ['.........', '.#.....#.', '.........', '.........', '.#.....#.', '.........', '.........', '.#.....#.', '.........'],
};

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  color: string;
}

const rectCache = new Map<readonly string[], SpriteRect[]>();

/** Merged horizontal runs per colour (cached). */
export function spriteRects(rows: readonly string[]): SpriteRect[] {
  const cached = rectCache.get(rows);
  if (cached) return cached;
  const rects: SpriteRect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x] as string;
      if (ch === '.' || ch === ' ') {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      rects.push({ x, y, w: end - x, color: SPRITE_PALETTE[ch] ?? '#ff00ff' });
      x = end;
    }
  });
  rectCache.set(rows, rects);
  return rects;
}

const canvasCache = new Map<string, HTMLCanvasElement>();

/** A crisp canvas of a sprite at an integer pixel scale (cached per sprite + scale). */
export function spriteCanvas(rows: readonly string[], scale: number, key: string): HTMLCanvasElement {
  const id = `${key}@${scale}`;
  const cached = canvasCache.get(id);
  if (cached) return cached;
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = rows.length * scale;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (const r of spriteRects(rows)) {
      ctx.fillStyle = r.color;
      ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, scale);
    }
  }
  canvasCache.set(id, canvas);
  return canvas;
}
