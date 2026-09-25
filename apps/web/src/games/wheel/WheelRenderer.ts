/**
 * Imperative Canvas 2D renderer for the wheel. React owns the DOM; this class
 * owns the pixels and the per-frame loop so nothing high-frequency touches React.
 *
 * Layers (back → front):
 *   rim     static gold bezel, bulb sockets, drop shadow            (canvas, drawn on resize)
 *   face    slices, labels, pegs; rendered once at rotation 0 and   (canvas, supersampled)
 *           turned with a GPU-composited CSS rotate() each frame
 *   gloss   fixed specular highlight                                (CSS)
 *   lights  bulbs: idle twinkle, chase while spinning, win flash    (canvas, redrawn on change)
 *   hub + pointer (flapper with spring physics)                     (DOM)
 *
 * The rotation is ALWAYS f(serverNow) from the server's spin plan, so the frame
 * loop can start at any moment (late join, tab refocus) and be exactly in sync.
 */
import {
  SPIN_PEAK_VELOCITY,
  computeArcs,
  mod,
  nearestApproachingPeg,
  readableTextColor,
  rotationAt,
  shade,
  spinProgressAt,
  spinVelocity,
} from '@dascade/game-core/wheel';
import { graphemes, type WheelSnapshotSegment, type WheelSliceMode } from '@dascade/shared/games/wheel';
import { serverNow } from '../../net/hooks.ts';

export interface RenderSpin {
  key: string;
  startAt: number;
  durationMs: number;
  fromRotation: number;
  toRotation: number;
}

export interface RenderLayout {
  segments: readonly WheelSnapshotSegment[];
  sliceMode: WheelSliceMode;
}

export interface RendererElements {
  root: HTMLElement;
  rim: HTMLCanvasElement;
  face: HTMLCanvasElement;
  lights: HTMLCanvasElement;
  pointer: HTMLElement;
}

export interface RendererCallbacks {
  /** A peg passed the flapper (speed 0..1). */
  onTick?: (speed: number) => void;
  /** The segment under the pointer changed. */
  onPointer?: (segment: WheelSnapshotSegment | null) => void;
}

export interface RendererOptions {
  reducedMotion: boolean;
  fx: 'high' | 'low' | 'off';
  /** Small non-interactive preview (lobby): no flapper physics, calm lights. */
  preview: boolean;
}

/** Geometry as fractions of the wheel box. */
export const WHEEL_GEOMETRY = {
  rimOuter: 0.47,
  centerY: 0.515,
  faceOfRim: 0.86,
  bulbRing: 0.918,
  bulbSize: 0.027,
  hubOfRim: 0.16,
  pegRadius: 0.955,
} as const;

const LABEL_FONT = '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const MORPH_MS = 380;
const HIGHLIGHT_MS = 420;
const DEG = Math.PI / 180;

interface DisplaySlice {
  seg: WheelSnapshotSegment;
  start: number;
  end: number;
  /** Arc size used to fit the label (stable during a morph). */
  fitSize: number;
}

interface LabelFit {
  /** One to three lines, stacked across the slice; empty for icon-only. */
  lines: string[];
  font: number;
  textEnd: number;
  emojiPx: number;
  emojiX: number;
  color: string;
}

interface Morph {
  order: string[];
  from: Map<string, number>;
  to: Map<string, number>;
  data: Map<string, WheelSnapshotSegment>;
  startedAt: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function layoutSignature(layout: RenderLayout): string {
  return `${layout.sliceMode}|${layout.segments.map((s) => `${s.id}:${s.label}:${s.emoji}:${s.color}:${s.weight}`).join('|')}`;
}

function mergeOrder(fromIds: readonly string[], toIds: readonly string[]): string[] {
  const result = [...toIds];
  const present = new Set(toIds);
  fromIds.forEach((id, i) => {
    if (present.has(id)) return;
    let j = i - 1;
    while (j >= 0 && !present.has(fromIds[j] as string)) j--;
    const pos = j >= 0 ? result.indexOf(fromIds[j] as string) + 1 : 0;
    result.splice(pos, 0, id);
    present.add(id);
  });
  return result;
}

export class WheelRenderer {
  private readonly el: RendererElements;
  private readonly cb: RendererCallbacks;
  private opts: RendererOptions = { reducedMotion: false, fx: 'high', preview: false };

