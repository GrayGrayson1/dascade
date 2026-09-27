/** DAS Ships client helpers: layout measurement, media queries, derived game info. */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useApp } from '../../app/store.ts';

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Element content size (px), tracked with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export type ArenaMode = 'row' | 'column' | 'single';

/**
 * Pick the arrangement that gives the boards the most room: side by side, stacked, or one at a
 * time (phones in portrait — the player switches with tabs). `chrome` = px each board panel needs
 * besides its sea (title strip, coordinates, fleet strip).
 */
export function arenaLayout(
  w: number,
  h: number,
  chrome: { x: number; y: number },
  opts: { max: number; gap: number; tabsH: number },
): { mode: ArenaMode; sea: number } {
  if (w <= 0 || h <= 0) return { mode: 'single', sea: 0 };
  const fit = (availW: number, availH: number) => Math.max(0, Math.floor(Math.min(availW - chrome.x, availH - chrome.y, opts.max)));
  const row = fit((w - opts.gap) / 2, h);
  const column = fit(w, (h - opts.gap) / 2);
  const single = fit(w, h - opts.tabsH);
  const both = Math.max(row, column);
  if (both >= 250 || both >= single * 0.72) return { mode: row >= column ? 'row' : 'column', sea: both };
  return { mode: 'single', sea: single };
}

/** Glow strength from the visual-effects setting. */
export function useGlow(): number {
  const fx = useApp((s) => s.settings.fx);
  return fx === 'off' ? 0 : fx === 'low' ? 0.6 : 1;
}

export function useReducedMotion(): boolean {
  return useApp((s) => s.settings.reducedMotion);
}

/** Coarse pointer (touch): aim with the first tap, fire with the second. */
export function useCoarsePointer(): boolean {
  return useMedia('(pointer: coarse)');
}

/** Layout viewport size (tracks resizes / rotation). */
export function useViewportSize(): { w: number; h: number } {
  const read = () => ({ w: document.documentElement.clientWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () =>
      setSize((s) => {
        const n = read();
        return s.w === n.w && s.h === n.h ? s : n;
      });
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);
  return size;
}
