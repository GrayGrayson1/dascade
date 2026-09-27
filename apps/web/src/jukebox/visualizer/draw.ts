/**
 * Jukebox visualizer styles — one pure draw function per ThemeEffects.visualizer value.
 * Each draws a full frame into a 2D context sized w×h device pixels. No allocation per frame beyond
 * what the canvas API itself does; gradients are cached per (style, size, palette) by the caller.
 *
 * Data is pre-digested by the component (see Visualizer.tsx):
 *   bands  0–1 per log-spaced frequency band (smoothed), peaks = slowly-falling peak hold
 *   wave   −1…1 time-domain samples, level = 0–1 loudness, t = seconds (animation clock; frozen when idle)
 */
import type { ThemeEffects } from '@dascade/ui';

export type VisualizerStyle = ThemeEffects['visualizer'];

export const VISUALIZER_STYLES: readonly VisualizerStyle[] = [
  'neon-bars',
  'pixel-bars',
  'lcd',
  'spectrum',
  'bubbles',
  'reels',
  'hologram',
  'oscilloscope',
  'blocks',
  'vu-meter',
  'glass-wave',
];

export interface VisPalette {
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  line: string;
  surface: string;
  background: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  gridAlpha: number;
  /** 0–2 glow multiplier (already scaled by fx). */
  glow: number;
}

export interface VisFrame {
  bands: Float32Array;
  peaks: Float32Array;
  wave: Float32Array;
  level: number;
  /** Left/right-ish levels (low vs high half of the spectrum) for the VU pair. */
  levelL: number;
  levelR: number;
  t: number;
  playing: boolean;
  /** Reduced motion: no continuous rotation/drift, only data-driven height changes. */
  still: boolean;
  dpr: number;
}

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color)?.[1];
  if (rgba) {
    const [r = '0', g = '0', b = '0', a0 = '1'] = rgba.split(/\s*,\s*/);
    return `rgba(${r}, ${g}, ${b}, ${a * (parseFloat(a0) || 1)})`;
  }
  return color;
}

function glowOn(ctx: Ctx, color: string, blur: number, p: VisPalette): void {
  if (p.glow <= 0) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * p.glow;
}

function glowOff(ctx: Ctx): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

