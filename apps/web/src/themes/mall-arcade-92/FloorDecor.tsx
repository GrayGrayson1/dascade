/**
 * Mall Arcade '92 floor props: the token changer and a velvet rope on the left, the prize counter
 * with its ticket dispenser on the right. Original SVG drawings; they sit in the floor's decor slot
 * (over the backdrop, under the carousel) and only appear where the floor has room for them.
 * Also defines the wood-grain laminate pattern the skin CSS paints onto the cabinet sides.
 */
import type { SkinRenderContext } from '../types.ts';
import { WOODGRAIN, useDocVisible } from './art.ts';

const woodHref = WOODGRAIN.slice(5, -2); // url("…") → …

function TokenMachine() {
  return (
    <svg className="ma-prop__svg" viewBox="0 0 120 250" aria-hidden focusable="false">
      <defs>
        <linearGradient id="ma-tm-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2c2a38" />
          <stop offset=".5" stopColor="#4a4758" />
          <stop offset="1" stopColor="#23212e" />
        </linearGradient>
        <linearGradient id="ma-tm-sign" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset="1" stopColor="#ffb31a" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="246" rx="58" ry="5" fill="#000" opacity=".55" />
      <rect x="10" y="20" width="100" height="224" rx="4" fill="url(#ma-tm-body)" />
      <rect x="10" y="20" width="100" height="224" rx="4" fill="none" stroke="#0a0812" strokeWidth="2" />
      <rect className="ma-prop__glow" x="16" y="26" width="88" height="36" rx="2" fill="url(#ma-tm-sign)" />
      <text
        x="60"
        y="51"
        textAnchor="middle"
        fontFamily="'Pixelify Sans Variable', Silkscreen, monospace"
        fontSize="19"
        fontWeight="700"
        fill="#5a1400"
      >
        TOKENS
      </text>
      <rect x="22" y="72" width="76" height="30" rx="2" fill="#0d0b14" />
      <text x="60" y="92" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="10" fill="#3fe07e">
        4 FOR $1
      </text>
      <rect x="30" y="112" width="60" height="10" rx="2" fill="#0d0b14" />
      <rect x="36" y="116" width="48" height="2" fill="#3fe07e" className="ma-prop__blink" />
      <text x="60" y="134" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="7" fill="#b8b0c8">
        INSERT BILL
      </text>
      <circle cx="40" cy="152" r="7" fill="#1a1824" stroke="#8a8698" />
      <circle cx="80" cy="152" r="7" fill="#1a1824" stroke="#8a8698" />
      <rect x="30" y="180" width="60" height="36" rx="6" fill="#0d0b14" stroke="#6d6a7c" strokeWidth="2" />
      <ellipse cx="60" cy="206" rx="14" ry="4" fill="#c9a24a" />
      <ellipse cx="55" cy="204" rx="5" ry="2" fill="#ffe08a" />
      <rect x="10" y="232" width="100" height="4" fill="#ff3b5c" opacity=".8" />
    </svg>
  );
}

function Rope() {
  return (
    <svg className="ma-prop__svg" viewBox="0 0 200 110" aria-hidden focusable="false">
      <defs>
        <linearGradient id="ma-brass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a6414" />
          <stop offset=".45" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#7a5610" />
        </linearGradient>
      </defs>
      {[20, 180].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="104" rx="16" ry="4" fill="#000" opacity=".5" />
          <ellipse cx={x} cy="100" rx="14" ry="4" fill="url(#ma-brass)" />
          <rect x={x - 3} y="20" width="6" height="80" fill="url(#ma-brass)" />
          <circle cx={x} cy="17" r="7" fill="url(#ma-brass)" />
        </g>
      ))}
      <path d="M24 28Q100 78 176 28" fill="none" stroke="#5a0a1a" strokeWidth="9" strokeLinecap="round" />
      <path d="M24 28Q100 78 176 28" fill="none" stroke="#c81e3a" strokeWidth="6" strokeLinecap="round" />
      <path d="M30 30Q100 72 170 30" fill="none" stroke="#ff7a8e" strokeWidth="1.5" opacity=".6" />
    </svg>
  );
}

