/**
 * DAS Boardroom scenes: a four-move checkmate, a checkers multi-jump to the
 * crown, a tic-tac-toe fork (then a glimpse of Ultimate's nine boards), Four in
 * a Row's discs dropping into a diagonal win, a Reversi move that flips six
 * discs at once, and a hidden-fleet sonar duel.
 */
import {
  banner,
  blinkOn,
  clamp,
  cyc,
  disc,
  drawTextC,
  easeInOut,
  frame,
  hash,
  line,
  rect,
  sparkle,
  sprite,
  textWidth,
  type AttractFrame,
  type Scene,
} from '../attractKit.ts';

// ---------------------------------------------------------------------------
// Chess — Scholar's mate, played out on a walnut board with running clocks.
// ---------------------------------------------------------------------------
type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
const PIECE_ART: Record<Piece, readonly string[]> = {
  P: ['.....', '.....', '..#..', '.###.', '.###.'],
  R: ['#.#.#', '#####', '.###.', '.###.', '#####'],
  N: ['.##..', '####.', '..##.', '.###.', '#####'],
  B: ['..#..', '.##..', '.###.', '..#..', '.###.'],
  Q: ['#.#.#', '.###.', '.###.', '..#..', '#####'],
  K: ['..#..', '.###.', '..#..', '.###.', '#####'],
};
interface ChessPiece {
  id: string;
  kind: Piece;
  white: boolean;
  sq: string;
}
const START: ChessPiece[] = [];
const BACK: Piece[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
'abcdefgh'.split('').forEach((file, i) => {
  START.push({ id: `w${file}1`, kind: BACK[i]!, white: true, sq: `${file}1` });
  START.push({ id: `w${file}2`, kind: 'P', white: true, sq: `${file}2` });
  START.push({ id: `b${file}8`, kind: BACK[i]!, white: false, sq: `${file}8` });
  START.push({ id: `b${file}7`, kind: 'P', white: false, sq: `${file}7` });
});
const MATE: Array<[string, string]> = [
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['f1', 'c4'],
  ['b8', 'c6'],
  ['d1', 'h5'],
  ['g8', 'f6'],
  ['h5', 'f7'],
];
const CHESS_C = 9.6;
const MOVE0 = 0.6;
const MOVE_GAP = 0.78;
const MOVE_DUR = 0.34;

const sqXY = (sq: string): [number, number] => [sq.charCodeAt(0) - 97, 8 - Number(sq[1])];

function chessPosition(tt: number): { pieces: Array<ChessPiece & { x: number; y: number }>; last: [string, string] | null; moves: number } {
  const board = new Map<string, ChessPiece>();
  for (const p of START) board.set(p.sq, { ...p });
  let moving: { p: ChessPiece; from: string; to: string; k: number } | null = null;
  let last: [string, string] | null = null;
  let moves = 0;
  for (let i = 0; i < MATE.length; i++) {
    const [from, to] = MATE[i]!;
    const at = MOVE0 + i * MOVE_GAP;
    if (tt < at) break;
    const piece = board.get(from);
    if (!piece) break;
    const k = clamp((tt - at) / MOVE_DUR, 0, 1);
    last = [from, to];
    moves = i + 1;
    if (k < 1) {
      moving = { p: piece, from, to, k };
      break;
    }
    board.delete(from);
    board.set(to, { ...piece, sq: to }); // a capture simply replaces the target
  }
  const out: Array<ChessPiece & { x: number; y: number }> = [];
  for (const [sq, p] of board) {
    if (moving && moving.from === sq) continue;
    const [x, y] = sqXY(sq);
    out.push({ ...p, x, y });
  }
  if (moving) {
    const [x0, y0] = sqXY(moving.from);
    const [x1, y1] = sqXY(moving.to);
    const e = easeInOut(moving.k);
    // a captured piece stays put until the mover lands on it
    out.push({ ...moving.p, x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e });
  }
  return { pieces: out, last, moves };
}

export const chess: Scene = {
  label: 'CHESS',
  length: CHESS_C,
  still: 7.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, CHESS_C);
    rect(ctx, 0, 0, W, H, '#140f08');
    for (let y = 0; y < H; y += 3) rect(ctx, 0, y, W, 1, '#19130a');
    const sq = Math.max(5, Math.floor(Math.min(H * 0.88, W * 0.66) / 8));
    const bw = sq * 8;
    const panel = W - bw >= 26;
    const bx = panel ? Math.round((W - bw - 24) / 2) : Math.round((W - bw) / 2);
    const by = Math.round((H - bw) / 2);
    // frame
    rect(ctx, bx - 2, by - 2, bw + 4, bw + 4, '#5a3a1a');
    rect(ctx, bx - 1, by - 1, bw + 2, bw + 2, '#c9a262');
    const { pieces, last, moves } = chessPosition(tt);
    const mate = moves >= MATE.length && tt > MOVE0 + (MATE.length - 1) * MOVE_GAP + MOVE_DUR;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const light = (r + c) % 2 === 0;
        let col = light ? '#e8d3a6' : '#8b5a2b';
        const name = `${String.fromCharCode(97 + c)}${8 - r}`;
        if (last && (last[0] === name || last[1] === name)) col = light ? '#f2e27a' : '#b9a23a';
        if (mate && name === 'e8' && blinkOn(f, tt, 4)) col = '#ff5a5f';
        rect(ctx, bx + c * sq, by + r * sq, sq, sq, col);
      }
    const scale = Math.max(1, Math.floor((sq - 1) / 5));
    const off = Math.floor((sq - 5 * scale) / 2);
    for (const p of pieces) {
      const px = Math.round(bx + p.x * sq + off);
      const py = Math.round(by + p.y * sq + off);
      const fill = p.white ? '#fbf6ea' : '#241a12';
      const edge = p.white ? '#5b4630' : '#d7b77a';
      sprite(ctx, PIECE_ART[p.kind], px + scale, py + scale, { '#': 'rgba(0,0,0,0.35)' }, scale);
      if (scale >= 2) {
        sprite(ctx, PIECE_ART[p.kind], px - 1, py, { '#': edge }, scale);
        sprite(ctx, PIECE_ART[p.kind], px + 1, py, { '#': edge }, scale);
      }
      sprite(ctx, PIECE_ART[p.kind], px, py, { '#': fill }, scale);
      if (scale < 2) rect(ctx, px, py + 4, 5, 1, edge);
    }
    // clocks
    if (panel) {
      const cx = bx + bw + 4;
      const cw = W - cx - 3;
      const whiteToMove = moves % 2 === 0;
      const base = [300 - Math.floor(tt * 3), 300 - Math.floor(tt * 2.2)];
      const clocks: Array<{ y: number; secs: number; on: boolean; ink: string }> = [
        { y: by, secs: base[1]!, on: !whiteToMove && !mate, ink: '#241a12' },
        { y: by + bw - 9, secs: base[0]!, on: whiteToMove && !mate, ink: '#fbf6ea' },
      ];
      for (const c of clocks) {
        rect(ctx, cx, c.y, cw, 9, c.on ? '#e8c07d' : '#2a2014');
        frame(ctx, cx, c.y, cw, 9, '#c9a262');
        const m = Math.floor(c.secs / 60);
        const s = String(c.secs % 60).padStart(2, '0');
        const label = textWidth(`${m}:${s}`) <= cw - 2 ? `${m}:${s}` : `${m}`;
        drawTextC(ctx, label, cx + cw / 2 + 0.5, c.y + 2, c.on ? '#241a12' : '#c9a262');
      }
      // move counter pips between the clocks
      for (let i = 0; i < MATE.length; i++)
        rect(ctx, cx + 2 + (i % 4) * 4, by + bw / 2 - 3 + Math.floor(i / 4) * 4, 2, 2, i < moves ? '#e8c07d' : '#3a2c18');
    }
    if (mate && f.hud) {
      banner(ctx, 'CHECKMATE', W, H * 0.5, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#140f08', W >= 120 ? 2 : 1);
      for (let i = 0; i < 5; i++) sparkle(ctx, bx + hash(i + 3) * bw, by + hash(i + 7) * bw * 0.4, tt * 3 + i * 0.4, '#fff3b0');
    }
  },
};

