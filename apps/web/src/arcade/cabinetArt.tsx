/**
 * Cabinet body art (SVG) for the lineup. A slim "modern home arcade" cabinet
 * seen from the front: lit marquee window, glossy bezel, control deck, printed
 * kick-panel art, coin door and a riser with an LED strip.
 *
 * Both side panels are drawn; the lineup reveals the one that faces the camera
 * (`--side-l` / `--side-r` in 0‥1 scale each panel from its front edge), so a
 * cabinet right of centre shows its left flank and vice versa, like walking
 * down a real arcade aisle. Marquee text and the live screen are DOM overlays
 * positioned with `cabLayout()`.
 */
import { memo, type ReactNode } from 'react';
import type { CabinetDef, CabinetId } from '@dascade/shared';

export const CAB_W = 296;
export const CAB_H = 612;
/** Front face spans FACE_X‥FACE_X+FACE_W in SVG units. */
export const FACE_X = 48;
export const FACE_W = 200;

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** DOM overlay boxes (percent of the cabinet box). */
export function cabLayout() {
  return {
    marquee: { left: pct(FACE_X + 8, CAB_W), width: pct(184, CAB_W), top: pct(8, CAB_H), height: pct(68, CAB_H) },
    screen: { left: pct(FACE_X + 16, CAB_W), width: pct(168, CAB_W), top: pct(108, CAB_H), height: pct(126, CAB_H) },
    face: { left: pct(FACE_X, CAB_W), width: pct(FACE_W, CAB_W) },
  };
}

// ---------------------------------------------------------------------------
// Shapes (exported for reuse by the cabinet picker)
// ---------------------------------------------------------------------------
export const SPADE =
  'M5 0C5 0 10 4.5 10 6.6C10 8.4 8.4 9.4 6.9 8.7C6.3 8.4 5.9 8 5.6 7.5L6.4 10H3.6L4.4 7.5C4.1 8 3.7 8.4 3.1 8.7C1.6 9.4 0 8.4 0 6.6C0 4.5 5 0 5 0Z';
export const HEART = 'M5 9.6C5 9.6 0 6.2 0 3C0 1.2 1.3 0 2.8 0C3.9 0 4.6 .6 5 1.5C5.4 .6 6.1 0 7.2 0C8.7 0 10 1.2 10 3C10 6.2 5 9.6 5 9.6Z';
export const DIAMOND = 'M5 0L9 5L5 10L1 5Z';
export const CLUB = 'M5 .2A2.5 2.5 0 0 1 7.2 3.8A2.5 2.5 0 1 1 5.8 7.6L6.5 10H3.5L4.2 7.6A2.5 2.5 0 1 1 2.8 3.8A2.5 2.5 0 0 1 5 .2Z';
export const STAR4 = 'M5 0L6.2 3.8L10 5L6.2 6.2L5 10L3.8 6.2L0 5L3.8 3.8Z';
const STAR5 = 'M5 0L6.2 3.6L10 3.7L7 6L8.1 9.7L5 7.5L1.9 9.7L3 6L0 3.7L3.8 3.6Z';
/** Chess knight silhouette in a 10×12 box. */
const KNIGHT =
  'M3 12H9V10.6H8.3C8.1 8.6 8.6 7 9.3 5.6C9.9 4.2 9.6 2.4 8.2 1.3C7 .4 5.5 0 4.6 0L4.2 1.2L3.4 .6L3 2.2C1.6 3.2 .6 4.6 .2 6.1C0 6.8 .5 7.4 1.2 7.2L2.3 6.8C2.8 7.4 3.6 7.6 4.3 7.3C3.8 8.5 3.4 9.5 3.6 10.6H3Z';
/** Rook in a 10×12 box. */
const ROOK = 'M1 12H9V10.8H8.2L7.4 5.2H8.4V1H6.9V2.4H5.7V1H4.3V2.4H3.1V1H1.6V5.2H2.6L1.8 10.8H1Z';

export function Suit({
  d,
  x,
  y,
  s,
  fill,
  stroke,
  sw = 0.6,
  rot = 0,
  opacity,
}: {
  d: string;
  x: number;
  y: number;
  s: number;
  fill: string;
  stroke?: string;
  sw?: number;
  rot?: number;
  opacity?: number;
}) {
  return (
    <path
      d={d}
      transform={`translate(${x} ${y}) rotate(${rot}) scale(${s}) translate(-5 -5)`}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? sw : undefined}
      opacity={opacity}
    />
  );
}

export function Chip({ x, y, r, color, rot = 0 }: { x: number; y: number; r: number; color: string; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <circle r={r} fill={color} />
      <circle r={r * 0.74} fill="none" stroke="#fff" strokeWidth={r * 0.26} strokeDasharray={`${r * 0.42} ${r * 0.42}`} />
      <circle r={r * 0.46} fill={color} stroke="rgba(0,0,0,.25)" strokeWidth={r * 0.06} />
    </g>
  );
}

