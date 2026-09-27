/**
 * Block Drop pieces and rotation data.
 *
 * Seven four-cell pieces (internally I O T S Z J L — the names never appear in the UI). Each
 * piece lives in an n×n box (I: 4, O: 2, others: 3); rotation state r ∈ {0, 1 (CW), 2, 3 (CCW)}
 * is the spawn shape rotated clockwise r times: (x, y) → (n − 1 − y, x). Grid y grows DOWN.
 *
 * Wall kicks ("DAScade Rotation System"): when a rotation collides, up to four alternative
 * offsets are tried in order, first fit wins. The offsets follow the widely documented
 * community-standard kick tables for this style of game (a game-mechanics convention, adopted
 * so experienced players' muscle memory works); they are written here in grid coordinates
 * (y down), i.e. with the published "up" values negated.
 */

export const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type PieceId = (typeof PIECES)[number];

/** Board cell value for each piece (0 = empty). */
export const PIECE_CELL: Record<PieceId, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
export const CELL_PIECE: ReadonlyArray<PieceId | null> = [null, 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const SPAWN: Record<PieceId, { n: number; cells: ReadonlyArray<readonly [number, number]> }> = {
  I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

export type Cells = ReadonlyArray<readonly [number, number]>;

function rotateCells(cells: Cells, n: number): Array<[number, number]> {
  return cells.map(([x, y]) => [n - 1 - y, x] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** SHAPES[piece][rotation] → cell offsets inside the piece box. */
export const SHAPES: Record<PieceId, [Cells, Cells, Cells, Cells]> = (() => {
  const out = {} as Record<PieceId, [Cells, Cells, Cells, Cells]>;
  for (const id of PIECES) {
    const { n, cells } = SPAWN[id];
    const r0 = [...cells].map((c) => [c[0], c[1]] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const r1 = id === 'O' ? r0 : rotateCells(r0, n);
    const r2 = id === 'O' ? r0 : rotateCells(r1, n);
    const r3 = id === 'O' ? r0 : rotateCells(r2, n);
    out[id] = [r0, r1, r2, r3];
  }
  return out;
})();

export function boxSize(id: PieceId): number {
  return SPAWN[id].n;
}

type Kick = ReadonlyArray<readonly [number, number]>;

// Published tables use y-up; entries below are [dx, dyDown] = [x, −y].
const JLSTZ: Record<string, Kick> = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};

const I_KICKS: Record<string, Kick> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const O_KICKS: Kick = [[0, 0]];

export function kicksFor(id: PieceId, from: number, to: number): Kick {
  if (id === 'O') return O_KICKS;
  const key = `${from}>${to}`;
  return (id === 'I' ? I_KICKS[key] : JLSTZ[key]) ?? [[0, 0]];
}
