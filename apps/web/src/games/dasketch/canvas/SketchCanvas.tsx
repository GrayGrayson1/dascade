/**
 * The drawing surface. Two stacked canvases:
 *  - main: the fixed-resolution drawing (SketchRenderer), fed by the canvas store;
 *  - overlay: device-resolution UI (brush-size ring, shape rubber band, the artist's pen for viewers).
 * All drawing data stays out of React; props only carry the current tool settings.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { SKETCH_CANVAS, SKETCH_MARGIN, type SketchTool } from '@dascade/shared/games/dasketch';
import type { BoardRejectReason } from '@dascade/game-core/dasketch';
import { canvasStore, type CanvasChange } from './canvasStore.ts';
import { SketchRenderer, tracePath } from './renderer.ts';

const W = SKETCH_CANVAS.width;
const H = SKETCH_CANVAS.height;
/** Exponential smoothing factor for freehand input (1 = raw). */
const SMOOTHING = 0.5;
/** Minimum logical distance between emitted points. */
const MIN_STEP = 1.6;
const PEN_FADE_MS = 900;

interface Point {
  x: number;
  y: number;
}

export interface SketchCanvasProps {
  canDraw: boolean;
  tool: SketchTool;
  color: string;
  size: number;
  label: string;
  onReject?: (reason: BoardRejectReason) => void;
  onRenderer?: (renderer: SketchRenderer | null) => void;
  children?: ReactNode;
}