function clear(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Resample `bands` to `n` columns (linear). */
function sample(bands: Float32Array, i: number, n: number): number {
  if (bands.length === 0) return 0;
  const f = (i / Math.max(1, n - 1)) * (bands.length - 1);
  const a = Math.floor(f);
  const b = Math.min(bands.length - 1, a + 1);
  const k = f - a;
  return (bands[a] ?? 0) * (1 - k) + (bands[b] ?? 0) * k;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function neonBars(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const n = Math.max(12, Math.min(40, Math.floor(w / (10 * f.dpr))));
  const gap = Math.max(2, Math.round(3 * f.dpr));
  const bw = (w - gap * (n - 1)) / n;
  const base = h * 0.74;
  const grad = ctx.createLinearGradient(0, base, 0, 0);
  grad.addColorStop(0, p.accent);
  grad.addColorStop(1, p.accent2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.04, sample(f.bands, i, n));
    const bh = v * base * 0.96;
    const x = i * (bw + gap);
    ctx.fillStyle = grad;
    glowOn(ctx, p.accent, 12 * f.dpr, p);
    roundRect(ctx, x, base - bh, bw, bh, bw * 0.3);
    ctx.fill();
    glowOff(ctx);
    // Reflection on the glass floor.
    ctx.fillStyle = withAlpha(p.accent, 0.16);
    ctx.fillRect(x, base + gap, bw, Math.min(h - base - gap, bh * 0.35));
    // Peak cap
    const pk = Math.max(v, sample(f.peaks, i, n));
    ctx.fillStyle = p.text;
    ctx.fillRect(x, base - pk * base * 0.96 - 2 * f.dpr, bw, Math.max(1, 1.5 * f.dpr));
  }
  ctx.fillStyle = withAlpha(p.line, 0.35);
  ctx.fillRect(0, base + 1, w, Math.max(1, f.dpr));
}

function pixelBars(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const cell = Math.max(4, Math.round(6 * f.dpr));
  const gap = Math.max(1, Math.round(2 * f.dpr));
  const cols = Math.max(8, Math.floor((w + gap) / (cell + gap)));
  const rows = Math.max(4, Math.floor((h + gap) / (cell + gap)));
  const ox = Math.floor((w - (cols * (cell + gap) - gap)) / 2);
  const oy = h - rows * (cell + gap) + gap;
  for (let c = 0; c < cols; c++) {
    const v = sample(f.bands, c, cols);
    const lit = Math.round(v * rows);
    const peak = Math.min(rows - 1, Math.round(Math.max(v, sample(f.peaks, c, cols)) * rows));
    for (let r = 0; r < rows; r++) {
      const y = oy + (rows - 1 - r) * (cell + gap);
      const x = ox + c * (cell + gap);
      const zone = r / rows;
      const col = zone > 0.8 ? p.danger : zone > 0.55 ? p.warning : p.accent;
      if (r < lit) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, cell, cell);
      } else if (r === peak && peak > 0) {
        ctx.fillStyle = p.text;
        ctx.fillRect(x, y, cell, cell);
      } else {
        ctx.fillStyle = withAlpha(col, 0.09);
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

function lcd(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  // Monochrome segment LCD: unlit segments visible as faint ghosts.
  clear(ctx, w, h);
  ctx.fillStyle = withAlpha(p.success, 0.08);
  ctx.fillRect(0, 0, w, h);
  const cols = Math.max(10, Math.min(24, Math.floor(w / (12 * f.dpr))));
  const rows = 8;
  const pad = 4 * f.dpr;
  const cw = (w - pad * 2) / cols;
  const rh = (h - pad * 2) / rows;
  for (let c = 0; c < cols; c++) {
    const lit = Math.round(sample(f.bands, c, cols) * rows);
    for (let r = 0; r < rows; r++) {
      const on = r < lit;
      ctx.fillStyle = on ? p.success : withAlpha(p.success, 0.1);
      ctx.fillRect(pad + c * cw + cw * 0.12, h - pad - (r + 1) * rh + rh * 0.18, cw * 0.76, rh * 0.64);
    }
  }
}

function spectrum(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  // Grid
  ctx.strokeStyle = withAlpha(p.line, Math.max(0.06, p.gridAlpha * 2));
  ctx.lineWidth = Math.max(1, f.dpr * 0.5);
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  for (let i = 1; i < 8; i++) {
    const x = (w * i) / 8;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  const n = Math.max(24, Math.floor(w / (4 * f.dpr)));
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, withAlpha(p.info, 0.05));
  grad.addColorStop(0.5, withAlpha(p.success, 0.5));
  grad.addColorStop(1, withAlpha(p.warning, 0.85));
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.02, sample(f.bands, i, n));
    ctx.lineTo((i / (n - 1)) * w, h - v * h * 0.94);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  // Peak-hold line
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.02, sample(f.peaks, i, n));
    const x = (i / (n - 1)) * w;
    const y = h - v * h * 0.94;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = Math.max(1, 1.5 * f.dpr);
  glowOn(ctx, p.accent, 8 * f.dpr, p);
  ctx.stroke();
  glowOff(ctx);
}

function bubbles(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const tubes = w > 260 * f.dpr ? 4 : 3;
  const tw = w / tubes;
  const colors = [p.accent, p.warning, p.accent2, p.success];
  for (let k = 0; k < tubes; k++) {
    const x0 = k * tw + tw * 0.2;
    const x1 = (k + 1) * tw - tw * 0.2;
    const cw = x1 - x0;
    const col = colors[k % colors.length]!;
    // Tube glass
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, withAlpha(col, 0.1));
    g.addColorStop(0.5, withAlpha(col, 0.32 + 0.4 * sample(f.bands, k, tubes)));
    g.addColorStop(1, withAlpha(col, 0.1));
    ctx.fillStyle = g;
    roundRect(ctx, x0, 2 * f.dpr, cw, h - 4 * f.dpr, cw / 2);
    ctx.fill();
    // Bubbles: deterministic lanes; rise speed follows the band level.
    const lvl = sample(f.bands, k * 2 + 1, tubes * 2);
    const count = 5;
    for (let b = 0; b < count; b++) {
      const seed = (k * 7 + b * 13) % 17;
      const speed = 0.12 + lvl * 0.9;
      const phase = f.still ? seed / 17 : (seed / 17 + f.t * speed * 0.5) % 1;
      const y = h - 6 * f.dpr - phase * (h - 12 * f.dpr);
      const r = (1.4 + (seed % 4) * 0.7 + lvl * 2.2) * f.dpr;
      const x = x0 + cw / 2 + ((seed % 5) - 2) * cw * 0.1;
      ctx.beginPath();
      ctx.arc(x, y, Math.min(r, cw * 0.36), 0, TAU);
      ctx.fillStyle = withAlpha(p.text, 0.55 + lvl * 0.4);
      ctx.fill();
    }
  }
}

