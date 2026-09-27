/**
 * Floor extras: the bulb-lit "DASCADE FUN PACK" casino sign above the cabinet row and velvet ropes
 * on brass stanchions along the carpet. Decorative only (the host renders it aria-hidden,
 * pointer-events none, under the carousel).
 */
import type { SkinRenderContext } from '../types.ts';
import { usePageVisible } from './usePageVisible.ts';

function Rope({ side }: { side: 'l' | 'r' }) {
  return (
    <svg className={`sw-rope sw-rope--${side}`} viewBox="0 0 260 90" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sw-post-${side}`} x1="0" x2="1">
          <stop offset="0" stopColor="#6e4f14" />
          <stop offset="0.35" stopColor="#fff0b8" />
          <stop offset="0.6" stopColor="#c9a24a" />
          <stop offset="1" stopColor="#5a3f0c" />
        </linearGradient>
        <linearGradient id={`sw-velvet-${side}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2334a" />
          <stop offset="0.5" stopColor="#9c1026" />
          <stop offset="1" stopColor="#4d0612" />
        </linearGradient>
      </defs>
      {/* ropes (swags) */}
      <path d="M22 26 Q72 70 130 26" fill="none" stroke={`url(#sw-velvet-${side})`} strokeWidth="9" strokeLinecap="round" />
      <path d="M130 26 Q186 70 238 26" fill="none" stroke={`url(#sw-velvet-${side})`} strokeWidth="9" strokeLinecap="round" />
      <path d="M26 24 Q72 62 126 25" fill="none" stroke="#ff8a9a" strokeOpacity="0.45" strokeWidth="2" />
      <path d="M134 25 Q186 62 234 24" fill="none" stroke="#ff8a9a" strokeOpacity="0.45" strokeWidth="2" />
      {[22, 130, 238].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="86" rx="15" ry="4" fill="#000" opacity="0.45" />
          <rect x={x - 12} y="78" width="24" height="7" rx="2" fill={`url(#sw-post-${side})`} />
          <rect x={x - 3.5} y="22" width="7" height="58" fill={`url(#sw-post-${side})`} />
          <circle cx={x} cy="18" r="8" fill={`url(#sw-post-${side})`} />
          <circle cx={x - 2.5} cy="15.5" r="2.4" fill="#fff8d8" opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

export function FloorDecor({ fx, reducedMotion }: SkinRenderContext) {
  const visible = usePageVisible();
  const animate = visible && !reducedMotion && fx !== 'off';
  return (
    <div className="sw-floor" data-animate={animate ? 'on' : 'off'} data-fx={fx}>
      <div className="sw-sign">
        <i className="sw-sign__bulbs" />
        <span className="sw-sign__plate">
          <span className="sw-sign__word">DASCADE</span>
          <span className="sw-sign__sub">Fun Pack v3.7 · Registered Version</span>
        </span>
      </div>
      <Rope side="l" />
      <Rope side="r" />
    </div>
  );
}
