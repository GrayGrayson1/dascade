/**
 * DAS Ships procedural art (SVG, drawn in grid-cell units so it stays crisp at any size).
 * Original neon-sea vessels seen from above, plus splash / burst / reticle marks.
 * Game-art palette lives here (theme tokens drive the chrome, not the vessels).
 */
import type { ReactNode } from 'react';
import { VESSELS, type ShipsDir, type VesselId } from '@dascade/shared/games/ships';

/** Signature neon hue per vessel class. */
export const VESSEL_HUES: Record<VesselId, string> = {
  arcology: '#5eead4',
  tidebreaker: '#ff8a3d',
  thunderhead: '#b69cff',
  lanternfish: '#b4f25a',
  riptide: '#ff5fd8',
  glowdart: '#4cc9ff',
  wisp: '#e2f3ff',
};

export const SEA = {
  deep: '#031425',
  mid: '#062a45',
  line: 'rgba(125, 211, 252, 0.16)',
  lineStrong: 'rgba(125, 211, 252, 0.3)',
  hull: '#123049',
  hullDark: '#0a1c2d',
  deck: '#1a4260',
  wreck: '#1b1f27',
  wreckEdge: '#ff5a5f',
  splash: '#bfe9ff',
  fire: '#ff8a3d',
  fireHot: '#ffe08a',
  fireRed: '#ff4b4b',
};

export type VesselTone = 'live' | 'sunk' | 'ghost' | 'invalid' | 'revealed';

interface VesselProps {
  id: VesselId;
  x: number;
  y: number;
  dir: ShipsDir;
  tone?: VesselTone;
  /** Emphasise (selected in deployment). */
  selected?: boolean;
  glowId?: string;
}

/** Place a horizontal drawing (local u ∈ [0, L], v ∈ [0, 1], bow at u = 0) on the grid. */
function placeTransform(x: number, y: number, dir: ShipsDir): string {
  return dir === 'h' ? `translate(${x} ${y})` : `translate(${x + 1} ${y}) rotate(90)`;
}

/** The hull outline: chamfered stern, stepped (pixel) bow. */
function hullPath(L: number, m = 0.14): string {
  const t = m;
  const b = 1 - m;
  return [
    `M 0.1 0.44`,
    `L 0.1 0.56`,
    `L 0.2 0.56`,
    `L 0.2 0.66`,
    `L 0.34 0.66`,
    `L 0.34 0.76`,
    `L 0.55 ${b}`,
    `L ${L - 0.16} ${b}`,
    `L ${L - 0.07} ${b - 0.09}`,
    `L ${L - 0.07} ${t + 0.09}`,
    `L ${L - 0.16} ${t}`,
    `L 0.55 ${t}`,
    `L 0.34 0.24`,
    `L 0.34 0.34`,
    `L 0.2 0.34`,
    `L 0.2 0.44`,
    'Z',
  ].join(' ');
}

function palette(id: VesselId, tone: VesselTone) {
  const hue = VESSEL_HUES[id];
  if (tone === 'sunk') return { hue: SEA.wreckEdge, body: SEA.wreck, deck: '#262a33', light: '#5b2a2e', lit: false };
  if (tone === 'invalid') return { hue: '#ff5a5f', body: '#3a1520', deck: '#4a1c28', light: '#ff9aa0', lit: true };
  return { hue, body: SEA.hull, deck: SEA.deck, light: hue, lit: true };
}

/** One vessel, top-down. */
export function Vessel({ id, x, y, dir, tone = 'live', selected, glowId }: VesselProps) {
  const L = VESSELS[id].length;
  const c = palette(id, tone);
  const opacity = tone === 'ghost' ? 0.8 : tone === 'invalid' ? 0.75 : tone === 'revealed' ? 0.9 : 1;
  const glow = glowId && c.lit ? `url(#${glowId})` : undefined;
  return (
    <g transform={placeTransform(x, y, dir)} opacity={opacity} className={`sh-vessel sh-vessel--${tone}`} data-vessel={id}>
      {/* wake / shadow */}
      <path d={hullPath(L, 0.1)} fill="rgba(0,0,0,0.35)" transform="translate(0.04 0.06)" />
      <path d={hullPath(L)} fill={c.body} stroke={c.hue} strokeWidth={selected ? 0.07 : 0.045} strokeLinejoin="round" filter={glow} />
      {/* top sheen for a little depth */}
      <path
        d={`M 0.58 0.2 L ${L - 0.2} 0.2`}
        stroke="#ffffff"
        strokeOpacity={tone === 'sunk' ? 0.04 : 0.13}
        strokeWidth={0.035}
        strokeLinecap="square"
      />
      {/* deck inset */}
      <rect x={0.62} y={0.3} width={Math.max(0.2, L - 0.95)} height={0.4} rx={0.05} fill={c.deck} opacity={0.9} />
      {details(id, L, c)}
      {tone === 'revealed' ? (
        <path d={hullPath(L)} fill="none" stroke="#ffffff" strokeWidth={0.03} strokeDasharray="0.12 0.1" opacity={0.7} />
      ) : null}
      {tone === 'sunk' ? <SunkScars L={L} /> : null}
      {selected ? (
        <rect
          x={0.02}
          y={0.02}
          width={L - 0.04}
          height={0.96}
          rx={0.08}
          fill="none"
          stroke="#ffffff"
          strokeWidth={0.04}
          strokeDasharray="0.16 0.1"
          className="sh-vessel__select"
        />
      ) : null}
    </g>
  );
}