// ---------------------------------------------------------------------------
// Checkers — a double jump that lands on the back row: KING ME!
// ---------------------------------------------------------------------------
interface Checker {
  id: number;
  red: boolean;
  r: number;
  c: number;
}
const CK_START: Checker[] = [
  { id: 1, red: false, r: 3, c: 0 },
  { id: 2, red: false, r: 1, c: 4 },
  { id: 3, red: false, r: 0, c: 1 },
  { id: 4, red: false, r: 0, c: 5 },
  { id: 5, red: false, r: 1, c: 6 },
  { id: 6, red: false, r: 2, c: 3 },
  { id: 10, red: true, r: 5, c: 2 },
  { id: 11, red: true, r: 6, c: 3 },
  { id: 12, red: true, r: 7, c: 0 },
  { id: 13, red: true, r: 6, c: 5 },
  { id: 14, red: true, r: 7, c: 6 },
  { id: 15, red: true, r: 5, c: 6 },
];
const CK_C = 8.4;
// Timeline: red 10 steps up-left, dark 1 double-jumps and is crowned.
const CK_MOVES: Array<{ id: number; to: [number, number]; at: number; takes?: number }> = [
  { id: 10, to: [4, 1], at: 0.7 },
  { id: 1, to: [5, 2], at: 1.9, takes: 10 },
  { id: 1, to: [7, 4], at: 2.8, takes: 11 },
];
const CK_DUR = 0.42;

