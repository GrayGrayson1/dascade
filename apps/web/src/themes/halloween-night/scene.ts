/**
 * Halloween Night environment renderer: a LOW-RESOLUTION canvas (one logical pixel = 2–4 CSS px,
 * upscaled with image-rendering: pixelated) over the CSS hall. It draws only what lives: a lavender
 * ground-fog bank in two depths, a few friendly ghosts drifting and bobbing, bats with glowing eyes
 * flapping across the top and autumn leaves tumbling down.
 *
 *  - `layout()` bakes the fog strips and pixel sprites once per resize / budget change.
 *  - `frame(t, moving)` only blits (≈20 drawImage calls); `moving: false` paints one still frame.
 *
 * Purely decorative; no game or app state is read.
 */
import type { HauntBudget } from './haunt.ts';

type Ctx = CanvasRenderingContext2D;

// prettier-ignore
const GHOST = [
  '.....aaaa.....',
  '...aaaaaaaa...',
  '..aaaaaaaaaa..',
  '.aaaaaaaaaaaa.',
  '.aaakkaakkaaa.',
  '.aaakkaakkaaa.',
  '.apaaakkaaapa.',
  'aaaaaakkaaaaaa',
  'aaaaaaaaaaaaaa',
  '.aaaaaaaaaaaa.',
  '.aaaaaaaaaaaa.',
  '.aaaaaaaaaaaa.',
  '.aa.aaaa.aaa..',
  '.a...aa...a...',
];
const GHOST_INK: Readonly<Record<string, string>> = { a: '#f4f0ff', k: '#2a0a3a', p: '#ffb3cf' };

// prettier-ignore
const BAT_UP = [
  'a.......a',
  'aa.a.a.aa',
  'aaaaaaaaa',
  '..aeaea..',
  '...aaa...',
];
// prettier-ignore
const BAT_DOWN = [
  '...a.a...',
  '..aaaaa..',
  '.aaeaeaa.',
  'aaa.a.aaa',
  'a.......a',
];
const BAT_INK: Readonly<Record<string, string>> = { a: '#2c1240', e: '#ffc93c' };

// prettier-ignore
const LEAF = [
  '..a..',
  '.aaa.',
  'aaaaa',
  '.aaa.',
  '..d..',
];
const LEAF_INKS: readonly Readonly<Record<string, string>>[] = [
  { a: '#e15c1f', d: '#6b2304' },
  { a: '#a8431a', d: '#4a1a08' },
  { a: '#ffc93c', d: '#8a5a00' },
];

