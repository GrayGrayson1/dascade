/**
 * DAS Chess — original pixel-modern piece art.
 *
 * Each piece is a 16×16 silhouette mask; the renderer derives a 1-px outline (8-neighbourhood),
 * a top-left highlight band, a bottom-right shade band and a soft inner glint, then merges every
 * colour layer into one SVG path of horizontal runs (crispEdges) — so pieces stay razor sharp from
 * 20 px move-list glyphs to 120 px boards, with only ~5 path elements each.
 *
 * Mask legend: '#' body, 'x' detail (eye, slit, band — drawn in the detail colour), '.' empty.
 */
import { memo } from 'react';

export type PieceKind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PieceColor = 'w' | 'b';

const MASKS: Record<PieceKind, readonly string[]> = {
  p: [
    '................',
    '................',
    '................',
    '................',
    '......####......',
    '.....######.....',
    '.....######.....',
    '......####......',
    '.....xxxxxx.....',
    '......####......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '................',
    '................',
  ],
  r: [
    '................',
    '................',
    '...##..##..##...',
    '...##..##..##...',
    '...##########...',
    '....########....',
    '....#x#####.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '....xxxxxxxx....',
    '...##########...',
    '...##########...',
    '................',
    '................',
  ],
  n: [
    '................',
    '................',
    '........##......',
    '.......####.....',
    '......######....',
    '.....#x######...',
    '....##########..',
    '...###########..',
    '..####.#######..',
    '..###...######..',
    '.......#######..',
    '......########..',
    '....xxxxxxxxx...',
    '...##########...',
    '................',
    '................',
  ],
  b: [
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '.....####x#.....',
    '....####x###....',
    '....###x####....',
    '....########....',
    '.....######.....',
    '......####......',
    '.....xxxxxx.....',
    '......####......',
    '....########....',
    '...##########...',
    '................',
    '................',
  ],
  q: [
    '................',
    '..#....##....#..',
    '..##...##...##..',
    '..###..##..###..',
    '...##########...',
    '...##########...',
    '....xxxxxxxx....',
    '.....######.....',
    '......####......',
    '.....######.....',
    '......####......',
    '.....######.....',
    '....########....',
    '..############..',
    '................',
    '................',
  ],
  k: [
    '................',
    '.......##.......',
    '......####......',
    '.......##.......',
    '....###..###....',
    '...##########...',
    '...##########...',
    '....xxxxxxxx....',
    '.....######.....',
    '......####......',
    '.....######.....',
    '......####......',
    '....########....',
    '..############..',
    '................',
    '................',
  ],
};

/** Piece palette — the art's own colours (declared once here so a theme can swap them). */
export const PIECE_PALETTE: Record<
  PieceColor,
  { outline: string; body: string; hi: string; glint: string; shade: string; detail: string }
> = {
  w: { outline: '#1d140c', body: '#f1e6cb', hi: '#fffbf1', glint: '#ffffff', shade: '#c7ad80', detail: '#c08a2e' },
  b: { outline: '#050409', body: '#2e2742', hi: '#5f5485', glint: '#8b80b8', shade: '#16121f', detail: '#38bdf8' },
};

type Layer = 'outline' | 'body' | 'hi' | 'glint' | 'shade' | 'detail';
const LAYERS: readonly Layer[] = ['outline', 'body', 'shade', 'hi', 'glint', 'detail'];

function buildPaths(kind: PieceKind): Record<Layer, string> {
  const rows = MASKS[kind];
  const H = rows.length;
  const W = rows[0]!.length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? '.' : rows[y]![x]!);
  const inside = (x: number, y: number) => at(x, y) !== '.';
  const grid: Array<Array<Layer | null>> = Array.from({ length: H }, () => Array<Layer | null>(W).fill(null));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      if (c === '.') {
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inside(x + dx, y + dy)) edge = true;
        grid[y]![x] = edge ? 'outline' : null;
        continue;
      }
      if (c === 'x') {
        grid[y]![x] = 'detail';
        continue;
      }
      const litEdge = !inside(x - 1, y) || !inside(x, y - 1);
      const darkEdge = !inside(x + 1, y) || !inside(x, y + 1);
      const deepDark = !inside(x + 2, y) && inside(x + 1, y);
      grid[y]![x] = litEdge && !darkEdge ? 'hi' : darkEdge || deepDark ? 'shade' : 'body';
    }
  }
  // A small glint: the first two body pixels of the upper-left mass.
  let glints = 0;
  for (let y = 0; y < H && glints < 2; y++) {
    for (let x = 0; x < W && glints < 2; x++) {
      if (grid[y]![x] === 'body' && grid[y]![x - 1] === 'hi') {
        grid[y]![x] = 'glint';
        glints++;
        y++;
      }
    }
  }
  const out = { outline: '', body: '', hi: '', glint: '', shade: '', detail: '' } as Record<Layer, string>;
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const layer = grid[y]![x];
      if (!layer) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < W && grid[y]![end] === layer) end++;
      out[layer] += `M${x} ${y}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }
  return out;
}

const PATHS = Object.fromEntries((Object.keys(MASKS) as PieceKind[]).map((k) => [k, buildPaths(k)])) as Record<
  PieceKind,
  Record<Layer, string>
>;

const NAMES: Record<PieceKind, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function pieceName(kind: PieceKind, color: PieceColor): string {
  return `${color === 'w' ? 'white' : 'black'} ${NAMES[kind]}`;
}

export const ChessPiece = memo(function ChessPiece({
  kind,
  color,
  title,
  className,
}: {
  kind: PieceKind;
  color: PieceColor;
  title?: string;
  className?: string;
}) {
  const paths = PATHS[kind];
  const pal = PIECE_PALETTE[color];
  return (
    <svg
      className={className ?? 'ch-piece'}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-piece={`${color}${kind}`}
    >
      {LAYERS.map((layer) => (paths[layer] ? <path key={layer} d={paths[layer]} fill={pal[layer]} /> : null))}
    </svg>
  );
});