function SunkScars({ L }: { L: number }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < L; i++) {
    out.push(
      <path
        key={i}
        d={`M ${i + 0.3} 0.32 L ${i + 0.7} 0.68 M ${i + 0.7} 0.32 L ${i + 0.3} 0.68`}
        stroke="#ff5a5f"
        strokeWidth={0.05}
        opacity={0.55}
      />,
    );
  }
  return <g>{out}</g>;
}

type Pal = ReturnType<typeof palette>;

/** Chunky pixel windows (crisp squares). */
function windows(x0: number, y0: number, cols: number, rows: number, c: Pal, step = 0.1, size = 0.055): ReactNode[] {
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const on = c.lit && (r * 7 + k * 3) % 5 !== 0;
      out.push(
        <rect
          key={`${r}-${k}`}
          x={x0 + k * step}
          y={y0 + r * step}
          width={size}
          height={size}
          fill={on ? c.light : '#0b1826'}
          opacity={on ? 0.95 : 0.8}
          shapeRendering="crispEdges"
        />,
      );
    }
  }
  return out;
}

function details(id: VesselId, L: number, c: Pal): ReactNode {
  switch (id) {
    case 'arcology': {
      // A floating city: tower blocks with lit windows, a helipad at the stern.
      const towers: Array<[number, number, number]> = [
        [0.85, 0.27, 0.46],
        [1.55, 0.22, 0.56],
        [2.3, 0.28, 0.44],
        [3.0, 0.24, 0.52],
      ];
      return (
        <g>
          {towers.map(([u, v, s], i) => (
            <g key={i}>
              <rect x={u} y={v} width={s} height={s} fill="#0e2438" stroke={c.hue} strokeWidth={0.03} shapeRendering="crispEdges" />
              {windows(u + 0.07, v + 0.07, Math.floor((s - 0.08) / 0.1), Math.floor((s - 0.08) / 0.1), c)}
            </g>
          ))}
          <circle cx={L - 0.55} cy={0.5} r={0.22} fill="#0e2438" stroke={c.hue} strokeWidth={0.03} />
          <path
            d={`M ${L - 0.63} 0.4 L ${L - 0.63} 0.6 M ${L - 0.47} 0.4 L ${L - 0.47} 0.6 M ${L - 0.63} 0.5 L ${L - 0.47} 0.5`}
            stroke={c.light}
            strokeWidth={0.04}
          />
        </g>
      );
    }
    case 'tidebreaker':
      // Armoured ram-hull: bow ram plate, deck armour and twin turrets.
      return (
        <g>
          <path d="M 0.12 0.5 L 0.5 0.3 L 0.5 0.7 Z" fill={c.hue} opacity={0.85} />
          {[0.95, 1.75, 2.55].map((u) => (
            <rect
              key={u}
              x={u}
              y={0.26}
              width={0.62}
              height={0.48}
              fill="#0f2436"
              stroke={c.hue}
              strokeWidth={0.025}
              shapeRendering="crispEdges"
            />
          ))}
          {[1.26, 2.86].map((u) => (
            <g key={u}>
              <circle cx={u} cy={0.5} r={0.15} fill="#1d3b54" stroke={c.hue} strokeWidth={0.03} />
              <rect x={u - 0.42} y={0.46} width={0.3} height={0.08} fill={c.light} />
            </g>
          ))}
          <rect x={L - 0.36} y={0.38} width={0.14} height={0.24} fill={c.light} opacity={0.9} shapeRendering="crispEdges" />
        </g>
      );
    case 'thunderhead':
      // Stormcloud gunship: cloud domes and a crackling mast.
      return (
        <g>
          {[0.95, 2.75].map((u) => (
            <g key={u}>
              <circle cx={u} cy={0.44} r={0.16} fill="#231a45" stroke={c.hue} strokeWidth={0.03} />
              <circle cx={u + 0.2} cy={0.56} r={0.15} fill="#231a45" stroke={c.hue} strokeWidth={0.03} />
              <circle cx={u - 0.12} cy={0.58} r={0.12} fill="#231a45" stroke={c.hue} strokeWidth={0.03} />
            </g>
          ))}
          <circle cx={1.9} cy={0.5} r={0.2} fill="#140f2b" stroke={c.hue} strokeWidth={0.04} />
          <path
            d="M 1.93 0.3 L 1.82 0.52 L 1.95 0.52 L 1.86 0.72"
            fill="none"
            stroke={c.lit ? '#ffe45e' : '#6b5b2a'}
            strokeWidth={0.05}
            strokeLinejoin="bevel"
          />
          {windows(L - 0.62, 0.38, 3, 3, c, 0.09, 0.05)}
        </g>
      );
    case 'lanternfish':
      // Deep-runner: capsule hull, conning tower and a lure-light prow.
      return (
        <g>
          <rect x={1.15} y={0.33} width={0.62} height={0.34} rx={0.14} fill="#10283a" stroke={c.hue} strokeWidth={0.03} />
          <rect x={1.32} y={0.44} width={0.28} height={0.12} rx={0.04} fill={c.light} opacity={0.85} />
          <path d="M 0.52 0.36 Q 0.3 0.1 0.12 0.2" fill="none" stroke={c.hue} strokeWidth={0.035} />
          <circle cx={0.13} cy={0.2} r={0.075} fill={c.lit ? '#f7ffb0' : '#555'} />
          {[2.05, 2.3, 2.55].map((u) => (
            <rect key={u} x={u} y={0.46} width={0.12} height={0.08} fill={c.light} opacity={0.8} shapeRendering="crispEdges" />
          ))}
        </g>
      );
    case 'riptide':
      // Twin-jet interceptor: cockpit canopy, fins and afterburners.
      return (
        <g>
          <ellipse cx={0.95} cy={0.5} rx={0.3} ry={0.13} fill="#2a1233" stroke={c.hue} strokeWidth={0.03} />
          <ellipse cx={0.9} cy={0.47} rx={0.12} ry={0.05} fill="#ffffff" opacity={0.55} />
          <path d={`M 1.5 0.16 L 2.1 0.16 L 1.85 0.34 Z M 1.5 0.84 L 2.1 0.84 L 1.85 0.66 Z`} fill={c.hue} opacity={0.8} />
          <rect x={L - 0.62} y={0.28} width={0.46} height={0.14} fill="#1c0f25" stroke={c.hue} strokeWidth={0.02} />
          <rect x={L - 0.62} y={0.58} width={0.46} height={0.14} fill="#1c0f25" stroke={c.hue} strokeWidth={0.02} />
          {c.lit ? (
            <g className="sh-jets">
              <path d={`M ${L - 0.16} 0.3 L ${L - 0.01} 0.35 L ${L - 0.16} 0.4 Z`} fill="#ffd166" />
              <path d={`M ${L - 0.16} 0.6 L ${L - 0.01} 0.65 L ${L - 0.16} 0.7 Z`} fill="#ffd166" />
            </g>
          ) : null}
        </g>
      );
    case 'glowdart':
      // Quick scout skiff: sail fin and a spark trail.
      return (
        <g>
          <path d="M 0.7 0.5 L 1.3 0.26 L 1.3 0.74 Z" fill={c.hue} opacity={0.85} />
          <rect x={1.35} y={0.42} width={0.26} height={0.16} fill="#0f2436" stroke={c.hue} strokeWidth={0.025} />
          {c.lit
            ? [0.08, 0.16, 0.24].map((d, i) => (
                <rect
                  key={i}
                  x={L - 0.2 + d * 0.3}
                  y={0.46 + (i % 2 ? -0.1 : 0.1)}
                  width={0.05}
                  height={0.05}
                  fill="#e0f7ff"
                  opacity={0.9 - i * 0.2}
                  shapeRendering="crispEdges"
                />
              ))
            : null}
        </g>
      );
    case 'wisp':
      // Courier drone on a hydrofoil: foils and a single glowing eye.
      return (
        <g>
          <path d="M 0.7 0.16 L 0.7 0.84 M 1.45 0.2 L 1.45 0.8" stroke={c.hue} strokeWidth={0.05} />
          <circle cx={0.95} cy={0.5} r={0.14} fill="#0f2436" stroke={c.hue} strokeWidth={0.03} />
          <circle cx={0.95} cy={0.5} r={0.06} fill={c.lit ? '#ffffff' : '#555'} />
          <rect x={1.2} y={0.44} width={0.5} height={0.12} fill={c.light} opacity={0.6} shapeRendering="crispEdges" />
        </g>
      );
  }
}