interface Actor {
  x: number;
  y: number;
  speed: number;
  phase: number;
  dir: 1 | -1;
  kind: number;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function ctx2d(c: HTMLCanvasElement): Ctx {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function sprite(rows: readonly string[], ink: Readonly<Record<string, string>>): HTMLCanvasElement {
  const c = canvas(rows[0]!.length, rows.length);
  const g = ctx2d(c);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = ink[row[x]!];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** Tiny deterministic PRNG (mulberry32) — decoration only. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (v: number, m: number) => ((v % m) + m) % m;

/** A seamless fog strip twice the canvas width (drawn twice, offset, so it drifts forever). */
function buildFog(W: number, h: number, r: () => number, alpha: number): HTMLCanvasElement {
  const c = canvas(W * 2, h);
  const g = ctx2d(c);
  for (let i = 0; i < 18; i++) {
    const x = r() * W * 2;
    const y = h * (0.35 + r() * 0.5);
    const rad = W * (0.1 + r() * 0.18);
    for (const ox of [x - W * 2, x, x + W * 2]) {
      const grad = g.createRadialGradient(ox, y, 0, ox, y, rad);
      grad.addColorStop(0, `rgba(214, 196, 255, ${alpha})`);
      grad.addColorStop(1, 'rgba(214, 196, 255, 0)');
      g.fillStyle = grad;
      g.fillRect(ox - rad, y - rad, rad * 2, rad * 2);
    }
  }
  return c;
}

export class HauntScene {
  private readonly ctx: Ctx;
  private W = 0;
  private H = 0;
  private fog = 0.6;
  private fogFar: HTMLCanvasElement | null = null;
  private fogNear: HTMLCanvasElement | null = null;
  private ghost: HTMLCanvasElement | null = null;
  private bat: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  private leaves: HTMLCanvasElement[] = [];
  private ghosts: Actor[] = [];
  private bats: Actor[] = [];
  private falling: Actor[] = [];

  constructor(private readonly el: HTMLCanvasElement) {
    this.ctx = ctx2d(el);
  }

  /** Rebuilds the fog and the cast for a viewport size and haunt budget. */
  layout(cssW: number, cssH: number, budget: HauntBudget, floor: boolean): void {
    const px = cssW >= 1700 ? 4 : cssW >= 900 ? 3 : 2;
    const W = Math.max(1, Math.ceil(cssW / px));
    const H = Math.max(1, Math.ceil(cssH / px));
    this.W = W;
    this.H = H;
    this.el.width = W;
    this.el.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.fog = budget.fog;

    const r = prng(1031);
    this.fogFar = buildFog(W, Math.max(8, Math.round(H * 0.22)), r, 0.08);
    this.fogNear = buildFog(W, Math.max(8, Math.round(H * 0.3)), r, 0.11);
    this.ghost ??= sprite(GHOST, GHOST_INK);
    this.bat ??= [sprite(BAT_UP, BAT_INK), sprite(BAT_DOWN, BAT_INK)];
    if (!this.leaves.length) this.leaves = LEAF_INKS.map((ink) => sprite(LEAF, ink));

    const actor = (y: number, speed: number, kind = 0): Actor => ({
      x: r() * W,
      y,
      speed,
      phase: r() * 6.28,
      dir: r() < 0.5 ? -1 : 1,
      kind,
    });
    // Ghosts haunt the band above the cabinets (higher up off the floor, where panels sit).
    this.ghosts = Array.from({ length: budget.ghosts }, () => actor(H * (floor ? 0.16 + r() * 0.2 : 0.1 + r() * 0.3), 2 + r() * 2.5));
    this.bats = Array.from({ length: budget.bats }, () => actor(H * (0.05 + r() * 0.2), 9 + r() * 8));
    this.falling = Array.from({ length: budget.leaves }, (_, i) => ({
      ...actor(r() * H, 4 + r() * 4, i % LEAF_INKS.length),
      dir: 1 as const,
    }));
  }

  /** Paints one frame at `t` seconds; `moving: false` paints a fixed still moment. */
  frame(t: number, moving: boolean): void {
    const { ctx, W, H } = this;
    const ghost = this.ghost;
    const bat = this.bat;
    if (!this.fogFar || !this.fogNear || !ghost || !bat) return;
    const tt = moving ? t : 7;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    this.drawFog(this.fogFar, tt * 1.2, H * 0.5, this.fog * 0.8);

    for (const g of this.ghosts) {
      const x = wrap(g.x + g.dir * g.speed * tt, W + 24) - 12;
      const y = g.y + Math.sin(tt * 1.3 + g.phase) * 2;
      ctx.globalAlpha = 0.72 + 0.14 * (0.5 + 0.5 * Math.sin(tt * 0.8 + g.phase));
      ctx.drawImage(ghost, Math.round(x), Math.round(y));
    }

    ctx.globalAlpha = 1;
    for (const b of this.bats) {
      const x = wrap(b.x + b.dir * b.speed * tt, W + 20) - 10;
      const y = b.y + Math.sin(tt * 2 + b.phase) * 3;
      const flap = moving ? Math.floor(tt * 5 + b.phase) % 2 : 0;
      ctx.drawImage(bat[flap]!, Math.round(x), Math.round(y));
    }

    for (const l of this.falling) {
      const y = wrap(l.y + l.speed * tt, H + 10) - 5;
      const x = l.x + Math.sin(tt * 1.1 + l.phase) * 6;
      ctx.drawImage(this.leaves[l.kind]!, Math.round(x), Math.round(y));
    }

    this.drawFog(this.fogNear, tt * 2.4, H * 0.74, this.fog);
    ctx.globalAlpha = 1;
  }

  private drawFog(fog: HTMLCanvasElement, offset: number, y: number, alpha: number): void {
    const { ctx, W } = this;
    const o = wrap(offset, W * 2);
    ctx.globalAlpha = alpha;
    ctx.drawImage(fog, -o, Math.round(y));
    ctx.drawImage(fog, W * 2 - o, Math.round(y));
  }
}
