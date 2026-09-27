/**
 * Neon Noir environment renderer: a rain-soaked arcade district after midnight, painted into a
 * LOW-RESOLUTION canvas (one logical pixel = 2–4 CSS px, upscaled with image-rendering: pixelated),
 * which is what gives the architecture its pixel grain and keeps the cost tiny.
 *
 *  - `layout()` bakes two static layers once per resize/place change: BACK (sky, haze, far and mid
 *    skylines with lit windows, wet street with the mirrored skyline) and FRONT (the dark framing
 *    buildings with fire escapes and blade-sign housings).
 *  - `frame(t)` blits them and draws only what lives: flickering neon signage (+ its smeared
 *    reflection in the wet street), antenna beacons, drifting fog, rain and puddle ripples.
 *
 * Purely decorative; no game or app state is read. Budget: well under 1 ms per frame at 1080p.
 */
import { drawText, hash, textWidth } from '../../arcade/pixel.ts';

type Ctx = CanvasRenderingContext2D;

export interface NoirOptions {
  /** 0–1 rain density (0 = none). */
  rain: number;
  /** Fog drift + ripples + sign animation. */
  motion: boolean;
  /** Ripples in the wet street. */
  ripples: boolean;
}

interface Sign {
  text: string;
  vertical: boolean;
  x: number;
  y: number;
  color: string;
  glow: string;
  /** Flicker personality seed. */
  seed: number;
  /** Letters light one by one in a loop (animated signage). */
  chase: boolean;
  w: number;
  h: number;
}

interface Drop {
  x: number;
  y: number;
  z: number;
  speed: number;
  len: number;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
  life: number;
  r: number;
}

const INK = '#020307';
const TEAL = '#46d9ec';
const ROSE = '#ff4d8d';
const AMBER = '#f4c25b';
const WIND = 0.18;

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

/** Vertical pixel text (one glyph per row). */
function drawVertical(ctx: Ctx, text: string, x: number, y: number, color: string, lit: (i: number) => boolean): void {
  let cy = y;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (lit(i)) drawText(ctx, ch, x + Math.round((3 - textWidth(ch)) / 2), cy, color);
    cy += 7;
  }
}

export class NoirScene {
  private readonly ctx: Ctx;
  private back: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;
  private fog: HTMLCanvasElement | null = null;
  private glowTeal: HTMLCanvasElement | null = null;
  private glowRose: HTMLCanvasElement | null = null;
  private glowAmber: HTMLCanvasElement | null = null;
  private W = 0;
  private H = 0;
  private hz = 0;
  private signs: Sign[] = [];
  private beacons: Array<{ x: number; y: number; p: number }> = [];
  private drops: Drop[] = [];
  private ripples: Ripple[] = [];
  private lastT = 0;
  private nextRipple = 0;
  private seed = 1;
  /** Out-of-focus mode (away from the floor): the city is baked blurred, signs become bokeh. */
  private soft = false;

  constructor(private readonly el: HTMLCanvasElement) {
    this.ctx = ctx2d(el);
  }

  private rnd(): number {
    this.seed += 1;
    return hash(this.seed * 0.731);
  }

  /**
   * Rebuilds the static layers. `horizon` is a 0–1 fraction of the height. `soft` renders the city
   * out of focus (a one-off blur while baking, so it costs nothing per frame) — used behind menus
   * and games so architecture never competes with text.
   */
  layout(cssW: number, cssH: number, horizon: number, soft = false): { W: number; H: number; px: number } {
    this.soft = soft;
    const px = cssW >= 1700 ? 4 : cssW >= 900 ? 3 : 2;
    const W = Math.ceil(cssW / px);
    const H = Math.ceil(cssH / px);
    this.W = W;
    this.H = H;
    this.hz = Math.round(H * Math.min(0.82, Math.max(0.34, horizon)));
    this.el.width = W;
    this.el.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.seed = 7;
    this.signs = [];
    this.beacons = [];
    this.back = this.defocus(this.buildBack());
    this.front = this.defocus(this.buildFront());
    this.fog = this.buildFog();
    this.glowTeal = this.buildGlow(TEAL);
    this.glowRose = this.buildGlow(ROSE);
    this.glowAmber = this.buildGlow(AMBER);
    this.seedRain();
    this.ripples = [];
    return { W, H, px };
  }

