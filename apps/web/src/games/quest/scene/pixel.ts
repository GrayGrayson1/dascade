/**
 * Tiny pixel-art toolkit for the DASQuest scene renderer. Everything draws into a
 * low-resolution canvas (240×135) that CSS scales up with image-rendering: pixelated.
 */

export const W = 240;
export const H = 135;

export type G = CanvasRenderingContext2D;

export interface Paint {
  /** Main pixel layer. */
  g: G;
  /** Bloom layer (blurred + screen-blended by CSS). */
  glow: G;
  /** Seconds since the scene mounted (frozen at a pleasant frame when motion is off). */
  t: number;
  /** Parallax input, −1…1 on each axis. */
  px: number;
  py: number;
  /** Stable per-scene variation. */
  seed: number;
  motion: boolean;
  fx: 'high' | 'low' | 'off';
}

export function rect(g: G, color: string, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function px(g: G, color: string, x: number, y: number): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function hline(g: G, color: string, x: number, y: number, w: number): void {
  rect(g, color, x, y, w, 1);
}

export function vline(g: G, color: string, x: number, y: number, h: number): void {
  rect(g, color, x, y, 1, h);
}

export function frame(g: G, color: string, x: number, y: number, w: number, h: number): void {
  hline(g, color, x, y, w);
  hline(g, color, x, y + h - 1, w);
  vline(g, color, x, y, h);
  vline(g, color, x + w - 1, y, h);
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Ordered-dither `b` over `a` with density 0…1 inside a rectangle. */
export function dither(g: G, a: string, b: string, x: number, y: number, w: number, h: number, density: number): void {
  rect(g, a, x, y, w, h);
  if (density <= 0) return;
  g.fillStyle = b;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let j = 0; j < Math.round(h); j++) {
    for (let i = 0; i < Math.round(w); i++) {
      if (BAYER[(y0 + j) & 3]![(x0 + i) & 3]! / 16 < density) g.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }
}

/** Vertical gradient built from dithered bands between palette stops. */
export function bands(g: G, stops: readonly string[], x: number, y: number, w: number, h: number): void {
  const n = stops.length - 1;
  if (n <= 0) {
    rect(g, stops[0] ?? '#000', x, y, w, h);
    return;
  }
  const bandH = h / n;
  for (let i = 0; i < n; i++) {
    const by = y + Math.round(i * bandH);
    const bh = Math.round((i + 1) * bandH) - Math.round(i * bandH);
    const a = stops[i]!;
    const b = stops[i + 1]!;
    // Solid top half, dithered transition in the bottom half of each band.
    rect(g, a, x, by, w, Math.ceil(bh / 2));
    const half = Math.floor(bh / 2);
    for (let k = 0; k < half; k++) dither(g, a, b, x, by + Math.ceil(bh / 2) + k, w, 1, (k + 1) / (half + 1));
  }
}

/** Soft light on the bloom layer. */
export function light(p: Paint, x: number, y: number, r: number, color: string, alpha = 0.8): void {
  if (p.fx === 'off') return;
  const g = p.glow;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, withAlpha(color, alpha));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Deterministic pseudo-random in [0,1) from integers (stable per scene). */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v) + 0x9e3779b9;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Blit a character-grid sprite. `palette` maps characters to colors ('.' = transparent). */
export function sprite(g: G, rows: readonly string[], palette: Record<string, string>, x: number, y: number, flip = false): void {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!;
      if (ch === '.' || ch === ' ') continue;
      const color = palette[ch];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(Math.round(x + (flip ? w - 1 - i : i)), Math.round(y + j), 1, 1);
    }
  });
}

// ---------------------------------------------------------------------------
// 3×5 pixel font for in-scene signage
// ---------------------------------------------------------------------------

const FONT: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  '½': '100101010001011',
  '¼': '100101010011001',
  '!': '010010010000010',
  '?': '110001010000010',
  '-': '000000111000000',
  '.': '000000000000010',
  ':': '000010000010000',
  '/': '001001010100100',
  '%': '101001010100101',
  '+': '000010111010000',
  '>': '100010001010100',
  '<': '001010100010001',
  '#': '101111101111101',
  "'": '010010000000000',
  '∞': '000000111111000',
};

export function text(g: G, str: string, x: number, y: number, color: string): number {
  let cx = Math.round(x);
  g.fillStyle = color;
  for (const ch of str.toUpperCase()) {
    if (ch === ' ') {
      cx += 3;
      continue;
    }
    const bits = FONT[ch];
    if (bits) {
      for (let i = 0; i < 15; i++) if (bits[i] === '1') g.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
    }
    cx += 4;
  }
  return cx - Math.round(x);
}

export function textWidth(str: string): number {
  let w = 0;
  for (const ch of str) w += ch === ' ' ? 3 : 4;
  return Math.max(0, w - 1);
}

// ---------------------------------------------------------------------------
// Shared scene building blocks
// ---------------------------------------------------------------------------

