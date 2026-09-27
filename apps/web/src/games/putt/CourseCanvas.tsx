/**
 * Hosts the course canvas: creates the renderer, feeds it the layout insets (so HUD chrome
 * never covers the hole), routes pointer + keyboard input to the controller, and tears
 * everything down on unmount.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PuttPublicState } from '@dascade/shared/games/putt';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import type { PuttController } from './game/controller.ts';
import { ensureFonts } from './game/palette.ts';
import { PuttRenderer } from './game/renderer.ts';
import type { Insets } from './game/camera.ts';
import { currentHole } from './helpers.ts';

declare global {
  interface Window {
    __PUTT__?: { renderer: PuttRenderer; controller: PuttController };
  }
}

export function CourseCanvas({ ctrl, insets }: { ctrl: PuttController; insets: Insets[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PuttRenderer | null>(null);
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const fx = useApp((s) => s.settings.fx);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const [fontsReady, setFontsReady] = useState(false);
  const label = useRoomSelector<PuttPublicState, string>((s) => {
    const h = currentHole(s);
    return h ? `Mini golf course — hole ${h.number}, ${h.name}, par ${h.par}. ${h.tip}` : 'Mini golf course';
  });

  useEffect(() => {
    let alive = true;
    void ensureFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !fontsReady) return;
    let renderer: PuttRenderer;
    try {
      renderer = new PuttRenderer(canvas, ctrl, { fx, reducedMotion });
    } catch {
      return;
    }
    rendererRef.current = renderer;
    const dprCap = fx === 'high' ? 2 : fx === 'low' ? 1.5 : 1;
    const resize = () => {
      const dpr = Math.max(1, Math.min(dprCap, window.devicePixelRatio || 1));
      renderer.resize(wrap.clientWidth, wrap.clientHeight, dpr, insetsRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    renderer.start();
    window.addEventListener('keydown', ctrl.onKeyDown);
    window.__PUTT__ = { renderer, controller: ctrl };
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', ctrl.onKeyDown);
      renderer.destroy();
      rendererRef.current = null;
      if (window.__PUTT__?.renderer === renderer) delete window.__PUTT__;
    };
  }, [ctrl, fx, reducedMotion, fontsReady]);

  // Re-fit when the HUD chrome changes size.
  const insetKey = insets.map((i) => `${i.top},${i.right},${i.bottom},${i.left}`).join('|');
  useEffect(() => {
    const r = rendererRef.current;
    const wrap = wrapRef.current;
    if (!r || !wrap) return;
    const dprCap = fx === 'high' ? 2 : fx === 'low' ? 1.5 : 1;
    r.resize(wrap.clientWidth, wrap.clientHeight, Math.max(1, Math.min(dprCap, window.devicePixelRatio || 1)), insetsRef.current);
  }, [insetKey, fx]);

  const local = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="pt-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label ?? 'Mini golf course'}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const p = local(e);
          if (ctrl.pointerDown(e.pointerId, p.x, p.y)) {
            try {
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
              // Pointer already gone (or synthetic): the drag still works without capture.
            }
            e.preventDefault();
          }
        }}
        onPointerMove={(e) => {
          const p = local(e);
          ctrl.pointerMove(e.pointerId, p.x, p.y);
        }}
        onPointerUp={(e) => {
          ctrl.pointerUp(e.pointerId);
          try {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          } catch {
            // Not captured.
          }
        }}
        onPointerCancel={() => ctrl.cancelDrag()}
        onLostPointerCapture={() => ctrl.cancelDrag()}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
