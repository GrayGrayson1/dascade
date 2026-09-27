/**
 * The single theme-transition overlay (rendered by ThemeHost). Pure CSS animation driven by the
 * switcher's phase; styles live in host.css (`.theme-xfade[data-style=…]`). Never intercepts input.
 */
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { getTheme } from '@dascade/ui';
import { useThemeTransition } from './controller.ts';

const SLATS = [0, 1, 2, 3, 4, 5];

export function ThemeTransition() {
  const t = useThemeTransition();
  if (t.phase === 'idle' || !t.target) return null;
  return <Overlay key={t.run} />;
}

/**
 * The overlay is a manual popover so it sits in the top layer ABOVE open <dialog>s (Settings, the
 * picker) — the whole screen power-cycles, not just the page behind the dialog. Falls back to a plain
 * fixed layer (z-index 10000) where the Popover API is missing.
 */
function Overlay() {
  const t = useThemeTransition();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      el.showPopover();
    } catch {
      return; // not connected / unsupported: the fixed-position fallback still covers the page
    }
    return () => {
      try {
        el.hidePopover?.();
      } catch {
        /* already hidden */
      }
    };
  }, []);
  if (!t.target) return null;
  const sw = getTheme(t.target).meta.swatches;
  const style = {
    '--xf-cover': `${t.coverMs}ms`,
    '--xf-reveal': `${t.revealMs}ms`,
    '--xf-a': sw[0],
    '--xf-b': sw[1],
    '--xf-c': sw[2],
    '--xf-d': sw[3],
  } as CSSProperties;
  const slats = t.style === 'shutter' || t.style === 'wipe' || t.style === 'tracking';
  return (
    <div
      ref={ref}
      popover="manual"
      className="theme-xfade"
      data-part="theme-transition"
      data-style={t.style}
      data-phase={t.phase === 'covered' ? 'cover' : t.phase}
      style={style}
      aria-hidden
    >
      <i className="theme-xfade__p theme-xfade__p--t" />
      <i className="theme-xfade__p theme-xfade__p--b" />
      <i className="theme-xfade__p theme-xfade__p--l" />
      <i className="theme-xfade__p theme-xfade__p--r" />
      <i className="theme-xfade__glow" />
      {slats ? SLATS.map((i) => <i key={i} className="theme-xfade__slat" style={{ '--i': i } as CSSProperties} />) : null}
    </div>
  );
}
