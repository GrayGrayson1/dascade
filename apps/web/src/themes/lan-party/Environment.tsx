/**
 * Basement LAN Party environment: the lights are off, the room is lit by CRTs.
 *
 * One static SVG (wood paneling, a high window, taped posters, a string of warm lights, a shelf with
 * a cheap 8-port switch, a folding table of beige PCs and glowing monitors, cables, pizza boxes and
 * soda cans) plus a handful of CSS opacity animations: monitor glow breathing, switch link lights
 * blinking, the light string twinkling. In a room the switch lights one port per connected player,
 * so a new computer joining the LAN literally lights up.
 *
 *  - fx high: every animation. fx low: switch + glow only, slower. fx off / reduced motion: still.
 *  - Paused while the tab is hidden; calm (dim, still) when place === 'game'.
 * Pure SVG/CSS: no canvas, no loop, nothing allocated per frame.
 */
import { memo, useEffect, useState } from 'react';
import type { BaseRoomView } from '@dascade/shared';
import { useRoomSelector } from '../../net/hooks.ts';
import type { SkinRenderContext } from '../types.ts';

const PORTS = 8;

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

const connectedCount = (s: BaseRoomView) => {
  let n = 0;
  for (const p of Object.values(s.players ?? {})) if (p.connected && !p.spectator) n++;
  return n;
};

export default function LanEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const hidden = useHidden();
  const players = useRoomSelector(connectedCount);
  const motion = reducedMotion || fx === 'off' || place === 'game' ? 'still' : fx === 'low' ? 'low' : 'full';
  // Outside a room the switch shows a busy party (6 of 8 ports lit); in a room, one per player.
  const lit = players === null ? 6 : Math.max(1, Math.min(PORTS, players));
  return (
    <div className="lp-env" data-motion={motion} data-place={place} data-paused={hidden ? 'true' : undefined}>
      <Scene lit={lit} />
      <div className="lp-env__shade" />
    </div>
  );
}

