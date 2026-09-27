/**
 * Shared vocabulary for attract-mode scenes: the frame contract plus small
 * pixel-art helpers (cards, chips, sparkles, ellipses, scratch buffers…).
 * Everything draws whole logical pixels so upscaled canvases stay crisp.
 */
import type { GameAccent } from '@dascade/shared';
import { clamp, disc, drawText, drawTextC, easeInOut, easeOut, frame, hash, line, mix, rect, ring, sprite, textWidth } from './pixel.ts';

export interface AttractFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Scene-local time in seconds. */
  t: number;
  /** Hovered / focused / selected: brighter, "PRESS START" + title. */
  active: boolean;
  /** Draw INSERT COIN / PRESS START text (off for background art). */
  hud: boolean;
  /** Static frame: no blinking. */
  still: boolean;
  /** Marquee-style title for the HUD band. */
  title: string;
  accent: GameAccent;
  /** Pixels at the top covered by the HUD's title band (0 when there is none): keep scores/cards below it. */
  top: number;
}

export interface Scene {
  /** Draws a full frame (must paint every pixel). */
  draw(f: AttractFrame): void;
  /** Scene time used for the reduced-motion still frame. */
  still: number;
  /** Seconds this scene plays inside a cabinet playlist (usually one full cycle). */
  length: number;
  /** Short HUD label inside multi-game playlists (≤ 12 chars). */
  label: string;
}

export type Ctx = CanvasRenderingContext2D;

/** Time within a repeating cycle of length `c`. */
export const cyc = (t: number, c: number) => ((t % c) + c) % c;

/** Blink helper: true for the "on" part of a square wave (always on when still). */
export const blinkOn = (f: Pick<AttractFrame, 'still'>, t: number, hz = 5, duty = 0.55) => f.still || (t * hz) % 1 < duty;

/** Smoothstep in [0,1]. */
export const smooth = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a || 1), 0, 1);
  return x * x * (3 - 2 * x);
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
export const SUITS: Record<'s' | 'h' | 'd' | 'c', readonly string[]> = {
  s: ['..#..', '.###.', '#####', '..#..', '.###.'],
  h: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  d: ['..#..', '.###.', '#####', '.###.', '..#..'],
  c: ['..#..', '.###.', '#.#.#', '#####', '..#..'],
};
export const RED = '#e8364f';
export const INK = '#17121f';

export interface Card {
  r: string;
  s: 's' | 'h' | 'd' | 'c';
}

export function cardSize(W: number): { cw: number; ch: number } {
  return W >= 112 ? { cw: 9, ch: 13 } : { cw: 7, ch: 12 };
}

/** Draws a card centered at (cx, cy). `flip` in [0,1]: 0 = back, 1 = face (with a squash in between). */
export function drawCard(
  ctx: Ctx,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  card: Card,
  flip: number,
  back: string,
  glow?: string,
): void {
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

// ---------------------------------------------------------------------------
// Chips, sparkles, backgrounds
// ---------------------------------------------------------------------------
export const CHIP_COLORS = ['#ff5a5f', '#38bdf8', '#ffd23f', '#2de38f', '#c084fc'];

export function drawChip(ctx: Ctx, x: number, y: number, color: string): void {
  x = Math.round(x);
  y = Math.round(y);
  rect(ctx, x + 1, y, 3, 1, mix(color, '#ffffff', 0.35));
  rect(ctx, x, y + 1, 5, 1, color);
  rect(ctx, x + 1, y + 2, 3, 1, mix(color, '#000000', 0.35));
  rect(ctx, x + 2, y + 1, 1, 1, '#ffffff');
}

export function sparkle(ctx: Ctx, x: number, y: number, phase: number, color: string): void {
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

export function dottedBg(ctx: Ctx, W: number, H: number, base: string, dot: string, step = 6, drift = 0): void {
  rect(ctx, 0, 0, W, H, base);
  ctx.fillStyle = dot;
  const off = Math.floor(drift) % step;
  for (let y = 2; y < H; y += step)
    for (let x = ((y / step) & 1 ? 3 : 0) + off - step; x < W; x += step) if (x >= 0) ctx.fillRect(x, y, 1, 1);
}

export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
  }
}