export const checkers: Scene = {
  label: 'CHECKERS',
  length: CK_C,
  still: 5.2,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, CK_C);
    rect(ctx, 0, 0, W, H, '#1a0808');
    for (let x = 0; x < W; x += 4) rect(ctx, x, 0, 1, H, '#200b0b');
    const sq = Math.max(5, Math.floor(Math.min(H * 0.9, W * 0.9) / 8));
    const bw = sq * 8;
    const bx = Math.round((W - bw) / 2);
    const by = Math.round((H - bw) / 2);
    rect(ctx, bx - 2, by - 2, bw + 4, bw + 4, '#3a0e0e');
    frame(ctx, bx - 1, by - 1, bw + 2, bw + 2, '#ffd23f');
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) rect(ctx, bx + c * sq, by + r * sq, sq, sq, (r + c) % 2 ? '#6b4426' : '#e9dcc0');
    // play the timeline
    const pos = new Map<number, { r: number; c: number; alive: number; king: boolean }>();
    for (const p of CK_START) pos.set(p.id, { r: p.r, c: p.c, alive: 1, king: false });
    let crowned = -1;
    for (const m of CK_MOVES) {
      if (tt < m.at) break;
      const p = pos.get(m.id)!;
      const k = clamp((tt - m.at) / CK_DUR, 0, 1);
      const e = easeInOut(k);
      const from = { r: p.r, c: p.c };
      p.r = from.r + (m.to[0] - from.r) * e;
      p.c = from.c + (m.to[1] - from.c) * e;
      if (m.takes) pos.get(m.takes)!.alive = 1 - k;
      if (k >= 1 && m.to[0] === 7 && !CK_START.find((s) => s.id === m.id)!.red) {
        p.king = true;
        crowned = m.at + CK_DUR;
      }
    }
    const R = Math.max(1.6, sq * 0.38);
    for (const p of CK_START) {
      const s = pos.get(p.id)!;
      if (s.alive <= 0) continue;
      const cx = bx + s.c * sq + sq / 2 - 0.5;
      const cy = by + s.r * sq + sq / 2 - 0.5;
      const shrink = s.alive;
      disc(ctx, cx, cy + 1, R * shrink, 'rgba(0,0,0,0.5)');
      disc(ctx, cx, cy, R * shrink, p.red ? '#ff5a5f' : '#c9bfd8');
      disc(ctx, cx, cy, R * 0.72 * shrink, p.red ? '#c81e36' : '#16121c');
      if (R * shrink >= 2.5) rect(ctx, cx - 1, cy - 1, 1, 1, p.red ? '#ff8a94' : '#4a4058');
      if (s.king) {
        const glow = blinkOn(f, tt, 4);
        const kx = Math.round(cx) - 2;
        const ky = Math.round(cy) - 1;
        rect(ctx, kx, ky, 5, 2, glow ? '#ffd23f' : '#e0b030');
        rect(ctx, kx, ky - 1, 1, 1, '#ffd23f');
        rect(ctx, kx + 2, ky - 1, 1, 1, '#ffd23f');
        rect(ctx, kx + 4, ky - 1, 1, 1, '#ffd23f');
      }
    }
    if (crowned > 0 && tt > crowned && tt < CK_C - 0.5) {
      if (f.hud) banner(ctx, 'KING ME!', W, H * 0.3, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#1a0808', W >= 120 ? 2 : 1);
      for (let i = 0; i < 6; i++)
        sparkle(ctx, bx + 4 * sq + (hash(i + 2) - 0.5) * sq * 3, by + 7 * sq + (hash(i + 5) - 0.5) * sq * 2, tt * 3 + i * 0.37, '#fff3b0');
    }
  },
};

// ---------------------------------------------------------------------------
// Ships — sonar sweep, shots splash or hit, the last one sinks a ship.
// ---------------------------------------------------------------------------
const SHIPS_C = 8.8;
const FLEET: Array<{ cells: Array<[number, number]> }> = [
  {
    cells: [
      [2, 5],
      [3, 5],
      [4, 5],
    ],
  },
  {
    cells: [
      [6, 1],
      [6, 2],
    ],
  },
];
const SHOTS: Array<{ at: number; cell: [number, number] }> = [
  { at: 0.7, cell: [1, 2] },
  { at: 1.7, cell: [3, 5] },
  { at: 2.6, cell: [5, 6] },
  { at: 3.5, cell: [2, 5] },
  { at: 4.4, cell: [4, 5] },
];

export const ships: Scene = {
  label: 'SHIPS',
  length: SHIPS_C,
  still: 5.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, SHIPS_C);
    rect(ctx, 0, 0, W, H, '#021018');
    const N = 8;
    const cs = Math.max(4, Math.floor(Math.min(H * 0.86, W * 0.7) / N));
    const gw = cs * N;
    const side = W - gw >= 22;
    const gx = side ? Math.round((W - gw - 18) / 2) : Math.round((W - gw) / 2);
    const gy = Math.round((H - gw) / 2);
    rect(ctx, gx - 1, gy - 1, gw + 2, gw + 2, '#0b3a52');
    rect(ctx, gx, gy, gw, gw, '#03202e');
    for (let i = 1; i < N; i++) {
      rect(ctx, gx + i * cs, gy, 1, gw, '#0a3144');
      rect(ctx, gx, gy + i * cs, gw, 1, '#0a3144');
    }
    // sonar sweep
    const cx = gx + gw / 2;
    const cy = gy + gw / 2;
    const ang = f.still ? 1.2 : f.t * 1.6;
    for (let k = 0; k < 14; k++) {
      const a = ang - k * 0.07;
      const alpha = (1 - k / 14) * 0.5;
      for (let r = 2; r < gw * 0.7; r += 1.5) {
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (x < gx || x >= gx + gw || y < gy || y >= gy + gw) break;
        rect(ctx, x, y, 1, 1, `rgba(56,189,248,${alpha.toFixed(2)})`);
      }
    }
    const isShip = (c: [number, number]) => FLEET.some((s) => s.cells.some(([a, b]) => a === c[0] && b === c[1]));
    const sunkAt = SHOTS[SHOTS.length - 1]!.at + 0.45;
    const sunk = tt > sunkAt && tt < SHIPS_C - 0.4;
    // revealed ship outline once sunk
    if (sunk) {
      const ship = FLEET[0]!;
      const xs = ship.cells.map((c) => c[0]);
      const ys = ship.cells.map((c) => c[1]);
      const x0 = gx + Math.min(...xs) * cs;
      const y0 = gy + Math.min(...ys) * cs;
      const w = (Math.max(...xs) - Math.min(...xs) + 1) * cs;
      const h = (Math.max(...ys) - Math.min(...ys) + 1) * cs;
      rect(ctx, x0 + 1, y0 + 1, w - 1, h - 1, '#5a2a0e');
      frame(ctx, x0, y0, w + 1, h + 1, blinkOn(f, tt, 4) ? '#ff8a3d' : '#ffd23f');
    }
    SHOTS.forEach((s, i) => {
      if (tt < s.at) return;
      const age = tt - s.at;
      const x = gx + s.cell[0] * cs;
      const y = gy + s.cell[1] * cs;
      const hit = isShip(s.cell);
      const land = 0.28;
      if (age < land) {
        // incoming shell: crosshair + shrinking dot
        const k = age / land;
        const r = Math.max(1, (1 - k) * cs);
        frame(ctx, x - r + cs / 2, y - r + cs / 2, r * 2, r * 2, '#ffd23f');
        return;
      }
      const since = age - land;
      if (hit) {
        const burst = since < 0.35 ? Math.round(cs * (0.4 + since * 2)) : 0;
        if (burst) disc(ctx, x + cs / 2, y + cs / 2, burst, i % 2 ? '#ffd23f' : '#ff8a3d');
        rect(ctx, x + 1, y + 1, cs - 1, cs - 1, '#ff5a1f');
        rect(ctx, x + Math.floor(cs / 2) - 1, y + Math.floor(cs / 2) - 1, 2, 2, '#fff3b0');
        // flicker of fire
        if (!f.still && Math.floor(f.t * 8 + i) % 2) rect(ctx, x + 1, y + 1, 1, 1, '#ffd23f');
      } else {
        const ring = since < 0.5 ? Math.round(1 + since * cs * 2) : 0;
        if (ring) frame(ctx, x + cs / 2 - ring, y + cs / 2 - ring, ring * 2, ring * 2, 'rgba(230,251,255,0.6)');
        disc(ctx, x + cs / 2 - 0.5, y + cs / 2 - 0.5, Math.max(1, cs * 0.18), '#e6fbff');
      }
    });
    // fleet status panel
    if (side) {
      const px = gx + gw + 4;
      const pw = W - px - 2;
      const hits = SHOTS.filter((s) => tt > s.at + 0.28 && isShip(s.cell)).length;
      FLEET.forEach((ship, i) => {
        const y = gy + 2 + i * 7;
        ship.cells.forEach((_, k) => rect(ctx, px + k * 4, y, 3, 3, i === 0 && k < hits ? '#ff5a1f' : '#38bdf8'));
      });
      drawTextC(ctx, `${hits}`, px + pw / 2, gy + gw - 6, '#ffd23f');
    }
    if (sunk && f.hud) banner(ctx, 'SUNK!', W, gy + gw * 0.5, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#021018', W >= 110 ? 2 : 1);
  },
};