  private size = 0;
  private dpr = 1;
  private faceScale = 2;

  private signature = '';
  /** Current target slices (no morph). */
  private slices: DisplaySlice[] = [];
  private morph: Morph | null = null;
  private pegs: number[] = [];

  private rest = 0;
  private spin: RenderSpin | null = null;
  private highlight: { id: string; color: string; since: number } | null = null;
  private highlightFade: { from: number; since: number } | null = null;

  private fitCache = new Map<string, LabelFit | null>();
  private faceDirty = true;
  private rimDirty = true;
  private lightsKey = '';
  private bulbSprites = new Map<string, HTMLCanvasElement>();

  private raf = 0;
  private lastFrame = 0;
  private lastRotation = NaN;
  /** Rotation shown in the most recent frame (for hit-testing). */
  private shownRotation = 0;
  private flap = { angle: 0, vel: 0 };
  private pointerIndex = -2;
  private revealFlashUntil = 0;
  private destroyed = false;

  constructor(el: RendererElements, cb: RendererCallbacks = {}) {
    this.el = el;
    this.cb = cb;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      void Promise.all([fonts.load(`700 24px ${LABEL_FONT}`), fonts.load(`600 24px ${LABEL_FONT}`)])
        .catch(() => undefined)
        .then(() => {
          if (this.destroyed) return;
          this.fitCache.clear();
          this.faceDirty = true;
        });
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  setOptions(opts: RendererOptions): void {
    const changed = opts.fx !== this.opts.fx || opts.reducedMotion !== this.opts.reducedMotion || opts.preview !== this.opts.preview;
    this.opts = opts;
    if (changed) {
      this.faceDirty = true;
      this.rimDirty = true;
      this.lightsKey = '';
      this.bulbSprites.clear();
    }
  }

  setSize(size: number): void {
    const s = Math.max(0, Math.floor(size));
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (s === this.size && dpr === this.dpr) return;
    this.size = s;
    this.dpr = dpr;
    const g = WHEEL_GEOMETRY;
    const rw = s * g.rimOuter;
    const rf = rw * g.faceOfRim;
    const root = this.el.root;
    root.style.setProperty('--wh-s', `${s}px`);
    root.style.setProperty('--wh-cy', `${s * g.centerY}px`);
    root.style.setProperty('--wh-rw', `${rw}px`);
    root.style.setProperty('--wh-rf', `${rf}px`);
    root.style.setProperty('--wh-rh', `${rw * g.hubOfRim}px`);
    for (const c of [this.el.rim, this.el.lights]) {
      c.width = Math.max(1, Math.round(s * dpr));
      c.height = Math.max(1, Math.round(s * dpr));
    }
    const faceCss = 2 * rf;
    // Supersample the face so the GPU-rotated bitmap stays crisp even on 1× screens.
    this.faceScale = Math.min(Math.max(dpr, 2), 2600 / Math.max(1, faceCss));
    this.el.face.width = Math.max(1, Math.round(faceCss * this.faceScale));
    this.el.face.height = this.el.face.width;
    this.fitCache.clear();
    this.bulbSprites.clear();
    this.faceDirty = true;
    this.rimDirty = true;
    this.lightsKey = '';
  }

  setLayout(layout: RenderLayout): void {
    const sig = layoutSignature(layout);
    if (sig === this.signature) return;
    const prevSlices = this.currentSlices(performance.now());
    this.signature = sig;
    const arcs = computeArcs(layout.segments, layout.sliceMode);
    this.slices = arcs.map((a, i) => ({ seg: layout.segments[i] as WheelSnapshotSegment, start: a.start, end: a.end, fitSize: a.size }));
    this.pegs = this.slices.length > 1 ? this.slices.map((s) => s.start) : this.slices.length === 1 ? [0] : [];
    this.pointerIndex = -2;
    const animate = prevSlices.length > 0 && !this.opts.reducedMotion && this.size > 0;
    if (animate) {
      const data = new Map<string, WheelSnapshotSegment>();
      for (const s of prevSlices) data.set(s.seg.id, s.seg);
      for (const s of this.slices) data.set(s.seg.id, s.seg);
      const from = new Map(prevSlices.map((s) => [s.seg.id, s.end - s.start]));
      const to = new Map(this.slices.map((s) => [s.seg.id, s.end - s.start]));
      const sameSizes = from.size === to.size && [...to].every(([id, size]) => Math.abs((from.get(id) ?? -1) - size) < 1e-9);
      this.morph = sameSizes ? null : { order: mergeOrder([...from.keys()], [...to.keys()]), from, to, data, startedAt: performance.now() };
    } else {
      this.morph = null;
    }
    this.faceDirty = true;
  }

  setRest(rotation: number): void {
    this.rest = Number.isFinite(rotation) ? rotation : 0;
  }

  setSpin(spin: RenderSpin | null): void {
    if (spin?.key !== this.spin?.key) this.lastRotation = NaN;
    this.spin = spin;
  }

  setHighlight(h: { id: string; color: string } | null): void {
    const now = performance.now();
    if (h && this.highlight?.id === h.id) return;
    if (!h && !this.highlight) return;
    if (h) {
      this.highlight = { ...h, since: now };
      this.highlightFade = null;
      this.revealFlashUntil = now + 1500;
    } else {
      this.highlightFade = { from: this.highlightAmount(now), since: now };
      this.highlight = null;
    }
    this.faceDirty = true;
    this.lightsKey = '';
  }

  /** Segment under a point (wheel-box CSS px); null outside the face or over the hub. */
  sliceAt(x: number, y: number): WheelSnapshotSegment | null {
    const s = this.size;
    if (s <= 0) return null;
    const g = WHEEL_GEOMETRY;
    const rw = s * g.rimOuter;
    const dx = x - s / 2;
    const dy = y - s * g.centerY;
    const r = Math.hypot(dx, dy);
    if (r > rw * g.faceOfRim || r < rw * g.hubOfRim) return null;
    const screen = mod(Math.atan2(dx, -dy) / DEG, 360);
    const local = mod(screen - this.shownRotation, 360);
    for (const slice of this.currentSlices(performance.now())) {
      if (local >= slice.start && local < slice.end) return slice.seg;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private frame = (t: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.size <= 0) return;
    const dt = Math.min(0.05, this.lastFrame ? (t - this.lastFrame) / 1000 : 0.016);
    this.lastFrame = t;
    const now = serverNow();

    const { rotation, phase, speed } = this.currentRotation(now);
    this.shownRotation = rotation;
    const faceWrap = this.el.face.parentElement;
    if (faceWrap) faceWrap.style.transform = `rotate(${mod(rotation, 360)}deg)`;
    this.el.root.dataset.phase = phase;

    // Pegs + flapper.
    if (!this.opts.preview) this.updateFlapper(rotation, phase, speed, dt);

    // Pointer readout.
    const slices = this.currentSlices(t);
    const idx = this.indexAtPointer(slices, rotation);
    if (idx !== this.pointerIndex) {
      this.pointerIndex = idx;
      this.cb.onPointer?.(idx >= 0 ? ((slices[idx] as DisplaySlice).seg ?? null) : null);
    }

    if (this.rimDirty) this.renderRim();
    if (this.morph || this.faceDirty || this.highlightAnimating(t)) this.renderFace(t, slices);
    this.renderLights(t, now, rotation, phase);
    this.lastRotation = rotation;
  };

  private currentRotation(now: number): { rotation: number; phase: 'idle' | 'lead' | 'spinning' | 'landed'; speed: number } {
    const spin = this.spin;
    if (!spin) return { rotation: this.rest, phase: 'idle', speed: 0 };
    const end = spin.startAt + spin.durationMs;
    if (now < spin.startAt) return { rotation: spin.fromRotation, phase: 'lead', speed: 0 };
    if (now >= end) return { rotation: spin.toRotation, phase: 'landed', speed: 0 };
    if (this.opts.reducedMotion) return { rotation: spin.fromRotation, phase: 'spinning', speed: 0 };
    const u = spinProgressAt(spin, now);
    return { rotation: rotationAt(spin, now), phase: 'spinning', speed: spinVelocity(u) / SPIN_PEAK_VELOCITY };
  }

  private indexAtPointer(slices: readonly DisplaySlice[], rotation: number): number {
    if (slices.length === 0) return -1;
    const p = mod(-rotation, 360);
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i] as DisplaySlice;
      if (p >= s.start && p < s.end) return i;
    }
    return slices.length - 1;
  }

