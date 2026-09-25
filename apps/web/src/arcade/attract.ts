/**
 * Attract-mode programs: one tiny, procedural pixel animation per cabinet.
 *
 * Every program is a pure function of time (`t`, seconds) and the canvas size,
 * so a reduced-motion "still" is just the program drawn at a nice moment.
 * Programs adapt to any logical resolution from ~60×45 up to ~200×150.
 */
import type { GameCatalogEntry, GameId } from '@dascade/shared';
import {
  clamp,
  disc,
  drawText,
  drawTextC,
  easeInOut,
  easeOut,
  frame,
  hash,
  line,
  mix,
  rect,
  rgb,
  sprite,
  textWidth,
} from './pixel.ts';

export interface AttractFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  t: number;
  /** Hovered / focused / selected: brighter, "PRESS START" + title. */
  active: boolean;
  /** Draw INSERT COIN / PRESS START text (off for background art). */
  hud: boolean;
  /** Static frame: no blinking. */
  still: boolean;
  game: GameCatalogEntry;
}

interface Program {
  draw(f: AttractFrame): void;
  /** Time used for the reduced-motion still frame. */
  still: number;
}

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Shared sprites
// ---------------------------------------------------------------------------
const SUITS: Record<'s' | 'h' | 'd' | 'c', readonly string[]> = {
  s: ['..#..', '.###.', '#####', '..#..', '.###.'],
  h: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  d: ['..#..', '.###.', '#####', '.###.', '..#..'],
  c: ['..#..', '.###.', '#.#.#', '#####', '..#..'],
};
const RED = '#e8364f';
const INK = '#17121f';

interface Card {
  r: string;
  s: 's' | 'h' | 'd' | 'c';
}

function cardSize(W: number): { cw: number; ch: number } {
  return W >= 112 ? { cw: 9, ch: 13 } : { cw: 7, ch: 12 };
}

/** Draws a card centered at (cx, cy). `flip` in [0,1]: 0 = back, 1 = face (with a squash in between). */
function drawCard(ctx: Ctx, cx: number, cy: number, cw: number, ch: number, card: Card, flip: number, back: string, glow?: string): void {
  const showFace = flip >= 0.5;
  const squash = Math.abs(Math.cos(flip * Math.PI));
  const w = Math.max(1, Math.round(cw * (flip > 0 && flip < 1 ? squash : 1)));
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - ch / 2);
  if (glow) rect(ctx, x - 1, y - 1, w + 2, ch + 2, glow);
  rect(ctx, x, y + 1, w, ch, 'rgba(0,0,0,0.45)');
  if (!showFace) {
    rect(ctx, x, y, w, ch, '#f3eefc');
    rect(ctx, x + 1, y + 1, Math.max(0, w - 2), ch - 2, back);
    if (w > 4)
      for (let yy = y + 2; yy < y + ch - 2; yy += 2)
        for (let xx = x + 2 + ((yy >> 1) & 1); xx < x + w - 2; xx += 2) rect(ctx, xx, yy, 1, 1, 'rgba(255,255,255,0.28)');
    return;
  }
  rect(ctx, x, y, w, ch, '#f8f6ff');
  if (w < cw - 1) return;
  const color = card.s === 'h' || card.s === 'd' ? RED : INK;
  drawText(ctx, card.r, x + 1, y + 1, color);
  sprite(ctx, SUITS[card.s], x + w - 6, y + ch - 6, { '#': color });
}

const CHIP_COLORS = ['#ff5a5f', '#38bdf8', '#ffd23f', '#2de38f', '#c084fc'];

function drawChip(ctx: Ctx, x: number, y: number, color: string): void {
  x = Math.round(x);
  y = Math.round(y);
  rect(ctx, x + 1, y, 3, 1, mix(color, '#ffffff', 0.35));
  rect(ctx, x, y + 1, 5, 1, color);
  rect(ctx, x + 1, y + 2, 3, 1, mix(color, '#000000', 0.35));
  rect(ctx, x + 2, y + 1, 1, 1, '#ffffff');
}

function sparkle(ctx: Ctx, x: number, y: number, phase: number, color: string): void {
  const s = Math.floor(phase * 3) % 3;
  x = Math.round(x);
  y = Math.round(y);
  if (s === 0) rect(ctx, x, y, 1, 1, color);
  else {
    const r = s;
    rect(ctx, x - r, y, r * 2 + 1, 1, color);
    rect(ctx, x, y - r, 1, r * 2 + 1, color);
  }
}

