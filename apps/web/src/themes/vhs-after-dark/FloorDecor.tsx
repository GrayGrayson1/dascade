/**
 * VHS After Dark floor props: a CRT on a rolling AV cart with the VCR underneath (its screen is a
 * decorative one, so it may roll a tracking bar now and then), and the after-hours returns bin with a
 * stack of tapes waiting to be rewound. Original SVG; only where the floor has room.
 */
import type { SkinRenderContext } from '../types.ts';
import { useDocVisible } from './art.ts';

function TvCart() {
  return (
    <svg className="vh-prop__svg" viewBox="0 0 180 250" aria-hidden focusable="false">
      <defs>
        <radialGradient id="vh-crt" cx=".5" cy=".45" r=".7">
          <stop offset="0" stopColor="#3a62ff" />
          <stop offset=".7" stopColor="#1b2fb8" />
          <stop offset="1" stopColor="#0a1250" />
        </radialGradient>
        <linearGradient id="vh-case" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2e36" />
          <stop offset="1" stopColor="#15161b" />
        </linearGradient>
      </defs>
      <ellipse cx="90" cy="246" rx="84" ry="5" fill="#000" opacity=".6" />
      {/* cart */}
      <rect x="14" y="128" width="152" height="8" fill="#3a3d48" />
      <rect x="14" y="196" width="152" height="8" fill="#3a3d48" />
      <rect x="20" y="136" width="5" height="100" fill="#2a2c35" />
      <rect x="155" y="136" width="5" height="100" fill="#2a2c35" />
      <circle cx="24" cy="240" r="6" fill="#0c0d11" />
      <circle cx="156" cy="240" r="6" fill="#0c0d11" />
      {/* TV */}
      <rect x="24" y="16" width="132" height="112" rx="10" fill="url(#vh-case)" />
      <rect x="34" y="24" width="96" height="78" rx="12" fill="#07080c" />
      <rect className="vh-prop__screen" x="38" y="28" width="88" height="70" rx="10" fill="url(#vh-crt)" />
      <text x="46" y="46" fontFamily="Silkscreen, monospace" fontSize="10" fill="#fff">
        {'PLAY \u25B6\uFE0E'}
      </text>
      <text x="46" y="90" fontFamily="Silkscreen, monospace" fontSize="7" fill="#dfe6ff">
        SP 0:00:00
      </text>
      <rect className="vh-prop__track" x="38" y="60" width="88" height="6" fill="#fff" opacity="0" />
      <path d="M44 32Q60 30 70 31" stroke="#fff" strokeWidth="2" opacity=".25" fill="none" />
      <circle cx="143" cy="40" r="5" fill="#1b1c22" stroke="#4a4d58" />
      <circle cx="143" cy="58" r="5" fill="#1b1c22" stroke="#4a4d58" />
      <rect x="138" y="76" width="10" height="3" fill="#4a4d58" />
      <rect x="138" y="82" width="10" height="3" fill="#4a4d58" />
      <circle className="vh-prop__led" cx="143" cy="112" r="2" fill="#ff3b3b" />
      {/* VCR */}
      <rect x="30" y="150" width="120" height="30" rx="3" fill="#1a1b21" />
      <rect x="40" y="158" width="58" height="6" rx="1" fill="#07080b" />
      <rect x="106" y="156" width="36" height="14" rx="1" fill="#061108" />
      <text
        x="124"
        y="167"
        textAnchor="middle"
        fontFamily="'Space Grotesk Variable', sans-serif"
        fontWeight="700"
        fontSize="10"
        fill="#5fe39a"
        className="vh-prop__blink"
      >
        12:00
      </text>
      <rect x="40" y="170" width="8" height="4" fill="#3a3d48" />
      <rect x="52" y="170" width="8" height="4" fill="#3a3d48" />
      <rect x="64" y="170" width="8" height="4" fill="#3a3d48" />
      <circle cx="80" cy="172" r="2" fill="#ff3b3b" />
      {/* tapes on the bottom shelf */}
      <rect x="34" y="210" width="44" height="22" fill="#16171d" />
      <rect x="38" y="214" width="36" height="8" fill="#f1e8d0" />
      <rect x="82" y="210" width="44" height="22" fill="#16171d" transform="rotate(-4 104 221)" />
      <rect x="86" y="213" width="36" height="8" fill="#ff5c9d" transform="rotate(-4 104 221)" />
    </svg>
  );
}

function ReturnsBin() {
  return (
    <svg className="vh-prop__svg" viewBox="0 0 170 200" aria-hidden focusable="false">
      <ellipse cx="85" cy="196" rx="80" ry="5" fill="#000" opacity=".6" />
      <rect x="20" y="48" width="130" height="146" rx="6" fill="#1c2a5a" />
      <rect x="20" y="48" width="130" height="146" rx="6" fill="none" stroke="#0a1030" strokeWidth="3" />
      <path d="M14 48Q85 10 156 48Z" fill="#23346e" stroke="#0a1030" strokeWidth="3" />
      <rect x="44" y="64" width="82" height="12" rx="3" fill="#05070f" />
      <rect x="36" y="92" width="98" height="34" rx="2" fill="#f1e8d0" />
      <text x="85" y="113" textAnchor="middle" fontFamily="Kalam, 'Comic Sans MS', cursive" fontWeight="700" fontSize="17" fill="#c8303a">
        Returns
      </text>
      <text x="85" y="146" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="8" fill="#b8c2e6">
        PLEASE REWIND
      </text>
      {/* a little stack of tapes waiting */}
      <g transform="translate(96 164)">
        <rect x="0" y="12" width="52" height="12" fill="#15161c" />
        <rect x="4" y="15" width="30" height="5" fill="#e9e2cd" />
        <rect x="-4" y="0" width="52" height="12" fill="#1c1d24" transform="rotate(-6 22 6)" />
        <rect x="0" y="3" width="30" height="5" fill="#ffd452" transform="rotate(-6 22 6)" />
      </g>
    </svg>
  );
}

export function VhsFloorDecor({ fx, reducedMotion }: SkinRenderContext) {
  const visible = useDocVisible();
  const animate = fx === 'high' && !reducedMotion && visible;
  return (
    <div className="vh-decor" data-fx={fx} data-animate={animate ? 'true' : undefined}>
      <div className="vh-prop vh-prop--tv">
        <TvCart />
      </div>
      <div className="vh-prop vh-prop--returns">
        <ReturnsBin />
      </div>
    </div>
  );
}
