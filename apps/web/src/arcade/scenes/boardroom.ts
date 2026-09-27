/**
 * DAS Boardroom scenes: a four-move checkmate, a checkers multi-jump to the
 * crown, and a hidden-fleet sonar duel.
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