function reels(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const r = Math.min(h * 0.4, w * 0.16);
  const cy = h * 0.48;
  const cxs = [w * 0.3, w * 0.7];
  const angle = f.still ? 0.4 : f.t * 2.2;
  // Tape path
  ctx.strokeStyle = withAlpha(p.muted, 0.7);
  ctx.lineWidth = Math.max(1, 1.5 * f.dpr);
  ctx.beginPath();
  ctx.moveTo(cxs[0]!, cy + r);
  ctx.lineTo(w * 0.5, h - 3 * f.dpr);
  ctx.lineTo(cxs[1]!, cy + r);
  ctx.stroke();
  cxs.forEach((cx, i) => {
    // Tape pack (left side fuller early on; it's decorative, so use the level to breathe a little)
    const pack = r * (i === 0 ? 0.95 : 0.7) + r * 0.04 * f.level;
    ctx.beginPath();
    ctx.arc(cx, cy, pack, 0, TAU);
    ctx.fillStyle = withAlpha(p.accent2, 0.35);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, TAU);
    ctx.fillStyle = p.surface;
    ctx.fill();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = Math.max(1, 2 * f.dpr);
    ctx.stroke();
    // Hub spokes
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(i === 0 ? angle : angle * 1.3);
    ctx.fillStyle = p.text;
    for (let s = 0; s < 3; s++) {
      ctx.rotate(TAU / 3);
      ctx.fillRect(-r * 0.06, r * 0.12, r * 0.12, r * 0.24);
    }
    ctx.restore();
  });
  // Level meter strip
  const lw = w * 0.3;
  const x = (w - lw) / 2;
  ctx.fillStyle = withAlpha(p.line, 0.25);
  ctx.fillRect(x, 3 * f.dpr, lw, 3 * f.dpr);
  ctx.fillStyle = f.level > 0.8 ? p.danger : p.accent;
  ctx.fillRect(x, 3 * f.dpr, lw * f.level, 3 * f.dpr);
}

function hologram(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const horizon = h * 0.7;
  // Perspective floor grid
  ctx.strokeStyle = withAlpha(p.info, 0.18);
  ctx.lineWidth = Math.max(1, f.dpr * 0.6);
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) {
    ctx.moveTo(w / 2 + i * w * 0.03, horizon);
    ctx.lineTo(w / 2 + i * w * 0.16, h);
  }
  for (let j = 1; j <= 3; j++) {
    const y = horizon + ((h - horizon) * j * j) / 9;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  const n = Math.max(12, Math.min(28, Math.floor(w / (12 * f.dpr))));
  const bw = (w * 0.86) / n;
  const x0 = w * 0.07;
  const flicker = f.still ? 1 : 0.85 + 0.15 * Math.abs(Math.sin(f.t * 9.1));
  const g = ctx.createLinearGradient(0, horizon, 0, 0);
  g.addColorStop(0, withAlpha(p.info, 0.75 * flicker));
  g.addColorStop(0.6, withAlpha(p.accent, 0.35 * flicker));
  g.addColorStop(1, withAlpha(p.accent, 0.04));
  ctx.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.05, sample(f.bands, i, n));
    const bh = v * horizon * 0.92;
    ctx.fillRect(x0 + i * bw + bw * 0.15, horizon - bh, bw * 0.7, bh);
  }
  // Scanline gaps
  ctx.fillStyle = withAlpha(p.background, 0.35);
  const pitch = Math.max(2, Math.round(3 * f.dpr));
  const scroll = f.still ? 0 : Math.floor(f.t * 20) % pitch;
  for (let y = scroll; y < horizon; y += pitch) ctx.fillRect(0, y, w, Math.max(1, Math.round(f.dpr)));
}