const Scene = memo(function Scene({ lit }: { lit: number }) {
  return (
    <svg className="lp-env__svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id="lp-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d0b09" />
          <stop offset="0.55" stopColor="#15110c" />
          <stop offset="1" stopColor="#0c0a07" />
        </linearGradient>
        <pattern id="lp-panel" width="46" height="900" patternUnits="userSpaceOnUse">
          <rect width="46" height="900" fill="#1c150e" />
          <rect x="0" width="2" height="900" fill="#0b0806" />
          <rect x="14" width="1" height="900" fill="#221a11" opacity="0.8" />
          <rect x="31" width="1" height="900" fill="#171109" opacity="0.8" />
        </pattern>
        <pattern id="lp-block" width="120" height="48" patternUnits="userSpaceOnUse">
          <rect width="120" height="48" fill="#121110" />
          <path d="M0 0H120M0 24H120M30 0V24M90 0V24M0 24V48M60 24V48" stroke="#0a0908" strokeWidth="2" />
        </pattern>
        <linearGradient id="lp-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15120e" />
          <stop offset="1" stopColor="#0a0806" />
        </linearGradient>
        <linearGradient id="lp-moon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#35527a" />
          <stop offset="1" stopColor="#1a2a44" />
        </linearGradient>
        <linearGradient id="lp-beam" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#8fb4ff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#8fb4ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lp-glow-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#63f07e" stopOpacity="0.32" />
          <stop offset="1" stopColor="#63f07e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-glow-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#6fa8ff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#6fa8ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-glow-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffa94d" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffa94d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-glow-w" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffd9a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lp-beige" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8f866e" />
          <stop offset="1" stopColor="#5d5645" />
        </linearGradient>
        <linearGradient id="lp-table" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a453b" />
          <stop offset="1" stopColor="#2c2923" />
        </linearGradient>
      </defs>

      {/* Walls: painted block up top, wood paneling below. */}
      <rect width="1600" height="900" fill="url(#lp-wall)" />
      <rect y="40" width="1600" height="220" fill="url(#lp-block)" opacity="0.7" />
      <rect y="260" width="1600" height="500" fill="url(#lp-panel)" opacity="0.75" />
      <rect y="256" width="1600" height="8" fill="#261c12" />
      {/* Ceiling joists. */}
      <rect width="1600" height="44" fill="#080706" />
      {[80, 420, 760, 1100, 1440].map((x) => (
        <rect key={x} x={x} y="0" width="60" height="58" fill="#0d0b08" />
      ))}

      {/* High basement window with moonlight. */}
      <g className="lp-window">
        <polygon points="120,150 330,150 520,760 20,760" fill="url(#lp-beam)" />
        <rect x="112" y="78" width="226" height="84" rx="3" fill="#2a2620" />
        <rect x="122" y="86" width="98" height="68" fill="url(#lp-moon)" />
        <rect x="230" y="86" width="98" height="68" fill="url(#lp-moon)" />
        <circle cx="292" cy="106" r="9" fill="#dfe8ff" opacity="0.7" />
      </g>

      {/* String of warm lights along the joist. */}
      <path d="M40 74 Q 260 118 480 78 T 920 80 T 1360 78 T 1600 84" fill="none" stroke="#2a2418" strokeWidth="2" />
      <g className="lp-bulbs">
        {BULBS.map(([x, y, c], i) => (
          <g key={i} className="lp-bulb" style={{ animationDelay: `${(i * 0.37) % 3}s` }}>
            <circle cx={x} cy={y + 8} r="16" fill="url(#lp-glow-w)" />
            <ellipse cx={x} cy={y + 6} rx="4" ry="6" fill={c} />
          </g>
        ))}
      </g>

      {/* Posters (original art), taped slightly crooked. */}
      <g transform="translate(1210 150) rotate(3)">
        <rect width="150" height="206" fill="#0f1b3a" />
        <circle cx="100" cy="70" r="40" fill="#e0703a" />
        <ellipse cx="100" cy="70" rx="64" ry="12" fill="none" stroke="#f3c07a" strokeWidth="3" />
        <circle cx="30" cy="30" r="2" fill="#fff" />
        <circle cx="54" cy="130" r="1.5" fill="#fff" />
        <circle cx="128" cy="150" r="2" fill="#fff" />
        <path d="M30 150 l20 -12 l20 12 l-20 -4z" fill="#9fd0ff" />
        <rect x="14" y="166" width="122" height="26" fill="#f3c07a" />
        <text x="75" y="185" textAnchor="middle" fontFamily="'LAN VT323', monospace" fontSize="22" fill="#1a1206">
          ORBIT 2K
        </text>
        <rect x="-6" y="-6" width="26" height="12" fill="#e8dfc4" opacity="0.55" transform="rotate(-20)" />
        <rect x="136" y="-2" width="26" height="12" fill="#e8dfc4" opacity="0.55" transform="rotate(18 136 -2)" />
      </g>
      <g transform="translate(372 176) rotate(-4)">
        <rect width="132" height="176" fill="#e9e0c6" />
        <rect x="10" y="10" width="112" height="100" fill="#1f3b24" />
        <path d="M22 30h22v20h22M22 70h22v-20M66 40h22v40h22M22 90h22v-20M88 80v0" fill="none" stroke="#63f07e" strokeWidth="3" />
        <text x="66" y="136" textAnchor="middle" fontFamily="'LAN VT323', monospace" fontSize="24" fill="#231d12">
          LAN NIGHT
        </text>
        <text x="66" y="160" textAnchor="middle" fontFamily="'LAN VT323', monospace" fontSize="16" fill="#5a5040">
          BYOC · SAT 8PM
        </text>
        <rect x="52" y="-6" width="28" height="12" fill="#f4eed8" opacity="0.6" />
      </g>

      {/* Shelf with the cheap 8-port switch + cable bundle. */}
      <g className="lp-switch">
        <rect x="700" y="236" width="260" height="10" fill="#3a2c1c" />
        <rect x="712" y="200" width="232" height="36" rx="3" fill="#6b6556" />
        <rect x="712" y="200" width="232" height="6" rx="2" fill="#8a8370" />
        <rect x="724" y="212" width="40" height="14" fill="#2a2721" />
        <text x="744" y="223" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="8" fill="#b9b19a">
          8 PORT
        </text>
        {Array.from({ length: PORTS }, (_, i) => {
          const x = 776 + i * 20;
          const on = i < lit;
          return (
            <g key={i}>
              <rect x={x} y="216" width="14" height="12" fill="#1b1a17" />
              <circle cx={x + 3} cy="210" r="2.4" className={on ? 'lp-led lp-led--on' : 'lp-led'} style={{ animationDelay: `${(i * 0.53) % 2.3}s` }} />
              <circle cx={x + 11} cy="210" r="2.4" className={on ? 'lp-led lp-led--amber' : 'lp-led'} style={{ animationDelay: `${(i * 0.29) % 1.7}s` }} />
            </g>
          );
        })}
        {/* Cable bundle drooping to the table. */}
        <g className="lp-cables">
          {CABLES.map((c, i) => (
            <path key={i} d={c.d} fill="none" stroke={c.color} strokeWidth={c.w} strokeLinecap="round" opacity="0.9" />
          ))}
        </g>
      </g>

      {/* Monitor glow on the wall (behind the monitors). */}
      <g className="lp-glows">
        <ellipse className="lp-glow" cx="250" cy="560" rx="230" ry="150" fill="url(#lp-glow-g)" />
        <ellipse className="lp-glow" cx="620" cy="555" rx="240" ry="150" fill="url(#lp-glow-b)" style={{ animationDelay: '1.3s' }} />
        <ellipse className="lp-glow" cx="990" cy="560" rx="230" ry="150" fill="url(#lp-glow-a)" style={{ animationDelay: '2.1s' }} />
        <ellipse className="lp-glow" cx="1360" cy="555" rx="240" ry="150" fill="url(#lp-glow-b)" style={{ animationDelay: '0.6s' }} />
      </g>

      {/* The folding table and its computers. */}
      <g className="lp-table">
        <rect x="60" y="648" width="1480" height="16" fill="url(#lp-table)" />
        <rect x="60" y="648" width="1480" height="3" fill="#6b6556" />
        {[110, 790, 1480].map((x) => (
          <path key={x} d={`M${x} 664 L${x - 14} 780 M${x} 664 L${x + 14} 780`} stroke="#3a3730" strokeWidth="4" />
        ))}
        {MONITORS.map((m, i) => (
          <Monitor key={i} {...m} />
        ))}
        {/* Towers under the table. */}
        {[200, 560, 930, 1300].map((x, i) => (
          <g key={x}>
            <rect x={x} y="676" width="70" height="104" rx="3" fill="url(#lp-beige)" />
            <rect x={x + 10} y="690" width="50" height="8" fill="#4a4436" />
            <rect x={x + 10} y="704" width="50" height="8" fill="#4a4436" />
            <circle cx={x + 16} cy="764" r="3" className="lp-led lp-led--on lp-led--slow" style={{ animationDelay: `${i * 0.7}s` }} />
            <circle cx={x + 28} cy="764" r="3" className="lp-led lp-led--amber lp-led--hdd" style={{ animationDelay: `${i * 0.45}s` }} />
          </g>
        ))}
        {/* Soda cans + a pizza box on the table. */}
        <Can x={430} color="#c8302a" />
        <Can x={456} color="#2f6fc0" />
        <Can x={1150} color="#3d9a44" />
        <g transform="translate(1180 626)">
          <rect width="120" height="22" fill="#b89a6a" />
          <rect y="0" width="120" height="4" fill="#d4b98a" />
          <circle cx="60" cy="12" r="6" fill="#a2382c" opacity="0.8" />
        </g>
      </g>

      {/* Floor, cables, power strip, pizza stack. */}
      <rect y="780" width="1600" height="120" fill="url(#lp-floor)" />
      <path d="M0 780 H1600" stroke="#241f18" strokeWidth="2" />
      {FLOOR_CABLES.map((c, i) => (
        <path key={i} d={c.d} fill="none" stroke={c.color} strokeWidth={c.w} strokeLinecap="round" />
      ))}
      <g transform="translate(700 842)">
        <rect width="170" height="22" rx="4" fill="#d8d0b8" />
        {[20, 46, 72, 98, 124].map((x) => (
          <rect key={x} x={x} y="7" width="14" height="9" rx="2" fill="#6d6655" />
        ))}
        <rect x="146" y="5" width="16" height="12" rx="2" fill="#ff5a4a" className="lp-strip" />
      </g>
      <g className="lp-pizza" transform="translate(1380 820)">
        <rect width="170" height="18" fill="#9c8260" />
        <rect x="6" y="-18" width="160" height="18" fill="#b39468" />
        <rect x="-4" y="-36" width="164" height="18" fill="#a88a5f" />
        <text x="80" y="-22" textAnchor="middle" fontFamily="'LAN VT323', monospace" fontSize="16" fill="#5a3f1e">
          HOT · FRESH
        </text>
      </g>
      {/* Mismatched chairs (foreground silhouettes). */}
      <g className="lp-chairs" fill="#070605">
        <path d="M300 900 V760 q0 -30 30 -30 h90 q30 0 30 30 V820 h-20 V900z" />
        <rect x="286" y="820" width="176" height="20" rx="6" />
        <path d="M1040 900 L1060 800 H1170 L1190 900 H1172 L1160 830 H1070 L1058 900z" fill="#0a0908" />
        <rect x="1050" y="780" width="130" height="22" rx="3" fill="#0a0908" />
      </g>
    </svg>
  );
});