/** Confetti burst: `n` pieces launched from (x, y) at `age` seconds, falling with gravity. */
export function confetti(
  ctx: Ctx,
  x: number,
  y: number,
  age: number,
  n: number,
  W: number,
  H: number,
  seed = 1,
  colors = ['#ffd23f', '#ff4fd8', '#22d3ee', '#2de38f', '#ff8a3d'],
): void {
  if (age < 0) return;
  for (let i = 0; i < n; i++) {
    const vx = (hash(i * 3.1 + seed) - 0.5) * W * 1.1;
    const vy = -H * (0.55 + hash(i * 5.3 + seed) * 0.6);
    const px = x + vx * age;
    const py = y + vy * age + H * 1.5 * age * age;
    if (py > H || px < -2 || px > W + 2) continue;
    const c = colors[i % colors.length]!;
    const flip = Math.floor(age * 10 + i) % 2;
    rect(ctx, px, py, flip ? 2 : 1, flip ? 1 : 2, c);
  }
}

/** A banner of pixel text centred at `cy` on a translucent band, auto-downscaling to fit. */
export function banner(ctx: Ctx, text: string, W: number, cy: number, color: string, shadow = '#000000', maxScale = 2): void {
  let scale = maxScale;
  while (scale > 1 && textWidth(text, scale) > W - 4) scale--;
  const h = 5 * scale;
  const y = Math.round(cy - h / 2);
  const w = Math.min(W, textWidth(text, scale) + 6 * scale);
  rect(ctx, Math.round((W - w) / 2), y - 2, w, h + 4, 'rgba(4,3,10,0.72)');
  drawTextC(ctx, text, W / 2, y, color, scale, shadow);
}

/** A little pixel star. */
export function star(ctx: Ctx, x: number, y: number, color: string): void {
  rect(ctx, x, y - 1, 1, 3, color);
  rect(ctx, x - 1, y, 3, 1, color);
}

/** Starfield backdrop that slowly drifts. */
export function starfield(ctx: Ctx, W: number, H: number, t: number, n: number, speed = 2, seed = 0): void {
  for (let i = 0; i < n; i++) {
    const x = (hash(i * 7.7 + seed) * W - t * speed * (0.4 + hash(i + seed) * 1.2)) % W;
    const y = hash(i * 3.3 + seed + 1) * H;
    const tw = hash(i * 1.9 + Math.floor(t * 3 + i)) > 0.85;
    rect(ctx, x < 0 ? x + W : x, y, 1, 1, tw ? '#ffffff' : hash(i) > 0.6 ? '#8f88d8' : '#4b4580');
  }
}

// ---------------------------------------------------------------------------
// Scratch ImageData per canvas (per-pixel scenes like wheels)
// ---------------------------------------------------------------------------
const imageCache = new WeakMap<Ctx, { w: number; h: number; img: ImageData; key: string }>();

export function scratchImage(ctx: Ctx, W: number, H: number, key: string): { img: ImageData; fresh: boolean } {
  const c = imageCache.get(ctx);
  if (c && c.w === W && c.h === H && c.key === key) return { img: c.img, fresh: false };
  const img = ctx.createImageData(W, H);
  imageCache.set(ctx, { w: W, h: H, img, key });
  return { img, fresh: true };
}

/**
 * A cached offscreen layer for static parts of a scene (turf, boards, skies).
 * Painted once per (key, size) and blitted every frame.
 */
const layers = new Map<string, HTMLCanvasElement>();
export function layer(ctx: Ctx, key: string, W: number, H: number, paint: (c: Ctx) => void): void {
  const id = `${key}:${W}x${H}`;
  let cv = layers.get(id);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    if (c) {
      c.imageSmoothingEnabled = false;
      paint(c);
    }
    if (layers.size > 64) layers.clear();
    layers.set(id, cv);
  }
  ctx.drawImage(cv, 0, 0);
}

/** "Channel change" static used between scenes of a playlist. `k` in [0,1] fades it out. */
export function drawStatic(ctx: Ctx, W: number, H: number, k: number, seed: number): void {
  if (k <= 0) return;
  const rows = Math.ceil(H * k);
  for (let i = 0; i < rows; i++) {
    const y = Math.floor(hash(i * 1.7 + seed) * H);
    const x = Math.floor(hash(i * 3.9 + seed * 2) * W * 0.6);
    const w = Math.ceil(W * (0.2 + hash(i + seed * 3) * 0.8));
    rect(ctx, x, y, w, 1, hash(i * 9.1 + seed) > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)');
  }
  // the collapsing bright line of an old tube changing channel
  const band = Math.round(H / 2 + (hash(seed) - 0.5) * H * 0.3);
  rect(ctx, 0, band, W, 1, `rgba(255,255,255,${(0.7 * k).toFixed(2)})`);
}

export { clamp, disc, drawText, drawTextC, easeInOut, easeOut, frame, hash, line, mix, rect, ring, sprite, textWidth };
