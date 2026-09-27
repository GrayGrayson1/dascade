/**
 * Basement LAN floor decor: the stations stand on a run of Ethernet and power cables, with a
 * power strip, a soda can and a stack of pizza boxes at the edges. Lined up with the centred
 * cabinet's base (re-measured on resize), drawn once as SVG; nothing animates except the strip's
 * lit switch (static glow). Pointer-events none, aria-hidden (the host slot handles both).
 */
import { useEffect, useState } from 'react';
import type { SkinRenderContext } from '../types.ts';

function measureBase(): number | null {
  const body = document.querySelector<HTMLElement>(".af-slot[data-active='true'] .af-cab__body");
  const floor = document.querySelector<HTMLElement>('.af-floor');
  if (!body || !floor) return null;
  const r = body.getBoundingClientRect();
  const f = floor.getBoundingClientRect();
  if (r.height < 40) return null;
  return r.bottom - f.top + floor.scrollTop;
}

export default function LanFloorDecor(_ctx: SkinRenderContext) {
  const [base, setBase] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setBase(measureBase());
    const timers = [60, 400, 1200].map((ms) => window.setTimeout(update, ms));
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(update, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  if (base === null) return null;
  return (
    <svg className="lp-floor" style={{ top: base - 26 }} viewBox="0 0 1600 70" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <path d="M-10 30 C 200 52, 360 18, 560 36 S 900 58, 1100 34 S 1420 20, 1610 42" fill="none" stroke="#1f3f66" strokeWidth="4" strokeLinecap="round" />
      <path d="M-10 44 C 180 30, 420 60, 640 44 S 980 26, 1200 48 S 1480 56, 1610 36" fill="none" stroke="#5c5226" strokeWidth="4" strokeLinecap="round" />
      <path d="M-10 52 C 260 60, 520 40, 760 54 S 1180 62, 1610 52" fill="none" stroke="#26231d" strokeWidth="6" strokeLinecap="round" />
      <g transform="translate(250 40)">
        <rect width="120" height="16" rx="3" fill="#cfc6ad" />
        {[12, 32, 52, 72].map((x) => (
          <rect key={x} x={x} y="5" width="11" height="7" rx="1.5" fill="#6d6655" />
        ))}
        <rect x="96" y="3" width="14" height="10" rx="2" fill="#ff5a4a" className="lp-strip" />
      </g>
      <g transform="translate(1290 30)">
        <rect width="14" height="22" rx="3" fill="#c8302a" />
        <rect width="14" height="3" rx="1" fill="#cfcfcf" />
      </g>
      <g transform="translate(1400 34)">
        <rect width="150" height="14" fill="#9c8260" />
        <rect x="6" y="-14" width="140" height="14" fill="#b39468" />
      </g>
    </svg>
  );
}