  // -------------------------------------------------------------------------- static layers
  private defocus(src: HTMLCanvasElement): HTMLCanvasElement {
    if (!this.soft) return src;
    const c = canvas(src.width, src.height);
    const g = ctx2d(c);
    if (!('filter' in g)) return src;
    g.filter = 'blur(2.5px)';
    g.drawImage(src, 0, 0);
    return c;
  }

  private buildBack(): HTMLCanvasElement {
    const { W, H, hz } = this;
    const c = canvas(W, H);
    const g = ctx2d(c);

    // Sky: ink at the top, a sodium-teal city haze low on the horizon.
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#010207');
    sky.addColorStop(0.5, '#050811');
    sky.addColorStop(0.86, '#0c1422');
    sky.addColorStop(1, '#16223a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, hz);
    const haze = g.createRadialGradient(W * 0.5, hz, 0, W * 0.5, hz, W * 0.65);
    haze.addColorStop(0, 'rgba(70, 217, 236, 0.10)');
    haze.addColorStop(0.5, 'rgba(70, 150, 200, 0.04)');
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, W, hz);
    const rose = g.createRadialGradient(W * 0.18, hz, 0, W * 0.18, hz, W * 0.35);
    rose.addColorStop(0, 'rgba(255, 77, 141, 0.07)');
    rose.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = rose;
    g.fillRect(0, 0, W, hz);

    // Low cloud deck catching the city light.
    for (let i = 0; i < 7; i++) {
      const y = Math.round(hz * (0.06 + this.rnd() * 0.32));
      const x = Math.round(this.rnd() * W);
      const w = Math.round(W * (0.25 + this.rnd() * 0.4));
      g.fillStyle = `rgba(120, 150, 190, ${(0.018 + this.rnd() * 0.02).toFixed(3)})`;
      g.fillRect(x - w / 2, y, w, 1 + Math.round(this.rnd() * 2));
    }

    // Far skyline: hazy blue silhouettes, sparse dim windows, antenna beacons.
    this.skyline(g, {
      base: hz,
      minH: 0.16,
      maxH: 0.4,
      minW: 6,
      maxW: 16,
      body: '#0b111c',
      rim: '#101a2a',
      windows: 0.06,
      windowColors: ['#1d2c44', '#22344f'],
      beacons: true,
    });
    // Atmospheric fog between the layers.
    const fog = g.createLinearGradient(0, hz * 0.55, 0, hz);
    fog.addColorStop(0, 'rgba(110, 140, 175, 0)');
    fog.addColorStop(1, 'rgba(110, 140, 175, 0.12)');
    g.fillStyle = fog;
    g.fillRect(0, hz * 0.55, W, hz * 0.45);
    // Mid skyline: darker, taller, warmer windows.
    this.skyline(g, {
      base: hz,
      minH: 0.24,
      maxH: 0.62,
      minW: 10,
      maxW: 26,
      body: '#05080f',
      rim: '#0f1726',
      windows: 0.16,
      windowColors: ['rgba(214, 160, 86, 0.55)', 'rgba(95, 184, 201, 0.45)', '#141d2b', '#141d2b', 'rgba(230, 236, 245, 0.28)'],
      beacons: false,
    });
    // A distant horizontal sign on the mid skyline.
    const farSign = 'DASCADE';
    const fw = textWidth(farSign);
    const fx = Math.round(W * 0.31 - fw / 2);
    const fy = Math.round(hz * 0.3);
    g.fillStyle = '#04060b';
    g.fillRect(fx - 3, fy - 3, fw + 6, 11);
    if (W >= 300) this.signs.push({ text: farSign, vertical: false, x: fx, y: fy, color: '#b8904a', glow: 'amber', seed: 3, chase: false, w: fw, h: 5 });

    // Street: wet asphalt with the skyline mirrored into it.
    g.fillStyle = INK;
    g.fillRect(0, hz, W, H - hz);
    const depth = H - hz;
    for (let r = 0; r < depth; r++) {
      // Sample the sky row mirrored about the horizon, stretched a little, with a wet wobble.
      const src = hz - 1 - Math.floor(r * 0.8);
      if (src < 0) break;
      const wob = Math.round((hash(r * 3.17) - 0.5) * (1 + r * 0.06));
      g.globalAlpha = 0.42 * (1 - r / depth) + 0.06;
      g.drawImage(c, 0, src, W, 1, wob, hz + r, W, 1);
    }
    g.globalAlpha = 1;
    const wet = g.createLinearGradient(0, hz, 0, H);
    wet.addColorStop(0, 'rgba(2, 3, 7, 0.25)');
    wet.addColorStop(0.35, 'rgba(2, 3, 7, 0.55)');
    wet.addColorStop(1, 'rgba(2, 3, 7, 0.9)');
    g.fillStyle = wet;
    g.fillRect(0, hz, W, depth);
    // Curb line + a faint kerb highlight.
    g.fillStyle = '#1b2638';
    g.fillRect(0, hz, W, 1);
    g.fillStyle = 'rgba(160, 190, 220, 0.06)';
    g.fillRect(0, hz + 1, W, 1);
    // Sidewalk slabs in perspective (deep environmental perspective, very faint).
    const vx = W / 2;
    const vy = hz - depth * 0.9;
    g.strokeStyle = 'rgba(150, 180, 215, 0.05)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = -14; i <= 14; i++) {
      const bx = vx + i * W * 0.09;
      const t = (hz - vy) / (H - vy);
      g.moveTo(vx + (bx - vx) * t, hz + 1);
      g.lineTo(bx, H);
    }
    for (let k = 1; k < 9; k++) {
      const y = Math.round(hz + depth * ((k / 9) * (k / 9)));
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
    }
    g.stroke();
    // Wet sheen streaks.
    for (let i = 0; i < Math.round(W * depth * 0.004); i++) {
      const y = hz + 2 + Math.floor(this.rnd() * (depth - 2));
      const w = 4 + Math.round(this.rnd() * 22);
      g.fillStyle = this.rnd() < 0.5 ? 'rgba(150, 190, 225, 0.035)' : 'rgba(0, 0, 0, 0.18)';
      g.fillRect(Math.round(this.rnd() * W), y, w, 1);
    }
    return c;
  }

  private skyline(
    g: Ctx,
    o: {
      base: number;
      minH: number;
      maxH: number;
      minW: number;
      maxW: number;
      body: string;
      rim: string;
      windows: number;
      windowColors: string[];
      beacons: boolean;
    },
  ): void {
    const { W } = this;
    let x = -Math.round(this.rnd() * o.maxW);
    while (x < W) {
      const w = Math.round(o.minW + this.rnd() * (o.maxW - o.minW));
      const h = Math.round(o.base * (o.minH + this.rnd() * (o.maxH - o.minH)));
      const top = o.base - h;
      g.fillStyle = o.body;
      g.fillRect(x, top, w, h);
      // Setback crown on some towers.
      if (this.rnd() < 0.35) {
        const cw = Math.max(3, Math.round(w * 0.5));
        const ch = Math.round(2 + this.rnd() * 5);
        g.fillRect(x + Math.round((w - cw) / 2), top - ch, cw, ch);
        if (o.beacons && this.rnd() < 0.7) {
          const ax = x + Math.round(w / 2);
          const ah = Math.round(3 + this.rnd() * 7);
          g.fillRect(ax, top - ch - ah, 1, ah);
          this.beacons.push({ x: ax, y: top - ch - ah - 1, p: this.rnd() * 3 });
        }
      }
      // Neon rim light down one edge.
      g.fillStyle = o.rim;
      g.fillRect(x, top, 1, h);
      // Windows on a 4×3 grid.
      for (let wy = top + 2; wy < o.base - 2; wy += 3) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3) {
          if (this.rnd() < o.windows) {
            g.fillStyle = o.windowColors[Math.floor(this.rnd() * o.windowColors.length)]!;
            g.fillRect(wx, wy, 2, 1);
          }
        }
      }
      x += w + (this.rnd() < 0.3 ? Math.round(this.rnd() * 3) : 0);
    }
  }

  private buildFront(): HTMLCanvasElement {
    const { W, H, hz } = this;
    const c = canvas(W, H);
    const g = ctx2d(c);
    const side = Math.max(16, Math.round(W * 0.11));
    const narrow = W < 260;
    // Left and right framing buildings reach off the top of the frame.
    for (const left of [true, false]) {
      const bw = side + Math.round(this.rnd() * side * 0.3);
      const x0 = left ? 0 : W - bw;
      const top = Math.round(hz * (narrow ? 0.18 : 0.04));
      g.fillStyle = '#020409';
      g.fillRect(x0, top, bw, hz - top + 2);
      // Cornice + rim light facing the street.
      g.fillStyle = '#0b1220';
      g.fillRect(x0, top, bw, 1);
      g.fillStyle = left ? 'rgba(70, 217, 236, 0.22)' : 'rgba(255, 77, 141, 0.22)';
      g.fillRect(left ? x0 + bw - 1 : x0, top, 1, hz - top);
      // Windows (a few lit, curtains drawn).
      for (let wy = top + 4; wy < hz - 10; wy += 7) {
        for (let wx = x0 + 3; wx < x0 + bw - 5; wx += 6) {
          const r = this.rnd();
          g.fillStyle = r < 0.12 ? 'rgba(214, 160, 86, 0.5)' : r < 0.2 ? 'rgba(95, 184, 201, 0.35)' : '#070b13';
          g.fillRect(wx, wy, 3, 4);
        }
      }
      // Fire escape: landings and a zig-zag stair.
      const fx = left ? x0 + Math.round(bw * 0.25) : x0 + Math.round(bw * 0.2);
      const fw = Math.round(bw * 0.5);
      g.fillStyle = '#0d1422';
      for (let fy = top + 12; fy < hz - 12; fy += 14) {
        g.fillRect(fx, fy, fw, 1);
        for (let k = 0; k < 12; k++) g.fillRect(fx + Math.round((k / 12) * fw), fy + (left ? 13 - k : k + 1), 1, 1);
      }
      // Blade sign housing (lit letters are drawn per frame).
      const text = left ? 'ARCADE' : narrow ? 'BAR' : 'HOTEL';
      const sh = text.length * 7 + 3;
      const sx = left ? x0 + bw - 2 : x0 - 5;
      const sy = Math.round(top + (hz - top) * 0.22);
      g.fillStyle = '#05080f';
      g.fillRect(sx - 1, sy - 3, 7, sh + 2);
      g.fillStyle = '#121b2b';
      g.fillRect(left ? sx - 3 : sx + 6, sy + 2, 2, 1);
      g.fillRect(left ? sx - 3 : sx + 6, sy + sh - 6, 2, 1);
      this.signs.push({
        text,
        vertical: true,
        x: sx,
        y: sy,
        color: left ? TEAL : ROSE,
        glow: left ? 'teal' : 'rose',
        seed: left ? 11 : 23,
        chase: left,
        w: 5,
        h: sh - 3,
      });
      // A small horizontal "OPEN" / "24H" box sign low on the building.
      const small = left ? '24H' : 'OPEN';
      const tw = textWidth(small);
      const bx = left ? x0 + Math.round((bw - tw) / 2) : x0 + Math.round((bw - tw) / 2);
      const by = hz - 12;
      g.fillStyle = '#05080f';
      g.fillRect(bx - 2, by - 2, tw + 4, 9);
      this.signs.push({ text: small, vertical: false, x: bx, y: by, color: left ? ROSE : TEAL, glow: left ? 'rose' : 'teal', seed: left ? 5 : 17, chase: false, w: tw, h: 5 });
    }
    // Street lamps: a pole on each side of the lineup, sodium pools on the pavement.
    for (const lx of [Math.round(W * 0.26), Math.round(W * 0.74)]) {
      const ph = Math.round(hz * 0.36);
      g.fillStyle = '#0a101b';
      g.fillRect(lx, hz - ph, 1, ph + 2);
      g.fillRect(lx - 3, hz - ph, 4, 1);
      g.fillStyle = 'rgba(244, 194, 91, 0.85)';
      g.fillRect(lx - 3, hz - ph + 1, 2, 1);
      const pool = g.createRadialGradient(lx - 2, hz + 2, 0, lx - 2, hz + 2, W * 0.07);
      pool.addColorStop(0, 'rgba(244, 194, 91, 0.10)');
      pool.addColorStop(1, 'rgba(244, 194, 91, 0)');
      g.fillStyle = pool;
      g.fillRect(lx - W * 0.08, hz - ph, W * 0.16, ph + H * 0.2);
    }
    // Cinematic vignette baked in.
    const v = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    return c;
  }

  private buildFog(): HTMLCanvasElement {
    const { W, hz } = this;
    const fh = Math.max(8, Math.round(hz * 0.5));
    const c = canvas(W * 2, fh);
    const g = ctx2d(c);
    for (let i = 0; i < 16; i++) {
      const x = this.rnd() * W * 2;
      const y = fh * (0.45 + this.rnd() * 0.45);
      const r = W * (0.12 + this.rnd() * 0.2);
      for (const ox of [x - W * 2, x, x + W * 2]) {
        const grad = g.createRadialGradient(ox, y, 0, ox, y, r);
        grad.addColorStop(0, 'rgba(140, 165, 195, 0.07)');
        grad.addColorStop(1, 'rgba(140, 165, 195, 0)');
        g.fillStyle = grad;
        g.fillRect(ox - r, y - r, r * 2, r * 2);
      }
    }
    return c;
  }

  private buildGlow(color: string): HTMLCanvasElement {
    const c = canvas(32, 32);
    const g = ctx2d(c);
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.globalAlpha = 0.5;
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  private seedRain(): void {
    const n = Math.round(Math.min(340, (this.W * this.H) / 480));
    this.drops = [];
    for (let i = 0; i < n; i++) this.drops.push(this.newDrop(true));
  }

  private newDrop(anywhere: boolean): Drop {
    const z = Math.random();
    return {
      x: Math.random() * (this.W + 40) - 20,
      y: anywhere ? Math.random() * this.H : -Math.random() * 30,
      z,
      speed: 150 + z * 190,
      len: 3 + z * 7,
    };
  }

  // -------------------------------------------------------------------------- per frame
  private signOn(s: Sign, t: number): number {
    // Mostly steady; every few seconds a short, irregular flicker (deterministic per sign).
    const period = 5 + (s.seed % 7);
    const k = Math.floor(t / period);
    const phase = t - k * period;
    if (hash(k * 13.1 + s.seed) < 0.55 && phase < 0.5) {
      const q = Math.floor(phase * 22);
      return hash(q * 3.3 + s.seed + k) < 0.45 ? 0.15 : 1;
    }
    return 1;
  }

  frame(t: number, o: NoirOptions): void {
    const { ctx, W, H, hz } = this;
    if (!this.back || !this.front) return;
    const dt = this.lastT ? Math.min(0.1, Math.max(0, t - this.lastT)) : 0;
    this.lastT = t;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.back, 0, 0);

    // Beacons.
    for (const b of this.beacons) {
      const on = !o.motion || ((t + b.p) % 2.4) < 0.5;
      if (on) {
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(b.x, b.y, 1, 1);
      }
    }

    // Drifting fog bank on the horizon.
    if (this.fog) {
      const fh = this.fog.height;
      const off = o.motion ? (t * 1.6) % (W * 2) : 0;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.fog, -off, hz - fh * 0.8);
      ctx.drawImage(this.fog, W * 2 - off, hz - fh * 0.8);
      ctx.globalAlpha = 1;
    }

    ctx.drawImage(this.front, 0, 0);

    // Signage + reflections.
    for (const s of this.signs) {
      const on = o.motion ? this.signOn(s, t) : 1;
      // Chasing signs relight letter by letter for ~1.5 s every 11 s, then hold steady.
      const cyc = t % 11;
      const chaseN = s.chase && o.motion && cyc < 1.6 ? Math.floor(cyc * 5) : s.text.length;
      const lit = (i: number) => i < chaseN;
      const glow = s.glow === 'teal' ? this.glowTeal : s.glow === 'rose' ? this.glowRose : this.glowAmber;
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      if (glow && on > 0.5) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * on;
        const gw = (s.vertical ? 26 : s.w + 26) * 1.1;
        const gh = s.vertical ? s.h + 26 : 26;
        ctx.drawImage(glow, cx - gw / 2, cy - gh / 2, gw, gh);
        // Smeared reflection in the wet street, mirrored about the horizon.
        const ry = hz + (hz - cy) * 0.8;
        if (ry < H) {
          ctx.globalAlpha = 0.35 * on;
          ctx.drawImage(glow, cx - gw * 0.3, ry - gh * 0.4, gw * 0.6, Math.min(H - ry + gh, gh * 1.6));
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      if (this.soft) continue; // out of focus: the glow and its reflection are the sign
      const color = on > 0.5 ? s.color : '#1a2332';
      if (s.vertical) drawVertical(ctx, s.text, s.x, s.y, color, lit);
      else drawText(ctx, s.text, s.x, s.y, color);
      // Letter streaks in the puddle.
      if (on > 0.5) {
        const ry = Math.round(hz + (hz - s.y - s.h) * 0.8);
        if (ry > hz && ry < H) {
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = s.color;
          for (let i = 0; i < (s.vertical ? 1 : s.text.length); i++) {
            const bx = s.vertical ? s.x + 1 : s.x + i * 4;
            const len = Math.round(Math.min(H - ry, s.h * 0.8 + 4));
            for (let k = 0; k < len; k += 2) ctx.fillRect(bx + ((k >> 1) & 1), ry + k, s.vertical ? 3 : 2, 1);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // Puddle ripples.
    if (o.ripples && o.motion) {
      if (t > this.nextRipple) {
        const y = hz + 3 + Math.random() * (H - hz - 3);
        this.ripples.push({ x: Math.random() * W, y, born: t, life: 0.7 + Math.random() * 0.5, r: 2 + ((y - hz) / Math.max(1, H - hz)) * 7 });
        this.nextRipple = t + 0.06 + Math.random() * 0.12;
        if (this.ripples.length > 18) this.ripples.shift();
      }
      ctx.strokeStyle = 'rgba(170, 205, 235, 0.5)';
      ctx.lineWidth = 1;
      for (const r of this.ripples) {
        const a = (t - r.born) / r.life;
        if (a < 0 || a >= 1) continue;
        ctx.globalAlpha = (1 - a) * 0.5;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, 0.5 + r.r * a, 0.3 + r.r * a * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Rain: two depth bands, one stroke each.
    if (o.rain > 0) {
      const n = Math.round(this.drops.length * o.rain);
      for (let band = 0; band < 2; band++) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = this.drops[i]!;
          if ((d.z > 0.62 ? 1 : 0) !== band) continue;
          if (o.motion) {
            d.y += d.speed * dt;
            d.x += d.speed * dt * WIND;
            if (d.y > H + 10 || d.x > W + 20) Object.assign(d, this.newDrop(false));
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * WIND, d.y - d.len);
        }
        ctx.strokeStyle = band ? 'rgba(190, 215, 240, 0.26)' : 'rgba(150, 180, 215, 0.15)';
        ctx.lineWidth = band ? 1 : 0.75;
        ctx.stroke();
      }
    }
  }
}