  private updateFlapper(rotation: number, phase: string, speed: number, dt: number): void {
    const pegs = this.pegs;
    const spinning = phase === 'spinning' && !this.opts.reducedMotion;
    if (spinning && Number.isFinite(this.lastRotation) && rotation > this.lastRotation && pegs.length > 0) {
      let crossed = 0;
      for (const b of pegs) crossed += Math.floor((rotation + b) / 360) - Math.floor((this.lastRotation + b) / 360);
      if (crossed > 0) this.cb.onTick?.(speed);
    }
    // Contact with the approaching peg pushes the flapper tip sideways.
    let contact = 0;
    if (pegs.length > 0 && !this.opts.reducedMotion) {
      const idx = this.indexAtPointer(this.slices, rotation);
      const arcSize = idx >= 0 ? (this.slices[idx] as DisplaySlice).end - (this.slices[idx] as DisplaySlice).start : 360;
      const zone = Math.min(arcSize * 0.16, 5);
      const maxDefl = Math.max(3, Math.min(24, arcSize * 1.1));
      const d = nearestApproachingPeg(pegs, rotation);
      if (d > -zone) contact = maxDefl * (1 + d / zone);
    }
    const f = this.flap;
    if (contact >= f.angle) {
      f.angle = contact;
      f.vel = 0;
    } else {
      // Under-damped spring back to rest (substepped for stability).
      const steps = 4;
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const acc = -620 * f.angle - 19 * f.vel;
        f.vel += acc * h;
        f.angle += f.vel * h;
      }
      if (Math.abs(f.angle) < 0.01 && Math.abs(f.vel) < 0.05) {
        f.angle = 0;
        f.vel = 0;
      }
    }
    this.el.pointer.style.transform = `rotate(${(-f.angle).toFixed(2)}deg)`;
  }