// ---------------------------------------------------------------------------
// Tic-tac-toe — X sets up a fork and wins down the left column, then the board
// wipes away to a glimpse of Ultimate: nine small boards, the "send" rule and a
// small board won.
// ---------------------------------------------------------------------------
const TTT_X = '#ff4f81';
const TTT_O = '#38bdf8';
const TTT_X_SHADE = '#5a1830';
const TTT_O_SHADE = '#0c3a52';
const TTT_BG = '#140818';
const TTT_C = 11.2;
/** Cells 0–8, row by row. X: centre, corner, the fork at 6 (threats 0-3-6 and 2-4-6), then 3. */
const TTT_GAME = [4, 1, 0, 8, 6, 2, 3] as const;
const TTT_WIN = [0, 3, 6] as const;
const TTT_MOVE0 = 1.0;
const TTT_GAP = 0.6;
const TTT_DRAW = 0.28;
const TTT_STRIKE = TTT_MOVE0 + (TTT_GAME.length - 1) * TTT_GAP + TTT_DRAW + 0.2;
const TTT_STRIKE_DUR = 0.32;
/** The Classic board wipes away and the Ultimate glimpse begins. */
const TTT_WIPE = 7.2;
const TTT_ULT = 7.6;
/** Ultimate: a mid-game position (9 small boards × 9 cells); board 0 won by X, board 8 by O. */
const ULT_START = ['xo..x.o.x', '..ox.....', '.x....o..', 'o...x....', '.o..x...o', '...o...x.', 'x.......o', '..x.o....', 'x.x...ooo'];
const ULT_WON_START = 'x.......o';
/** [board, cell] — each move sends the opponent to the board matching its cell. */
const ULT_MOVES: ReadonlyArray<readonly [number, number]> = [
  [4, 2], // X → O must play board 2
  [2, 4], // O → back to board 4
  [4, 3], // X threatens 3-4-5 and 2-4-6 → board 3
  [3, 8], // O → board 8 is decided: X may play anywhere
  [4, 6], // X wins board 4 on the 2-4-6 diagonal → board 6
  [6, 4], // O → board 4 is decided: anywhere again
];
const ULT_MOVE0 = 8.0;
const ULT_GAP = 0.34;
const ULT_WIN_MOVE = 4;
const ULT_WIPE = 10.9;

/** A partial circle from 12 o'clock, `k` of the way round, with a square brush. */
function arc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, k: number, color: string, size = 1): void {
  if (k <= 0) return;
  ctx.fillStyle = color;
  const steps = Math.max(16, Math.ceil(r * 8));
  const n = Math.round(steps * clamp(k, 0, 1));
  const off = Math.floor(size / 2);
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r) - off, Math.round(cy + Math.sin(a) * r) - off, size, size);
  }
}

/** An X or O filling a `size` box at (x, y), drawn `k` of the way in (X: two strokes; O: a sweep). */
function tttMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  mark: 'x' | 'o',
  k: number,
  brush: number,
  shadow = true,
  ink = mark === 'x' ? TTT_X : TTT_O,
): void {
  const pad = size * 0.24;
  const x0 = x + pad;
  const y0 = y + pad;
  const x1 = x + size - pad - 1;
  const y1 = y + size - pad - 1;
  const shade = mark === 'x' ? TTT_X_SHADE : TTT_O_SHADE;
  const passes: Array<[number, string]> =
    shadow && brush >= 2
      ? [
          [1, shade],
          [0, ink],
        ]
      : [[0, ink]];
  for (const [d, color] of passes) {
    if (mark === 'x') {
      const a = clamp(k * 2, 0, 1);
      const b = clamp(k * 2 - 1, 0, 1);
      if (a > 0) line(ctx, x0 + d, y0 + d, x0 + (x1 - x0) * a + d, y0 + (y1 - y0) * a + d, color, brush);
      if (b > 0) line(ctx, x1 + d, y0 + d, x1 - (x1 - x0) * b + d, y0 + (y1 - y0) * b + d, color, brush);
    } else {
      arc(ctx, x + size / 2 - 0.5 + d, y + size / 2 - 0.5 + d, (x1 - x0) / 2, k, color, brush);
    }
  }
}

function tttBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  rect(ctx, 0, 0, W, H, TTT_BG);
  for (let y = 2; y < H; y += 5) for (let x = 2; x < W; x += 5) rect(ctx, x, y, 1, 1, '#22102c');
}

function tttWipe(ctx: CanvasRenderingContext2D, W: number, H: number, k: number): void {
  if (k <= 0) return;
  const h = Math.round(H * clamp(k, 0, 1));
  rect(ctx, 0, 0, W, h, TTT_BG);
  if (k < 1) rect(ctx, 0, h, W, 1, '#c9b6ff');
}

function drawClassic(f: AttractFrame, tt: number): void {
  const { ctx, W, H } = f;
  const lift = Math.round(f.top * 0.6);
  const gs = Math.max(18, Math.floor(Math.min(W * 0.84, (H - lift) * 0.86) / 3) * 3);
  const cell = gs / 3;
  const panel = W - gs >= 34;
  const bx = panel ? Math.round((W - gs - 18) / 2) : Math.round((W - gs) / 2);
  const by = lift + Math.round((H - lift - gs) / 2);
  const brush = Math.max(1, Math.round(cell / 9));
  const lw = Math.max(1, Math.round(cell / 14));
  const strikeK = clamp((tt - TTT_STRIKE) / TTT_STRIKE_DUR, 0, 1);
  const won = strikeK >= 1;

  // the winning cells glow once the line is struck
  if (won && blinkOn(f, tt, 3))
    for (const c of TTT_WIN)
      rect(ctx, bx + (c % 3) * cell + lw, by + Math.floor(c / 3) * cell + lw, cell - lw * 2, cell - lw * 2, '#2a1236');
  // the grid draws itself in, one stroke after another
  for (let i = 0; i < 4; i++) {
    const k = easeInOut(clamp((tt - 0.15 - i * 0.14) / 0.26, 0, 1));
    if (k <= 0) continue;
    const at = Math.round((i % 2 ? 2 : 1) * cell - lw / 2);
    const len = gs * k;
    if (i < 2) rect(ctx, bx + at, by, lw, len, '#c9b6ff');
    else rect(ctx, bx, by + at, len, lw, '#c9b6ff');
  }
  // the moves, X first
  TTT_GAME.forEach((c, i) => {
    const k = clamp((tt - TTT_MOVE0 - i * TTT_GAP) / TTT_DRAW, 0, 1);
    if (k <= 0) return;
    tttMark(ctx, bx + (c % 3) * cell, by + Math.floor(c / 3) * cell, cell, i % 2 ? 'o' : 'x', k, brush);
  });
  // whose turn: two plates beside the board, the side to move lit
  if (panel) {
    const moves = TTT_GAME.filter((_, i) => tt >= TTT_MOVE0 + i * TTT_GAP).length;
    const px = bx + gs + 6;
    const pw = Math.min(14, W - px - 3);
    (['x', 'o'] as const).forEach((m, i) => {
      const y = by + (i ? gs - pw : 0);
      const on = !won && tt >= TTT_MOVE0 - 0.4 && moves % 2 === i;
      rect(ctx, px, y, pw, pw, on ? (m === 'x' ? TTT_X : TTT_O) : '#1d0f26');
      frame(ctx, px, y, pw, pw, m === 'x' ? TTT_X : TTT_O);
      tttMark(ctx, px + 1, y + 1, pw - 2, m, 1, 1, false, on ? TTT_BG : undefined);
    });
    if (won) rect(ctx, px, by + Math.round(gs / 2) - 1, pw, 2, '#ffd23f');
  }
  // the strike through 0-3-6
  if (strikeK > 0) {
    const sx = bx + cell / 2 - 0.5;
    const y0 = by + cell * 0.18;
    const y1 = by + gs - cell * 0.18;
    line(ctx, sx + 1, y0 + 1, sx + 1, y0 + 1 + (y1 - y0) * easeInOut(strikeK), '#5a4410', brush + 1);
    line(ctx, sx, y0, sx, y0 + (y1 - y0) * easeInOut(strikeK), '#ffd23f', brush + 1);
  }
  if (won && tt < TTT_WIPE) {
    if (f.hud) banner(ctx, 'X WINS!', W, by + gs * 0.5, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', TTT_BG, W >= 120 ? 2 : 1);
    for (let i = 0; i < 5; i++) sparkle(ctx, bx + hash(i + 11) * 0.5 * gs, by + hash(i + 17) * gs, tt * 3 + i * 0.41, '#fff3b0');
  }
}

function drawUltimate(f: AttractFrame, tt: number): void {
  const { ctx, W, H } = f;
  const lift = Math.round(f.top * 0.6);
  const cs = Math.max(3, Math.floor(Math.min(W * 0.88, (H - lift) * 0.88) / 9.6));
  const gap = Math.max(1, Math.round(cs * 0.3));
  const bw = cs * 3;
  const total = bw * 3 + gap * 2;
  const ox = Math.round((W - total) / 2);
  const oy = lift + Math.round((H - lift - total) / 2);
  const appear = clamp((tt - TTT_ULT) / 0.3, 0, 1);
  const played = ULT_MOVES.filter((_, i) => tt >= ULT_MOVE0 + i * ULT_GAP).length;
  const won = ULT_WON_START.split('');
  if (played > ULT_WIN_MOVE) won[ULT_MOVES[ULT_WIN_MOVE]![0]] = 'x';
  // the board the side to move is sent to (-1 = any open board); the glimpse opens with X sent to the centre
  let active = 4;
  if (played > 0) {
    const target = ULT_MOVES[played - 1]![1];
    active = won[target] === '.' ? target : -1;
  }
  const done = played >= ULT_MOVES.length;
  const brush = Math.max(1, Math.round(cs / 8));
  for (let b = 0; b < 9; b++) {
    const k = clamp(appear * 1.6 - b * 0.07, 0, 1);
    if (k <= 0) continue;
    const x = ox + (b % 3) * (bw + gap);
    const y = oy + Math.floor(b / 3) * (bw + gap);
    const owner = won[b];
    rect(ctx, x, y, bw, bw, owner === 'x' ? '#33102a' : owner === 'o' ? '#0b2638' : '#1c0d24');
    for (let i = 1; i < 3; i++) {
      rect(ctx, x + i * cs, y + 1, 1, bw - 2, '#3b2350');
      rect(ctx, x + 1, y + i * cs, bw - 2, 1, '#3b2350');
    }
    for (let c = 0; c < 9; c++) {
      const fromMove = ULT_MOVES.findIndex(([mb, mc]) => mb === b && mc === c);
      const mark = fromMove >= 0 ? (fromMove < played ? (fromMove % 2 ? 'o' : 'x') : '.') : ULT_START[b]![c]!;
      if (mark === '.') continue;
      const mk = fromMove >= 0 ? clamp((tt - ULT_MOVE0 - fromMove * ULT_GAP) / 0.18, 0, 1) : 1;
      const cx = x + (c % 3) * cs;
      const cy = y + Math.floor(c / 3) * cs;
      if (cs >= 6) tttMark(ctx, cx, cy, cs, mark as 'x' | 'o', mk, 1, false);
      else rect(ctx, cx + 1, cy + 1, cs - 2, cs - 2, mark === 'x' ? TTT_X : TTT_O);
    }
    // a decided board carries one big mark
    if (owner === 'x' || owner === 'o') {
      const big = b === ULT_MOVES[ULT_WIN_MOVE]![0] ? clamp((tt - ULT_MOVE0 - ULT_WIN_MOVE * ULT_GAP - 0.15) / 0.3, 0, 1) : 1;
      tttMark(ctx, x, y, bw, owner, big, Math.max(1, brush + 1), false);
    }
    const lit = active === b || (active < 0 && owner === '.');
    if (!done && lit && blinkOn(f, tt, 4)) frame(ctx, x - 1, y - 1, bw + 2, bw + 2, '#ffd23f');
  }
  // once the centre board's big X has landed, over the top row so it stays in view
  if (done && f.hud && tt > ULT_MOVE0 + (ULT_MOVES.length - 1) * ULT_GAP + 0.25 && tt < ULT_WIPE) {
    banner(ctx, 'ULTIMATE', W, oy + bw * 0.5, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', TTT_BG, W >= 120 ? 2 : 1);
  }
}

export const tictactoe: Scene = {
  label: 'TIC-TAC-TOE',
  length: TTT_C,
  still: 6.0,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, TTT_C);
    tttBackdrop(ctx, W, H);
    if (tt < TTT_ULT) {
      drawClassic(f, tt);
      tttWipe(ctx, W, H, (tt - TTT_WIPE) / (TTT_ULT - TTT_WIPE));
    } else {
      drawUltimate(f, tt);
      tttWipe(ctx, W, H, (tt - ULT_WIPE) / (TTT_C - ULT_WIPE));
    }
  },
};

