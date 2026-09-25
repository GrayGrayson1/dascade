/**
 * Cabinet body art (SVG). A slim "modern home arcade" cabinet seen in a gentle
 * three-quarter view: the side panel (with full-bleed game art and a glowing
 * T-molding) faces the centre of the row, the front carries a lit marquee
 * window, a glossy bezel, a control deck, printed kick-panel art, a coin door
 * and a riser with an LED strip. Marquee text and the live screen are DOM
 * overlays positioned with `CAB_LAYOUT`.
 */
import type { ReactNode } from 'react';
import type { GameCatalogEntry, GameId } from '@dascade/shared';

export const CAB_W = 264;
export const CAB_H = 612;
export type Side = 'left' | 'right';

/** Left edge of the front face in SVG units. */
export const faceX = (side: Side) => (side === 'right' ? 16 : 48);

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** DOM overlay boxes (percent of the cabinet box). */
export function cabLayout(side: Side) {
  const fx = faceX(side);
  return {
    marquee: { left: pct(fx + 8, CAB_W), width: pct(184, CAB_W), top: pct(8, CAB_H), height: pct(68, CAB_H) },
    screen: { left: pct(fx + 16, CAB_W), width: pct(168, CAB_W), top: pct(108, CAB_H), height: pct(126, CAB_H) },
    face: { left: pct(fx, CAB_W), width: pct(200, CAB_W) },
  };
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
const SPADE = 'M5 0C5 0 10 4.5 10 6.6C10 8.4 8.4 9.4 6.9 8.7C6.3 8.4 5.9 8 5.6 7.5L6.4 10H3.6L4.4 7.5C4.1 8 3.7 8.4 3.1 8.7C1.6 9.4 0 8.4 0 6.6C0 4.5 5 0 5 0Z';
const HEART = 'M5 9.6C5 9.6 0 6.2 0 3C0 1.2 1.3 0 2.8 0C3.9 0 4.6 .6 5 1.5C5.4 .6 6.1 0 7.2 0C8.7 0 10 1.2 10 3C10 6.2 5 9.6 5 9.6Z';
const DIAMOND = 'M5 0L9 5L5 10L1 5Z';
const CLUB = 'M5 .2A2.5 2.5 0 0 1 7.2 3.8A2.5 2.5 0 1 1 5.8 7.6L6.5 10H3.5L4.2 7.6A2.5 2.5 0 1 1 2.8 3.8A2.5 2.5 0 0 1 5 .2Z';
const STAR4 = 'M5 0L6.2 3.8L10 5L6.2 6.2L5 10L3.8 6.2L0 5L3.8 3.8Z';

function Suit({ d, x, y, s, fill, stroke, sw = 0.6, rot = 0, opacity }: { d: string; x: number; y: number; s: number; fill: string; stroke?: string; sw?: number; rot?: number; opacity?: number }) {
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

function Chip({ x, y, r, color, rot = 0 }: { x: number; y: number; r: number; color: string; rot?: number }) {
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
        <text y={r * 0.2} textAnchor="middle" fontFamily="'Tiny5', 'Silkscreen', monospace" fontWeight={700} fontSize={r * 0.62} fill="#14203a">
          {label}
        </text>
      ) : null}
    </g>
  );
}

function PlayingCard({ x, y, w, rot, rank, suit, red }: { x: number; y: number; w: number; rot: number; rank: string; suit: string; red: boolean }) {
  const h = w * 1.4;
  const ink = red ? '#e8364f' : '#17121f';
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2 + 2} y={-h / 2 + 3} width={w} height={h} rx={w * 0.1} fill="rgba(0,0,0,.35)" />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.1} fill="#fbf8ff" />
      <text x={-w / 2 + w * 0.12} y={-h / 2 + w * 0.36} fontFamily="'Tiny5', 'Silkscreen', monospace" fontWeight={700} fontSize={w * 0.34} fill={ink}>
        {rank}
      </text>
      <Suit d={suit} x={0} y={h * 0.08} s={w * 0.05} fill={ink} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Per-game art
// ---------------------------------------------------------------------------
interface ArtIds {
  pat: string;
}

