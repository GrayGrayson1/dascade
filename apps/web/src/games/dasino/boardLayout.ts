/**
 * Geometry of the European betting layout, in layout units (horizontal table):
 *   x: 0 = zero column, 1–12 = streets (1-2-3 … 34-35-36), 13 = "2 to 1" column bets
 *   y: 0 = top row (3, 6 … 36), 1 = middle row, 2 = bottom row (1, 4 … 34),
 *      3–3.75 = dozens, 3.75–4.5 = even-money bets
 * Inside bets that sit on lines (splits, streets, corners, six lines, trios,
 * first four) get small hit areas on those edges/corners, exactly where a
 * player would put the chip on a real felt.
 */
import { getRouletteBet, rouletteBetKey, type RouletteBetDef } from '@dascade/game-core/dasino';

export const BOARD_W = 14;
export const BOARD_H = 4.5;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SpotKind = 'number' | 'zero' | 'edge-v' | 'edge-h' | 'corner' | 'column' | 'dozen' | 'even';

export interface BoardSpot {
  key: string;
  kind: SpotKind;
  rect: Rect;
  def: RouletteBetDef;
  /** Where the chip stack sits (layout units). */
  anchor: { x: number; y: number };
  /** Visible text on the felt (outside bets / numbers). */
  text?: string;
}

const EDGE = 0.3;
const EDGE_LEN = 0.56;
const CORNER = 0.34;

export function numberCell(n: number): Rect {
  if (n === 0) return { x: 0, y: 0, w: 1, h: 3 };
  const s = Math.floor((n - 1) / 3);
  const c = (n - 1) % 3;
  return { x: 1 + s, y: 2 - c, w: 1, h: 1 };
}

/**
 * Chips on numbers and outside boxes sit toward a corner/end so the printed
 * number or label stays readable; line/corner bets sit exactly on their line.
 */
function defaultAnchor(kind: SpotKind, r: Rect): { x: number; y: number } {
  if (kind === 'number' || kind === 'column') return { x: r.x + r.w - 0.27, y: r.y + r.h - 0.22 };
  if (kind === 'zero') return { x: r.x + r.w / 2, y: r.y + r.h - 0.3 };
  if (kind === 'dozen' || kind === 'even') return { x: r.x + r.w - 0.3, y: r.y + r.h / 2 + 0.12 };
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function spot(kind: SpotKind, key: string, rect: Rect, anchor?: { x: number; y: number }, text?: string): BoardSpot {
  const def = getRouletteBet(key);
  if (!def) throw new Error(`Board references unknown bet ${key}`);
  return { key, kind, rect, def, anchor: anchor ?? defaultAnchor(kind, rect), text };
}

function vEdge(key: string, cx: number, cy: number): BoardSpot {
  return spot('edge-v', key, { x: cx - EDGE / 2, y: cy - EDGE_LEN / 2, w: EDGE, h: EDGE_LEN }, { x: cx, y: cy });
}

function hEdge(key: string, cx: number, cy: number): BoardSpot {
  return spot('edge-h', key, { x: cx - EDGE_LEN / 2, y: cy - EDGE / 2, w: EDGE_LEN, h: EDGE }, { x: cx, y: cy });
}

function corner(key: string, cx: number, cy: number): BoardSpot {
  return spot('corner', key, { x: cx - CORNER / 2, y: cy - CORNER / 2, w: CORNER, h: CORNER }, { x: cx, y: cy });
}

function build() {
  const numbers: BoardSpot[] = [spot('zero', 'straight:0', numberCell(0), undefined, '0')];
  for (let n = 1; n <= 36; n++) numbers.push(spot('number', `straight:${n}`, numberCell(n), undefined, String(n)));

  const inside: BoardSpot[] = [];
  for (let n = 1; n <= 36; n++) {
    const s = Math.floor((n - 1) / 3);
    const c = (n - 1) % 3;
    if (n <= 33) inside.push(vEdge(rouletteBetKey('split', [n, n + 3]), 2 + s, 2 - c + 0.5));
    if (c < 2) inside.push(hEdge(rouletteBetKey('split', [n, n + 1]), 1 + s + 0.5, 2 - c));
    if (c < 2 && n <= 32) inside.push(corner(rouletteBetKey('corner', [n, n + 1, n + 3, n + 4]), 2 + s, 2 - c));
  }
  for (let s = 0; s < 12; s++) {
    const a = s * 3 + 1;
    inside.push(hEdge(rouletteBetKey('street', [a, a + 1, a + 2]), 1 + s + 0.5, 3));
    if (s < 11) inside.push(corner(rouletteBetKey('line', [a, a + 1, a + 2, a + 3, a + 4, a + 5]), 2 + s, 3));
  }
  for (const k of [1, 2, 3]) inside.push(vEdge(rouletteBetKey('split', [0, k]), 1, 3 - k + 0.5));
  inside.push(corner('street:0-1-2', 1, 2));
  inside.push(corner('street:0-2-3', 1, 1));
  inside.push(corner('corner:0-1-2-3', 1, 3));

  const outside: BoardSpot[] = [];
  for (const k of [1, 2, 3] as const) outside.push(spot('column', `column:${k}`, { x: 13, y: 3 - k, w: 1, h: 1 }, undefined, '2 to 1'));
  for (const d of [1, 2, 3] as const) outside.push(spot('dozen', `dozen:${d}`, { x: 1 + 4 * (d - 1), y: 3, w: 4, h: 0.75 }, undefined, ['1st 12', '2nd 12', '3rd 12'][d - 1]));
  const evens: Array<[string, string]> = [
    ['low', '1–18'],
    ['even', 'EVEN'],
    ['red', 'RED'],
    ['black', 'BLACK'],
    ['odd', 'ODD'],
    ['high', '19–36'],
  ];
  evens.forEach(([key, text], i) => outside.push(spot('even', key, { x: 1 + i * 2, y: 3.75, w: 2, h: 0.75 }, undefined, text)));
  return { numbers, inside, outside };
}

export const BOARD = build();
export const ALL_SPOTS: readonly BoardSpot[] = [...BOARD.numbers, ...BOARD.inside, ...BOARD.outside];
export const SPOT_BY_KEY: ReadonlyMap<string, BoardSpot> = new Map(ALL_SPOTS.map((s) => [s.key, s]));

export type Orientation = 'horizontal' | 'vertical';

/**
 * Rect → CSS percentages. Vertical (phones) rotates the table: zero on top,
 * streets running down, outside bets on the left.
 */
export function toPercent(r: Rect, o: Orientation): { left: string; top: string; width: string; height: string } {
  if (o === 'horizontal') {
    return { left: pct(r.x / BOARD_W), top: pct(r.y / BOARD_H), width: pct(r.w / BOARD_W), height: pct(r.h / BOARD_H) };
  }
  const x = BOARD_H - r.y - r.h;
  return { left: pct(x / BOARD_H), top: pct(r.x / BOARD_W), width: pct(r.h / BOARD_H), height: pct(r.w / BOARD_W) };
}

export function pointPercent(p: { x: number; y: number }, o: Orientation): { left: string; top: string } {
  if (o === 'horizontal') return { left: pct(p.x / BOARD_W), top: pct(p.y / BOARD_H) };
  return { left: pct((BOARD_H - p.y) / BOARD_H), top: pct(p.x / BOARD_W) };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}