  // ---------------------------------------------------------------------------
  // Slices (with morphing)
  // ---------------------------------------------------------------------------

  private currentSlices(t: number): DisplaySlice[] {
    const m = this.morph;
    if (!m) return this.slices;
    const k = (t - m.startedAt) / MORPH_MS;
    if (k >= 1) {
      this.morph = null;
      this.faceDirty = true;
      return this.slices;
    }
    const e = easeInOut(Math.max(0, k));
    const out: DisplaySlice[] = [];
    let acc = 0;
    for (const id of m.order) {
      const a = m.from.get(id) ?? 0;
      const b = m.to.get(id) ?? 0;
      const size = a + (b - a) * e;
      const seg = m.data.get(id) as WheelSnapshotSegment;
      if (size > 1e-6) out.push({ seg, start: acc, end: acc + size, fitSize: Math.max(a, b) });
      acc += size;
    }
    if (out.length) (out[out.length - 1] as DisplaySlice).end = 360;
    return out;
  }

  private highlightAmount(t: number): number {
    if (this.highlight) return easeInOut(Math.min(1, (t - this.highlight.since) / HIGHLIGHT_MS));
    if (this.highlightFade) {
      const k = Math.min(1, (t - this.highlightFade.since) / HIGHLIGHT_MS);
      return this.highlightFade.from * (1 - easeInOut(k));
    }
    return 0;
  }

