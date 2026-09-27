/**
 * Saturday Morning environment: the TV studio behind the whole app.
 *   - electric-blue studio wall with a big, slowly turning sunburst,
 *   - coloured studio lights washing across it,
 *   - bright geometric shapes and squiggles (thick ink outlines) drifting and spinning at the edges.
 * Pure CSS/SVG, compositor-only animation (transform/opacity). FULL = everything; REDUCED = half the
 * shapes, no sunburst spin, no light sweep; MINIMAL / reduced motion = a static set. Inside a game the
 * whole layer goes quiet (the game backdrop covers it anyway). Browsers pause CSS animation in hidden tabs.
 */
import type { CSSProperties } from 'react';
import type { SkinRenderContext } from '../types.ts';

type ShapeKind = 'tri' | 'squiggle' | 'zigzag' | 'ring' | 'star' | 'plus' | 'dots' | 'half' | 'square' | 'bolt';

interface Shape {
  k: ShapeKind;
  /** position in % of the viewport */
  x: number;
  y: number;
  /** size in px (scaled by --sm-scale) */
  s: number;
  c: string;
  /** float duration (s), delay (s), base rotation (deg) */
  d: number;
  dl: number;
  r: number;
  spin?: boolean;
  /** shown at REDUCED as well */
  core?: boolean;
}

const INK = '#120833';
const Y = '#ffe14d';
const P = '#ff4fa3';
const T = '#2ee6e6';
const L = '#c1f23a';
const O = '#ff9a2e';
const W = '#ffffff';

// Kept to the edges and corners so they never sit behind the middle of the screen.
const SHAPES: Shape[] = [
  { k: 'tri', x: 4, y: 18, s: 64, c: Y, d: 13, dl: -2, r: -12, core: true },
  { k: 'squiggle', x: 3.5, y: 68, s: 90, c: P, d: 11, dl: -5, r: 8, core: true },
  { k: 'ring', x: 90, y: 14, s: 70, c: T, d: 15, dl: -1, r: 0, core: true },
  { k: 'star', x: 94, y: 62, s: 58, c: Y, d: 9, dl: -3, r: 10, spin: true, core: true },
  { k: 'zigzag', x: 82, y: 86, s: 92, c: L, d: 12, dl: -7, r: -6, core: true },
  { k: 'dots', x: 2, y: 44, s: 56, c: W, d: 16, dl: -4, r: 0, core: true },
  { k: 'plus', x: 24, y: 2.5, s: 40, c: O, d: 10, dl: -6, r: 15, spin: true },
  { k: 'half', x: 70, y: 6, s: 60, c: P, d: 14, dl: -8, r: 20 },
  { k: 'square', x: 97, y: 36, s: 44, c: O, d: 11, dl: -2, r: 24, spin: true },
  { k: 'bolt', x: 6, y: 90, s: 54, c: Y, d: 12, dl: -9, r: -10 },
  { k: 'squiggle', x: 60, y: 94, s: 80, c: T, d: 13, dl: -3, r: -4 },
  { k: 'tri', x: 36, y: 96, s: 44, c: L, d: 10, dl: -5, r: 30, spin: true },
  { k: 'ring', x: 30, y: 4, s: 36, c: L, d: 12, dl: -2, r: 0 },
  { k: 'dots', x: 88, y: 44, s: 44, c: Y, d: 15, dl: -6, r: 0 },
  { k: 'zigzag', x: 46, y: 3, s: 70, c: W, d: 14, dl: -10, r: 4 },
  { k: 'star', x: 97, y: 80, s: 30, c: T, d: 9, dl: -4, r: -8, spin: true },
];

function Glyph({ k, c }: { k: ShapeKind; c: string }) {
  const sw = { strokeWidth: 3, stroke: INK, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (k) {
    case 'tri':
      return <path d="M5 35 L20 6 L35 35 Z" fill={c} {...sw} />;
    case 'squiggle':
      return (
        <>
          <path d="M3 22 Q8 8 13 22 T23 22 T33 22 T43 22" fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" />
          <path d="M3 22 Q8 8 13 22 T23 22 T33 22 T43 22" fill="none" stroke={c} strokeWidth={4.5} strokeLinecap="round" />
        </>
      );
    case 'zigzag':
      return (
        <>
          <path d="M3 30 L11 12 L19 30 L27 12 L35 30 L43 12" fill="none" stroke={INK} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
          <path d="M3 30 L11 12 L19 30 L27 12 L35 30 L43 12" fill="none" stroke={c} strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
        </>
      );
    case 'ring':
      return (
        <>
          <circle cx="20" cy="20" r="13" fill="none" stroke={INK} strokeWidth={11} />
          <circle cx="20" cy="20" r="13" fill="none" stroke={c} strokeWidth={6} />
        </>
      );
    case 'star':
      return <path d="M20 3 L25 15 L38 15 L27.5 23 L31.5 36 L20 28 L8.5 36 L12.5 23 L2 15 L15 15 Z" fill={c} {...sw} />;
    case 'plus':
      return <path d="M15 4 H25 V15 H36 V25 H25 V36 H15 V25 H4 V15 H15 Z" fill={c} {...sw} />;
    case 'dots':
      return (
        <g fill={c} stroke={INK} strokeWidth={2}>
          {[6, 20, 34].flatMap((y) => [6, 20, 34].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={4} />))}
        </g>
      );
    case 'half':
      return <path d="M4 26 A16 16 0 0 1 36 26 Z" fill={c} {...sw} />;
    case 'square':
      return <rect x="7" y="7" width="26" height="26" rx="4" fill={c} {...sw} />;
    case 'bolt':
      return <path d="M23 3 L8 23 H19 L15 37 L32 15 H21 Z" fill={c} {...sw} />;
  }
}

export function SaturdayEnvironment({ fx, reducedMotion, place }: SkinRenderContext) {
  const calm = place === 'game';
  const live = !reducedMotion && fx !== 'off' && !calm;
  const shapes = calm ? [] : fx === 'high' ? SHAPES : fx === 'low' ? SHAPES.filter((s) => s.core) : SHAPES.filter((s) => s.core).slice(0, 4);
  return (
    <div className="sm-env" data-live={live ? 'true' : undefined} data-fx={fx} data-calm={calm ? 'true' : undefined} data-place={place}>
      <div className="sm-env__burst" />
      <div className="sm-env__lights">
        <i className="sm-env__light sm-env__light--a" />
        <i className="sm-env__light sm-env__light--b" />
        <i className="sm-env__light sm-env__light--c" />
      </div>
      <div className="sm-env__shapes">
        {shapes.map((s, i) => (
          <span
            key={i}
            className="sm-shape"
            data-spin={s.spin ? 'true' : undefined}
            data-top={s.y < 12 ? 'true' : undefined}
            style={
              {
                left: `${s.x}%`,
                top: `${s.y}%`,
                '--s': `${s.s}px`,
                '--d': `${s.d}s`,
                '--dl': `${s.dl}s`,
                '--r': `${s.r}deg`,
              } as CSSProperties
            }
          >
            <svg viewBox="0 0 46 40" width="100%" height="100%" aria-hidden focusable="false">
              <Glyph k={s.k} c={s.c} />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}