/** Background tile pattern for side + kick panels. */
function MotifPattern({ game, id }: { game: GameCatalogEntry; id: string }) {
  const { primary: P, secondary: S } = game.accent;
  const tiles: Record<GameId, ReactNode> = {
    dasketch: (
      <pattern id={id} width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M3 12c4-7 8 7 12 0s8 7 12 0" fill="none" stroke={S} strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
        <circle cx="28" cy="28" r="2" fill="#fff" opacity=".45" />
        <path d="M6 28l4 4M10 28l-4 4" stroke="#fff" strokeWidth="1.4" opacity=".3" />
      </pattern>
    ),
    holdem: (
      <pattern id={id} width="30" height="30" patternUnits="userSpaceOnUse">
        <Suit d={SPADE} x={8} y={8} s={0.7} fill={S} opacity={0.22} />
        <Suit d={DIAMOND} x={23} y={23} s={0.6} fill={S} opacity={0.22} />
      </pattern>
    ),
    blackjack: (
      <pattern id={id} width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="26" height="26" fill="transparent" />
        <rect width="9" height="26" fill="#000" opacity=".28" />
        <Suit d={DIAMOND} x={18} y={13} s={0.45} fill={S} opacity={0.35} />
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
      <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M12 2L22 12L12 22L2 12Z" fill="none" stroke={S} strokeWidth="1.2" opacity=".35" />
        <circle cx="12" cy="12" r="1.6" fill={S} opacity=".5" />
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
  return <>{tiles[game.id]}</>;
}

/** Side art drawn in a 100×540 "unfolded panel" space. */
function SideArt({ game, ids }: { game: GameCatalogEntry; ids: ArtIds }) {
  const { primary: P, secondary: S } = game.accent;
  const bg = <rect x="-4" y="-4" width="108" height="548" fill={`url(#${ids.pat})`} />;
  switch (game.id) {
    case 'dasketch':
      return (
        <>
          {bg}
          <path d="M18 70C18 40 78 38 78 70C78 96 50 94 50 124" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
          <circle cx="50" cy="150" r="8" fill="#fff" />
          <path d="M8 200C60 170 96 230 44 262S-6 330 54 350S104 420 60 450" fill="none" stroke={S} strokeWidth="12" strokeLinecap="round" />
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
    case 'holdem':
      return (
        <>
          {bg}
          <Suit d={SPADE} x={50} y={70} s={5.4} fill="#fbf8ff" />
          <Suit d={HEART} x={50} y={188} s={5} fill="#e8364f" stroke={S} sw={0.5} />
          <Suit d={CLUB} x={50} y={306} s={5} fill="#0b2a1c" stroke={S} sw={0.5} />
          <Suit d={DIAMOND} x={50} y={424} s={5.2} fill={S} />
          <Chip x={22} y={506} r={14} color="#e8364f" />
          <Chip x={62} y={516} r={14} color="#1b6fb8" />
          <rect x="0" y="0" width="100" height="6" fill={S} opacity=".8" />
        </>
      );
    case 'blackjack':
      return (
        <>
          {bg}
          <text x="50" y="118" textAnchor="middle" fontFamily="'Tiny5', 'Silkscreen', monospace" fontWeight={700} fontSize="92" fill={S} stroke="#2b0a0f" strokeWidth="3">
            21
          </text>
          <PlayingCard x={42} y={230} w={52} rot={-12} rank="A" suit={SPADE} red={false} />
          <PlayingCard x={60} y={268} w={52} rot={10} rank="K" suit={HEART} red />
          <Chip x={30} y={400} r={16} color={S} />
          <Chip x={68} y={430} r={16} color="#17121f" rot={20} />
          <Chip x={40} y={470} r={16} color={P} rot={-10} />
          <Suit d={STAR4} x={78} y={360} s={1.3} fill="#fff6c8" />
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
        return <path key={i} d={`M50 130L${50 + Math.cos(a0) * R} ${130 + Math.sin(a0) * R}L${50 + Math.cos(a1) * R} ${130 + Math.sin(a1) * R}Z`} fill="#fff3b0" opacity=".13" />;
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
              return <path key={c} d={`M0 0L${Math.cos(a0) * 50} ${Math.sin(a0) * 50}A50 50 0 0 1 ${Math.cos(a1) * 50} ${Math.sin(a1) * 50}Z`} fill={c} stroke="#fff3b0" strokeWidth="1.4" />;
            })}
            <circle r="10" fill="#c9a22f" stroke="#2a1405" strokeWidth="3" />
            {Array.from({ length: 16 }, (_, i) => (
              <circle key={i} cx={Math.cos((i / 16) * Math.PI * 2) * 53} cy={Math.sin((i / 16) * Math.PI * 2) * 53} r="2.2" fill="#fff3b0" />
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
          <text x="50" y="150" textAnchor="middle" fontFamily="'Tiny5', 'Silkscreen', monospace" fontWeight={700} fontSize="150" fill="#ff3b5c" stroke={S} strokeWidth="4">
            7
          </text>
          <g transform="translate(50 250)">
            <path d="M-2 -40C4 -20 10 -10 18 0M-2 -40C-6 -20 -14 -8 -20 2" fill="none" stroke="#2de38f" strokeWidth="4" strokeLinecap="round" />
            <circle cx="-20" cy="12" r="14" fill="#ff3b5c" />
            <circle cx="18" cy="10" r="14" fill="#ff3b5c" />
            <circle cx="-25" cy="7" r="4" fill="#ffd6de" />
            <circle cx="13" cy="5" r="4" fill="#ffd6de" />
          </g>
          <path d="M50 330L82 362L50 420L18 362Z" fill="#38e1ff" stroke="#e6fbff" strokeWidth="2" />
          <path d="M18 362H82M50 330L40 362L50 420L60 362Z" fill="none" stroke="#e6fbff" strokeWidth="1.5" opacity=".7" />
          {[470, 492, 514].map((y, i) => (
            <ellipse key={y} cx={34 + i * 12} cy={y} rx="16" ry="7" fill={S} stroke="#8a6508" strokeWidth="2" />
          ))}
        </>
      );
    case 'circuit':
      return (
        <>
          {bg}
          <path d="M20 -10L20 250L60 330L60 560" fill="none" stroke={P} strokeWidth="16" />
          <path d="M44 -10L44 240L84 320L84 560" fill="none" stroke={S} strokeWidth="10" />
          {Array.from({ length: 5 }, (_, r) =>
            Array.from({ length: 5 }, (_, c) => ((r + c) % 2 ? <rect key={`${r}-${c}`} x={c * 20} y={r * 12} width="20" height="12" fill="#fff" opacity=".9" /> : null)),
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

/** Kick-panel wings (left and right of the coin door), front coordinates. */
function KickArt({ game }: { game: GameCatalogEntry }) {
  const { primary: P, secondary: S } = game.accent;
  const L = 46;
  const R = 186;
  const Y = 440;
  switch (game.id) {
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
    case 'holdem':
      return (
        <>
          <Chip x={L} y={Y - 10} r={15} color="#e8364f" />
          <Chip x={L - 4} y={Y + 26} r={15} color={S} rot={30} />
          <Suit d={SPADE} x={R} y={Y} s={2.8} fill="#fbf8ff" />
        </>
      );
    case 'blackjack':
      return (
        <>
          <PlayingCard x={L} y={Y} w={34} rot={-10} rank="A" suit={SPADE} red={false} />
          <PlayingCard x={R} y={Y} w={34} rot={10} rank="K" suit={HEART} red />
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
          <text x={L} y={Y + 18} textAnchor="middle" fontFamily="'Tiny5', 'Silkscreen', monospace" fontWeight={700} fontSize="52" fill="#ff3b5c" stroke={S} strokeWidth="2">
            7
          </text>
          <path d={`M${R} ${Y - 22}L${R + 18} ${Y - 4}L${R} ${Y + 26}L${R - 18} ${Y - 4}Z`} fill="#38e1ff" stroke="#e6fbff" strokeWidth="1.5" />
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
          <g transform={`translate(${L} ${Y})`}>
            <rect x="-3" y="-4" width="6" height="30" fill="#4a3520" />
            <path d="M-8 -6Q0 -34 8 -6Z" fill="#ff8a3d" />
            <path d="M-4 -6Q0 -22 4 -6Z" fill="#ffd23f" />
          </g>
          <g transform={`translate(${R} ${Y})`}>
            <rect x="-3" y="-4" width="6" height="30" fill="#4a3520" />
            <path d="M-8 -6Q0 -34 8 -6Z" fill="#ff8a3d" />
            <path d="M-4 -6Q0 -22 4 -6Z" fill="#ffd23f" />
          </g>
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Cabinet
// ---------------------------------------------------------------------------
export function CabinetArt({ game, side, uid }: { game: GameCatalogEntry; side: Side; uid: string }) {
  const { primary: P, secondary: S, deep: D } = game.accent;
  const id = (k: string) => `${uid}-${k}`;
  const url = (k: string) => `url(#${id(k)})`;
  const right = side === 'right';
  const f0 = right ? 216 : 48;
  const b0 = right ? 260 : 4;
  const s = right ? 1 : -1;
  const sidePoly = `${f0},0 ${b0},10 ${b0},518 ${f0},540`;
  const artTransform = `translate(${right ? 216 : 4} 0) scale(0.44 1)`;
  const dx = faceX(side) - 16;
  const buttons: Array<[number, number, string]> = [
    [120, 306, P],
    [144, 303, S],
    [168, 306, '#f4f1ff'],
    [124, 323, S],
    [148, 320, P],
    [172, 323, '#f4f1ff'],
  ];
  return (
    <svg className="af-cab__svg" viewBox={`0 0 ${CAB_W} ${CAB_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false">
      <defs>
        <MotifPattern game={game} id={id('pat')} />
        <linearGradient id={id('side')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P} />
          <stop offset=".45" stopColor={mixHex(P, D, 0.55)} />
          <stop offset="1" stopColor={D} />
        </linearGradient>
        <linearGradient id={id('sideShade')} gradientUnits="userSpaceOnUse" x1={f0} y1="0" x2={b0} y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".5" />
        </linearGradient>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1d1936" />
          <stop offset=".5" stopColor="#15112a" />
          <stop offset="1" stopColor="#0d0a1c" />
        </linearGradient>
        <linearGradient id={id('bezel')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#15122a" />
          <stop offset=".55" stopColor="#07060e" />
          <stop offset="1" stopColor="#0c0a18" />
        </linearGradient>
        <linearGradient id={id('deck')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixHex(D, '#000000', 0.2)} />
          <stop offset="1" stopColor={mixHex(P, D, 0.55)} />
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
        <radialGradient id={id('ball')} cx=".35" cy=".35" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".25" stopColor={P} />
          <stop offset="1" stopColor={mixHex(P, '#000000', 0.55)} />
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
        <clipPath id={id('sideClip')}>
          <polygon points={sidePoly} />
        </clipPath>
        <clipPath id={id('kickClip')}>
          <rect x="16" y="350" width="200" height="190" />
        </clipPath>
      </defs>

      {/* floor shadow */}
      <ellipse cx={faceX(side) + 100 + s * 18} cy="598" rx="132" ry="11" fill={url('shadow')} />

      {/* side panel */}
      <g clipPath={url('sideClip')}>
        <polygon points={sidePoly} fill={url('side')} />
        <g transform={artTransform}>
          <SideArt game={game} ids={{ pat: id('pat') }} />
        </g>
        <polygon points={sidePoly} fill={url('sideShade')} />
      </g>
      {/* riser side */}
      <polygon points={`${f0 - s * 4},540 ${b0 - s * 6},522 ${b0 - s * 6},574 ${f0 - s * 4},596`} fill="#07060d" />

      <g transform={dx ? `translate(${dx} 0)` : undefined}>
        {/* body */}
        <rect x="16" y="0" width="200" height="540" fill={url('body')} />
        <rect x="16" y="0" width="200" height="84" fill="#1b1733" />
        <rect x="16" y="0" width="200" height="2" fill="#3a3366" />
        <rect x="22" y="6" width="188" height="72" rx="2" fill="#030208" />
        {/* speaker bar */}
        <rect x="16" y="82" width="200" height="16" fill="#0b0916" />
        <g fill="#26204a">
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
        <g clipPath={url('kickClip')}>
          <rect x="16" y="350" width="200" height="190" fill={url('kick')} />
          <rect x="16" y="350" width="200" height="190" fill={url('pat')} />
          <KickArt game={game} />
          <rect x="16" y="350" width="200" height="190" fill="#000" opacity=".12" />
        </g>
        <rect x="16" y="520" width="200" height="20" fill="#000" opacity=".3" />
        {/* coin door */}
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
        {/* riser */}
        <rect x="20" y="540" width="192" height="56" fill="#0b0918" />
        <rect className="af-cab__led" x="20" y="540" width="192" height="3" fill={P} />
        <rect x="20" y="543" width="192" height="6" fill={P} opacity=".12" />
        <text x="116" y="578" textAnchor="middle" fontFamily="Silkscreen, monospace" fontSize="10" letterSpacing="3" fill="#2c2552">
          DASCADE
        </text>
      </g>

      {/* T-molding on the corner that faces the viewer */}
      <rect x={right ? 214 : 46} y="0" width="4" height="540" fill={url('mold')} className="af-cab__mold" />

      <g transform={dx ? `translate(${dx} 0)` : undefined}>
        {/* control deck */}
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
        <g className="af-cab__stick">
          <ellipse cx="60" cy="318" rx="15" ry="5.5" fill="#06050c" />
          <ellipse cx="60" cy="316.5" rx="11" ry="4" fill="#23203a" />
          <rect x="58" y="296" width="4" height="21" rx="1.5" fill="#b8b6cc" />
          <rect x="58" y="296" width="1.5" height="21" fill="#fff" opacity=".6" />
          <circle cx="60" cy="294" r="9.5" fill={url('ball')} />
        </g>
        {/* action buttons */}
        {buttons.map(([x, y, c], i) => (
          <g key={i} className="af-cab__btn" style={{ animationDelay: `${i * 90}ms` }}>
            <ellipse cx={x} cy={y + 2.4} rx="9" ry="4.4" fill="#06050c" />
            <ellipse cx={x} cy={y} rx="8" ry="4" fill={c} />
            <ellipse cx={x - 2.2} cy={y - 1.3} rx="3" ry="1.2" fill="#fff" opacity=".55" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