const BULBS: Array<[number, number, string]> = [
  [110, 90, '#ffcf6b'],
  [210, 104, '#ff7d6b'],
  [320, 102, '#8fe38a'],
  [420, 88, '#6fb4ff'],
  [560, 84, '#ffcf6b'],
  [680, 98, '#ff7d6b'],
  [800, 90, '#8fe38a'],
  [940, 82, '#6fb4ff'],
  [1060, 96, '#ffcf6b'],
  [1180, 94, '#ff7d6b'],
  [1300, 82, '#8fe38a'],
  [1430, 90, '#6fb4ff'],
  [1540, 86, '#ffcf6b'],
];

const CABLES = [
  { d: 'M780 228 C 770 360, 520 420, 480 640', color: '#3b6fb0', w: 3 },
  { d: 'M800 228 C 800 380, 660 470, 640 640', color: '#c9b04a', w: 3 },
  { d: 'M840 228 C 850 380, 980 470, 1000 640', color: '#8a8a8a', w: 3 },
  { d: 'M880 228 C 900 360, 1300 430, 1340 640', color: '#3b6fb0', w: 3 },
  { d: 'M820 228 C 820 400, 300 430, 250 640', color: '#b04a4a', w: 3 },
];

const FLOOR_CABLES = [
  { d: 'M235 780 C 260 830, 520 810, 700 852', color: '#1d1a15', w: 6 },
  { d: 'M595 780 C 610 820, 650 840, 710 856', color: '#1d1a15', w: 6 },
  { d: 'M965 780 C 950 830, 900 850, 868 856', color: '#1d1a15', w: 6 },
  { d: 'M1335 780 C 1300 840, 1000 820, 870 850', color: '#1d1a15', w: 6 },
  { d: 'M0 870 C 200 850, 400 890, 700 860', color: '#2a4a70', w: 4 },
  { d: 'M1600 880 C 1400 860, 1100 900, 870 862', color: '#6b5f2a', w: 4 },
];