  private highlightAnimating(t: number): boolean {
    if (this.highlight) return t - this.highlight.since < HIGHLIGHT_MS + 32;
    if (this.highlightFade) {
      if (t - this.highlightFade.since < HIGHLIGHT_MS + 32) return true;
      this.highlightFade = null;
      this.faceDirty = true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Drawing: face
  // ---------------------------------------------------------------------------

  private renderFace(t: number, slices: readonly DisplaySlice[]): void {
    this.faceDirty = false;
    const canvas = this.el.face;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const R = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(R, R);

    if (slices.length === 0) {
      this.drawEmptyFace(ctx, R);
      ctx.restore();
      return;
    }

    const single = slices.length === 1;
    // Slices.
    for (const s of slices) {
      const g = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
      g.addColorStop(0, shade(s.seg.color, 0.28));
      g.addColorStop(0.55, s.seg.color);
      g.addColorStop(1, shade(s.seg.color, -0.22));
      ctx.fillStyle = g;
      ctx.beginPath();
      if (single) ctx.arc(0, 0, R, 0, Math.PI * 2);
      else {
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, (s.start - 90) * DEG, (s.end - 90) * DEG);
        ctx.closePath();
      }
      ctx.fill();
    }

    // Separators with a light bevel edge.
    if (!single) {
      const dense = slices.length > 90;
      for (const s of slices) {
        const a = (s.start - 90) * DEG;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cos * R * 0.12, sin * R * 0.12);
        ctx.lineTo(cos * R, sin * R);
        ctx.strokeStyle = 'rgba(24, 10, 0, 0.5)';
        ctx.lineWidth = Math.max(1, R * (dense ? 0.003 : 0.008));
        ctx.stroke();
        if (!dense) {
          const b = a + Math.max(0.002, R * 0.00001);
          ctx.beginPath();
          ctx.moveTo(Math.cos(b) * R * 0.12, Math.sin(b) * R * 0.12);
          ctx.lineTo(Math.cos(b) * R, Math.sin(b) * R);
          ctx.strokeStyle = 'rgba(255, 244, 220, 0.2)';
          ctx.lineWidth = Math.max(1, R * 0.004);
          ctx.stroke();
        }
      }
    }

    // Inner rim shadow (depth) and a soft center glow.
    const edge = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(0.75, 'rgba(0,0,0,0.1)');
    edge.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Labels.
    for (const s of slices) this.drawLabel(ctx, s, R, single);

    // Pegs on the boundaries.
    this.drawPegs(ctx, slices, R);

    // Winner highlight.
    const amt = this.highlightAmount(t);
    if (amt > 0.001) {
      const winId = this.highlight?.id ?? null;
      for (const s of slices) {
        if (s.seg.id === winId) continue;
        ctx.beginPath();
        if (single) ctx.arc(0, 0, R, 0, Math.PI * 2);
        else {
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R, (s.start - 90) * DEG, (s.end - 90) * DEG);
          ctx.closePath();
        }
        ctx.fillStyle = `rgba(8, 4, 16, ${0.6 * amt})`;
        ctx.fill();
      }
      const win = slices.find((s) => s.seg.id === winId);
      if (win) {
        ctx.save();
        ctx.beginPath();
        if (single) ctx.arc(0, 0, R * 0.985, 0, Math.PI * 2);
        else {
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R * 0.985, (win.start - 90) * DEG, (win.end - 90) * DEG);
          ctx.closePath();
        }
        ctx.fillStyle = `rgba(255, 250, 235, ${0.14 * amt})`;
        ctx.fill();
        ctx.globalAlpha = amt;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, R * 0.016);
        ctx.strokeStyle = '#fff8e6';
        if (this.opts.fx !== 'off') {
          ctx.shadowColor = win.seg.color;
          ctx.shadowBlur = R * 0.06;
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawEmptyFace(ctx: CanvasRenderingContext2D, R: number): void {
    const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    g.addColorStop(0, '#2a1a3a');
    g.addColorStop(1, '#120a1c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([R * 0.04, R * 0.04]);
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.35)';
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Splits text into `count` word-balanced lines (null when it can't split that many ways). */
  private splitLines(ctx: CanvasRenderingContext2D, text: string, count: number): string[] | null {
    if (count === 1) return [text];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < count) return null;
    const total = ctx.measureText(text).width;
    const target = total / count;
    const lines: string[] = [];
    let current = '';
    for (let i = 0; i < words.length; i++) {
      const word = words[i] as string;
      const candidate = current ? `${current} ${word}` : word;
      const remainingWords = words.length - i;
      const remainingLines = count - lines.length;
      if (current && remainingLines > 1 && (ctx.measureText(candidate).width > target * 1.08 || remainingWords < remainingLines)) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    return lines.length === count ? lines : null;
  }

  private fitLabel(ctx: CanvasRenderingContext2D, seg: WheelSnapshotSegment, sizeDeg: number, R: number, single: boolean): LabelFit | null {
    const key = `${seg.label}\u0001${seg.emoji}\u0001${sizeDeg.toFixed(3)}\u0001${seg.color}\u0001${single ? 1 : 0}`;
    const cached = this.fitCache.get(key);
    if (cached !== undefined) return cached;
    // Absolute limits are in CSS px; the face canvas is supersampled by `k`.
    const k = this.faceScale;
    const theta = Math.min(sizeDeg, 360) * DEG;
    const avail = (r: number) => (theta >= Math.PI ? 2 * r : 2 * r * Math.sin(theta / 2));
    const outer = R * 0.885;
    const inner = R * 0.225;
    const color = readableTextColor(seg.color);
    let textEnd = outer;
    let emojiPx = 0;
    let emojiX = 0;
    let result: LabelFit | null = null;

    if (seg.emoji && !seg.label) {
      emojiPx = Math.min(R * 0.2, avail(R * 0.64) * 0.7);
      result = emojiPx >= 10 * k ? { lines: [], font: 0, textEnd: 0, emojiPx, emojiX: R * 0.64, color } : null;
    } else if (seg.label) {
      if (seg.emoji) {
        emojiPx = Math.min(R * 0.13, 40 * k, avail(outer - R * 0.065) * 0.74);
        if (emojiPx >= 11 * k) {
          emojiX = outer - emojiPx / 2;
          textEnd = outer - emojiPx - R * 0.03;
        } else emojiPx = 0;
      }
      // Roomy slices (few options) get bigger type.
      const fMax = Math.max(11 * k, Math.min(R * (theta >= 1 ? 0.13 : 0.1), 44 * k));
      const fMin = Math.max(9.5 * k, R * 0.04);
      const setFont = (f: number) => {
        ctx.font = `700 ${f}px ${LABEL_FONT}`;
      };
      const maxLines = theta >= 0.9 ? 3 : theta >= 0.45 ? 2 : 1;
      for (let f = fMax; f >= fMin && !result; f -= Math.max(0.5, f * 0.06)) {
        setFont(f);
        for (let n = 1; n <= maxLines; n++) {
          const lines = this.splitLines(ctx, seg.label, n);
          if (!lines) break;
          const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
          const rIn = textEnd - w;
          if (rIn >= inner && avail(rIn) >= f * (1.18 + 1.12 * (n - 1))) {
            result = { lines, font: f, textEnd, emojiPx, emojiX, color };
            break;
          }
        }
      }
      if (!result) {
        // Smallest size, one line, ellipsized to the room available.
        const rHeight = theta >= Math.PI ? (fMin * 1.18) / 2 : (fMin * 1.18) / (2 * Math.sin(theta / 2));
        const rIn = Math.max(inner, rHeight);
        const maxW = textEnd - rIn;
        const g = graphemes(seg.label);
        let fitted: string | null = null;
        if (maxW >= fMin * 2.4 && avail(textEnd) >= fMin * 1.18) {
          setFont(fMin);
          let lo = 0;
          let hi = g.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(`${g.slice(0, mid).join('').trimEnd()}…`).width <= maxW) lo = mid;
            else hi = mid - 1;
          }
          // A two-letter stub ("Op…") reads as noise: hide the label instead (the pointer readout names it).
          if (lo >= Math.min(3, g.length)) fitted = `${g.slice(0, lo).join('').trimEnd()}…`;
        }
        if (fitted) result = { lines: [fitted], font: fMin, textEnd, emojiPx, emojiX, color };
        else if (emojiPx > 0) result = { lines: [], font: 0, textEnd, emojiPx, emojiX, color };
      }
    }
    // Long sessions with many edits: keep the cache bounded.
    if (this.fitCache.size > 4000) this.fitCache.clear();
    this.fitCache.set(key, result);
    return result;
  }

  private drawLabel(ctx: CanvasRenderingContext2D, s: DisplaySlice, R: number, single: boolean): void {
    const fit = this.fitLabel(ctx, s.seg, s.fitSize, R, single);
    if (!fit) return;
    const mid = (s.start + s.end) / 2;
    ctx.save();
    if (!single) {
      // Keep text inside its own wedge (matters while slices morph).
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, (s.start - 90) * DEG, (s.end - 90) * DEG);
      ctx.closePath();
      ctx.clip();
    }
    ctx.rotate((mid - 90) * DEG);
    if (fit.lines.length) {
      ctx.font = `700 ${fit.font}px ${LABEL_FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fit.color;
      if (fit.color === '#ffffff' && this.opts.fx !== 'off') {
        ctx.shadowColor = 'rgba(20, 6, 0, 0.55)';
        ctx.shadowBlur = Math.max(1, R * 0.012);
        ctx.shadowOffsetY = Math.max(0.5, R * 0.004);
      }
      const lh = fit.font * 1.12;
      fit.lines.forEach((line, i) => {
        ctx.fillText(line, fit.textEnd, (i - (fit.lines.length - 1) / 2) * lh + fit.font * 0.04);
      });
      ctx.shadowColor = 'transparent';
    }
    if (fit.emojiPx > 0) {
      ctx.translate(fit.emojiX, 0);
      ctx.rotate(Math.PI / 2);
      ctx.font = `${fit.emojiPx}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.seg.emoji, 0, fit.emojiPx * 0.06);
    }
    ctx.restore();
  }

  private drawPegs(ctx: CanvasRenderingContext2D, slices: readonly DisplaySlice[], R: number): void {
    const angles = slices.length > 1 ? slices.map((s) => s.start) : [0];
    let minSize = 360;
    for (const s of slices) minSize = Math.min(minSize, s.end - s.start);
    const rp = R * WHEEL_GEOMETRY.pegRadius;
    const spacing = rp * minSize * DEG;
    const k = this.faceScale;
    const pr = Math.min(Math.max(2 * k, R * 0.022), spacing * 0.32);
    if (pr < 1.3 * k) return;
    for (const deg of angles) {
      const a = (deg - 90) * DEG;
      const x = Math.cos(a) * rp;
      const y = Math.sin(a) * rp;
      ctx.beginPath();
      ctx.arc(x + pr * 0.25, y + pr * 0.45, pr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill();
      const g = ctx.createRadialGradient(x - pr * 0.35, y - pr * 0.35, pr * 0.1, x, y, pr);
      g.addColorStop(0, '#fff8de');
      g.addColorStop(0.45, '#ffc54a');
      g.addColorStop(1, '#8a4c00');
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing: rim + lights
  // ---------------------------------------------------------------------------

  private get bulbCount(): number {
    return this.size >= 420 ? 32 : 24;
  }

  private renderRim(): void {
    this.rimDirty = false;
    const ctx = this.el.rim.getContext('2d');
    if (!ctx) return;
    const s = this.size;
    const g = WHEEL_GEOMETRY;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s * g.centerY;
    const rw = s * g.rimOuter;
    const rf = rw * g.faceOfRim;
    const circle = (r: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    };

    // Grounding shadow.
    ctx.save();
    if (this.opts.fx !== 'off') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = rw * 0.14;
      ctx.shadowOffsetY = rw * 0.06;
    }
    circle(rw);
    ctx.fillStyle = '#1a0c02';
    ctx.fill();
    ctx.restore();

    // Outer gold lip.
    const lip = ctx.createLinearGradient(cx, cy - rw, cx, cy + rw);
    lip.addColorStop(0, '#fff0c2');
    lip.addColorStop(0.2, '#ffc94d');
    lip.addColorStop(0.5, '#e38b00');
    lip.addColorStop(0.8, '#8f4a00');
    lip.addColorStop(1, '#4d2600');
    circle(rw);
    ctx.fillStyle = lip;
    ctx.fill();
    circle(rw - 1);
    ctx.strokeStyle = 'rgba(255, 246, 214, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Bulb channel.
    const channel = ctx.createLinearGradient(cx, cy - rw, cx, cy + rw);
    channel.addColorStop(0, '#0b0401');
    channel.addColorStop(0.5, '#1f0f03');
    channel.addColorStop(1, '#321805');
    circle(rw * 0.962);
    ctx.fillStyle = channel;
    ctx.fill();
    // Hot-pink neon pinstripe.
    circle(rw * 0.962);
    ctx.strokeStyle = 'rgba(255, 79, 129, 0.55)';
    ctx.lineWidth = Math.max(1, rw * 0.006);
    ctx.stroke();

    // Inner lip (reverse gradient reads as a bevel).
    const inner = ctx.createLinearGradient(cx, cy - rf, cx, cy + rf);
    inner.addColorStop(0, '#6e3700');
    inner.addColorStop(0.5, '#d68200');
    inner.addColorStop(1, '#ffe3a1');
    circle(rf + rw * 0.032);
    ctx.fillStyle = inner;
    ctx.fill();
    circle(rf + 0.5);
    ctx.fillStyle = '#0a0400';
    ctx.fill();

    // Bulb sockets.
    const n = this.bulbCount;
    const rb = rw * g.bulbRing;
    const size = Math.max(2.5, rw * g.bulbSize);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * rb;
      const y = cy + Math.sin(a) * rb;
      ctx.beginPath();
      ctx.arc(x, y, size * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = '#070200';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 200, 110, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private bulbSprite(color: string, on: boolean, r: number): HTMLCanvasElement {
    const halo = on && this.opts.fx !== 'off' ? (this.opts.fx === 'high' ? 3.2 : 2) : 1.2;
    const key = `${color}|${on}|${r.toFixed(2)}|${halo}`;
    const existing = this.bulbSprites.get(key);
    if (existing) return existing;
    const px = Math.ceil(r * halo * 2 * this.dpr) + 2;
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const ctx = c.getContext('2d');
    if (ctx) {
      const m = px / 2;
      const rr = r * this.dpr;
      if (on && halo > 1.5) {
        const glow = ctx.createRadialGradient(m, m, rr * 0.5, m, m, rr * halo);
        glow.addColorStop(0, `${color}cc`);
        glow.addColorStop(0.45, `${color}44`);
        glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, px, px);
      }
      const body = ctx.createRadialGradient(m - rr * 0.3, m - rr * 0.35, rr * 0.1, m, m, rr);
      if (on) {
        body.addColorStop(0, '#fffef4');
        body.addColorStop(0.45, shade(color, 0.55));
        body.addColorStop(1, color);
      } else {
        body.addColorStop(0, shade(color, -0.45));
        body.addColorStop(1, shade(color, -0.8));
      }
      ctx.beginPath();
      ctx.arc(m, m, rr, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(m - rr * 0.32, m - rr * 0.36, rr * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
    this.bulbSprites.set(key, c);
    return c;
  }

  private renderLights(t: number, now: number, rotation: number, phase: string): void {
    const n = this.bulbCount;
    const reduced = this.opts.reducedMotion;
    const celebrate = this.highlight;
    const color = celebrate ? celebrate.color : '#ffc451';
    let pattern: (i: number) => boolean;
    let key: string;
    if (reduced || this.opts.fx === 'off') {
      pattern = () => true;
      key = `static|${color}`;
    } else if (celebrate && t < this.revealFlashUntil) {
      const on = Math.floor((t - celebrate.since) / 110) % 2 === 0;
      pattern = () => on;
      key = `flash|${on}|${color}`;
    } else if (celebrate) {
      const step = Math.floor(t / 260) % 2;
      pattern = (i) => i % 2 === step;
      key = `winalt|${step}|${color}`;
    } else if (phase === 'spinning') {
      const head = Math.floor(rotation / (360 / n));
      pattern = (i) => (((i - head) % 3) + 3) % 3 === 0;
      key = `chase|${((head % 3) + 3) % 3}`;
    } else if (phase === 'lead') {
      pattern = () => true;
      key = 'lead';
    } else if (this.opts.preview) {
      pattern = () => true;
      key = 'preview';
    } else {
      const step = Math.floor(now / 750) % 2;
      pattern = (i) => i % 2 === step;
      key = `idle|${step}`;
    }
    key = `${key}|${this.size}|${this.opts.fx}`;
    if (key === this.lightsKey) return;
    this.lightsKey = key;

    const ctx = this.el.lights.getContext('2d');
    if (!ctx) return;
    const s = this.size;
    const g = WHEEL_GEOMETRY;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.lights.width, this.el.lights.height);
    const cx = (s / 2) * this.dpr;
    const cy = s * g.centerY * this.dpr;
    const rw = s * g.rimOuter;
    const rb = rw * g.bulbRing * this.dpr;
    const r = Math.max(2.5, rw * g.bulbSize);
    const onSprite = this.bulbSprite(color, true, r);
    const offSprite = this.bulbSprite(celebrate ? color : '#ffb020', false, r);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * rb;
      const y = cy + Math.sin(a) * rb;
      const sprite = pattern(i) ? onSprite : offSprite;
      ctx.drawImage(sprite, Math.round(x - sprite.width / 2), Math.round(y - sprite.height / 2));
    }
  }
}