function oscilloscope(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  ctx.strokeStyle = withAlpha(p.success, 0.14);
  ctx.lineWidth = Math.max(1, f.dpr * 0.5);
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    const x = (w * i) / 10;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  const n = f.wave.length;
  ctx.beginPath();
  for (let i = 0; i < Math.max(2, n); i++) {
    const v = n ? (f.wave[i] ?? 0) : 0;
    const x = (i / Math.max(1, n - 1)) * w;
    const y = h / 2 - v * h * 0.42;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = p.success;
  ctx.lineWidth = Math.max(1.2, 2 * f.dpr);
  glowOn(ctx, p.success, 10 * f.dpr, p);
  ctx.stroke();
  glowOff(ctx);
}

function blocks(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const n = Math.max(6, Math.min(14, Math.floor(w / (26 * f.dpr))));
  const gap = 4 * f.dpr;
  const bw = (w - gap * (n + 1)) / n;
  const rows = Math.max(3, Math.floor(h / (bw * 0.6 + gap)));
  const bh = (h - gap * (rows + 1)) / rows;
  const colors = [p.accent, p.accent2, p.warning, p.success, p.info, p.danger];
  for (let i = 0; i < n; i++) {
    const lit = Math.max(1, Math.round(sample(f.bands, i, n) * rows));
    for (let r = 0; r < lit; r++) {
      const x = gap + i * (bw + gap);
      const y = h - gap - (r + 1) * (bh + gap) + gap;
      ctx.fillStyle = colors[(i + r) % colors.length]!;
      roundRect(ctx, x, y, bw, bh, Math.min(bw, bh) * 0.28);
      ctx.fill();
      ctx.fillStyle = withAlpha('#ffffff', 0.28);
      ctx.fillRect(x + bw * 0.16, y + bh * 0.16, bw * 0.3, Math.max(1, bh * 0.16));
    }
  }
}

function vuMeter(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const meters = [f.levelL, f.levelR];
  const mw = w / 2;
  meters.forEach((lvl, i) => {
    const cx = mw * i + mw / 2;
    const cy = h * 0.95;
    const r = Math.min(mw * 0.44, h * 0.82);
    const a0 = Math.PI * 1.18;
    const a1 = Math.PI * 1.82;
    // Face
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, Math.PI, TAU);
    ctx.fillStyle = withAlpha(p.warning, 0.1);
    ctx.fill();
    // Scale ticks + red zone
    for (let k = 0; k <= 10; k++) {
      const a = a0 + ((a1 - a0) * k) / 10;
      const red = k >= 8;
      ctx.strokeStyle = red ? p.danger : p.text;
      ctx.lineWidth = Math.max(1, (k % 5 === 0 ? 2 : 1) * f.dpr);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
      ctx.lineTo(cx + Math.cos(a) * r * (k % 5 === 0 ? 0.98 : 0.92), cy + Math.sin(a) * r * (k % 5 === 0 ? 0.98 : 0.92));
      ctx.stroke();
    }
    // Needle
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, lvl));
    ctx.strokeStyle = p.accent2;
    ctx.lineWidth = Math.max(1, 1.6 * f.dpr);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * f.dpr, 0, TAU);
    ctx.fillStyle = p.text;
    ctx.fill();
  });
}

function glassWave(ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  clear(ctx, w, h);
  const layers = [
    { col: p.accent2, amp: 0.55, alpha: 0.18, shift: 0.0 },
    { col: p.accent, amp: 0.8, alpha: 0.32, shift: 0.33 },
    { col: p.text, amp: 1, alpha: 0.75, shift: 0.66 },
  ];
  const mid = h * 0.55;
  const n = 18;
  for (const L of layers) {
    ctx.beginPath();
    let px = 0;
    let py = mid;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const v = sample(f.bands, (i + Math.round(L.shift * n)) % (n + 1), n + 1);
      const drift = f.still ? 0 : Math.sin(f.t * 0.9 + i * 0.7 + L.shift * 6) * 0.06;
      const y = mid - (v * L.amp + drift) * h * 0.42 * (i % 2 === 0 ? 1 : -0.6);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x;
      py = y;
    }
    ctx.lineTo(w, py);
    ctx.strokeStyle = withAlpha(L.col, L.alpha);
    ctx.lineWidth = Math.max(1, (L.col === p.text ? 1.2 : 2.4) * f.dpr);
    if (L.col === p.text) glowOn(ctx, p.accent, 10 * f.dpr, p);
    ctx.stroke();
    glowOff(ctx);
  }
  // Glass floor reflection line
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, withAlpha(p.text, 0));
  g.addColorStop(0.5, withAlpha(p.text, 0.25));
  g.addColorStop(1, withAlpha(p.text, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, h - Math.max(1, f.dpr), w, Math.max(1, f.dpr));
}

export const DRAW: Record<VisualizerStyle, (ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette) => void> = {
  'neon-bars': neonBars,
  'pixel-bars': pixelBars,
  lcd,
  spectrum,
  bubbles,
  reels,
  hologram,
  oscilloscope,
  blocks,
  'vu-meter': vuMeter,
  'glass-wave': glassWave,
};

export function drawVisualizer(style: VisualizerStyle, ctx: Ctx, w: number, h: number, f: VisFrame, p: VisPalette): void {
  (DRAW[style] ?? neonBars)(ctx, w, h, f, p);
}

/** Resting shape when paused/idle: a gentle static contour so the display never looks broken. */
export function idleBands(out: Float32Array): Float32Array {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const x = i / Math.max(1, n - 1);
    out[i] = 0.06 + 0.1 * (1 - Math.abs(x - 0.35) * 1.6) * (x < 0.9 ? 1 : 0.5);
    if (out[i]! < 0.04) out[i] = 0.04;
  }
  return out;
}
