/**
 * Canvas 2D helpers for the Classics renderers.
 *
 *  - useCanvasSurface(): a DPR-aware canvas that fills its container while keeping a logical
 *    resolution (draw in logical units; scaling/letterboxing is handled here).
 *  - Block sprites: beveled "modern pixel" tiles rendered once into offscreen canvases.
 *  - Small colour + shape utilities.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical size the game draws in. */
  width: number;
  height: number;
  /** Device pixels per logical unit. */
  scale: number;
}

/**
 * Keeps `canvasRef` sized to `containerRef` (contain-fit at the logical aspect ratio) with a
 * device-pixel backing store (DPR ≤ 2). The returned ref always holds the current surface.
 */
export function useCanvasSurface(
  containerRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  width: number,
  height: number,
): RefObject<Surface | null> {
  const surface = useRef<Surface | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const fit = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const k = Math.min(rect.width / width, rect.height / height);
      const cssW = Math.max(1, Math.floor(width * k));
      const cssH = Math.max(1, Math.floor(height * k));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW) canvas.width = pxW;
      if (canvas.height !== pxH) canvas.height = pxH;
      const scale = pxW / width;
      surface.current = { canvas, ctx, width, height, scale };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    window.addEventListener('orientationchange', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', fit);
      surface.current = null;
    };
  }, [containerRef, canvasRef, width, height]);
  return surface;
}

/** Begin a frame: reset the transform to logical units and clear. */
export function beginFrame(s: Surface): CanvasRenderingContext2D {
  const { ctx } = s;
  ctx.setTransform(s.scale, 0, 0, s.scale, 0, 0);
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Map a client (CSS px) point to logical canvas coordinates. */
export function toLogical(s: Surface, clientX: number, clientY: number): { x: number; y: number } {
  const r = s.canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * s.width, y: ((clientY - r.top) / r.height) * s.height };
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour, returning rgb(). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const f = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Beveled block sprites (cached)
// ---------------------------------------------------------------------------

export type BlockStyle = 'gem' | 'flat' | 'steel' | 'ghost' | 'glass';

const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * A crisp beveled tile: bright top-left edge, deep bottom-right edge, a soft inner face
 * gradient and a pixel "glint". Rendered at `px` device pixels per logical unit and cached.
 */
export function blockSprite(color: string, w: number, h: number, px: number, style: BlockStyle = 'gem'): HTMLCanvasElement {
  const key = `${color}|${w}|${h}|${px.toFixed(2)}|${style}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * px));
  c.height = Math.max(1, Math.round(h * px));
  const g = c.getContext('2d')!;
  g.scale(c.width / w, c.height / h);
  const edge = Math.max(1, Math.min(w, h) * 0.14);
  if (style === 'ghost') {
    g.strokeStyle = alpha(color, 0.75);
    g.lineWidth = Math.max(0.8, edge * 0.6);
    g.strokeRect(g.lineWidth / 2 + 0.5, g.lineWidth / 2 + 0.5, w - g.lineWidth - 1, h - g.lineWidth - 1);
    g.fillStyle = alpha(color, 0.18);
    g.fillRect(edge, edge, w - edge * 2, h - edge * 2);
  } else {
    const face = g.createLinearGradient(0, 0, 0, h);
    if (style === 'steel') {
      face.addColorStop(0, '#c9cbe0');
      face.addColorStop(0.5, '#7d80a0');
      face.addColorStop(1, '#4b4d68');
    } else if (style === 'glass') {
      face.addColorStop(0, alpha(color, 0.55));
      face.addColorStop(1, alpha(color, 0.22));
    } else {
      face.addColorStop(0, shade(color, 0.28));
      face.addColorStop(0.55, color);
      face.addColorStop(1, shade(color, -0.22));
    }
    g.fillStyle = style === 'flat' ? color : face;
    g.fillRect(0, 0, w, h);
    // Bevel: light top/left, dark bottom/right.
    g.fillStyle = style === 'steel' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.42)';
    g.fillRect(0, 0, w, edge);
    g.fillRect(0, 0, edge, h);
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(0, h - edge, w, edge);
    g.fillRect(w - edge, 0, edge, h);
    // Inner face outline + glint.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = Math.max(0.5, edge * 0.35);
    g.strokeRect(edge, edge, w - edge * 2, h - edge * 2);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(edge * 1.6, edge * 1.6, Math.max(1, edge * 1.2), Math.max(1, edge * 1.2));
    if (style === 'gem' || style === 'glass') {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(edge, edge, w - edge * 2, (h - edge * 2) * 0.35);
    }
  }
  if (spriteCache.size > 600) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}

/** Draw a cached block sprite at logical coordinates. */
export function drawBlock(ctx: CanvasRenderingContext2D, s: Surface, color: string, x: number, y: number, w: number, h: number, style: BlockStyle = 'gem'): void {
  ctx.drawImage(blockSprite(color, w, h, s.scale, style), x, y, w, h);
}