// ---------------------------------------------------------------------------
// Four in a Row — discs drop into a 7 × 6 rack until Pink lines up a diagonal.
// ---------------------------------------------------------------------------
const C4_BG = '#0c0a1e';
const C4_RACK = '#2b2378';
const C4_RACK_EDGE = '#4a3fb8';
const C4_HOLE = '#100c26';
const C4_C = 10.8;
/** Columns played, Pink first; the 13th disc completes Pink's diagonal d1–e2–f3–g4. */
const C4_GAME = [3, 3, 4, 2, 5, 6, 4, 5, 5, 4, 6, 6, 6] as const;
const C4_MOVE0 = 0.8;
const C4_GAP = 0.55;
const C4_FALL = 0.3;
const C4_STRIKE = C4_MOVE0 + (C4_GAME.length - 1) * C4_GAP + C4_FALL + 0.15;
const C4_WIPE = 10.1;

/** Landing row (0 = top) of each disc in C4_GAME. */
const C4_ROWS: readonly number[] = (() => {
  const height = [0, 0, 0, 0, 0, 0, 0];
  return C4_GAME.map((c) => 5 - height[c]!++);
})();
const C4_WIN: ReadonlyArray<readonly [number, number]> = [
  [3, 5],
  [4, 4],
  [5, 3],
  [6, 2],
];

function c4Disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pink: boolean): void {
  disc(ctx, cx, cy + Math.max(1, Math.round(r / 5)), r, pink ? TTT_X_SHADE : TTT_O_SHADE);
  disc(ctx, cx, cy, r, pink ? TTT_X : TTT_O);
  if (r >= 4) disc(ctx, cx - r * 0.35, cy - r * 0.35, Math.max(1, r * 0.22), '#ffffff');
}

