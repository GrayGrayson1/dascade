/**
 * DAS Checkers piece art: an original pixel-modern disc (16×16 pixel grid, crisp edges) seen from
 * slightly above — a bevelled top face with an inset groove ring and a specular highlight, a solid
 * side band for thickness and a neon rim. Kings stand taller and wear a pixel crown.
 *
 * Colours come from CSS custom properties declared once in checkers.css (`--ck-dark-*`,
 * `--ck-light-*`, `--ck-crown-*`) so a theme can restyle the set without touching this file.
 */
import { memo } from 'react';

export type PieceTone = 'dark' | 'light';

type Span = readonly [row: number, x0: number, x1: number];

/** Disc silhouette (rows 0–11 of the top face), as inclusive horizontal spans. */
const DISC: readonly Span[] = [
  [0, 5, 10],
  [1, 3, 12],
  [2, 2, 13],
  [3, 1, 14],
  [4, 1, 14],
  [5, 1, 14],
  [6, 1, 14],
  [7, 1, 14],
  [8, 1, 14],
  [9, 2, 13],
  [10, 3, 12],
  [11, 5, 10],
];

/** Inset groove ring on the top face. */
const RING: readonly Span[] = [
  [3, 5, 10],
  [4, 4, 4],
  [4, 11, 11],
  [5, 3, 3],
  [5, 12, 12],
  [6, 3, 3],
  [6, 12, 12],
  [7, 4, 4],
  [7, 11, 11],
  [8, 5, 10],
];

/** Specular highlight (upper-left of the top face). */
const SHINE: readonly Span[] = [
  [1, 5, 7],
  [2, 3, 4],
  [3, 2, 2],
];

/** Soft lower-right shading on the top face. */
const SHADE: readonly Span[] = [
  [9, 10, 12],
  [10, 8, 11],
];

/** Pixel crown (drawn over the top face on kings). */
const CROWN: readonly Span[] = [
  [3, 4, 4],
  [3, 7, 8],
  [3, 11, 11],
  [4, 4, 5],
  [4, 7, 8],
  [4, 10, 11],
  [5, 4, 11],
  [6, 4, 11],
];
const CROWN_BAND: readonly Span[] = [[7, 4, 11]];
const CROWN_GEMS: readonly Span[] = [
  [6, 6, 6],
  [6, 9, 9],
];
const CROWN_SHINE: readonly Span[] = [
  [3, 4, 4],
  [5, 5, 6],
];

function spans(list: readonly Span[], fill: string, dy = 0) {
  return list.map(([row, x0, x1]) => <rect key={`${row}:${x0}`} x={x0} y={row + dy} width={x1 - x0 + 1} height={1} fill={fill} />);
}

interface Variant {
  /** Rows the top face is pushed down (men sit lower than kings). */
  lift: number;
  /** Side-band thickness in pixels. */
  depth: number;
  /** One-pixel neon outline around the whole silhouette (top face + side band). */
  outline: Span[];
}

function makeVariant(lift: number, depth: number): Variant {
  const rows = new Map<number, [number, number]>();
  for (let dy = lift; dy <= lift + depth; dy++) {
    for (const [r, a, b] of DISC) {
      const y = r + dy;
      const cur = rows.get(y);
      rows.set(y, cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b]);
    }
  }
  const ys = [...rows.keys()];
  const outline: Span[] = [];
  for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
    const near = [rows.get(y - 1), rows.get(y), rows.get(y + 1)].filter((v): v is [number, number] => Boolean(v));
    if (near.length === 0) continue;
    outline.push([y, Math.min(...near.map((v) => v[0])) - 1, Math.max(...near.map((v) => v[1])) + 1]);
  }
  return { lift, depth, outline };
}

const MAN = makeVariant(2, 2);
const KING = makeVariant(0, 4);

export interface PieceArtProps {
  tone: PieceTone;
  king: boolean;
  className?: string;
}

/** The piece graphic only (decorative — the square/button around it carries the accessible name). */
export const PieceArt = memo(function PieceArt({ tone, king, className }: PieceArtProps) {
  const v = (name: string) => `var(--ck-${tone}-${name})`;
  // Kings are taller: the top face sits two pixels higher on a thicker side band.
  const { lift, depth, outline } = king ? KING : MAN;
  return (
    <svg className={className} viewBox="-1 -1 18 19" shapeRendering="crispEdges" aria-hidden focusable="false">
      {/* contact shadow */}
      <rect x={2} y={16} width={12} height={1} fill="rgba(0,0,0,0.3)" />
      <rect x={4} y={17} width={8} height={1} fill="rgba(0,0,0,0.2)" />
      {/* neon rim around the whole silhouette */}
      {spans(outline, v('rim'))}
      {/* side band (thickness): darkest pixel row at the bottom */}
      {spans(DISC, v('edge'), lift + depth)}
      {Array.from({ length: depth - 1 }, (_, i) => (
        <g key={i}>{spans(DISC, v('side'), lift + depth - 1 - i)}</g>
      ))}
      {/* top face */}
      {spans(DISC, v('top'), lift)}
      {spans(SHADE, v('shade'), lift)}
      {spans(RING, v('ring'), lift)}
      {spans(SHINE, v('shine'), lift)}
      {king ? (
        <g>
          {spans(CROWN, 'var(--ck-crown)', lift)}
          {spans(CROWN_BAND, 'var(--ck-crown-deep)', lift)}
          {spans(CROWN_GEMS, 'var(--ck-crown-gem)', lift)}
          {spans(CROWN_SHINE, 'var(--ck-crown-shine)', lift)}
        </g>
      ) : null}
    </svg>
  );
});

/** Small inline swatch used in player cards, the move list and results ("Dark", "Light"). */
export function PieceSwatch({ tone, king = false, className }: { tone: PieceTone; king?: boolean; className?: string }) {
  return (
    <span className={className ? `ck-swatch ${className}` : 'ck-swatch'} data-tone={tone}>
      <PieceArt tone={tone} king={king} />
    </span>
  );
}