const MONITORS: Array<{ x: number; screen: string; glow: string; kind: 'term' | 'game' | 'chat' | 'map' }> = [
  { x: 180, screen: '#0b2410', glow: '#63f07e', kind: 'term' },
  { x: 548, screen: '#0b1a3a', glow: '#6fa8ff', kind: 'game' },
  { x: 918, screen: '#2a1a08', glow: '#ffa94d', kind: 'chat' },
  { x: 1288, screen: '#0b1a3a', glow: '#6fa8ff', kind: 'map' },
];

function Monitor({ x, screen, glow, kind }: (typeof MONITORS)[number]) {
  return (
    <g transform={`translate(${x} 520)`}>
      {/* CRT case (beige) with a deep back. */}
      <rect x="10" y="-6" width="120" height="118" rx="6" fill="#6f6857" />
      <rect x="0" y="0" width="140" height="112" rx="7" fill="#b3aa90" />
      <rect x="0" y="0" width="140" height="6" rx="3" fill="#cdc4a8" />
      <rect x="12" y="10" width="116" height="84" rx="8" fill="#1a1813" />
      <rect x="18" y="15" width="104" height="74" rx="10" fill={screen} />
      <g className="lp-screen" opacity="0.9">
        {kind === 'term'
          ? [0, 1, 2, 3, 4, 5].map((r) => <rect key={r} x="26" y={24 + r * 10} width={30 + ((r * 37) % 60)} height="4" fill={glow} opacity="0.75" />)
          : null}
        {kind === 'game' ? (
          <>
            <rect x="18" y="62" width="104" height="27" fill="#1d3b1e" opacity="0.9" />
            <path d="M28 62 l14 -16 l12 10 l18 -22 l22 28" fill="none" stroke={glow} strokeWidth="2" />
            <circle cx="96" cy="32" r="5" fill="#ffd74f" />
          </>
        ) : null}
        {kind === 'chat'
          ? [0, 1, 2, 3, 4].map((r) => (
              <g key={r}>
                <rect x="26" y={24 + r * 12} width="14" height="4" fill="#ffd74f" opacity="0.8" />
                <rect x="44" y={24 + r * 12} width={24 + ((r * 29) % 46)} height="4" fill={glow} opacity="0.7" />
              </g>
            ))
          : null}
        {kind === 'map' ? (
          <>
            <path d="M26 30 h30 v20 h20 v-14 h30 M40 80 h40 v-18 h26" fill="none" stroke={glow} strokeWidth="2" opacity="0.8" />
            <circle cx="56" cy="50" r="3" fill="#ff6259" />
            <circle cx="100" cy="66" r="3" fill="#63f07e" />
          </>
        ) : null}
      </g>
      {/* Glass reflection. */}
      <path d="M22 18 q40 -4 60 0 l-50 40 q-10 -20 -10 -40z" fill="#fff" opacity="0.05" />
      <circle cx="122" cy="102" r="2.5" className="lp-led lp-led--on lp-led--slow" />
      {/* Neck + keyboard. */}
      <rect x="54" y="112" width="32" height="12" fill="#8f866e" />
      <rect x="10" y="118" width="120" height="8" rx="2" fill="#a39a80" transform="translate(0 4)" />
    </g>
  );
}

function Can({ x, color }: { x: number; color: string }) {
  return (
    <g transform={`translate(${x} 626)`}>
      <rect width="16" height="24" rx="3" fill={color} />
      <rect y="0" width="16" height="3" rx="1" fill="#cfcfcf" />
      <rect x="3" y="7" width="3" height="12" fill="#fff" opacity="0.25" />
    </g>
  );
}
