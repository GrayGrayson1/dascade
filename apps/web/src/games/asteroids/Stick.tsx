/**
 * On-screen analog stick for touch play: the ship turns towards where you push and thrusts
 * when you push hard. Writes into a ref (no React state per move). Accessible as a labelled
 * group; keyboard users have the arrow keys.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';

export interface StickState {
  active: boolean;
  /** Unit-ish direction (screen space) and magnitude 0..1. */
  x: number;
  y: number;
  mag: number;
}

export function Stick({ state, label = 'Flight stick' }: { state: MutableRefObject<StickState>; label?: string }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = baseRef.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    let id: number | null = null;
    const update = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > max) {
        dx = (dx / d) * max;
        dy = (dy / d) * max;
      }
      const mag = Math.min(1, d / max);
      state.current = { active: mag > 0.18, x: d > 0 ? dx / Math.max(1, Math.min(d, max)) : 0, y: d > 0 ? dy / Math.max(1, Math.min(d, max)) : 0, mag };
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      update(e);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === id) update(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      state.current = { active: false, x: 0, y: 0, mag: 0 };
      knob.style.transform = '';
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      state.current = { active: false, x: 0, y: 0, mag: 0 };
    };
  }, [state]);
  return (
    <div ref={baseRef} className="as-stick" role="group" aria-label={label}>
      <span className="as-stick__ring" aria-hidden />
      <span ref={knobRef} className="as-stick__knob" aria-hidden />
    </div>
  );
}