function PrizeCounter() {
  const prizes: Array<[number, number, string, 'bear' | 'ball' | 'duck' | 'star' | 'ring']> = [
    [34, 54, '#ff7ab6', 'bear'],
    [72, 58, '#ffcc33', 'duck'],
    [106, 56, '#4d8dff', 'ball'],
    [140, 54, '#b77bff', 'bear'],
    [178, 58, '#3fe07e', 'ring'],
    [214, 56, '#ff8c2e', 'star'],
    [50, 96, '#3fd4ff', 'ball'],
    [86, 96, '#ff3b5c', 'star'],
    [124, 94, '#fff7ea', 'duck'],
    [162, 96, '#ffcc33', 'ring'],
    [200, 94, '#ff7ab6', 'ball'],
  ];
  return (
    <svg className="ma-prop__svg" viewBox="0 0 250 200" aria-hidden focusable="false">
      <defs>
        <pattern id="ma-counter-wood" patternUnits="userSpaceOnUse" width="240" height="160">
          <image href={woodHref} width="240" height="160" />
        </pattern>
        <linearGradient id="ma-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bfe6ff" stopOpacity=".22" />
          <stop offset=".4" stopColor="#bfe6ff" stopOpacity=".05" />
          <stop offset="1" stopColor="#bfe6ff" stopOpacity=".14" />
        </linearGradient>
      </defs>
      <ellipse cx="125" cy="196" rx="124" ry="5" fill="#000" opacity=".55" />
      {/* glass case */}
      <rect x="6" y="24" width="238" height="96" fill="#0f0b1c" />
      <rect x="6" y="24" width="238" height="3" fill="#f4fbff" className="ma-prop__glow" />
      <rect x="6" y="74" width="238" height="3" fill="#6d6a7c" />
      {prizes.map(([x, y, c, kind], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          {kind === 'bear' ? (
            <g fill={c}>
              <circle cx="-7" cy="-17" r="5" />
              <circle cx="7" cy="-17" r="5" />
              <circle cy="-10" r="9" />
              <ellipse cy="6" rx="11" ry="12" />
              <circle cx="-3" cy="-11" r="1.4" fill="#1a0a14" />
              <circle cx="3" cy="-11" r="1.4" fill="#1a0a14" />
            </g>
          ) : kind === 'duck' ? (
            <g fill={c}>
              <ellipse cy="6" rx="12" ry="9" />
              <circle cx="-4" cy="-7" r="7" />
              <path d="M-12 -8l-6 2 6 2z" fill="#ff8c2e" />
            </g>
          ) : kind === 'ball' ? (
            <g>
              <circle cy="4" r="11" fill={c} />
              <path d="M-11 4h22" stroke="#fff" strokeWidth="2" opacity=".7" />
              <circle cx="-4" cy="-1" r="3" fill="#fff" opacity=".6" />
            </g>
          ) : kind === 'star' ? (
            <path d="M0 -12l3.5 8 8.5.8-6.4 5.6 2 8.4L0 6.4-7.6 10.8l2-8.4-6.4-5.6 8.5-.8z" fill={c} />
          ) : (
            <circle cy="4" r="9" fill="none" stroke={c} strokeWidth="4" />
          )}
        </g>
      ))}
      <rect x="6" y="24" width="238" height="96" fill="url(#ma-glass)" />
      <path d="M20 30L60 30L30 116L10 116Z" fill="#fff" opacity=".06" />
      <rect x="6" y="24" width="238" height="96" fill="none" stroke="#b8b0c8" strokeWidth="2" />
      {/* counter top + laminate front */}
      <rect x="0" y="118" width="250" height="10" fill="#d8d2e4" />
      <rect x="0" y="118" width="250" height="3" fill="#fff" />
      <rect x="4" y="128" width="242" height="66" fill="url(#ma-counter-wood)" />
      <rect x="4" y="128" width="242" height="66" fill="#000" opacity=".25" />
      <rect x="60" y="140" width="130" height="30" rx="3" fill="#0d0b14" stroke="#ffcc33" strokeWidth="2" />
      <text x="125" y="160" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="11" fill="#ffcc33" letterSpacing="1">
        REDEEM TICKETS
      </text>
      <rect x="4" y="186" width="242" height="8" fill="#150d26" />
    </svg>
  );
}

function TicketDispenser() {
  return (
    <svg className="ma-prop__svg" viewBox="0 0 70 210" aria-hidden focusable="false">
      <ellipse cx="35" cy="206" rx="32" ry="4" fill="#000" opacity=".5" />
      <rect x="8" y="10" width="54" height="194" rx="4" fill="#2b1d45" stroke="#0a0612" strokeWidth="2" />
      <rect x="12" y="16" width="46" height="30" rx="2" fill="#ff3b5c" className="ma-prop__glow" />
      <text x="35" y="36" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="9" fill="#fff">
        TICKETS
      </text>
      <rect x="16" y="56" width="38" height="18" rx="2" fill="#0d0b14" />
      <text
        x="35"
        y="69"
        textAnchor="middle"
        fontFamily="'Space Grotesk Variable', sans-serif"
        fontSize="12"
        fontWeight="700"
        fill="#ff8c2e"
      >
        0250
      </text>
      <rect x="18" y="86" width="34" height="5" rx="1" fill="#0d0b14" />
      {/* a strip of tickets spilling out */}
      <path
        d="M24 90h22v14h-22zM22 104h24l4 14h-24zM26 118h24l-2 14h-24zM24 132h24l6 13h-24zM30 145h24l-4 13h-24zM26 158h24l2 13h-24z"
        fill="#ffb347"
        stroke="#c26a12"
        strokeWidth="1"
      />
      <path d="M26 97h18M25 111h18M29 125h18M29 139h18M32 152h18M29 165h18" stroke="#c26a12" strokeWidth=".8" strokeDasharray="2 2" />
    </svg>
  );
}

export function MallFloorDecor({ fx, reducedMotion }: SkinRenderContext) {
  const visible = useDocVisible();
  const animate = fx === 'high' && !reducedMotion && visible;
  return (
    <div className="ma-decor" data-fx={fx} data-animate={animate ? 'true' : undefined}>
      <svg className="ma-defs" width="0" height="0" aria-hidden focusable="false">
        <defs>
          <pattern id="ma-wood" patternUnits="userSpaceOnUse" width="240" height="160" patternTransform="rotate(90) scale(.9)">
            <image href={woodHref} width="240" height="160" />
          </pattern>
        </defs>
      </svg>
      <div className="ma-prop ma-prop--tokens">
        <TokenMachine />
      </div>
      <div className="ma-prop ma-prop--rope">
        <Rope />
      </div>
      <div className="ma-prop ma-prop--counter">
        <PrizeCounter />
      </div>
      <div className="ma-prop ma-prop--tickets">
        <TicketDispenser />
      </div>
    </div>
  );
}