/** A receding floor with perspective lines toward a vanishing point. */
export function perspectiveFloor(g: G, top: number, base: string, line: string, vx: number, spacing = 18, rows = 5): void {
  rect(g, base, 0, top, W, H - top);
  for (let i = -10; i <= 22; i++) {
    const bx = i * spacing;
    // Line from (vx, top) to (bx, H)
    const steps = H - top;
    for (let s = 0; s < steps; s += 1) {
      const k = s / steps;
      const x = vx + (bx - vx) * k;
      if (x >= 0 && x < W && (s & 1) === 0) px(g, line, x, top + s);
    }
  }
  let y = top + 2;
  let gap = 2;
  for (let r = 0; r < rows + 6 && y < H; r++) {
    hline(g, line, 0, Math.round(y), W);
    gap *= 1.55;
    y += gap;
  }
}

/** Ceiling light panel that can flicker. */
export function ceilingLight(p: Paint, x: number, y: number, w: number, color: string, flicker = 0): void {
  const on = !p.motion || flicker <= 0 || Math.sin(p.t * 17 + x) > -1 + flicker * 0.15 || hash(Math.floor(p.t * 8), x) > flicker * 0.3;
  rect(p.g, on ? color : '#2b2a44', x, y, w, 2);
  rect(p.g, '#15132a', x - 1, y - 1, w + 2, 1);
  if (on) light(p, x + w / 2, y + 2, w * 0.9, color, 0.45);
}

/** Monitors with glowing text lines. */
export function monitor(p: Paint, x: number, y: number, color: string, msg?: string): void {
  const { g } = p;
  rect(g, '#0b0914', x - 1, y - 1, 16, 12);
  rect(g, '#10202a', x, y, 14, 10);
  if (msg) {
    rect(g, withAlpha(color, 0.25), x + 1, y + 1, 12, 8);
    for (let i = 0; i < 3; i++) hline(g, color, x + 2, y + 2 + i * 3, 4 + ((i * 7 + x) % 7));
  } else {
    for (let i = 0; i < 3; i++) hline(g, withAlpha(color, 0.6), x + 2, y + 2 + i * 2, 3 + ((i * 5 + x) % 8));
  }
  rect(g, '#2a2745', x + 6, y + 10, 3, 2);
  rect(g, '#2a2745', x + 3, y + 12, 9, 1);
  light(p, x + 7, y + 5, 12, color, 0.35);
}

export function desk(g: G, x: number, y: number, w: number, top: string, side: string): void {
  rect(g, top, x, y, w, 3);
  rect(g, side, x + 1, y + 3, 2, 10);
  rect(g, side, x + w - 3, y + 3, 2, 10);
  rect(g, withAlpha('#000000', 0.35), x + 2, y + 13, w - 4, 1);
}

export function plant(g: G, x: number, y: number): void {
  rect(g, '#7a4b2a', x, y + 8, 6, 5);
  rect(g, '#5a3520', x, y + 12, 6, 1);
  for (let i = 0; i < 6; i++) px(g, i % 2 ? '#2de38f' : '#1b9a5c', x + 1 + (i % 4), y + 2 + Math.floor(i / 2) * 2);
  px(g, '#2de38f', x + 2, y);
  px(g, '#1b9a5c', x + 4, y + 1);
}

/** Floating dust / data / bubble particles. */
export function particles(p: Paint, count: number, color: string, opts: { rise?: number; drift?: number; area?: [number, number, number, number]; size?: number } = {}): void {
  const n = p.fx === 'off' ? 0 : p.fx === 'low' ? Math.ceil(count / 3) : count;
  const [ax, ay, aw, ah] = opts.area ?? [0, 0, W, H];
  const rise = opts.rise ?? 4;
  const drift = opts.drift ?? 2;
  for (let i = 0; i < n; i++) {
    const r = hash(p.seed, i);
    const r2 = hash(i, p.seed, 7);
    const x = ax + ((r * aw + Math.sin(p.t * 0.7 + i) * drift + p.t * drift * 0.3 * (r2 - 0.5) * 4) % aw + aw) % aw;
    const y = ay + ((r2 * ah - p.t * rise * (0.5 + r)) % ah + ah) % ah;
    const s = opts.size ?? 1;
    rect(p.g, color, x, y, s, s);
  }
}

/** Random glitch blocks (color-shifted slices). */
export function glitch(p: Paint, intensity: number, colors: readonly string[] = ['#a3e635', '#22d3ee', '#ff4fd8']): void {
  if (p.fx === 'off' || intensity <= 0) return;
  const frame = p.motion ? Math.floor(p.t * 12) : 3;
  const n = Math.round((p.fx === 'low' ? 3 : 8) * intensity);
  for (let i = 0; i < n; i++) {
    const r = hash(frame, i, p.seed);
    if (r > 0.55) continue;
    const x = hash(frame, i, 1) * W;
    const y = hash(frame, i, 2) * H;
    const w = 2 + hash(frame, i, 3) * 18;
    const h = 1 + hash(frame, i, 4) * 3;
    rect(p.g, colors[i % colors.length]!, x, y, w, h);
  }
}