function dottedBg(ctx: Ctx, W: number, H: number, base: string, dot: string, step = 6, drift = 0): void {
  rect(ctx, 0, 0, W, H, base);
  ctx.fillStyle = dot;
  const off = Math.floor(drift) % step;
  for (let y = 2; y < H; y += step) for (let x = ((y / step) & 1 ? 3 : 0) + off - step; x < W; x += step) if (x >= 0) ctx.fillRect(x, y, 1, 1);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const SHORT_TITLE: Record<GameId, string> = {
  dasketch: 'DASKETCH',
  holdem: "HOLD'EM",
  blackjack: 'DASJACK 21',
  bingo: 'DAS BINGO',
  wheel: 'DASTINY',
  dasino: 'DASINO',
  circuit: 'DASH CIRCUIT',
  quest: 'DASQUEST',
};

function drawHud(f: AttractFrame): void {
  if (!f.hud) return;
  const { ctx, W, H, t, active, still } = f;
  const scale = W >= 150 ? 2 : 1;
  const band = 5 * scale + 3;
  if (active) {
    const title = textWidth(f.game.marquee, scale) <= W - 6 ? f.game.marquee : SHORT_TITLE[f.game.id];
    rect(ctx, 0, 0, W, band, 'rgba(6,4,14,0.78)');
    rect(ctx, 0, band, W, 1, f.game.accent.primary);
    drawTextC(ctx, title, W / 2, 2, f.game.accent.primary, scale, '#000000');
    if (still || (t * 2.4) % 1 < 0.64) {
      rect(ctx, 0, H - band, W, band, 'rgba(6,4,14,0.78)');
      drawTextC(ctx, 'PRESS START', W / 2, H - band + 2, '#ffffff', scale, '#000000');
    }
  } else if (still || (t * 1.25) % 1 < 0.6) {
    rect(ctx, 0, H - band, W, band, 'rgba(6,4,14,0.72)');
    drawTextC(ctx, 'INSERT COIN', W / 2, H - band + 2, '#ffd23f', scale, '#000000');
  }
}

// ---------------------------------------------------------------------------
// DASketch — a pen doodles a sketch, guesses pop in, someone gets it.
// ---------------------------------------------------------------------------
type Stroke = Array<[number, number]>;
function circlePts(cx: number, cy: number, rx: number, ry: number, n: number, a0 = 0): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}
const DOODLES: Array<{ word: string; strokes: Stroke[] }> = [
  {
    word: 'CAT',
    strokes: [
      circlePts(0.5, 0.58, 0.26, 0.3, 14, Math.PI * 0.5),
      [
        [0.3, 0.4],
        [0.3, 0.12],
        [0.44, 0.3],
      ],
      [
        [0.56, 0.3],
        [0.7, 0.12],
        [0.7, 0.4],
      ],
      [
        [0.42, 0.52],
        [0.42, 0.56],
      ],
      [
        [0.58, 0.52],
        [0.58, 0.56],
      ],
      [
        [0.47, 0.68],
        [0.5, 0.71],
        [0.53, 0.68],
      ],
      [
        [0.14, 0.62],
        [0.36, 0.66],
      ],
      [
        [0.64, 0.66],
        [0.86, 0.62],
      ],
    ],
  },
  {
    word: 'HOUSE',
    strokes: [
      [
        [0.24, 0.9],
        [0.24, 0.48],
        [0.76, 0.48],
        [0.76, 0.9],
        [0.24, 0.9],
      ],
      [
        [0.16, 0.52],
        [0.5, 0.14],
        [0.84, 0.52],
      ],
      [
        [0.44, 0.9],
        [0.44, 0.66],
        [0.58, 0.66],
        [0.58, 0.9],
      ],
      [
        [0.3, 0.56],
        [0.38, 0.56],
        [0.38, 0.64],
        [0.3, 0.64],
        [0.3, 0.56],
      ],
      [
        [0.66, 0.3],
        [0.66, 0.2],
        [0.72, 0.2],
        [0.72, 0.36],
      ],
    ],
  },
  {
    word: 'SUN',
    strokes: [
      circlePts(0.5, 0.52, 0.18, 0.22, 12),
      ...Array.from({ length: 8 }, (_, i): Stroke => {
        const a = (i / 8) * Math.PI * 2;
        return [
          [0.5 + Math.cos(a) * 0.26, 0.52 + Math.sin(a) * 0.32],
          [0.5 + Math.cos(a) * 0.38, 0.52 + Math.sin(a) * 0.44],
        ];
      }),
    ],
  },
  {
    word: 'FISH',
    strokes: [
      circlePts(0.45, 0.52, 0.28, 0.2, 14, Math.PI),
      [
        [0.72, 0.52],
        [0.9, 0.34],
        [0.9, 0.7],
        [0.72, 0.52],
      ],
      [
        [0.3, 0.46],
        [0.31, 0.47],
      ],
      [
        [0.5, 0.35],
        [0.56, 0.52],
        [0.5, 0.69],
      ],
    ],
  },
];

const PENCIL = ['......pp', '.....ypp', '....yyy.', '...yyy..', '..yyy...', '.www....', 'kww.....', 'k.......'];

function strokeLength(s: Stroke): number {
  let len = 0;
  for (let i = 1; i < s.length; i++) len += Math.hypot(s[i]![0] - s[i - 1]![0], s[i]![1] - s[i - 1]![1]);
  return len;
}

const dasketch: Program = {
  still: 5.0,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 6.6;
    const cycle = Math.floor(f.t / C);
    const tt = f.t - cycle * C;
    const doodle = DOODLES[((cycle % DOODLES.length) + DOODLES.length) % DOODLES.length]!;
    dottedBg(ctx, W, H, '#2a0b2e', '#4d1856', 6);
    const px = Math.round(W * 0.17);
    const py = Math.round(H * 0.15);
    const pw = Math.round(W * 0.66);
    const ph = Math.round(H * 0.6);
    rect(ctx, px + 2, py + 2, pw, ph, '#12051a');
    rect(ctx, px, py, pw, ph, '#fbf5ff');
    rect(ctx, px, py, pw, 2, '#ffc2ef');
    const brush = W >= 130 ? 2 : 1;
    const inset = 3;
    const map = (p: [number, number]): [number, number] => [px + inset + p[0] * (pw - inset * 2), py + inset + p[1] * (ph - inset * 2)];
    const total = doodle.strokes.reduce((a, s) => a + strokeLength(s), 0);
    const progress = clamp((tt - 0.3) / 3.0, 0, 1);
    let budget = progress * total;
    let tip: [number, number] | null = null;
    for (const s of doodle.strokes) {
      if (budget <= 0) break;
      for (let i = 1; i < s.length && budget > 0; i++) {
        const a = s[i - 1]!;
        const b = s[i]!;
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = Math.min(1, budget / (seg || 1));
        const end: [number, number] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        const [x0, y0] = map(a);
        const [x1, y1] = map(end);
        line(ctx, x0, y0, x1, y1, '#3b1247', brush);
        tip = [x1, y1];
        budget -= seg;
      }
    }
    // eraser wipe at the end of the cycle
    if (tt > 5.9) {
      const k = easeInOut((tt - 5.9) / 0.6);
      const wx = px + k * pw;
      rect(ctx, px, py + 2, wx - px, ph - 2, '#fbf5ff');
      rect(ctx, wx - 3, py + 1, 4, ph - 1, '#ff8fe6');
    }
    if (tip && progress < 1) sprite(ctx, PENCIL, tip[0], tip[1] - 7, { p: '#ff4fd8', y: '#ffd23f', w: '#f5c9a0', k: '#2a0b2e' });
    else if (progress >= 1 && tt < 5.9) sprite(ctx, PENCIL, px + pw - 6, py + ph - 10, { p: '#ff4fd8', y: '#ffd23f', w: '#f5c9a0', k: '#2a0b2e' });

    // guesses
    const bubbles: Array<{ at: number; x: number; y: number; text: string; ok?: boolean }> = [
      { at: 2.4, x: px - 2, y: py + ph * 0.18, text: '?' },
      { at: 3.0, x: px + pw - 6, y: py + ph * 0.4, text: '?' },
      { at: 3.6, x: px - 3, y: py + ph * 0.62, text: '??' },
      { at: 4.3, x: px + pw * 0.5, y: py + ph * 0.72, text: `${doodle.word}!`, ok: true },
    ];
    for (const b of bubbles) {
      if (tt < b.at || tt > 5.9) continue;
      const pop = tt - b.at < 0.12 ? 1 : 0;
      const tw = textWidth(b.text);
      const bw = tw + 4 + pop * 2;
      const bh = 9 + pop * 2;
      const bx = Math.round(clamp(b.ok ? b.x - bw / 2 : b.x, 1, W - bw - 1));
      const by = Math.round(clamp(b.y, 1, H - bh - 9));
      rect(ctx, bx + 1, by + 1, bw, bh, 'rgba(0,0,0,0.5)');
      rect(ctx, bx, by, bw, bh, b.ok ? '#2de38f' : '#ffffff');
      frame(ctx, bx, by, bw, bh, b.ok ? '#0b5a36' : '#ff4fd8');
      drawText(ctx, b.text, bx + 2 + pop, by + 2 + pop, b.ok ? '#05301b' : '#ff4fd8');
    }
    if (f.hud && tt > 4.4 && tt < 5.9) {
      const rise = Math.round((tt - 4.4) * 6);
      drawTextC(ctx, '+100', px + pw * 0.8, py - 1 - rise + 6, '#ffd23f', 1, '#2a0b2e');
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DAS Hold'em — flop, turn, river; chips slide to the pot.
// ---------------------------------------------------------------------------
function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
  }
}