export const fourinarow: Scene = {
  label: '4 IN A ROW',
  length: C4_C,
  still: 9.0,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, C4_C);
    rect(ctx, 0, 0, W, H, C4_BG);
    for (let y = 3; y < H; y += 6) for (let x = 3; x < W; x += 6) rect(ctx, x, y, 1, 1, '#17123a');
    const lift = Math.round(f.top * 0.6);
    // a hover row above the rack for the disc about to drop
    const cell = Math.max(4, Math.floor(Math.min((W * 0.9) / 7, ((H - lift) * 0.9) / 7)));
    const rw = cell * 7;
    const rh = cell * 6;
    const rx = Math.round((W - rw) / 2);
    const ry = lift + Math.round((H - lift - rh - cell) / 2) + cell;
    const r = Math.max(1, Math.round(cell * 0.38));
    const played = C4_GAME.filter((_, i) => tt >= C4_MOVE0 + i * C4_GAP).length;
    const strikeK = clamp((tt - C4_STRIKE) / 0.35, 0, 1);
    const won = strikeK >= 1;

    // the disc waiting above its column, then falling
    C4_GAME.forEach((col, i) => {
      const t0 = C4_MOVE0 + i * C4_GAP;
      const k = clamp((tt - t0) / C4_FALL, 0, 1);
      if (tt < t0 - 0.3 || k >= 1) return;
      const cx = rx + col * cell + cell / 2;
      const top = ry - cell / 2;
      const bottom = ry + C4_ROWS[i]! * cell + cell / 2;
      c4Disc(ctx, cx, top + (bottom - top) * k * k, r, i % 2 === 0);
    });
    // the rack, with the slots that are still empty showing through
    rect(ctx, rx - 2, ry - 2, rw + 4, rh + 4, C4_RACK_EDGE);
    rect(ctx, rx, ry, rw, rh, C4_RACK);
    rect(ctx, rx - 3, ry + rh + 2, 3, Math.max(2, Math.round(cell / 2)), C4_RACK_EDGE);
    rect(ctx, rx + rw, ry + rh + 2, 3, Math.max(2, Math.round(cell / 2)), C4_RACK_EDGE);
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 7; col++) disc(ctx, rx + col * cell + cell / 2, ry + row * cell + cell / 2, r, C4_HOLE);
    // landed discs
    for (let i = 0; i < played; i++) {
      if (tt < C4_MOVE0 + i * C4_GAP + C4_FALL) continue;
      const lit = won && C4_WIN.some(([c, w]) => c === C4_GAME[i] && w === C4_ROWS[i]);
      const cx = rx + C4_GAME[i]! * cell + cell / 2;
      const cy = ry + C4_ROWS[i]! * cell + cell / 2;
      if (lit && blinkOn(f, tt, 3)) disc(ctx, cx, cy, r + 1, '#ffd23f');
      c4Disc(ctx, cx, cy, r, i % 2 === 0);
    }
    // the strike along the diagonal
    if (strikeK > 0) {
      const [c0, r0] = C4_WIN[0]!;
      const [c1, r1] = C4_WIN[3]!;
      const x0 = rx + c0 * cell + cell / 2;
      const y0 = ry + r0 * cell + cell / 2;
      const x1 = rx + c1 * cell + cell / 2;
      const y1 = ry + r1 * cell + cell / 2;
      const k = easeInOut(strikeK);
      const brush = Math.max(1, Math.round(cell / 7));
      line(ctx, x0 + 1, y0 + 1, x0 + 1 + (x1 - x0) * k, y0 + 1 + (y1 - y0) * k, '#5a4410', brush + 1);
      line(ctx, x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, '#ffd23f', brush + 1);
    }
    if (won && tt < C4_WIPE) {
      if (f.hud) banner(ctx, 'PINK WINS!', W, ry + rh * 0.35, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', C4_BG, W >= 120 ? 2 : 1);
      for (let i = 0; i < 5; i++) sparkle(ctx, rx + hash(i + 23) * rw, ry + hash(i + 29) * rh, tt * 3 + i * 0.37, '#fff3b0');
    }
    tttWipe(ctx, W, H, (tt - C4_WIPE) / (C4_C - C4_WIPE));
  },
};

// ---------------------------------------------------------------------------
// Reversi — a quiet opening, then one Black disc outflanks six in four directions.
// ---------------------------------------------------------------------------
const RV_BG = '#04140d';
const RV_FELT = '#0f6e4a';
const RV_FELT_2 = '#0c6141';
const RV_LINE = '#03261a';
const RV_RAIL = '#052417';
const RV_RAIL_EDGE = '#34d399';
const RV_BLACK = '#17151f';
const RV_BLACK_SHINE = '#565170';
const RV_WHITE = '#f7f5ee';
const RV_WHITE_SHADE = '#c9c4b6';
const RV_C = 10.4;
/** [cell, discs it flips] — cells row by row from a1; Black moves first. The last move flips six. */
const RV_GAME: ReadonlyArray<readonly [number, readonly number[]]> = [
  [19, [27]],
  [34, [35]],
  [43, [35]],
  [20, [27, 28]],
  [25, [34]],
  [11, [19]],
  [13, [20, 27]],
  [26, [27]],
  [2, [11]],
  [21, [20]],
  [29, [20, 21, 26, 27, 28, 36]],
];
const RV_START: ReadonlyArray<readonly [number, 'b' | 'w']> = [
  [27, 'w'],
  [28, 'b'],
  [35, 'b'],
  [36, 'w'],
];
const RV_MOVE0 = 0.7;
const RV_GAP = 0.48;
/** The big move waits a beat. */
const RV_BIG_AT = RV_MOVE0 + (RV_GAME.length - 1) * RV_GAP + 0.55;
const RV_FLIP = 0.26;
const RV_STEP = 0.08;
const RV_WIPE = 9.7;

const rvMoveAt = (i: number) => (i === RV_GAME.length - 1 ? RV_BIG_AT : RV_MOVE0 + i * RV_GAP);

