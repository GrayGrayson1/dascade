/**
 * SketchRenderer — draws the DASketch op log onto a fixed-resolution bitmap.
 *
 * The backing store is always SKETCH_CANVAS × RENDER_SCALE on every client, so flood
 * fills see the same pixels everywhere. Fill results are cached per op as compact
 * row spans (a few KB even for full-canvas fills), which keeps undo/redraw instant.
 */
import { isFreehand } from '@dascade/game-core/dasketch';
import { SKETCH_CANVAS, SKETCH_PAPER, type SketchOp } from '@dascade/shared/games/dasketch';

export const RENDER_SCALE = 1.5;
export const BACKING_W = Math.round(SKETCH_CANVAS.width * RENDER_SCALE);
export const BACKING_H = Math.round(SKETCH_CANVAS.height * RENDER_SCALE);

/** Max per-channel difference still considered "the same colour" by the bucket. */
const FILL_TOLERANCE = 44;

interface FillSpans {
  color: string;
  /** Triples of (y, x0, x1) in backing pixels, inclusive. */
  spans: Int32Array;
  /** The spans as one path (built on first paint), so repaints are one fill call per op. */
  path?: Path2D | null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class SketchRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fills = new WeakMap<SketchOp, FillSpans>();
  /** CPU-backed copy used for flood-fill readback (keeps the visible canvas GPU-accelerated). */
  private scratch: CanvasRenderingContext2D | null = null;
  /** Source of ops for a queued full repaint (see invalidate). */
  private pending: (() => readonly SketchOp[]) | null = null;
  private raf = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = BACKING_W;
    canvas.height = BACKING_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.paper();
  }

  /** Clears to paper. */
  paper(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SKETCH_PAPER;
    ctx.fillRect(0, 0, BACKING_W, BACKING_H);
  }

  /**
   * Queues a full repaint for the next frame. Snapshots and undos call this instead of
   * redraw(), so a burst of them (a hostile artist spamming undo) repaints once per frame
   * rather than once per event.
   */
  invalidate(ops: () => readonly SketchOp[]): void {
    this.pending = ops;
    if (!this.raf && typeof requestAnimationFrame === 'function') this.raf = requestAnimationFrame(() => this.flush());
    else if (!this.raf) this.flush();
  }

  /** True while a full repaint is queued (incremental draws can be skipped until then). */
  get dirty(): boolean {
    return this.pending !== null;
  }

  /** Runs a queued repaint now (e.g. before reading pixels for a thumbnail). */
  flush(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const source = this.pending;
    this.pending = null;
    if (source) this.redraw(source());
  }

  /** Drops any queued repaint (unmount). */
  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pending = null;
  }

  /** Full repaint from an op list (only ops after the last clear are visible). */
  redraw(ops: readonly SketchOp[]): void {
    this.paper();
    let start = 0;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i]!.tool === 'clear') {
        start = i + 1;
        break;
      }
    }
    for (let i = start; i < ops.length; i++) this.drawOp(ops[i]!);
  }

  drawOp(op: SketchOp): void {
    switch (op.tool) {
      case 'brush':
      case 'eraser':
        this.drawStroke(op, 0);
        break;
      case 'line':
      case 'rect':
      case 'ellipse':
        this.drawShape(op);
        break;
      case 'fill':
        this.drawFill(op);
        break;
      case 'clear':
        this.paper();
        break;
    }
  }

  /**
   * Draws a freehand stroke starting at point index `from` (connecting from the point
   * before it), so streamed chunks render incrementally with no seams.
   */
  drawStroke(op: SketchOp, from: number): void {
    if (!isFreehand(op.tool)) return;
    const pts = op.points;
    const n = pts.length / 2;
    if (n === 0) return;
    const ctx = this.ctx;
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    const color = op.tool === 'eraser' ? SKETCH_PAPER : op.color;
    if (n === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0]!, pts[1]!, op.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const start = Math.max(0, from - 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = op.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[start * 2]!, pts[start * 2 + 1]!);
    for (let i = start + 1; i < n; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    ctx.stroke();
  }

  drawShape(op: SketchOp): void {
    const [x1, y1, x2, y2] = op.points as [number, number, number, number];
    const ctx = this.ctx;
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    tracePath(ctx, op.tool, x1, y1, x2, y2);
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  drawFill(op: SketchOp): void {
    let fill = this.fills.get(op);
    if (!fill) {
      fill = this.computeFill(op);
      this.fills.set(op, fill);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = fill.color;
    const s = fill.spans;
    if (fill.path === undefined) {
      fill.path = typeof Path2D === 'function' && s.length > 0 ? new Path2D() : null;
      for (let i = 0; fill.path && i < s.length; i += 3) fill.path.rect(s[i + 1]!, s[i]!, s[i + 2]! - s[i + 1]! + 1, 1);
    }
    if (fill.path) {
      ctx.fill(fill.path);
      return;
    }
    for (let i = 0; i < s.length; i += 3) ctx.fillRect(s[i + 1]!, s[i]!, s[i + 2]! - s[i + 1]! + 1, 1);
  }

  /** Scanline flood fill on the backing bitmap, dilated by one pixel to cover anti-aliased edges. */
  private computeFill(op: SketchOp): FillSpans {
    const W = BACKING_W;
    const H = BACKING_H;
    const sx = Math.min(W - 1, Math.max(0, Math.floor((op.points[0]! + 0.5) * RENDER_SCALE)));
    const sy = Math.min(H - 1, Math.max(0, Math.floor((op.points[1]! + 0.5) * RENDER_SCALE)));
    if (!this.scratch) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      this.scratch = c.getContext('2d', { willReadFrequently: true, alpha: false });
    }
    const reader = this.scratch ?? this.ctx;
    if (reader !== this.ctx) {
      reader.setTransform(1, 0, 0, 1, 0, 0);
      reader.drawImage(this.canvas, 0, 0);
    }
    const img = reader.getImageData(0, 0, W, H);
    const px = new Uint32Array(img.data.buffer);
    const seed = px[sy * W + sx]!;
    const tr = seed & 255;
    const tg = (seed >>> 8) & 255;
    const tb = (seed >>> 16) & 255;
    const [fr, fg, fb] = hexToRgb(op.color);
    if (Math.abs(fr - tr) <= 2 && Math.abs(fg - tg) <= 2 && Math.abs(fb - tb) <= 2) return { color: op.color, spans: new Int32Array(0) };

    const mask = new Uint8Array(W * H);
    const match = (i: number): boolean => {
      if (mask[i]) return false;
      const c = px[i]!;
      return Math.abs((c & 255) - tr) <= FILL_TOLERANCE && Math.abs(((c >>> 8) & 255) - tg) <= FILL_TOLERANCE && Math.abs(((c >>> 16) & 255) - tb) <= FILL_TOLERANCE;
    };
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      const row = y * W;
      while (x > 0 && match(row + x - 1)) x--;
      if (!match(row + x)) continue;
      let above = false;
      let below = false;
      while (x < W && match(row + x)) {
        mask[row + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > 0) {
          const m = match(row - W + x);
          if (m && !above) stack.push(x, y - 1);
          above = m;
        }
        if (y < H - 1) {
          const m = match(row + W + x);
          if (m && !below) stack.push(x, y + 1);
          below = m;
        }
        x++;
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const spans: number[] = [];
    const x0 = Math.max(0, minX - 1);
    const x1 = Math.min(W - 1, maxX + 1);
    for (let y = Math.max(0, minY - 1); y <= Math.min(H - 1, maxY + 1); y++) {
      const row = y * W;
      let runStart = -1;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const on = mask[i] === 1 || (x > 0 && mask[i - 1] === 1) || (x < W - 1 && mask[i + 1] === 1) || (y > 0 && mask[i - W] === 1) || (y < H - 1 && mask[i + W] === 1);
        if (on && runStart < 0) runStart = x;
        else if (!on && runStart >= 0) {
          spans.push(y, runStart, x - 1);
          runStart = -1;
        }
      }
      if (runStart >= 0) spans.push(y, runStart, x1);
    }
    return { color: op.color, spans: Int32Array.from(spans) };
  }

  /** Small JPEG thumbnail of the current drawing (for the results gallery). */
  thumbnail(width = 360): string {
    this.flush();
    const t = document.createElement('canvas');
    t.width = width;
    t.height = Math.round((width * BACKING_H) / BACKING_W);
    const c = t.getContext('2d');
    if (!c) return '';
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.canvas, 0, 0, t.width, t.height);
    try {
      return t.toDataURL('image/jpeg', 0.82);
    } catch {
      return '';
    }
  }
}

/** Builds the path for a line / rectangle / ellipse between two corners (logical units). */
export function tracePath(ctx: CanvasRenderingContext2D, tool: SketchOp['tool'], x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  if (tool === 'line') {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 === x1 && y2 === y1 ? x2 + 0.01 : x2, y2);
  } else if (tool === 'rect') {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (tool === 'ellipse') {
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.5, Math.abs(x2 - x1) / 2), Math.max(0.5, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
  }
}
