/**
 * The kiosk's section tabs with a visible scroll affordance. On phones the strip can be wider than
 * the screen: the clipped edge then fades out behind a chevron button that pages the strip, and the
 * selected tab is always scrolled into view. Keyboard users keep the tablist's arrow-key navigation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelIcon, Tabs, cx, type TabsProps } from '@dascade/ui';
import { useApp } from '../../app/store.ts';

export function ScrollTabs<T extends string>({ className, ...props }: TabsProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const [edges, setEdges] = useState({ left: false, right: false });
  const list = () => wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]') ?? null;

  const update = useCallback(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  const count = props.tabs.length;
  useEffect(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Watch the tabs too: their widths change without the strip resizing (web font load, counts).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    for (const tab of el.children) ro?.observe(tab);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [update, count]);

  // Keep the selected tab fully visible (clear of the chevrons).
  useEffect(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const box = el.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    const pad = 44;
    if (r.left < box.left + pad || r.right > box.right - pad) {
      el.scrollTo({ left: el.scrollLeft + (r.left - box.left) - (box.width - r.width) / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [props.value, count, reducedMotion]);

  const page = (dir: -1 | 1) => {
    const el = list();
    el?.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <div ref={wrapRef} className={cx('tk-tabbar', edges.left && 'has-left', edges.right && 'has-right', className)}>
      <Tabs {...props} className="tk-tabbar__list" />
      {/* Pointer shortcuts only: the tabs themselves stay reachable with Tab + arrow keys. */}
      {edges.left ? (
        <button
          type="button"
          className="tk-tabbar__more tk-tabbar__more--left"
          tabIndex={-1}
          aria-label="Scroll sections left"
          onClick={() => page(-1)}
        >
          <PixelIcon name="chevron-down" />
        </button>
      ) : null}
      {edges.right ? (
        <button
          type="button"
          className="tk-tabbar__more tk-tabbar__more--right"
          tabIndex={-1}
          aria-label="Scroll sections right"
          onClick={() => page(1)}
        >
          <PixelIcon name="chevron-down" />
        </button>
      ) : null}
    </div>
  );
}