/** A disc seen edge-on by `squash` (1 = face up, 0 = edge-on) — the flip's half-turn. */
function rvDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, black: boolean, squash = 1): void {
  const top = black ? RV_BLACK : RV_WHITE;
  if (squash >= 0.98) {
    disc(ctx, cx, cy + 1, r, 'rgba(0,0,0,0.45)');
    disc(ctx, cx, cy, r, black ? '#05040a' : RV_WHITE_SHADE);
    disc(ctx, cx, cy, Math.max(1, r - 1), top);
    if (r >= 3) rect(ctx, Math.round(cx - r / 2), Math.round(cy - r / 2), 1, 1, black ? RV_BLACK_SHINE : '#ffffff');
    return;
  }
  ctx.fillStyle = top;
  const x = Math.round(cx);
  const y = Math.round(cy);
  const rr = Math.max(0, r);
  for (let dy = -Math.floor(rr); dy <= Math.floor(rr); dy++) {
    const dx = Math.floor(Math.sqrt(rr * rr - dy * dy) * Math.max(0.08, squash) + 0.35);
    ctx.fillRect(x - dx, y + dy, dx * 2 + 1, 1);
  }
}

export const reversi: Scene = {
  label: 'REVERSI',
  length: RV_C,
  still: 8.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, RV_C);
    rect(ctx, 0, 0, W, H, RV_BG);
    for (let y = 2; y < H; y += 5) for (let x = 2; x < W; x += 5) rect(ctx, x, y, 1, 1, '#082419');
    const lift = Math.round(f.top * 0.6);
    const sq = Math.max(4, Math.floor(Math.min(W * 0.88, (H - lift) * 0.88) / 8));
    const bw = sq * 8;
    const bx = Math.round((W - bw) / 2);
    const by = lift + Math.round((H - lift - bw) / 2);
    rect(ctx, bx - 3, by - 3, bw + 6, bw + 6, RV_RAIL);
    frame(ctx, bx - 2, by - 2, bw + 4, bw + 4, RV_RAIL_EDGE);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) rect(ctx, bx + c * sq, by + r * sq, sq, sq, (r + c) % 2 ? RV_FELT : RV_FELT_2);
    for (let i = 1; i < 8; i++) {
      rect(ctx, bx + i * sq, by, 1, bw, RV_LINE);
      rect(ctx, bx, by + i * sq, bw, 1, RV_LINE);
    }
    for (const [c, r] of [
      [2, 2],
      [6, 2],
      [2, 6],
      [6, 6],
    ] as const)
      rect(ctx, bx + c * sq - 1, by + r * sq - 1, 3, 3, RV_LINE);

    // Replay the game up to now: who owns each square, and the flips still turning over.
    const owner = new Map<number, boolean>(RV_START.map(([cell, d]) => [cell, d === 'b']));
    const turning = new Map<number, { k: number; black: boolean }>();
    let last = -1;
    RV_GAME.forEach(([cell, flips], i) => {
      const at = rvMoveAt(i);
      if (tt < at) return;
      const black = i % 2 === 0;
      owner.set(cell, black);
      last = cell;
      for (const fc of flips) {
        const steps = Math.max(Math.abs(Math.floor(fc / 8) - Math.floor(cell / 8)), Math.abs((fc % 8) - (cell % 8)));
        const k = clamp((tt - at - 0.1 - (steps - 1) * RV_STEP) / RV_FLIP, 0, 1);
        if (k >= 1) owner.set(fc, black);
        else if (k > 0) turning.set(fc, { k, black });
      }
    });
    const R = Math.max(1.5, sq * 0.4);
    if (last >= 0) rect(ctx, bx + (last % 8) * sq + 1, by + Math.floor(last / 8) * sq + 1, sq - 1, sq - 1, '#2f8a5c');
    for (const [cell, black] of owner) {
      const cx = bx + (cell % 8) * sq + sq / 2 - 0.5;
      const cy = by + Math.floor(cell / 8) * sq + sq / 2 - 0.5;
      const turn = turning.get(cell);
      if (!turn) {
        rvDisc(ctx, cx, cy, R, black);
        continue;
      }
      // First half: the old face narrows to its edge; second half: the new face opens up.
      const half = turn.k < 0.5;
      const hop = Math.round(Math.sin(turn.k * Math.PI) * sq * 0.18);
      rvDisc(ctx, cx, cy - hop, R, half ? !turn.black : turn.black, Math.abs(1 - turn.k * 2));
    }

    const big = RV_BIG_AT + 0.1 + 2 * RV_STEP + RV_FLIP;
    if (tt > big && tt < RV_WIPE) {
      const cx = bx + (29 % 8) * sq + sq / 2;
      const cy = by + Math.floor(29 / 8) * sq + sq / 2;
      if (blinkOn(f, tt, 3)) frame(ctx, Math.round(cx - sq / 2), Math.round(cy - sq / 2), sq, sq, '#ffd23f');
      if (f.hud) banner(ctx, 'OUTFLANKED!', W, by + bw * 0.78, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', RV_BG, W >= 140 ? 2 : 1);
      for (let i = 0; i < 6; i++) sparkle(ctx, cx + (hash(i + 41) - 0.5) * sq * 4, cy + (hash(i + 47) - 0.5) * sq * 3, tt * 3 + i * 0.37, '#fff3b0');
    }
    if (tt > RV_WIPE) {
      const h = Math.round(H * clamp((tt - RV_WIPE) / (RV_C - RV_WIPE), 0, 1));
      rect(ctx, 0, 0, W, h, RV_BG);
      if (h < H) rect(ctx, 0, h, W, 1, RV_RAIL_EDGE);
    }
  },
};