function Ball({ x, y, r, color, label }: { x: number; y: number; r: number; color: string; label?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill={color} />
      <circle r={r * 0.6} fill="#fff" />
      <ellipse cx={-r * 0.38} cy={-r * 0.45} rx={r * 0.22} ry={r * 0.12} fill="rgba(255,255,255,.7)" transform="rotate(-30)" />
      {label ? (
        <text y={r * 0.2} textAnchor="middle" fontFamily="'Tiny5', 'Silkscreen', monospace" fontSize={r * 0.62} fill="#14203a">
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function PlayingCard({
  x,
  y,
  w,
  rot,
  rank,
  suit,
  red,
}: {
  x: number;
  y: number;
  w: number;
  rot: number;
  rank: string;
  suit: string;
  red: boolean;
}) {
  const h = w * 1.4;
  const ink = red ? '#e8364f' : '#17121f';
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2 + 2} y={-h / 2 + 3} width={w} height={h} rx={w * 0.1} fill="rgba(0,0,0,.35)" />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.1} fill="#fbf8ff" />
      <text x={-w / 2 + w * 0.12} y={-h / 2 + w * 0.36} fontFamily="'Tiny5', 'Silkscreen', monospace" fontSize={w * 0.34} fill={ink}>
        {rank}
      </text>
      <Suit d={suit} x={0} y={h * 0.08} s={w * 0.05} fill={ink} />
    </g>
  );
}

function Die({
  x,
  y,
  s,
  face,
  rot = 0,
  fill = '#fbf8ff',
  pip = '#1c0b2e',
}: {
  x: number;
  y: number;
  s: number;
  face: number;
  rot?: number;
  fill?: string;
  pip?: string;
}) {
  const P: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [
      [-1, -1],
      [1, 1],
    ],
    3: [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    4: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    5: [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    6: [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  };
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-s / 2 + 2} y={-s / 2 + 3} width={s} height={s} rx={s * 0.18} fill="rgba(0,0,0,.35)" />
      <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={s * 0.18} fill={fill} />
      {(P[face] ?? []).map(([px, py], i) => (
        <circle key={i} cx={px * s * 0.27} cy={py * s * 0.27} r={s * 0.09} fill={face === 1 ? '#e8364f' : pip} />
      ))}
    </g>
  );
}

function RouletteWheel({ x, y, r }: { x: number; y: number; r: number }) {
  const n = 18;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 3} fill="#5a3406" />
      {Array.from({ length: n }, (_, i) => {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const c = i === 0 ? '#16a05c' : i % 2 ? '#1a1220' : '#ce243a';
        return (
          <path
            key={i}
            d={`M0 0L${Math.cos(a0) * r} ${Math.sin(a0) * r}A${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r}Z`}
            fill={c}
            stroke="#c9a22f"
            strokeWidth="0.8"
          />
        );
      })}
      <circle r={r * 0.58} fill="#8a4a1c" />
      <circle r={r * 0.58} fill="none" stroke="#c9a22f" strokeWidth="1.4" />
      {[0, 1, 2, 3].map((k) => (
        <rect key={k} x={-1} y={-r * 0.5} width="2" height={r} fill="#e8c07d" transform={`rotate(${k * 45})`} />
      ))}
      <circle r={r * 0.16} fill="#ffe27a" />
      <circle cx={r * 0.72} cy={-r * 0.38} r={r * 0.09} fill="#fff" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Per-cabinet materials
// ---------------------------------------------------------------------------
interface Material {
  /** Front body gradient (top → bottom). */
  body: [string, string, string];
  /** Marquee housing + bezel frame. */
  bezel: [string, string];
  /** Riser + trim accents. */
  trim: string;
  /** Joystick/button palette override. */
  buttons?: [string, string, string];
  /** Speaker grille dot colour. */
  grille: string;
}

/** The standard cabinet reads the theme's cabinet chrome tokens (Delta Neon values as fallbacks). */
const DEFAULT_MATERIAL: Material = {
  body: [
    'var(--cabinet-body, #1d1936)',
    'color-mix(in srgb, var(--cabinet-body, #1d1936) 55%, var(--cabinet-body-2, #0d0a1c))',
    'var(--cabinet-body-2, #0d0a1c)',
  ],
  bezel: ['var(--cabinet-bezel, #15122a)', '#07060e'],
  trim: '#2c2552',
  grille: '#26204a',
};

const MATERIALS: Partial<Record<CabinetId, Partial<Material>>> = {
  boardroom: {
    body: ['#4a2c16', '#321c0e', '#1e1008'],
    bezel: ['#2a180b', '#0e0804'],
    trim: '#6b4a22',
    buttons: ['#e8c07d', '#f4ecd8', '#1a1410'],
    grille: '#5a3a1c',
  },
  stravaganza: { body: ['#3a0e2a', '#270822', '#160414'], bezel: ['#22061a', '#0b0208'], trim: '#5a1a44', grille: '#4a1238' },
  putt: {
    body: ['#10261a', '#0b1c12', '#06100a'],
    bezel: ['#0c1a12', '#040a06'],
    trim: '#1f4a2e',
    buttons: ['#ffffff', '#ff4f81', '#a3e635'],
    grille: '#1c3a26',
  },
  tanks: {
    body: ['#2e3018', '#212310', '#14150a'],
    bezel: ['#1a1b0c', '#080804'],
    trim: '#4a4a22',
    buttons: ['#ff8a3d', '#fde047', '#d9d6c0'],
    grille: '#3a3c1c',
  },
  classics: { body: ['#1a1f3a', '#12162c', '#0a0c1c'], bezel: ['#101428', '#05060e'], trim: '#2a3466', grille: '#252c55' },
};

function material(id: CabinetId): Material {
  return { ...DEFAULT_MATERIAL, ...(MATERIALS[id] ?? {}) };
}

// ---------------------------------------------------------------------------
// Per-cabinet art
// ---------------------------------------------------------------------------
/** Background tile pattern for side + kick panels. */
function MotifPattern({ cabinet, id }: { cabinet: CabinetDef; id: string }) {
  const { primary: P, secondary: S } = cabinet.accent;
  const tiles: Record<CabinetId, ReactNode> = {
    dasketch: (
      <pattern id={id} width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M3 12c4-7 8 7 12 0s8 7 12 0" fill="none" stroke={S} strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
        <circle cx="28" cy="28" r="2" fill="#fff" opacity=".45" />
        <path d="M6 28l4 4M10 28l-4 4" stroke="#fff" strokeWidth="1.4" opacity=".3" />
      </pattern>
    ),
    bingo: (
      <pattern id={id} width="32" height="32" patternUnits="userSpaceOnUse">
        <circle cx="8" cy="8" r="5" fill={P} opacity=".45" />
        <circle cx="8" cy="8" r="2.4" fill="#fff" opacity=".6" />
        <circle cx="24" cy="24" r="5" fill={S} opacity=".45" />
        <circle cx="24" cy="24" r="2.4" fill="#fff" opacity=".6" />
      </pattern>
    ),
    wheel: (
      <pattern id={id} width="28" height="28" patternUnits="userSpaceOnUse">
        <Suit d={STAR4} x={7} y={7} s={0.8} fill="#fff3b0" opacity={0.35} />
        <circle cx="21" cy="21" r="1.6" fill={S} opacity=".6" />
      </pattern>
    ),
    dasino: (
      <pattern id={id} width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M15 2L28 15L15 28L2 15Z" fill="none" stroke={S} strokeWidth="1.1" opacity=".3" />
        <Suit d={SPADE} x={15} y={15} s={0.5} fill={S} opacity={0.4} />
        <circle cx="0" cy="0" r="1.6" fill={S} opacity=".5" />
        <circle cx="30" cy="30" r="1.6" fill={S} opacity=".5" />
      </pattern>
    ),
    boardroom: (
      <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#000" opacity=".08" />
        <rect width="12" height="12" fill="#fff" opacity=".05" />
        <rect x="12" y="12" width="12" height="12" fill="#fff" opacity=".05" />
        <path d="M0 .5H24M.5 0V24" stroke={P} strokeWidth=".8" opacity=".18" />
      </pattern>
    ),
    stravaganza: (
      <pattern id={id} width="34" height="34" patternUnits="userSpaceOnUse">
        <Suit d={STAR5} x={9} y={9} s={0.9} fill={S} opacity={0.35} />
        <rect x="22" y="22" width="4" height="2" fill="#7cf5ff" opacity=".5" transform="rotate(30 24 23)" />
        <rect x="26" y="6" width="3" height="2" fill="#fff" opacity=".4" transform="rotate(-20 27 7)" />
        <circle cx="6" cy="28" r="1.5" fill={P} opacity=".6" />
      </pattern>
    ),
    putt: (
      <pattern id={id} width="28" height="28" patternUnits="userSpaceOnUse">
        <rect width="14" height="28" fill="#fff" opacity=".05" />
        <circle cx="21" cy="8" r="2.2" fill="#fff" opacity=".35" />
        <circle cx="21.6" cy="7.4" r=".6" fill="#000" opacity=".2" />
      </pattern>
    ),
    tanks: (
      <pattern id={id} width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M0 30L30 0M-8 8L8 -8M22 38L38 22" stroke="#000" strokeWidth="6" opacity=".16" />
        <circle cx="6" cy="6" r="1.4" fill="#d9d6c0" opacity=".35" />
        <circle cx="24" cy="24" r="1.4" fill="#d9d6c0" opacity=".35" />
      </pattern>
    ),
    classics: (
      <pattern id={id} width="20" height="20" patternUnits="userSpaceOnUse">
        <rect x="2" y="2" width="6" height="6" fill={P} opacity=".2" />
        <rect x="12" y="12" width="6" height="6" fill={S} opacity=".2" />
        <rect x="12" y="2" width="2" height="2" fill="#fff" opacity=".3" />
      </pattern>
    ),
    circuit: (
      <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
        <rect width="8" height="8" fill="#fff" opacity=".07" />
        <rect x="8" y="8" width="8" height="8" fill="#fff" opacity=".07" />
        <rect y="15" width="16" height="1" fill={P} opacity=".25" />
      </pattern>
    ),
    quest: (
      <pattern id={id} width="24" height="14" patternUnits="userSpaceOnUse">
        <rect x=".5" y=".5" width="11" height="6" fill="#000" opacity=".22" />
        <rect x="12.5" y=".5" width="11" height="6" fill="#fff" opacity=".05" />
        <rect x="6.5" y="7.5" width="11" height="6" fill="#000" opacity=".16" />
        <rect x="18.5" y="7.5" width="5" height="6" fill="#fff" opacity=".04" />
        <rect x="-5.5" y="7.5" width="11" height="6" fill="#fff" opacity=".04" />
      </pattern>
    ),
  };
  return <>{tiles[cabinet.id]}</>;
}

/** Side art drawn in a 100×540 "unfolded panel" space. */
function SideArt({ cabinet, pat }: { cabinet: CabinetDef; pat: string }) {
  const { primary: P, secondary: S } = cabinet.accent;
  const bg = <rect x="-4" y="-4" width="108" height="548" fill={`url(#${pat})`} />;
  switch (cabinet.id) {
    case 'dasketch':
      return (
        <>
          {bg}
          <path d="M18 70C18 40 78 38 78 70C78 96 50 94 50 124" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
          <circle cx="50" cy="150" r="8" fill="#fff" />
          <path
            d="M8 200C60 170 96 230 44 262S-6 330 54 350S104 420 60 450"
            fill="none"
            stroke={S}
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path d="M20 214C66 196 84 240 40 268" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".8" />
          <g transform="translate(52 440) rotate(-24)">
            <rect x="-11" y="-80" width="22" height="100" fill={S} />
            <rect x="-11" y="-80" width="7" height="100" fill="#fff" opacity=".35" />
            <rect x="-11" y="-98" width="22" height="18" rx="3" fill={P} />
            <rect x="-11" y="-84" width="22" height="5" fill="#d9d4ea" />
            <path d="M-11 20L11 20L0 46Z" fill="#f5c9a0" />
            <path d="M-4 36L4 36L0 46Z" fill="#2a0b2e" />
          </g>
          <Suit d={STAR4} x={24} y={505} s={1.4} fill="#fff" />
          <Suit d={STAR4} x={80} y={300} s={1} fill="#fff" opacity={0.8} />
        </>
      );
    case 'bingo':
      return (
        <>
          {bg}
          <Ball x={40} y={70} r={30} color={P} label="B7" />
          <Ball x={62} y={160} r={26} color={S} label="I22" />
          <Ball x={36} y={246} r={28} color="#ff4fd8" label="N42" />
          <Ball x={60} y={336} r={26} color="#2de38f" label="G58" />
          <Ball x={40} y={430} r={30} color="#ffb020" label="O71" />
          <circle cx="78" cy="505" r="12" fill="#ff4fd8" opacity=".75" />
          <circle cx="22" cy="515" r="8" fill={S} opacity=".75" />
        </>
      );
    case 'wheel': {
      const rays = Array.from({ length: 18 }, (_, i) => {
        const a0 = (i / 18) * Math.PI * 2;
        const a1 = ((i + 0.5) / 18) * Math.PI * 2;
        const R = 700;
        return (
          <path
            key={i}
            d={`M50 130L${50 + Math.cos(a0) * R} ${130 + Math.sin(a0) * R}L${50 + Math.cos(a1) * R} ${130 + Math.sin(a1) * R}Z`}
            fill="#fff3b0"
            opacity=".13"
          />
        );
      });
      const segs = ['#ffb020', '#ff4f81', '#ffd23f', '#a78bfa', '#22d3ee', '#ff8a3d', '#2de38f', '#ff5a5f'];
      return (
        <>
          {rays}
          {bg}
          <g transform="translate(50 130)">
            <circle r="56" fill="#5a3406" />
            {segs.map((c, i) => {
              const a0 = (i / 8) * Math.PI * 2;
              const a1 = ((i + 1) / 8) * Math.PI * 2;
              return (
                <path
                  key={c}
                  d={`M0 0L${Math.cos(a0) * 50} ${Math.sin(a0) * 50}A50 50 0 0 1 ${Math.cos(a1) * 50} ${Math.sin(a1) * 50}Z`}
                  fill={c}
                  stroke="#fff3b0"
                  strokeWidth="1.4"
                />
              );
            })}
            <circle r="10" fill="#c9a22f" stroke="#2a1405" strokeWidth="3" />
            {Array.from({ length: 16 }, (_, i) => (
              <circle
                key={i}
                cx={Math.cos((i / 16) * Math.PI * 2) * 53}
                cy={Math.sin((i / 16) * Math.PI * 2) * 53}
                r="2.2"
                fill="#fff3b0"
              />
            ))}
          </g>
          <path d="M50 64L40 50H60Z" fill="#fff" />
          <Suit d={STAR4} x={30} y={300} s={2.6} fill="#fff3b0" />
          <Suit d={STAR4} x={72} y={390} s={1.8} fill={S} />
          <Suit d={STAR4} x={36} y={470} s={2.2} fill="#fff3b0" />
        </>
      );
    }
    case 'dasino':
      return (
        <>
          {bg}
          <rect x="0" y="0" width="100" height="6" fill={S} opacity=".85" />
          <RouletteWheel x={50} y={66} r={36} />
          <text
            x="50"
            y="228"
            textAnchor="middle"
            fontFamily="'Tiny5', 'Silkscreen', monospace"
            fontSize="118"
            fill="#ff3b5c"
            stroke={S}
            strokeWidth="4"
          >
            7
          </text>
          <PlayingCard x={36} y={296} w={46} rot={-12} rank="A" suit={SPADE} red={false} />
          <PlayingCard x={64} y={318} w={46} rot={10} rank="K" suit={HEART} red />
          <Die x={34} y={410} s={30} face={5} rot={-14} />
          <Die x={70} y={432} s={26} face={6} rot={16} />
          <Chip x={24} y={504} r={14} color="#e8364f" />
          <Chip x={56} y={512} r={14} color={S} rot={30} />
          <Chip x={86} y={500} r={12} color="#1b6fb8" />
        </>
      );
    case 'boardroom':
      return (
        <>
          <rect x="-4" y="-4" width="108" height="548" fill="#3a2212" />
          {Array.from({ length: 22 }, (_, i) => (
            <path
              key={i}
              d={`M${-10 + i * 6} -4C${i * 6 + 8} 140 ${i * 6 - 14} 300 ${i * 6 + 6} 548`}
              stroke={i % 3 ? '#2a180b' : '#4f3019'}
              strokeWidth={i % 4 ? 1.2 : 2.4}
              fill="none"
              opacity=".75"
            />
          ))}
          {bg}
          <rect x="8" y="10" width="84" height="520" fill="none" stroke={P} strokeWidth="2.4" />
          <rect x="13" y="15" width="74" height="510" fill="none" stroke={P} strokeWidth=".8" opacity=".6" />
          <g transform="translate(20 38) scale(6)">
            <path d={KNIGHT} fill="#f4ecd8" />
          </g>
          <g transform="translate(26 188) scale(4.8)">
            <path d={ROOK} fill="#1a1410" stroke={P} strokeWidth=".35" />
          </g>
          {/* checkers crown piece */}
          <g transform="translate(50 320)">
            <ellipse cy="10" rx="30" ry="9" fill="#5a0e16" />
            <ellipse cy="4" rx="30" ry="9" fill="#d8283f" />
            <ellipse cy="4" rx="21" ry="6" fill="none" stroke="#ff8a94" strokeWidth="1.4" />
            <path d="M-12 2L-12 -8L-6 -2L0 -10L6 -2L12 -8L12 2Z" fill={P} />
          </g>
          {/* a tiny sonar grid with a hidden fleet */}
          <g transform="translate(18 392)">
            <rect width="64" height="64" fill="#03202e" stroke="#38bdf8" strokeWidth="1.2" />
            {Array.from({ length: 7 }, (_, i) => (
              <g key={i} stroke="#0b3a52" strokeWidth=".8">
                <path d={`M${(i + 1) * 8} 0V64`} />
                <path d={`M0 ${(i + 1) * 8}H64`} />
              </g>
            ))}
            <rect x="16" y="24" width="24" height="8" fill="#ff8a3d" />
            <circle cx="52" cy="12" r="2.5" fill="#e6fbff" />
            <circle cx="12" cy="52" r="2.5" fill="#e6fbff" />
            <path d="M32 32L60 8" stroke="#38bdf8" strokeWidth="1.2" opacity=".7" />
          </g>
          <rect x="22" y="486" width="56" height="22" rx="2" fill={P} />
          <rect x="25" y="489" width="50" height="16" rx="1" fill="none" stroke="#6b4a22" strokeWidth="1" />
          <text x="50" y="501" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="8" letterSpacing="1.5" fill="#3a2212">
            EST. DAS
          </text>
        </>
      );
    case 'stravaganza':
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => {
            const a0 = (i / 14) * Math.PI * 2;
            const a1 = ((i + 0.5) / 14) * Math.PI * 2;
            const R = 700;
            return (
              <path
                key={i}
                d={`M50 200L${50 + Math.cos(a0) * R} ${200 + Math.sin(a0) * R}L${50 + Math.cos(a1) * R} ${200 + Math.sin(a1) * R}Z`}
                fill={S}
                opacity=".14"
              />
            );
          })}
          {bg}
          <Suit d={STAR5} x={50} y={200} s={8.6} fill={S} stroke="#fff6c8" sw={0.35} />
          <text
            x="50"
            y="222"
            textAnchor="middle"
            fontFamily="'Tiny5', 'Silkscreen', monospace"
            fontSize="44"
            fill={P}
            stroke="#2a0718"
            strokeWidth="1.5"
          >
            ?
          </text>
          {/* microphone */}
          <g transform="translate(34 330) rotate(-18)">
            <rect x="-5" y="0" width="10" height="70" rx="4" fill="#1a0a14" stroke="#ffb3c8" strokeWidth="1.5" />
            <rect x="-12" y="-28" width="24" height="30" rx="12" fill="#e6e0f0" />
            <path d="M-12 -18H12M-12 -10H12" stroke="#9a90b0" strokeWidth="1.5" />
          </g>
          {/* bulbs strip */}
          {Array.from({ length: 9 }, (_, i) => (
            <circle
              key={i}
              className="af-cab__bulb"
              cx="84"
              cy={40 + i * 14}
              r="4"
              fill="#fff3b0"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
          {/* confetti */}
          {Array.from({ length: 22 }, (_, i) => (
            <rect
              key={`c${i}`}
              x={8 + ((i * 37) % 86)}
              y={420 + ((i * 53) % 110)}
              width="6"
              height="3"
              fill={['#ffd23f', '#7cf5ff', P, '#fff'][i % 4]}
              transform={`rotate(${(i * 47) % 180} ${8 + ((i * 37) % 86)} ${420 + ((i * 53) % 110)})`}
            />
          ))}
          <Suit d={STAR4} x={70} y={372} s={2.4} fill="#fff6c8" />
        </>
      );
    case 'putt':
      return (
        <>
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={-4} y={-4 + i * 62} width="108" height="31" fill="#fff" opacity=".045" />
          ))}
          {bg}
          {/* flag */}
          <rect x="30" y="30" width="4" height="150" fill="#e6e6f0" />
          <path d="M34 32L86 50L34 68Z" fill="#ff4f81" />
          <path d="M34 32L86 50L60 50Z" fill="#ff8aa9" />
          <ellipse cx="32" cy="182" rx="18" ry="6" fill="#052a14" />
          {/* windmill */}
          <g transform="translate(58 300)">
            <path d="M-18 70L-12 0H12L18 70Z" fill="#b8542a" />
            <path d="M-12 0L0 -16L12 0Z" fill="#8a3b1a" />
            <rect x="-5" y="44" width="10" height="26" rx="4" fill="#2a0f06" />
            {[20, 110, 200, 290].map((a) => (
              <rect
                key={a}
                x="-3"
                y="-52"
                width="6"
                height="46"
                fill={a % 180 === 20 ? '#fff3b0' : '#ffd23f'}
                transform={`translate(0 -6) rotate(${a})`}
              />
            ))}
            <circle cy="-6" r="5" fill="#fff" />
          </g>
          {/* golf ball with dimples */}
          <g transform="translate(40 440)">
            <circle r="18" fill="#fbfbff" />
            {Array.from({ length: 10 }, (_, i) => (
              <circle key={i} cx={Math.cos(i * 1.7) * 9} cy={Math.sin(i * 1.7) * 9} r="1.8" fill="#d6d6e6" />
            ))}
            <ellipse cx="-6" cy="-8" rx="5" ry="3" fill="#fff" />
          </g>
          <path d="M76 380L60 492" stroke="#c9c3e6" strokeWidth="4" strokeLinecap="round" />
          <path d="M60 492L76 498L78 490Z" fill="#9a94b8" />
          <circle cx="72" cy="516" r="7" fill="#021a0c" />
        </>
      );
    case 'tanks':
      return (
        <>
          {bg}
          {/* stencil hazard band */}
          <g>
            {Array.from({ length: 8 }, (_, i) => (
              <path key={i} d={`M${i * 16 - 10} 0L${i * 16 + 2} 0L${i * 16 - 10} 18L${i * 16 - 22} 18Z`} fill={i % 2 ? '#1a1b0c' : S} />
            ))}
          </g>
          {/* shell arc */}
          <path d="M18 330Q30 90 84 160" fill="none" stroke="#fff3b0" strokeWidth="3" strokeDasharray="6 7" />
          <circle cx="84" cy="160" r="16" fill={P} />
          <circle cx="84" cy="160" r="9" fill="#fff3b0" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={84 + Math.cos(i * 0.8) * 24} y={160 + Math.sin(i * 0.8) * 24} width="5" height="5" fill={i % 2 ? S : P} />
          ))}
          {/* the tank */}
          <g transform="translate(46 380)">
            <rect x="-34" y="10" width="68" height="16" rx="8" fill="#141508" />
            {[-24, -10, 4, 18].map((cx) => (
              <circle key={cx} cx={cx + 3} cy="18" r="5" fill="#3a3c1c" />
            ))}
            <path d="M-30 10L-24 -6H24L30 10Z" fill="#5a5c2a" />
            <rect x="-14" y="-18" width="26" height="14" rx="4" fill="#6b6d34" />
            <rect x="8" y="-16" width="40" height="5" fill="#6b6d34" transform="rotate(-38 8 -14)" />
            <rect x="-10" y="-2" width="18" height="3" fill={P} />
          </g>
          {/* terrain silhouette */}
          <path d="M-4 470C20 452 30 470 50 458S82 440 104 452V548H-4Z" fill="#1e3a1a" />
          <path d="M-4 470C20 452 30 470 50 458S82 440 104 452" fill="none" stroke="#7cf57a" strokeWidth="2.4" />
          <text x="50" y="524" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="11" letterSpacing="2" fill={S}>
            DAS-7
          </text>
        </>
      );
    case 'classics':
      return (
        <>
          {bg}
          {/* retro racing stripes */}
          {['#ff4fd8', '#ffd23f', '#2de38f', '#22d3ee'].map((c, i) => (
            <path key={c} d={`M${-10 + i * 10} 548L${60 + i * 10} -4`} stroke={c} strokeWidth="6" opacity=".8" />
          ))}
          {/* paddle rally */}
          <rect x="10" y="40" width="7" height="34" fill={P} />
          <rect x="83" y="70" width="7" height="34" fill={S} />
          <rect x="47" y="60" width="8" height="8" fill="#fff" />
          {/* brick wall */}
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x={8 + (i % 4) * 22 + (Math.floor(i / 4) % 2) * 6}
              y={150 + Math.floor(i / 4) * 12}
              width="20"
              height="10"
              fill={['#ff4fd8', '#ff8a3d', '#ffd23f'][Math.floor(i / 4)]}
            />
          ))}
          {/* snake */}
          <path d="M14 250H70V282H30V314H86" fill="none" stroke="#2de38f" strokeWidth="10" strokeLinejoin="miter" />
          <rect x="80" y="309" width="10" height="10" fill="#eafff4" />
          <rect x="16" y="320" width="8" height="8" fill="#ffd23f" />
          {/* asteroid + ship */}
          <path d="M28 372L44 362L62 368L66 386L56 400L36 398L24 388Z" fill="none" stroke="#c8b8ff" strokeWidth="3" />
          <path d="M80 420L70 440L90 440Z" fill="none" stroke="#7cf5ff" strokeWidth="2.6" />
          {/* falling blocks */}
          {[
            [10, 470, '#22d3ee'],
            [22, 470, '#22d3ee'],
            [34, 470, '#22d3ee'],
            [22, 458, '#22d3ee'],
            [58, 494, '#a78bfa'],
            [70, 494, '#a78bfa'],
            [70, 482, '#a78bfa'],
            [70, 470, '#a78bfa'],
          ].map(([x, y, c], i) => (
            <rect key={i} x={x as number} y={y as number} width="11" height="11" fill={c as string} stroke="#0a0c1c" strokeWidth="1" />
          ))}
          <rect x="4" y="506" width="92" height="30" fill="#0a0c1c" opacity=".7" />
          <text x="50" y="526" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="11" letterSpacing="2" fill="#7cf5ff">
            6 IN 1
          </text>
        </>
      );
    case 'circuit':
      return (
        <>
          {bg}
          <path d="M20 -10L20 250L60 330L60 560" fill="none" stroke={P} strokeWidth="16" />
          <path d="M44 -10L44 240L84 320L84 560" fill="none" stroke={S} strokeWidth="10" />
          {Array.from({ length: 5 }, (_, r) =>
            Array.from({ length: 5 }, (_, c) =>
              (r + c) % 2 ? <rect key={`${r}-${c}`} x={c * 20} y={r * 12} width="20" height="12" fill="#fff" opacity=".9" /> : null,
            ),
          )}
          <rect x="0" y="60" width="100" height="3" fill={P} />
          <g transform="translate(52 440)">
            <rect x="-14" y="-30" width="28" height="56" rx="8" fill={P} />
            <rect x="-10" y="-14" width="20" height="16" rx="3" fill="#04161f" />
            <rect x="-4" y="-30" width="8" height="56" fill="#fff" opacity=".85" />
            <rect x="-18" y="-24" width="6" height="12" rx="2" fill="#0b0b12" />
            <rect x="12" y="-24" width="6" height="12" rx="2" fill="#0b0b12" />
            <rect x="-18" y="10" width="6" height="12" rx="2" fill="#0b0b12" />
            <rect x="12" y="10" width="6" height="12" rx="2" fill="#0b0b12" />
          </g>
          <path d="M40 486V540M52 490V540M64 486V540" stroke={S} strokeWidth="3" opacity=".8" />
        </>
      );
    case 'quest':
      return (
        <>
          {bg}
          <g transform="translate(50 250)">
            <rect x="-5" y="-190" width="10" height="230" fill="#e6fbff" />
            <rect x="-5" y="-190" width="4" height="230" fill="#fff" />
            <path d="M-5 -190L0 -210L5 -190Z" fill="#e6fbff" />
            <rect x="-26" y="40" width="52" height="10" fill={S} />
            <rect x="-6" y="50" width="12" height="36" fill="#6b4a2a" />
            <circle cy="94" r="9" fill={P} />
          </g>
          {[
            [22, 90],
            [78, 180],
            [24, 390],
            [76, 470],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`} stroke={i % 2 ? S : P} strokeWidth="3" fill="none" strokeLinecap="square">
              <path d="M-8 -10V10M-8 -2L6 -10M-8 4L6 10" />
            </g>
          ))}
          <rect x="0" y="300" width="100" height="6" fill="#ff4fd8" opacity=".6" />
          <rect x="10" y="312" width="80" height="3" fill={S} opacity=".7" />
          <path d="M50 470L72 482V506L50 518L28 506V482Z" fill="#0d1a05" stroke={P} strokeWidth="3" />
          <path d="M50 478L64 494L50 510L36 494Z" fill="none" stroke={S} strokeWidth="2" />
        </>
      );
  }
}

/** Kick-panel wings (left and right of the coin door), front coordinates (face = 16‥216). */
function KickArt({ cabinet }: { cabinet: CabinetDef }) {
  const { primary: P, secondary: S } = cabinet.accent;
  const L = 46;
  const R = 186;
  const Y = 440;
  switch (cabinet.id) {
    case 'dasketch':
      return (
        <>
          <path d="M24 380C40 360 60 400 44 420S30 470 56 480" fill="none" stroke={S} strokeWidth="5" strokeLinecap="round" />
          <g transform={`translate(${R} ${Y}) rotate(18)`}>
            <rect x="-6" y="-40" width="12" height="54" fill={S} />
            <rect x="-6" y="-50" width="12" height="10" rx="2" fill="#fff" />
            <path d="M-6 14L6 14L0 28Z" fill="#f5c9a0" />
          </g>
        </>
      );
    case 'bingo':
      return (
        <>
          <Ball x={L} y={Y - 14} r={17} color={P} label="B4" />
          <Ball x={R} y={Y + 10} r={17} color={S} label="O66" />
        </>
      );
    case 'wheel':
      return (
        <>
          <Suit d={STAR4} x={L} y={Y} s={3.2} fill="#fff3b0" />
          <Suit d={STAR4} x={R} y={Y - 10} s={2.4} fill={S} />
        </>
      );
    case 'dasino':
      return (
        <>
          <PlayingCard x={L - 6} y={Y - 4} w={30} rot={-12} rank="A" suit={SPADE} red={false} />
          <PlayingCard x={L + 12} y={Y + 4} w={30} rot={8} rank="K" suit={HEART} red />
          <Die x={R - 8} y={Y - 8} s={22} face={6} rot={-10} />
          <Die x={R + 12} y={Y + 14} s={20} face={3} rot={14} />
        </>
      );
    case 'boardroom':
      return (
        <>
          <g transform={`translate(${L - 22} ${Y - 28})`}>
            {Array.from({ length: 16 }, (_, i) => (
              <rect
                key={i}
                x={(i % 4) * 11}
                y={Math.floor(i / 4) * 11}
                width="11"
                height="11"
                fill={(i + Math.floor(i / 4)) % 2 ? '#2a180b' : '#e8d3a6'}
              />
            ))}
            <rect width="44" height="44" fill="none" stroke={P} strokeWidth="2" />
          </g>
          <g transform={`translate(${R - 13} ${Y - 30}) scale(2.6)`}>
            <path d={KNIGHT} fill="#f4ecd8" />
          </g>
        </>
      );
    case 'stravaganza':
      return (
        <>
          {[L - 18, L + 6].map((x, i) => (
            <g key={x} transform={`translate(${x} ${Y - 6})`}>
              <rect x="-10" y="0" width="20" height="36" fill={i ? '#22d3ee' : P} />
              <rect x="-12" y="-4" width="24" height="6" fill="#fff6c8" />
              <circle cy="-8" r="5" fill="#ff3b5c" className="af-cab__bulb" />
            </g>
          ))}
          <Suit d={STAR5} x={R} y={Y} s={3.2} fill={S} />
        </>
      );
    case 'putt':
      return (
        <>
          <g transform={`translate(${L} ${Y})`}>
            <ellipse cy="18" rx="22" ry="7" fill="#052a14" />
            <rect x="-1.5" y="-30" width="3" height="48" fill="#e6e6f0" />
            <path d="M1.5 -30L22 -22L1.5 -14Z" fill="#ff4f81" />
          </g>
          <g transform={`translate(${R} ${Y + 6})`}>
            <circle r="11" fill="#fbfbff" />
            <circle cx="-3" cy="-4" r="1.4" fill="#d6d6e6" />
            <circle cx="4" cy="2" r="1.4" fill="#d6d6e6" />
          </g>
        </>
      );
    case 'tanks':
      return (
        <>
          {[L - 12, L + 8].map((x, i) => (
            <g key={x} transform={`translate(${x} ${Y}) rotate(${i ? 18 : -18})`}>
              <rect x="-5" y="-26" width="10" height="36" rx="1" fill="#c9a262" />
              <path d="M-5 -26Q0 -40 5 -26Z" fill="#8a6a3a" />
              <rect x="-5" y="4" width="10" height="4" fill="#6b4a22" />
            </g>
          ))}
          <g transform={`translate(${R} ${Y})`}>
            <circle r="16" fill="none" stroke={S} strokeWidth="3" />
            <path d="M-22 0H22M0 -22V22" stroke={S} strokeWidth="2" />
            <circle r="4" fill={P} />
          </g>
        </>
      );
    case 'classics':
      return (
        <>
          <g transform={`translate(${L} ${Y})`}>
            <rect x="-22" y="-14" width="44" height="30" rx="4" fill="#0a0c1c" stroke={P} strokeWidth="2" />
            <text y="6" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="12" fill={P}>
              1P
            </text>
          </g>
          <g transform={`translate(${R} ${Y})`}>
            <rect x="-22" y="-14" width="44" height="30" rx="4" fill="#0a0c1c" stroke={S} strokeWidth="2" />
            <text y="6" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="12" fill={S}>
              2P
            </text>
          </g>
        </>
      );
    case 'circuit':
      return (
        <>
          <path d="M16 420H70M20 432H64M24 444H58" stroke={P} strokeWidth="3" />
          <path d="M162 420H216M168 432H212M174 444H206" stroke={S} strokeWidth="3" />
        </>
      );
    case 'quest':
      return (
        <>
          {[L, R].map((x) => (
            <g key={x} transform={`translate(${x} ${Y})`}>
              <rect x="-3" y="-4" width="6" height="30" fill="#4a3520" />
              <path d="M-8 -6Q0 -34 8 -6Z" fill="#ff8a3d" />
              <path d="M-4 -6Q0 -22 4 -6Z" fill="#ffd23f" />
            </g>
          ))}
        </>
      );
  }
}

/** Extra front decorations per cabinet (drawn over the body, front coordinates). */
function FrontDeco({ cabinet }: { cabinet: CabinetDef }) {
  const { primary: P, secondary: S } = cabinet.accent;
  switch (cabinet.id) {
    case 'stravaganza':
      // chaser bulbs framing the marquee window
      return (
        <g>
          {Array.from({ length: 13 }, (_, i) => (
            <circle
              key={`t${i}`}
              className="af-cab__bulb"
              cx={24 + i * 15.5}
              cy="3.2"
              r="2.4"
              fill="#fff3b0"
              style={{ animationDelay: `${(i % 3) * 180}ms` }}
            />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <g key={`s${i}`}>
              <circle
                className="af-cab__bulb"
                cx="19"
                cy={14 + i * 14}
                r="2.2"
                fill="#fff3b0"
                style={{ animationDelay: `${((i + 1) % 3) * 180}ms` }}
              />
              <circle
                className="af-cab__bulb"
                cx="213"
                cy={14 + i * 14}
                r="2.2"
                fill="#fff3b0"
                style={{ animationDelay: `${((i + 2) % 3) * 180}ms` }}
              />
            </g>
          ))}
        </g>
      );
    case 'boardroom':
      // brass corner plates + a brass rail under the bezel
      return (
        <g fill={P}>
          <path d="M16 0H34L16 18Z" />
          <path d="M216 0H198L216 18Z" />
          <rect x="16" y="286" width="200" height="3" opacity=".9" />
          <circle cx="24" cy="112" r="2.2" />
          <circle cx="208" cy="112" r="2.2" />
          <circle cx="24" cy="230" r="2.2" />
          <circle cx="208" cy="230" r="2.2" />
        </g>
      );
    case 'tanks':
      // rivets along the body edges
      return (
        <g fill="#6b6d34">
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i}>
              <circle cx="21" cy={104 + i * 16} r="1.8" />
              <circle cx="211" cy={104 + i * 16} r="1.8" />
            </g>
          ))}
          <rect x="16" y="352" width="200" height="6" fill={S} opacity=".5" />
        </g>
      );
    case 'putt':
      return <rect x="16" y="286" width="200" height="4" fill={P} opacity=".7" />;
    case 'classics':
      return (
        <g>
          {['#ff4fd8', '#ffd23f', '#2de38f', '#22d3ee'].map((c, i) => (
            <rect key={c} x="16" y={352 + i * 3} width="200" height="2" fill={c} opacity=".7" />
          ))}
        </g>
      );
    case 'dasino':
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <circle
              key={i}
              className="af-cab__bulb"
              cx={26 + i * 16.4}
              cy="3.2"
              r="2"
              fill={S}
              style={{ animationDelay: `${(i % 2) * 260}ms` }}
            />
          ))}
        </g>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Cabinet
// ---------------------------------------------------------------------------
export const CabinetArt = memo(function CabinetArt({ cabinet, uid }: { cabinet: CabinetDef; uid: string }) {
  const { primary: P, secondary: S, deep: D } = cabinet.accent;
  const m = material(cabinet.id);
  const [b1, b2, b3] = m.buttons ?? [P, S, '#f4f1ff'];
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  const L0 = FACE_X;
  const R0 = FACE_X + FACE_W;
  const sideL = `${L0},0 4,10 4,518 ${L0},540`;
  const sideR = `${R0},0 292,10 292,518 ${R0},540`;
  const buttons: Array<[number, number, string]> = [
    [120, 306, b1],
    [144, 303, b2],
    [168, 306, b3],
    [124, 323, b2],
    [148, 320, b1],
    [172, 323, b3],
  ];
  const DX = FACE_X - 16;
  return (
    <svg
      className="af-cab__svg"
      data-part="cabinet-art"
      viewBox={`0 0 ${CAB_W} ${CAB_H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
    >
      <defs>
        <MotifPattern cabinet={cabinet} id={id('pat')} />
        <linearGradient id={id('side')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P} />
          <stop offset=".45" stopColor={mixHex(P, D, 0.55)} />
          <stop offset="1" stopColor={D} />
        </linearGradient>
        <linearGradient id={id('shadeR')} gradientUnits="userSpaceOnUse" x1={R0} y1="0" x2="292" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id={id('shadeL')} gradientUnits="userSpaceOnUse" x1={L0} y1="0" x2="4" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
        {/* stop colours go through style so theme tokens (CSS variables) resolve */}
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: m.body[0] }} />
          <stop offset=".5" style={{ stopColor: m.body[1] }} />
          <stop offset="1" style={{ stopColor: m.body[2] }} />
        </linearGradient>
        <linearGradient id={id('bezel')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: m.bezel[0] }} />
          <stop offset=".55" style={{ stopColor: m.bezel[1] }} />
          <stop offset="1" style={{ stopColor: m.bezel[0] }} />
        </linearGradient>
        <linearGradient id={id('deck')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cabinet.id === 'putt' ? '#0e5a2c' : mixHex(D, '#000000', 0.2)} />
          <stop offset="1" stopColor={cabinet.id === 'putt' ? '#1f9a52' : mixHex(P, D, 0.55)} />
        </linearGradient>
        <linearGradient id={id('kick')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixHex(P, D, 0.35)} />
          <stop offset=".6" stopColor={mixHex(P, D, 0.7)} />
          <stop offset="1" stopColor={D} />
        </linearGradient>
        <linearGradient id={id('metal')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4668" />
          <stop offset=".5" stopColor="#2a2742" />
          <stop offset="1" stopColor="#1a1830" />
        </linearGradient>
        <linearGradient id={id('edge')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('ball')} cx=".35" cy=".35" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".25" stopColor={b1} />
          <stop offset="1" stopColor={mixHex(b1, '#000000', 0.55)} />
        </radialGradient>
        <radialGradient id={id('shadow')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".75" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('mold')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixHex(P, '#ffffff', 0.35)} />
          <stop offset=".5" stopColor={P} />
          <stop offset="1" stopColor={mixHex(P, '#000000', 0.25)} />
        </linearGradient>
        <clipPath id={id('clipL')}>
          <polygon points={sideL} />
        </clipPath>
        <clipPath id={id('clipR')}>
          <polygon points={sideR} />
        </clipPath>
        <clipPath id={id('kickClip')}>
          <rect x="16" y="350" width="200" height="190" />
        </clipPath>
      </defs>

      {/* floor shadow */}
      <ellipse cx={CAB_W / 2} cy="598" rx="136" ry="11" fill={url('shadow')} />

      {/* side panels (revealed by the lineup) */}
      <g className="af-cab__side af-cab__side--l" data-part="cabinet-side">
        <g clipPath={url('clipL')}>
          <polygon points={sideL} fill={url('side')} />
          <g transform="translate(4 0) scale(0.44 1)">
            <SideArt cabinet={cabinet} pat={id('pat')} />
          </g>
          <polygon points={sideL} fill={url('shadeL')} />
        </g>
        <polygon points={`${L0 + 4},540 10,522 10,574 ${L0 + 4},596`} fill="#07060d" />
        <rect x={L0 - 2} y="0" width="4" height="540" fill={url('mold')} className="af-cab__mold" />
      </g>
      <g className="af-cab__side af-cab__side--r" data-part="cabinet-side">
        <g clipPath={url('clipR')}>
          <polygon points={sideR} fill={url('side')} />
          <g transform={`translate(${R0} 0) scale(0.44 1)`}>
            <SideArt cabinet={cabinet} pat={id('pat')} />
          </g>
          <polygon points={sideR} fill={url('shadeR')} />
        </g>
        <polygon points={`${R0 - 4},540 286,522 286,574 ${R0 - 4},596`} fill="#07060d" />
        <rect x={R0 - 2} y="0" width="4" height="540" fill={url('mold')} className="af-cab__mold" />
      </g>

      <g transform={`translate(${DX} 0)`} data-part="cabinet-front">
        {/* body */}
        <rect x="16" y="0" width="200" height="540" fill={url('body')} />
        <rect x="16" y="0" width="200" height="84" style={{ fill: m.bezel[0] }} />
        <rect x="16" y="0" width="200" height="2" fill={mixHex(m.trim, '#ffffff', 0.2)} />
        <rect x="22" y="6" width="188" height="72" rx="2" fill="#030208" />
        {/* speaker bar */}
        <rect x="16" y="82" width="200" height="16" fill="#0b0916" />
        <g fill={m.grille}>
          {Array.from({ length: 18 }, (_, i) => (
            <circle key={i} cx={40 + (i % 9) * 6} cy={87 + Math.floor(i / 9) * 5} r="1.5" />
          ))}
          {Array.from({ length: 18 }, (_, i) => (
            <circle key={`r${i}`} cx={144 + (i % 9) * 6} cy={87 + Math.floor(i / 9) * 5} r="1.5" />
          ))}
        </g>
        <circle className="af-cab__power" cx="116" cy="90" r="2.2" fill={P} />
        {/* bezel */}
        <rect x="16" y="98" width="200" height="194" fill={url('bezel')} />
        <rect x="30" y="106" width="172" height="130" rx="4" fill="#000" />
        <rect x="29.5" y="105.5" width="173" height="131" rx="4.5" fill="none" stroke={P} strokeOpacity=".45" />
        <rect x="30" y="248" width="172" height="30" rx="2" fill={url('pat')} opacity=".9" />
        <rect x="30" y="246" width="172" height="1.5" fill={P} opacity=".7" />
        <rect x="30" y="280" width="172" height="1" fill={S} opacity=".5" />
        <path d="M34 110L110 110L60 232L34 232Z" fill="#fff" opacity=".035" />
        {/* kick panel */}
        <g clipPath={url('kickClip')} data-part="cabinet-kick-panel">
          <rect x="16" y="350" width="200" height="190" fill={url('kick')} />
          <rect x="16" y="350" width="200" height="190" fill={url('pat')} />
          <KickArt cabinet={cabinet} />
          <rect x="16" y="350" width="200" height="190" fill="#000" opacity=".12" />
        </g>
        <rect x="16" y="520" width="200" height="20" fill="#000" opacity=".3" />
        {/* coin door */}
        <g data-part="cabinet-coin-door">
          <rect x="86" y="398" width="60" height="80" rx="4" fill="#0b0916" />
          <rect x="88" y="400" width="56" height="76" rx="3" fill={url('metal')} />
          <rect x="91" y="403" width="50" height="70" rx="2" fill="none" stroke="#6a6690" strokeOpacity=".55" />
          {[98, 126].map((x) => (
            <g key={x}>
              <rect x={x - 2} y="409" width="10" height="24" rx="2" fill="#15121f" />
              <rect className="af-cab__slot" x={x + 1.5} y="412" width="3" height="18" rx="1" fill="#ff4a5e" />
              <rect x={x - 1} y="440" width="8" height="6" rx="1" fill="#0b0916" />
            </g>
          ))}
          <circle cx="116" cy="462" r="3" fill="#0b0916" />
          <rect x="115.2" y="460.5" width="1.6" height="3" fill="#6a6690" />
        </g>
        {/* riser */}
        <rect x="20" y="540" width="192" height="56" fill="#0b0918" />
        <rect className="af-cab__led" x="20" y="540" width="192" height="3" fill={P} />
        <rect x="20" y="543" width="192" height="6" fill={P} opacity=".12" />
        <text x="116" y="578" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="10" letterSpacing="3" fill={m.trim}>
          DASCADE
        </text>
        {/* soft bevels at both front corners so a head-on cabinet still reads as a box */}
        <rect x="16" y="0" width="5" height="540" fill={url('edge')} />
        <rect x="211" y="0" width="5" height="540" fill={url('edge')} transform="rotate(180 213.5 270)" />
        <FrontDeco cabinet={cabinet} />
        {/* control deck */}
        <g data-part="cabinet-control-panel">
          <polygon points="16,292 216,292 230,334 2,334" fill={url('deck')} />
          <polygon points="16,292 216,292 230,334 2,334" fill={url('pat')} opacity=".55" />
          <rect x="16" y="292" width="200" height="1.5" fill="#fff" opacity=".12" />
          <rect x="2" y="334" width="228" height="17" fill="#0d0b19" />
          <rect x="2" y="334" width="228" height="2.5" fill={P} className="af-cab__deck-edge" />
          <rect x="2" y="349" width="228" height="2" fill="#000" opacity=".5" />
          {/* start buttons */}
          <ellipse cx="96" cy="302" rx="4.5" ry="2.2" fill="#0b0916" />
          <ellipse cx="96" cy="301" rx="4" ry="2" fill="#f4f1ff" />
          <ellipse cx="108" cy="302" rx="4.5" ry="2.2" fill="#0b0916" />
          <ellipse cx="108" cy="301" rx="4" ry="2" fill={S} />
          {/* joystick */}
          <g className="af-cab__stick" data-part="cabinet-joystick">
            <ellipse cx="60" cy="318" rx="15" ry="5.5" fill="#06050c" />
            <ellipse cx="60" cy="316.5" rx="11" ry="4" fill="#23203a" />
            <rect x="58" y="296" width="4" height="21" rx="1.5" fill="#b8b6cc" />
            <rect x="58" y="296" width="1.5" height="21" fill="#fff" opacity=".6" />
            <circle cx="60" cy="294" r="9.5" fill={url('ball')} />
          </g>
          {/* action buttons */}
          {buttons.map(([x, y, c], i) => (
            <g key={i} className="af-cab__btn">
              <ellipse cx={x} cy={y + 2.4} rx="9" ry="4.4" fill="#06050c" />
              <ellipse cx={x} cy={y} rx="8" ry="4" fill={c} />
              <ellipse cx={x - 2.2} cy={y - 1.3} rx="3" ry="1.2" fill="#fff" opacity=".55" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
});

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
