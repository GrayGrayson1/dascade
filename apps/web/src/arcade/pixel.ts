/**
 * Tiny pixel-art toolkit for the arcade floor canvases (room + attract screens):
 * a 5-row bitmap font, sprites, lines, circles, dithering and a stable hash.
 * Everything draws whole logical pixels so upscaled canvases stay crisp.
 */

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Bitmap font (5 rows; most glyphs 3 wide, a few wider for legibility)
// ---------------------------------------------------------------------------
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '!': ['#', '#', '#', '.', '#'],
  '.': ['.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
  "'": ['#', '#', '.', '.', '.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  ' ': ['..', '..', '..', '..', '..'],
};

function glyph(ch: string): readonly string[] {
  return GLYPHS[ch] ?? GLYPHS['?']!;
}

export const FONT_H = 5;

export function textWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += (glyph(ch)[0]!.length + 1) * scale;
  return Math.max(0, w - scale);
}

export function drawText(ctx: Ctx, text: string, x: number, y: number, color: string, scale = 1): void {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text.toUpperCase()) {
    const g = glyph(ch);
    for (let r = 0; r < g.length; r++) {
      const row = g[r]!;
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(cx + c * scale, cy + r * scale, scale, scale);
    }
    cx += (g[0]!.length + 1) * scale;
  }
}

/** Centered text with an optional 1px drop shadow for legibility over busy art. */
export function drawTextC(ctx: Ctx, text: string, cx: number, y: number, color: string, scale = 1, shadow?: string): void {
  const x = Math.round(cx - textWidth(text, scale) / 2);
  if (shadow) drawText(ctx, text, x + scale, y + scale, shadow, scale);
  drawText(ctx, text, x, y, color, scale);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Rectangle outline (1px). */
export function frame(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** Bresenham line with a square brush of `size` px. */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, size = 1): void {
  ctx.fillStyle = color;
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const off = Math.floor(size / 2);
  for (let guard = 0; guard < 4096; guard++) {
    ctx.fillRect(x0 - off, y0 - off, size, size);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  cx = Math.round(cx);
  cy = Math.round(cy);
  const rr = Math.max(0, r);
  for (let dy = -Math.floor(rr); dy <= Math.floor(rr); dy++) {
    const dx = Math.floor(Math.sqrt(rr * rr - dy * dy) + 0.35);
    ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

export function ring(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  cx = Math.round(cx);
  cy = Math.round(cy);
  const steps = Math.max(12, Math.ceil(r * 7));
  let lx = NaN;
  let ly = NaN;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (x !== lx || y !== ly) ctx.fillRect(x, y, 1, 1);
    lx = x;
    ly = y;
  }
}

/** Draws a sprite authored as character rows; '.' is transparent. */
export function sprite(
  ctx: Ctx,
  rows: readonly string[],
  x: number,
  y: number,
  pal: Record<string, string>,
  scale = 1,
  flipX = false,
): void {
  x = Math.round(x);
  y = Math.round(y);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const n = row.length;
    let c = 0;
    while (c < n) {
      const ch = row[flipX ? n - 1 - c : c]!;
      if (ch === '.') {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < n && row[flipX ? n - 1 - (c + run) : c + run] === ch) run++;
      const color = pal[ch];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + c * scale, y + r * scale, run * scale, scale);
      }
      c += run;
    }
  }
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function hash2(a: number, b: number): number {
  return hash(a * 57.31 + b * 113.17 + 0.5);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t: number) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** 4×4 Bayer thresholds in [0, 1). */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function bayer(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)]!;
}

/** Parses #rrggbb into [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const k = clamp(t, 0, 1);
  const to = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${to(r1 + (r2 - r1) * k)}${to(g1 + (g2 - g1) * k)}${to(b1 + (b2 - b1) * k)}`;
}