export function SketchCanvas({ canDraw, tool, color, size, label, onReject, onRenderer, children }: SketchCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ canDraw, tool, color, size, onReject });
  props.current = { canDraw, tool, color, size, onReject };
  const rendererCallback = useRef(onRenderer);
  rendererCallback.current = onRenderer;
  const requestOverlay = useRef<() => void>(() => undefined);
  const endInput = useRef<() => void>(() => undefined);

  // Drawing bitmap: mirror the canvas store.
  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    const renderer = new SketchRenderer(canvas);
    renderer.redraw(canvasStore.board.ops);
    rendererCallback.current?.(renderer);
    const allOps = () => canvasStore.board.ops;
    const unsubscribe = canvasStore.subscribe((change: CanvasChange) => {
      const board = canvasStore.board;
      if (change.kind === 'reset') {
        renderer.invalidate(allOps);
        requestOverlay.current();
        return;
      }
      if (renderer.dirty) {
        // A full repaint is queued for this frame; it will include this event.
        if (!change.local) requestOverlay.current();
        return;
      }
      const ev = change.event;
      const last = board.lastOp();
      switch (ev.k) {
        case 'stroke':
          if (last) renderer.drawStroke(last, 0);
          break;
        case 'pts':
          if (last) renderer.drawStroke(last, last.points.length / 2 - ev.pts.length / 2);
          break;
        case 'shape':
        case 'fill':
          if (last) renderer.drawOp(last);
          break;
        case 'undo':
          renderer.invalidate(allOps);
          break;
        case 'clear':
          renderer.paper();
          break;
      }
      if (!change.local) requestOverlay.current();
    });
    return () => {
      unsubscribe();
      renderer.dispose();
      rendererCallback.current?.(null);
    };
  }, []);

  // Pointer input + overlay rendering.
  useEffect(() => {
    const overlay = overlayRef.current;
    const frame = frameRef.current;
    if (!overlay || !frame) return;
    const octx = overlay.getContext('2d');
    if (!octx) return;

    let cssW = 1;
    let cssH = 1;
    let dpr = 1;
    let raf = 0;
    let hover: Point | null = null;
    let pointerId: number | null = null;
    let stroke: { last: Point; smooth: Point } | null = null;
    let shape: { start: Point; end: Point } | null = null;

    const resize = () => {
      const rect = frame.getBoundingClientRect();
      dpr = Math.min(3, window.devicePixelRatio || 1);
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      overlay.width = Math.round(cssW * dpr);
      overlay.height = Math.round(cssH * dpr);
      schedule();
    };

    const toLogical = (e: { clientX: number; clientY: number }): Point => {
      const rect = overlay.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
      const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * H;
      return { x: Math.min(W + SKETCH_MARGIN, Math.max(-SKETCH_MARGIN, x)), y: Math.min(H + SKETCH_MARGIN, Math.max(-SKETCH_MARGIN, y)) };
    };
    const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

    const constrain = (start: Point, end: Point, square: boolean): Point => {
      if (!square) return end;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (props.current.tool === 'line') {
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        return { x: start.x + Math.cos(angle) * len, y: start.y + Math.sin(angle) * len };
      }
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: start.x + Math.sign(dx || 1) * side, y: start.y + Math.sign(dy || 1) * side };
    };

    const reject = (reason: BoardRejectReason) => {
      if (reason === 'nothing_to_undo' || reason === 'already_clear') return;
      props.current.onReject?.(reason);
    };

    const draw = () => {
      raf = 0;
      const k = (cssW / W) * dpr;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      let animate = false;
      const { canDraw: live, tool: t, color: c, size: s } = props.current;

      // The artist's pen, as seen by everyone else.
      const pen = canvasStore.pen;
      if (!live && pen) {
        const age = performance.now() - pen.at;
        if (age < PEN_FADE_MS) {
          const a = 1 - age / PEN_FADE_MS;
          const r = (10 + (1 - a) * 8) * dpr;
          octx.globalAlpha = a;
          octx.beginPath();
          octx.arc(pen.x * k, pen.y * k, r, 0, Math.PI * 2);
          octx.lineWidth = 2.5 * dpr;
          octx.strokeStyle = '#ff4fd8';
          octx.stroke();
          octx.beginPath();
          octx.arc(pen.x * k, pen.y * k, 3 * dpr, 0, Math.PI * 2);
          octx.fillStyle = '#ff4fd8';
          octx.fill();
          octx.globalAlpha = 1;
          animate = true;
        }
      }

      // Rubber-band preview for shapes.
      if (live && shape) {
        octx.setTransform(k, 0, 0, k, 0, 0);
        tracePath(octx, t, shape.start.x, shape.start.y, shape.end.x, shape.end.y);
        octx.strokeStyle = c;
        octx.lineWidth = s;
        octx.lineCap = 'round';
        octx.lineJoin = 'round';
        octx.stroke();
        octx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // Cursor feedback.
      if (live && hover) {
        const hx = hover.x * k;
        const hy = hover.y * k;
        if (t === 'brush' || t === 'eraser') {
          const r = Math.max(2 * dpr, (s / 2) * k);
          octx.beginPath();
          octx.arc(hx, hy, r, 0, Math.PI * 2);
          octx.lineWidth = 3 * dpr;
          octx.strokeStyle = 'rgba(12, 8, 24, 0.55)';
          octx.stroke();
          octx.lineWidth = 1.25 * dpr;
          octx.strokeStyle = t === 'eraser' ? '#ffffff' : c.toLowerCase() === '#ffffff' ? '#ff4fd8' : '#ffffff';
          if (t === 'eraser') octx.setLineDash([4 * dpr, 3 * dpr]);
          octx.stroke();
          octx.setLineDash([]);
          if (t === 'brush') {
            octx.beginPath();
            octx.arc(hx, hy, Math.max(1.5 * dpr, Math.min(r - 2 * dpr, 3 * dpr)), 0, Math.PI * 2);
            octx.fillStyle = c;
            octx.fill();
          }
        } else {
          const arm = 9 * dpr;
          octx.lineWidth = 3 * dpr;
          octx.strokeStyle = 'rgba(12, 8, 24, 0.55)';
          const cross = () => {
            octx.beginPath();
            octx.moveTo(hx - arm, hy);
            octx.lineTo(hx + arm, hy);
            octx.moveTo(hx, hy - arm);
            octx.lineTo(hx, hy + arm);
            octx.stroke();
          };
          cross();
          octx.lineWidth = 1.25 * dpr;
          octx.strokeStyle = '#ffffff';
          cross();
          octx.beginPath();
          octx.arc(hx + 12 * dpr, hy + 12 * dpr, 5 * dpr, 0, Math.PI * 2);
          octx.fillStyle = c;
          octx.fill();
          octx.lineWidth = 1.5 * dpr;
          octx.strokeStyle = '#ffffff';
          octx.stroke();
        }
      }
      if (animate) schedule();
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(draw);
    }
    requestOverlay.current = schedule;

    const finishStroke = (e?: PointerEvent) => {
      if (stroke && e) {
        const end = round(toLogical(e));
        if (Math.hypot(end.x - stroke.last.x, end.y - stroke.last.y) >= 1) {
          const r = canvasStore.draw({ k: 'pts', pts: [end.x, end.y] });
          if (!r.ok) reject(r.reason);
        }
      }
      stroke = null;
    };

    const finishShape = (e?: PointerEvent) => {
      if (shape && e) {
        const end = round(constrain(shape.start, toLogical(e), e.shiftKey));
        const start = round(shape.start);
        const t = props.current.tool;
        if (Math.abs(end.x - start.x) + Math.abs(end.y - start.y) >= 3 && (t === 'line' || t === 'rect' || t === 'ellipse')) {
          const r = canvasStore.draw({ k: 'shape', tool: t, color: props.current.color, size: props.current.size, pts: [start.x, start.y, end.x, end.y] });
          if (!r.ok) reject(r.reason);
        }
      }
      shape = null;
      schedule();
    };

    const stop = (e?: PointerEvent) => {
      finishStroke(e);
      finishShape(e);
      if (pointerId !== null && overlay.hasPointerCapture?.(pointerId)) overlay.releasePointerCapture(pointerId);
      pointerId = null;
      canvasStore.flush();
    };
    endInput.current = () => stop();

    const onDown = (e: PointerEvent) => {
      const { canDraw: live, tool: t, color: c, size: s } = props.current;
      if (!live || pointerId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const p = toLogical(e);
      hover = p;
      if (t === 'fill') {
        const q = round(p);
        if (q.x >= 0 && q.y >= 0 && q.x < W && q.y < H) {
          const r = canvasStore.draw({ k: 'fill', color: c, pts: [q.x, q.y] });
          if (!r.ok) reject(r.reason);
          canvasStore.flush();
        }
        return;
      }
      pointerId = e.pointerId;
      overlay.setPointerCapture?.(e.pointerId);
      if (t === 'brush' || t === 'eraser') {
        const q = round(p);
        const r = canvasStore.draw({ k: 'stroke', tool: t, color: c, size: s, pts: [q.x, q.y] });
        if (!r.ok) {
          reject(r.reason);
          pointerId = null;
          return;
        }
        stroke = { last: q, smooth: { ...p } };
      } else {
        shape = { start: p, end: p };
      }
      schedule();
    };

    const onMove = (e: PointerEvent) => {
      if (!props.current.canDraw) {
        hover = null;
        return;
      }
      hover = toLogical(e);
      if (e.pointerId === pointerId) {
        if (stroke) {
          const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
          const list = samples.length > 0 ? samples : [e];
          const pts: number[] = [];
          for (const sample of list) {
            const raw = toLogical(sample);
            stroke.smooth.x += (raw.x - stroke.smooth.x) * SMOOTHING;
            stroke.smooth.y += (raw.y - stroke.smooth.y) * SMOOTHING;
            const q = round(stroke.smooth);
            if (Math.hypot(q.x - stroke.last.x, q.y - stroke.last.y) >= MIN_STEP) {
              pts.push(q.x, q.y);
              stroke.last = q;
            }
          }
          if (pts.length > 0) {
            const r = canvasStore.draw({ k: 'pts', pts });
            if (!r.ok) {
              reject(r.reason);
              stroke = null;
            }
          }
        } else if (shape) {
          shape.end = constrain(shape.start, hover, e.shiftKey);
        }
      }
      schedule();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      stop(e);
    };
    const onLeave = () => {
      if (pointerId === null) {
        hover = null;
        schedule();
      }
    };

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
    overlay.addEventListener('pointerleave', onLeave);
    const ro = new ResizeObserver(resize);
    ro.observe(frame);
    resize();
    return () => {
      stop();
      ro.disconnect();
      cancelAnimationFrame(raf);
      requestOverlay.current = () => undefined;
      endInput.current = () => undefined;
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      overlay.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Losing the pen mid-stroke (turn over) ends the stroke; tool changes refresh the cursor.
  useEffect(() => {
    if (!canDraw) endInput.current();
    requestOverlay.current();
  }, [canDraw, tool, color, size]);

  return (
    <div className="sk-canvas-wrap">
      <div className="sk-canvas-frame" ref={frameRef} data-can-draw={canDraw ? 'true' : undefined} data-tool={tool}>
        <canvas ref={mainRef} className="sk-canvas" role="img" aria-label={label} />
        <canvas ref={overlayRef} className="sk-canvas-overlay" aria-hidden="true" data-testid="sketch-surface" />
        {children}
      </div>
    </div>
  );
}