/** Shared SVG defs (glow filter) — one per board SVG, with a unique id. */
export function ArtDefs({ glowId, strength }: { glowId: string; strength: number }) {
  if (strength <= 0) return null;
  return (
    <defs>
      <filter id={glowId} x="-30%" y="-60%" width="160%" height="220%">
        <feGaussianBlur in="SourceGraphic" stdDeviation={0.05 * strength} result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

/** Water splash (miss). */
export function MissMark({ x, y, fresh }: { x: number; y: number; fresh?: boolean }) {
  return (
    <g transform={`translate(${x + 0.5} ${y + 0.5})`} className={fresh ? 'sh-mark sh-mark--miss is-new' : 'sh-mark sh-mark--miss'}>
      {fresh ? <circle r={0.34} className="sh-ripple" fill="none" stroke={SEA.splash} strokeWidth={0.05} /> : null}
      <circle r={0.26} fill="none" stroke={SEA.splash} strokeWidth={0.04} opacity={0.45} />
      <rect x={-0.08} y={-0.08} width={0.16} height={0.16} fill={SEA.splash} opacity={0.85} shapeRendering="crispEdges" />
    </g>
  );
}

/** Pixel burst (hit); `sunk` burns darker. */
export function HitMark({ x, y, fresh, sunk }: { x: number; y: number; fresh?: boolean; sunk?: boolean }) {
  const outer = sunk ? '#b3261e' : SEA.fireRed;
  const mid = sunk ? '#e0653a' : SEA.fire;
  const core = sunk ? '#ffb45e' : SEA.fireHot;
  return (
    <g transform={`translate(${x + 0.5} ${y + 0.5})`} className={`sh-mark sh-mark--hit${sunk ? ' is-sunk' : ''}${fresh ? ' is-new' : ''}`}>
      {fresh ? <circle r={0.3} className="sh-shock" fill="none" stroke={SEA.fireHot} strokeWidth={0.06} /> : null}
      <g shapeRendering="crispEdges">
        {/* diagonal sparks */}
        <rect x={-0.34} y={-0.34} width={0.12} height={0.12} fill={outer} />
        <rect x={0.22} y={-0.34} width={0.12} height={0.12} fill={outer} />
        <rect x={-0.34} y={0.22} width={0.12} height={0.12} fill={outer} />
        <rect x={0.22} y={0.22} width={0.12} height={0.12} fill={outer} />
        {/* cross */}
        <rect x={-0.1} y={-0.4} width={0.2} height={0.8} fill={mid} />
        <rect x={-0.4} y={-0.1} width={0.8} height={0.2} fill={mid} />
        <rect x={-0.2} y={-0.2} width={0.4} height={0.4} fill={mid} />
        <rect x={-0.1} y={-0.1} width={0.2} height={0.2} fill={core} />
      </g>
    </g>
  );
}

/** Aiming reticle; optional number (salvo order). */
export function Reticle({ x, y, n, pending }: { x: number; y: number; n?: number; pending?: boolean }) {
  const a = 0.08;
  const s = 0.26;
  const e = 1 - a;
  return (
    <g transform={`translate(${x} ${y})`} className={pending ? 'sh-reticle is-pending' : 'sh-reticle'}>
      <path
        d={`M ${a} ${a + s} L ${a} ${a} L ${a + s} ${a} M ${e - s} ${a} L ${e} ${a} L ${e} ${a + s} M ${e} ${e - s} L ${e} ${e} L ${e - s} ${e} M ${a + s} ${e} L ${a} ${e} L ${a} ${e - s}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.07}
      />
      <rect x={0.44} y={0.44} width={0.12} height={0.12} fill="currentColor" shapeRendering="crispEdges" />
      {n !== undefined ? (
        <text x={0.5} y={0.36} textAnchor="middle" fontSize={0.26} fill="currentColor" className="sh-reticle__n">
          {n}
        </text>
      ) : null}
    </g>
  );
}

/** Stand-alone vessel icon (dock cards, fleet status). */
export function VesselIcon({ id, tone = 'live', className }: { id: VesselId; tone?: VesselTone; className?: string }) {
  const L = VESSELS[id].length;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${L} 1`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
    >
      <Vessel id={id} x={0} y={0} dir="h" tone={tone} />
    </svg>
  );
}