const BOARD: Card[] = [
  { r: 'A', s: 's' },
  { r: 'K', s: 's' },
  { r: 'Q', s: 's' },
  { r: 'J', s: 's' },
  { r: '7', s: 'h' },
];

const holdem: Program = {
  still: 5.4,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 7;
    const tt = ((f.t % C) + C) % C;
    rect(ctx, 0, 0, W, H, '#06261a');
    const cx = W / 2;
    const cy = H * 0.5;
    const rx = W * 0.45;
    const ry = H * 0.33;
    ellipse(ctx, cx, cy + 2, rx + 3, ry + 3, '#020d08');
    ellipse(ctx, cx, cy, rx + 3, ry + 3, '#3b2412');
    ellipse(ctx, cx, cy, rx + 1, ry + 1, '#c9a22f');
    ellipse(ctx, cx, cy, rx, ry, '#0f5c3a');
    ellipse(ctx, cx, cy - 1, rx * 0.78, ry * 0.7, '#137045');
    const { cw, ch } = cardSize(W);
    const gap = 2;
    const rowW = cw * 5 + gap * 4;
    const x0 = cx - rowW / 2 + cw / 2;
    const cardY = cy - 2;
    const deal = [0.3, 0.45, 0.6, 2.6, 4.0];
    const flips = [0.9, 1.05, 1.2, 2.9, 4.3];
    const flush = tt > 4.9 && tt < 6.5;
    const blink = f.still || (tt * 5) % 1 < 0.6;
    for (let i = 0; i < 5; i++) {
      if (tt < deal[i]! || tt > 6.5) continue;
      const k = easeOut((tt - deal[i]!) / 0.3);
      const x = cx + (x0 + i * (cw + gap) - cx) * k;
      const y = H * 0.08 + (cardY - H * 0.08) * k;
      const flip = clamp((tt - flips[i]!) / 0.3, 0, 1);
      const glow = flush && i < 4 && blink ? '#ffd23f' : undefined;
      drawCard(ctx, x, y, cw, ch, BOARD[i]!, flip, '#1b6fb8', glow);
    }
    // seats + chips
    const seats: Array<[number, number]> = [
      [cx - rx * 0.78, cy + ry * 0.2],
      [cx + rx * 0.78 - 5, cy + ry * 0.2],
      [cx - 2, cy + ry * 0.78],
    ];
    const pot: [number, number] = [cx - 2, cardY + ch / 2 + 3];
    seats.forEach(([sx, sy], i) => {
      for (let k = 0; k < 3; k++) drawChip(ctx, sx, sy - k * 2, CHIP_COLORS[(i + k) % CHIP_COLORS.length]!);
    });
    const bets = [1.5, 3.3];
    let potChips = 0;
    for (const b of bets) {
      seats.forEach(([sx, sy], i) => {
        const start = b + i * 0.12;
        if (tt < start) return;
        const k = easeInOut((tt - start) / 0.45);
        if (k >= 1) {
          potChips++;
          return;
        }
        drawChip(ctx, sx + (pot[0] - sx) * k, sy - 4 + (pot[1] - sy + 4) * k, CHIP_COLORS[(i + 2) % CHIP_COLORS.length]!);
      });
    }
    if (tt > 6.5) potChips = 0;
    for (let k = 0; k < Math.min(potChips, 6); k++) drawChip(ctx, pot[0] + (k % 2) * 3 - 1, pot[1] - Math.floor(k / 2) * 2, CHIP_COLORS[k % CHIP_COLORS.length]!);
    if (flush && f.hud) {
      drawTextC(ctx, 'FLUSH!', cx, Math.max(2, cardY - ch / 2 - 8), blink ? '#ffd23f' : '#fff6c8', 1, '#02140c');
      for (let i = 0; i < 4; i++) sparkle(ctx, cx - rowW / 2 + hash(i + 3) * rowW, cardY - ch / 2 + hash(i + 9) * ch, f.t * 4 + i, '#fff6c8');
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DASjack 21 — A + K lands: BLACKJACK!
// ---------------------------------------------------------------------------
const blackjack: Program = {
  still: 2.6,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 6;
    const tt = ((f.t % C) + C) % C;
    rect(ctx, 0, 0, W, H, '#1a0508');
    ellipse(ctx, W / 2, -H * 0.1, W * 0.66, H * 1.02, '#3b0a12');
    ellipse(ctx, W / 2, -H * 0.1, W * 0.64, H * 1.0, '#7a1420');
    ellipse(ctx, W / 2, -H * 0.1, W * 0.5, H * 0.78, '#861827');
    // insurance arc
    ctx.fillStyle = '#c9a22f';
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * (0.18 + (i / 40) * 0.64);
      const x = W / 2 + Math.cos(a) * W * 0.42;
      const y = -H * 0.1 + Math.sin(a) * H * 0.62;
      if (i % 2 === 0) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    const { cw, ch } = cardSize(W);
    // shoe
    const shoeX = W - cw - 6;
    rect(ctx, shoeX - 2, 3, cw + 5, ch - 2, '#23101a');
    rect(ctx, shoeX, 4, cw, ch - 5, '#1b6fb8');
    frame(ctx, shoeX - 2, 3, cw + 5, ch - 2, '#c9a22f');
    // dealer
    const dy = Math.round(H * 0.2);
    if (tt < 5.4) {
      drawCard(ctx, W / 2 - cw / 2 - 1, dy, cw, ch, { r: '9', s: 'c' }, 0, '#1b6fb8');
      drawCard(ctx, W / 2 + cw / 2 + 1, dy, cw, ch, { r: '9', s: 'c' }, 1, '#1b6fb8');
    }
    // player hand
    const py = Math.round(H * 0.6);
    const hand: Array<{ card: Card; at: number; dx: number; dy: number }> = [
      { card: { r: 'A', s: 's' }, at: 0.35, dx: -3, dy: 0 },
      { card: { r: 'K', s: 'h' }, at: 0.95, dx: 3, dy: -2 },
    ];
    const bj = tt > 1.7 && tt < 5.4;
    const blink = f.still || (tt * 5) % 1 < 0.55;
    for (const h of hand) {
      if (tt < h.at || tt > 5.4) continue;
      const k = easeOut((tt - h.at) / 0.4);
      const x = shoeX + cw / 2 + (W / 2 + h.dx - shoeX - cw / 2) * k;
      const y = 8 + (py + h.dy - 8) * k;
      drawCard(ctx, x, y, cw, ch, h.card, clamp((tt - h.at - 0.25) / 0.2, 0, 1), '#1b6fb8', bj && blink ? '#ffd23f' : undefined);
    }
    // bet + payout chips
    const chipX = W / 2 - 2;
    const chipY = py + ch / 2 + 4;
    if (chipY < H - 4) {
      for (let k = 0; k < 2; k++) drawChip(ctx, chipX - 7, chipY - k * 2, '#ffd23f');
      if (tt > 2.2 && tt < 5.4) {
        const k = easeOut((tt - 2.2) / 0.5);
        for (let j = 0; j < 3; j++) drawChip(ctx, chipX + 7, chipY - j * 2 - (1 - k) * (chipY - dy), CHIP_COLORS[j]!);
      }
    }
    if (tt > 1.4 && tt < 5.4) {
      const bx = Math.round(W / 2 + cw + 2);
      const by = Math.round(py - ch / 2 - 1);
      rect(ctx, bx, by, 11, 7, '#ffd23f');
      drawText(ctx, '21', bx + 2, by + 1, '#3b0a12');
    }
    if (bj && f.hud) {
      const ty = Math.round(H * 0.36);
      const scale = W >= 120 ? 2 : 1;
      drawTextC(ctx, 'BLACKJACK!', W / 2, ty, blink ? '#ffd23f' : '#ffffff', scale, '#2b0508');
      for (let i = 0; i < 6; i++) {
        const sx = W * (0.12 + hash(i * 3.3) * 0.76);
        const sy = ty - 5 + hash(i * 7.1) * 16;
        sparkle(ctx, sx, sy, tt * 3 + i * 0.37, i % 2 ? '#ffd23f' : '#fff6c8');
      }
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DAS Bingo — balls pop, the card daubs into a line: BINGO!
// ---------------------------------------------------------------------------
const BINGO_COLS = ['#38bdf8', '#a78bfa', '#ff4fd8', '#2de38f', '#ffb020'];
const BINGO_CARD: number[][] = Array.from({ length: 5 }, (_, col) =>
  Array.from({ length: 5 }, (_, row) => {
    if (col === 2 && row === 2) return 0;
    return col * 15 + 1 + Math.floor(hash(col * 11 + row * 3.7) * 14.99);
  }),
);
// Calls: two misses plus the middle row (the centre is FREE).
const BINGO_CALLS: Array<{ col: number; num: number; row: number | null }> = [
  { col: 1, num: 22, row: null },
  { col: 0, num: BINGO_CARD[0]![2]!, row: 2 },
  { col: 3, num: BINGO_CARD[3]![2]!, row: 2 },
  { col: 4, num: 70, row: null },
  { col: 1, num: BINGO_CARD[1]![2]!, row: 2 },
  { col: 4, num: BINGO_CARD[4]![2]!, row: 2 },
];

const bingo: Program = {
  still: 5.6,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 7.6;
    const tt = ((f.t % C) + C) % C;
    dottedBg(ctx, W, H, '#071a2e', '#0f2d4d', 5);
    const cs = clamp(Math.floor(Math.min(W * 0.5, H * 0.72) / 5), 5, 16);
    const gs = cs * 5;
    const gx = Math.round(W - gs - W * 0.07);
    const gy = Math.round((H - gs) / 2 + 3);
    // card
    rect(ctx, gx - 1, gy - 8, gs + 2, gs + 9, '#0a0f2a');
    rect(ctx, gx + 1, gy + 1, gs, gs, 'rgba(0,0,0,0.45)');
    rect(ctx, gx, gy, gs, gs, '#eef6ff');
    for (let c = 0; c < 5; c++) {
      rect(ctx, gx + c * cs, gy - 7, cs, 7, BINGO_COLS[c]!);
      drawTextC(ctx, 'BINGO'[c]!, gx + c * cs + cs / 2, gy - 6, '#ffffff');
    }
    for (let i = 1; i < 5; i++) {
      rect(ctx, gx + i * cs, gy, 1, gs, '#b9d3f0');
      rect(ctx, gx, gy + i * cs, gs, 1, '#b9d3f0');
    }
    const calledIdx = BINGO_CALLS.map((_, i) => 0.4 + i * 0.85).filter((at) => tt >= at).length;
    const daubed = new Set<string>(['2,2']);
    BINGO_CALLS.forEach((c, i) => {
      if (c.row !== null && tt >= 0.4 + i * 0.85 + 0.35) daubed.add(`${c.col},${c.row}`);
    });
    const win = tt > 5.2;
    const blink = f.still || (tt * 5) % 1 < 0.55;
    for (let c = 0; c < 5; c++)
      for (let r = 0; r < 5; r++) {
        const x = gx + c * cs;
        const y = gy + r * cs;
        if (win && r === 2) rect(ctx, x + 1, y + 1, cs - 1, cs - 1, blink ? '#ffd23f' : '#fff3b0');
        const n = BINGO_CARD[c]![r]!;
        if (cs >= 9) {
          if (n === 0) rect(ctx, x + cs / 2 - 1, y + cs / 2 - 1, 3, 3, '#ff4fd8');
          else drawTextC(ctx, String(n), x + cs / 2 + 0.5, y + Math.floor((cs - 5) / 2) + 1, '#1d2a4a');
        } else rect(ctx, x + Math.floor(cs / 2), y + Math.floor(cs / 2), 1, 1, '#1d2a4a');
        if (daubed.has(`${c},${r}`)) {
          const rr = Math.max(1.5, cs * 0.36);
          disc(ctx, x + cs / 2, y + cs / 2, rr, 'rgba(255,79,216,0.72)');
        }
      }
    // current ball
    const areaW = gx - 2;
    const bx = Math.round(areaW / 2 + 1);
    const by = Math.round(H * 0.42);
    const R = clamp(Math.floor(Math.min(areaW * 0.36, H * 0.2)), 5, 18);
    if (calledIdx > 0 && tt < 7.2) {
      const call = BINGO_CALLS[calledIdx - 1]!;
      const since = tt - (0.4 + (calledIdx - 1) * 0.85);
      const pop = since < 0.12 ? 1.18 : since < 0.22 ? 1.06 : 1;
      const drop = Math.round((1 - easeOut(since / 0.2)) * -8);
      const r = R * pop;
      disc(ctx, bx + 1, by + 2 + drop, r, 'rgba(0,0,0,0.45)');
      disc(ctx, bx, by + drop, r, BINGO_COLS[call.col]!);
      disc(ctx, bx, by + drop, r * 0.64, '#ffffff');
      rect(ctx, bx - Math.round(r * 0.55), by + drop - Math.round(r * 0.7), 2, 1, 'rgba(255,255,255,0.8)');
      const label = r * 1.28 >= textWidth(`${'BINGO'[call.col]}${call.num}`) + 1 ? `${'BINGO'[call.col]}${call.num}` : String(call.num);
      drawTextC(ctx, label, bx + 0.5, by + drop - 2, '#1d2a4a');
      // previous balls
      for (let k = 1; k <= 3 && calledIdx - 1 - k >= 0; k++) {
        const prev = BINGO_CALLS[calledIdx - 1 - k]!;
        disc(ctx, bx - 8 + k * 5 - 2, by + R + 6, 2, BINGO_COLS[prev.col]!);
      }
    }
    if (win && f.hud) {
      const scale = W >= 90 ? 2 : 1;
      const ty = Math.round(H * 0.1);
      drawTextC(ctx, 'BINGO!', W / 2, ty, blink ? '#ffd23f' : '#ffffff', scale, '#071a2e');
      for (let i = 0; i < 5; i++) sparkle(ctx, W * (0.1 + hash(i + 40) * 0.8), H * (0.1 + hash(i + 50) * 0.3), tt * 3 + i * 0.4, '#fff6c8');
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// Wheel of DAStiny — a prize wheel spins and lands, sunburst behind.
// ---------------------------------------------------------------------------
const WHEEL_COLORS = ['#ffb020', '#ff4f81', '#ffd23f', '#a78bfa', '#22d3ee', '#ff8a3d', '#2de38f', '#ff5a5f'].map(rgb);
const imageCache = new WeakMap<Ctx, { w: number; h: number; img: ImageData; key: string }>();

function scratchImage(ctx: Ctx, W: number, H: number, key: string): { img: ImageData; fresh: boolean } {
  const c = imageCache.get(ctx);
  if (c && c.w === W && c.h === H && c.key === key) return { img: c.img, fresh: false };
  const img = ctx.createImageData(W, H);
  imageCache.set(ctx, { w: W, h: H, img, key });
  return { img, fresh: true };
}

const wheelFinal = (cycle: number, n: number) => -Math.PI / 2 - (Math.floor(hash(cycle * 1.37 + 2) * n) + 0.5) * ((Math.PI * 2) / n);

const wheel: Program = {
  still: 5.2,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 6.6;
    const cycle = Math.floor(f.t / C);
    const tt = f.t - cycle * C;
    const N = 8;
    const TAU = Math.PI * 2;
    const from = wheelFinal(cycle - 1, N);
    const to = wheelFinal(cycle, N);
    const delta = (((to - from) % TAU) + TAU) % TAU;
    const p = clamp((tt - 0.4) / 3.8, 0, 1);
    const rot = from + (delta + TAU * 3) * easeOut(p);
    const landed = tt > 4.2;
    const winIdx = Math.floor(hash(cycle * 1.37 + 2) * N);
    const flash = landed && (f.still || (tt * 6) % 1 < 0.5);
    const cx = W / 2;
    const cy = H * 0.54;
    const R = Math.floor(Math.min(W, H) * 0.4);
    const { img } = scratchImage(ctx, W, H, 'wheel');
    const d = img.data;
    const spin = f.t * 0.12;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        let r: number, g: number, b: number;
        if (dist <= R) {
          if (dist > R - 2) {
            r = 122;
            g = 74;
            b = 8;
          } else {
            const segF = ((((a - rot) / TAU) * N) % N + N) % N;
            const seg = Math.floor(segF);
            const edge = (segF - seg) * ((TAU * dist) / N);
            const col = WHEEL_COLORS[seg % WHEEL_COLORS.length]!;
            const shade = 0.72 + 0.28 * (dist / R);
            const lit = flash && seg === winIdx ? 1.35 : 1;
            if (edge < 0.9 && dist > R * 0.2) {
              r = 255;
              g = 226;
              b = 150;
            } else {
              r = Math.min(255, col[0] * shade * lit);
              g = Math.min(255, col[1] * shade * lit);
              b = Math.min(255, col[2] * shade * lit);
            }
          }
        } else {
          const ray = Math.floor((((a + spin) / TAU) * 16 + 16) % 16) % 2;
          const fall = clamp(1 - dist / (Math.max(W, H) * 0.75), 0, 1);
          r = (ray ? 92 : 58) * (0.5 + fall * 0.8);
          g = (ray ? 38 : 20) * (0.5 + fall * 0.8);
          b = (ray ? 14 : 8) * (0.5 + fall * 0.8);
        }
        const i = (y * W + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // bulbs on the rim
    const bulbs = 16;
    for (let k = 0; k < bulbs; k++) {
      const a = (k / bulbs) * TAU;
      const lit = f.still ? k % 2 === 0 : (k + Math.floor(f.t * (landed ? 10 : 6))) % 2 === 0;
      rect(ctx, cx + Math.cos(a) * (R - 1) - 0.5, cy + Math.sin(a) * (R - 1) - 0.5, 1, 1, lit ? '#fff3b0' : '#5a3406');
    }
    disc(ctx, cx, cy, Math.max(2, R * 0.2), '#c9a22f');
    disc(ctx, cx, cy, Math.max(1, R * 0.1), '#2a1405');
    // pointer
    const top = Math.round(cy - R - 3);
    for (let i = 0; i < 4; i++) rect(ctx, cx - 3 + i, top + i, 7 - i * 2, 1, i === 0 ? '#ffffff' : '#ff4f81');
    if (landed && tt < 6.3) {
      const ty = Math.round(Math.min(H - 16, cy + R + 2));
      if (f.hud && ty > cy + R - 2) drawTextC(ctx, 'WINNER!', W / 2, ty, flash ? '#ffd23f' : '#ffffff', 1, '#2a1405');
      for (let i = 0; i < 6; i++) sparkle(ctx, cx + Math.cos(i * 1.05 + f.t) * (R + 4), cy + Math.sin(i * 1.05 + f.t) * (R + 4), tt * 3 + i * 0.3, '#fff3b0');
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DASino — slot reels stop on 7-7-7, JACKPOT, coins everywhere.
// ---------------------------------------------------------------------------
const SYM: Record<string, { rows: readonly string[]; pal: Record<string, string> }> = {
  seven: { rows: ['#######', '#######', '....##.', '...##..', '..##...', '..##...', '..##...'], pal: { '#': '#ff3b5c' } },
  cherry: { rows: ['....g..', '...g.g.', '..g...g', '.r...r.', 'rwr.rwr', 'rrr.rrr', '.r...r.'], pal: { g: '#2de38f', r: '#ff3b5c', w: '#ffd6de' } },
  bell: { rows: ['...y...', '..yyy..', '.yywyy.', '.yyyyy.', '.yyyyy.', 'yyyyyyy', '...y...'], pal: { y: '#ffd23f', w: '#fff6c8' } },
  bar: { rows: ['.......', 'kkkkkkk', 'kwkwkwk', 'kkkkkkk', 'kkkkkkk', 'kwkwkwk', 'kkkkkkk'], pal: { k: '#1c0b2e', w: '#c084fc' } },
  diamond: { rows: ['.......', '.ccccc.', 'cwccccc', 'ccccccc', '.ccccc.', '..ccc..', '...c...'], pal: { c: '#38e1ff', w: '#e6fbff' } },
  star: { rows: ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', '.y...y.'], pal: { y: '#ffb020' } },
};
const REELS: string[][] = [
  ['cherry', 'bell', 'seven', 'bar', 'diamond', 'star', 'cherry', 'bell'],
  ['bar', 'seven', 'cherry', 'star', 'bell', 'diamond', 'bar', 'cherry'],
  ['diamond', 'star', 'bell', 'cherry', 'bar', 'seven', 'star', 'bell'],
];

const dasino: Program = {
  still: 3.3,
  draw(f) {
    const { ctx, W, H } = f;
    const C = 6;
    const tt = ((f.t % C) + C) % C;
    rect(ctx, 0, 0, W, H, '#1c0b2e');
    // chaser bulbs round the edge
    const step = 4;
    let idx = 0;
    const chase = f.still ? 0 : Math.floor(f.t * 10);
    const bulb = (x: number, y: number) => {
      const lit = (idx + chase) % 3 === 0;
      rect(ctx, x, y, 1, 1, lit ? '#ffd23f' : '#4b2a6b');
      idx++;
    };
    for (let x = 1; x < W - 1; x += step) bulb(x, 1);
    for (let y = 1; y < H - 1; y += step) bulb(W - 2, y);
    for (let x = W - 2; x > 1; x -= step) bulb(x, H - 2);
    for (let y = H - 2; y > 1; y -= step) bulb(1, y);
    const rw = Math.max(11, Math.floor(W * 0.19));
    const rh = Math.max(16, Math.floor(H * 0.46));
    const total = rw * 3 + 4;
    const x0 = Math.round((W - total) / 2) - 2;
    const y0 = Math.round(H * 0.22);
    rect(ctx, x0 - 3, y0 - 3, total + 6, rh + 6, '#3b1a5c');
    frame(ctx, x0 - 2, y0 - 2, total + 4, rh + 4, '#ffd23f');
    const pitch = 9;
    const stops = [1.3, 1.85, 2.5];
    const v = 70;
    for (let r = 0; r < 3; r++) {
      const rx = x0 + r * (rw + 2);
      rect(ctx, rx, y0, rw, rh, '#fff8ee');
      const strip = REELS[r]!;
      const L = strip.length * pitch;
      const sStop = strip.indexOf('seven') * pitch;
      const since = tt - stops[r]!;
      const spinning = tt < stops[r]! && tt > 0.1;
      let s = since < 0 ? sStop + since * v : sStop + Math.sin(since * 26) * 2.2 * Math.exp(-since * 9);
      s = ((s % L) + L) % L;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, y0, rw, rh);
      ctx.clip();
      const centerY = y0 + rh / 2 - 3.5;
      for (let k = -3; k <= strip.length + 3; k++) {
        const sy = centerY + k * pitch - s;
        const wrapped = sy < y0 - pitch ? sy + L : sy > y0 + rh + L ? sy - L : sy;
        if (wrapped < y0 - pitch || wrapped > y0 + rh) continue;
        const sym = SYM[strip[((k % strip.length) + strip.length) % strip.length]!]!;
        if (spinning) sprite(ctx, sym.rows, rx + (rw - 7) / 2, wrapped - 3, { ...Object.fromEntries(Object.keys(sym.pal).map((key) => [key, 'rgba(90,60,120,0.35)'])) });
        sprite(ctx, sym.rows, rx + (rw - 7) / 2, wrapped, sym.pal);
      }
      ctx.restore();
      rect(ctx, rx, y0, rw, 2, 'rgba(0,0,0,0.25)');
      rect(ctx, rx, y0 + rh - 2, rw, 2, 'rgba(0,0,0,0.25)');
    }
    const jackpot = tt > 2.65 && tt < 5.6;
    const blink = f.still || (tt * 6) % 1 < 0.55;
    if (jackpot && blink) {
      rect(ctx, x0 - 2, y0 + Math.round(rh / 2), total + 4, 1, '#ffd23f');
    }
    // lever
    const lx = x0 + total + 4;
    const pull = tt < 0.5 ? Math.sin((tt / 0.5) * Math.PI) : 0;
    const ly0 = y0 + Math.round(rh * 0.7);
    const ballY = Math.round(y0 - 2 + pull * rh * 0.55);
    if (lx + 3 < W - 2) {
      line(ctx, lx + 1, ly0, lx + 1, ballY, '#8f88b3');
      disc(ctx, lx + 1, ballY, 1.6, '#ff3b5c');
      rect(ctx, lx - 1, ly0 - 1, 3, 3, '#3b1a5c');
    }
    if (jackpot) {
      const scale = W >= 120 ? 2 : 1;
      const ty = Math.max(2, y0 - 5 * scale - 5);
      if (f.hud) drawTextC(ctx, 'JACKPOT', W / 2, ty, blink ? '#ffd23f' : '#ffffff', scale, '#1c0b2e');
      const since = tt - 2.65;
      for (let i = 0; i < 12; i++) {
        const t0 = (i % 6) * 0.18;
        const age = since - t0;
        if (age < 0) continue;
        const vx = (hash(i * 3.1) - 0.5) * W * 0.9;
        const vy = -H * (0.7 + hash(i * 5.3) * 0.5);
        const cxp = W / 2 + vx * age;
        const cyp = y0 + rh + 2 + vy * age + H * 1.6 * age * age;
        if (cyp > H) continue;
        disc(ctx, cxp, cyp, 1.4, '#ffd23f');
        rect(ctx, cxp, cyp - 1, 1, 1, '#fff6c8');
      }
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DASh Circuit — tiny top-down cars racing a neon oval.
// ---------------------------------------------------------------------------
interface Track {
  cx: number;
  cy: number;
  L: number;
  r: number;
  hw: number;
  P: number;
}

function trackOf(W: number, H: number): Track {
  const r = H * 0.29;
  const L = Math.max(4, W * 0.26);
  return { cx: W / 2, cy: H * 0.53, L, r, hw: Math.max(2.5, H * 0.085), P: 4 * L + 2 * Math.PI * r };
}

function trackPoint(tr: Track, u: number, lane = 0): [number, number] {
  const { cx, cy, L, r } = tr;
  u = ((u % tr.P) + tr.P) % tr.P;
  const rr = r + lane;
  if (u < 2 * L) return [cx - L + u, cy + rr];
  u -= 2 * L;
  if (u < Math.PI * r) {
    const a = Math.PI / 2 - u / r;
    return [cx + L + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  }
  u -= Math.PI * r;
  if (u < 2 * L) return [cx + L - u, cy - rr];
  u -= 2 * L;
  const a = -Math.PI / 2 - u / r;
  return [cx - L + Math.cos(a) * rr, cy + Math.sin(a) * rr];
}

const CARS = [
  { color: '#22d3ee', lap: 3.1, lane: -1, off: 0 },
  { color: '#f97316', lap: 3.25, lane: 1, off: 0.05 },
  { color: '#ff4fd8', lap: 3.4, lane: -1, off: 0.1 },
  { color: '#ffd23f', lap: 3.55, lane: 1, off: 0.16 },
];

const circuit: Program = {
  still: 1.7,
  draw(f) {
    const { ctx, W, H } = f;
    const tr = trackOf(W, H);
    const { img, fresh } = scratchImage(ctx, W, H, 'circuit');
    if (fresh) {
      const d = img.data;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const qx = Math.abs(x + 0.5 - tr.cx);
          const qy = y + 0.5 - tr.cy;
          const radial = qx <= tr.L ? Math.abs(qy) : Math.hypot(qx - tr.L, qy);
          const dist = radial - tr.r;
          const ad = Math.abs(dist);
          let c: [number, number, number];
          if (ad <= tr.hw) {
            if (ad > tr.hw - 1) c = dist > 0 ? [34, 211, 238] : [249, 115, 22];
            else c = (x + y) % 7 === 0 ? [22, 44, 58] : [14, 34, 46];
          } else if (ad <= tr.hw + 1) c = dist > 0 ? [10, 70, 84] : [80, 38, 10];
          else c = x % 8 === 0 || y % 8 === 0 ? [8, 32, 42] : [4, 22, 31];
          const i = (y * W + x) * 4;
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
          d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    // start/finish checker on the bottom straight
    const sx = Math.round(tr.cx + tr.L * 0.35);
    for (let y = Math.round(tr.cy + tr.r - tr.hw + 1); y < tr.cy + tr.r + tr.hw - 1; y++)
      for (let k = 0; k < 2; k++) rect(ctx, sx + k, y, 1, 1, (y + k) % 2 ? '#ffffff' : '#0b1a22');
    // dashed centre line
    for (let u = 0; u < tr.P; u += 4) {
      const [x, y] = trackPoint(tr, u);
      rect(ctx, x, y, 1, 1, '#2d5566');
    }
    const lapLabel = `LAP ${(Math.floor(f.t / 3.3) % 3) + 1}/3`;
    if (f.hud) drawTextC(ctx, lapLabel, tr.cx, tr.cy - 2, '#8adff0', 1);
    // cars + trails
    const big = W >= 72;
    for (const car of CARS) {
      const u = (f.t / car.lap + car.off) * tr.P;
      for (let k = 8; k >= 1; k--) {
        const [x, y] = trackPoint(tr, u - k * 1.5, car.lane);
        rect(ctx, x, y, 1, 1, mix(car.color, '#04161f', 0.15 + k * 0.1));
      }
      const [x, y] = trackPoint(tr, u, car.lane);
      const [nx, ny] = trackPoint(tr, u + 2.5, car.lane);
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (big) {
        rect(ctx, cx - 1, cy - 1, 3, 3, car.color);
        rect(ctx, cx, cy, 1, 1, '#04161f');
      } else rect(ctx, cx - 1, cy - 1, 2, 2, car.color);
      rect(ctx, Math.round(nx), Math.round(ny), 1, 1, '#ffffff');
    }
    drawHud(f);
  },
};

// ---------------------------------------------------------------------------
// DASQuest — a pixel hero walks glitchy corridors; a d20 rolls a crit.
// ---------------------------------------------------------------------------
const HERO_A = ['..hhh...', '.hhhhh..', '.hsss...', '..sss.w.', '.cccc.w.', 'ccccccw.', '.cccc.w.', '.cccc...', '.l..l...', '.l..l...'];
const HERO_B = ['..hhh...', '.hhhhh..', '.hsss...', '..sss.w.', '.cccc.w.', 'ccccccw.', '.cccc.w.', '.cccc...', '..ll....', '.l...l..'];
const HERO_PAL = { h: '#a3e635', s: '#f5c9a0', c: '#22d3ee', w: '#f8f6ff', l: '#3a2a1a' };
const D20 = [
  '.....#.....',
  '...##.##...',
  '..#.....#..',
  '.#.......#.',
  '#.........#',
  '#.........#',
  '#.........#',
  '.#.......#.',
  '..#.....#..',
  '...##.##...',
  '.....#.....',
];
const D20_FILL = [
  '...........',
  '.....#.....',
  '...#####...',
  '..#######..',
  '.#########.',
  '.#########.',
  '.#########.',
  '..#######..',
  '...#####...',
  '.....#.....',
  '...........',
];

const quest: Program = {
  still: 1.7,
  draw(f) {
    const { ctx, W, H } = f;
    const floorY = Math.round(H * 0.72);
    // back wall bricks
    const wallOff = Math.floor(f.t * 7);
    rect(ctx, 0, 0, W, floorY, '#0b1604');
    for (let row = 0; row * 5 < floorY; row++) {
      const y = row * 5;
      const shift = (row % 2) * 5 - (wallOff % 10);
      for (let x = shift - 10; x < W; x += 10) {
        const id = Math.floor((x + wallOff) / 10) * 31 + row * 7;
        const tone = hash(id);
        rect(ctx, x + 1, y + 1, 9, 4, tone > 0.8 ? '#2b4a19' : tone > 0.35 ? '#1f3512' : '#18290d');
      }
    }
    // torches
    const tOff = Math.floor(f.t * 7) % 40;
    for (let x = 12 - tOff; x < W + 40; x += 40) {
      const ty = Math.round(H * 0.3);
      rect(ctx, x, ty + 3, 2, 4, '#4a3520');
      const fl = Math.floor(f.t * 9 + x) % 3;
      rect(ctx, x - 1, ty - 1 + (fl === 1 ? 1 : 0), 4, 3, '#ff8a3d');
      rect(ctx, x, ty - 2 + fl % 2, 2, 3, '#ffd23f');
      disc(ctx, x + 1, ty + 1, 6, 'rgba(255,160,60,0.08)');
    }
    // floor tiles
    const floorOff = Math.floor(f.t * 14);
    rect(ctx, 0, floorY, W, H - floorY, '#1a2a10');
    rect(ctx, 0, floorY, W, 1, '#4d7a26');
    for (let x = -(floorOff % 12); x < W; x += 12) {
      rect(ctx, x, floorY + 1, 1, H - floorY, '#0f1a08');
      rect(ctx, x + 1, floorY + 1, 11, 1, '#2d4a1a');
    }
    // glowing runes on the floor
    for (let k = 0; k < 3; k++) {
      const rx = ((k * 53 - floorOff * 1) % (W + 20) + W + 20) % (W + 20) - 10;
      const pulse = 0.5 + 0.5 * Math.sin(f.t * 3 + k);
      rect(ctx, rx, floorY + 4, 3, 1, pulse > 0.5 ? '#a3e635' : '#4d7a26');
      rect(ctx, rx + 1, floorY + 3, 1, 3, pulse > 0.5 ? '#a3e635' : '#4d7a26');
    }
    // hero
    const step = Math.floor(f.t * 6) % 2;
    const hx = Math.round(W * 0.3);
    sprite(ctx, step ? HERO_B : HERO_A, hx, floorY - 10 - (step ? 1 : 0), HERO_PAL);
    // d20
    const C = 4.2;
    const tt = ((f.t % C) + C) % C;
    const dx = W - 16;
    const rolling = tt < 1.1;
    const bounce = rolling ? Math.abs(Math.sin(tt * 9)) * (1 - tt / 1.1) * 10 : 0;
    const dyy = Math.round(H * 0.16 - bounce);
    const crit = !rolling && tt < 3.6;
    const blink = f.still || (tt * 5) % 1 < 0.6;
    sprite(ctx, D20_FILL, dx, dyy, { '#': '#0d1a05' });
    sprite(ctx, D20, dx, dyy, { '#': crit && blink ? '#ffd23f' : '#a3e635' });
    const face = rolling ? 1 + Math.floor(hash(Math.floor(f.t * 14)) * 19.99) : 20;
    drawTextC(ctx, String(face), dx + 5.5, dyy + 3, crit ? '#ffd23f' : '#ffffff');
    if (crit && f.hud) drawTextC(ctx, 'CRIT!', dx + 5, dyy + 13, blink ? '#ffd23f' : '#fff6c8', 1, '#0d1a05');
    // glitch slices
    const g = f.t % 3.3;
    if (!f.still && g > 2.95) {
      for (let k = 0; k < 3; k++) {
        const sy = Math.floor(hash(Math.floor(f.t * 20) + k * 7) * (H - 4));
        const sh = 2 + Math.floor(hash(k + Math.floor(f.t * 20)) * 3);
        const off = Math.round((hash(k * 13 + Math.floor(f.t * 30)) - 0.5) * 8);
        ctx.drawImage(ctx.canvas, 0, sy, W, sh, off, sy, W, sh);
        rect(ctx, 0, sy, W, 1, k % 2 ? 'rgba(255,79,216,0.45)' : 'rgba(34,211,238,0.45)');
      }
    }
    drawHud(f);
  },
};

export const ATTRACT: Record<GameId, Program> = { dasketch, holdem, blackjack, bingo, wheel, dasino, circuit, quest };

/** Draws one attract frame (safe to call with any size ≥ 32×24). */
export function drawAttract(f: AttractFrame): void {
  const program = ATTRACT[f.game.id];
  f.ctx.imageSmoothingEnabled = false;
  program.draw(f);
}

export function stillTime(id: GameId): number {
  return ATTRACT[id].still;
}

