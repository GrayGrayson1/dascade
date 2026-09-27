/**
 * DAScade Classics scenes: six original arcade quick-plays in miniature —
 * Pixel Paddle, Neon Snake, Brick Blitz, Asteroid Run, Memory Matrix and Block Drop.
 * All motion is a pure function of time (scripted paths, no simulation state).
 */
import {
  banner,
  blinkOn,
  clamp,
  cyc,
  disc,
  drawTextC,
  frame,
  hash,
  line,
  rect,
  sparkle,
  starfield,
  type AttractFrame,
  type Ctx,
  type Scene,
} from '../attractKit.ts';

/** Triangle wave in [0, 1] with period p. */
const tri = (t: number, p: number) => {
  const x = cyc(t, p) / p;
  return x < 0.5 ? x * 2 : 2 - x * 2;
};

/** Big blocky score digits (3×5 font at scale 2). */
function score(ctx: Ctx, text: string, x: number, y: number, color: string, scale = 2): void {
  drawTextC(ctx, text, x, y, color, scale);
}

// ---------------------------------------------------------------------------
// Pixel Paddle — a rally that speeds up until someone misses.
// ---------------------------------------------------------------------------
const PADDLE_C = 7;

export const paddle: Scene = {
  label: 'PADDLE',
  length: PADDLE_C,
  still: 2.2,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, PADDLE_C);
    const cycle = Math.floor(f.t / PADDLE_C);
    rect(ctx, 0, 0, W, H, '#050b1f');
    for (let y = 2; y < H; y += 5) rect(ctx, Math.floor(W / 2), y, 1, 3, '#1d2c55');
    rect(ctx, 0, 0, W, 1, '#7cf5ff');
    rect(ctx, 0, H - 1, W, 1, '#ff4fd8');
    const pw = 2;
    const ph = Math.max(6, Math.round(H * 0.2));
    const lx = 4;
    const rxp = W - 4 - pw;
    // ball: x bounces between paddles; y is an independent bounce
    const miss = 5.2;
    const period = 1.3;
    const ballT = Math.min(tt, miss);
    const bxN = tri(ballT + period * 0.5, period * 2);
    let bx = lx + pw + (rxp - lx - pw - 2) * bxN;
    const by = 3 + (H - 8) * tri(ballT * 0.83 + 0.2, 1.9);
    if (tt > miss) bx = rxp + (tt - miss) * W * 0.8; // sails past the right paddle
    const lScore = cycle % 9;
    const rScore = (cycle * 2 + 3) % 9;
    const scored = tt > miss + 0.25;
    score(ctx, String(lScore + (scored ? 1 : 0)), W / 2 - 9, f.top + 3, '#7cf5ff', W >= 100 ? 2 : 1);
    score(ctx, String(rScore), W / 2 + 10, f.top + 3, '#ff4fd8', W >= 100 ? 2 : 1);
    // paddles track the ball (the right one is a hair late at the end)
    const lTarget = bxN < 0.5 ? by : H / 2;
    const rTarget = tt > miss - 0.5 ? by + (tt - (miss - 0.5)) * H * 1.6 : bxN > 0.5 ? by : H / 2;
    const ly = clamp(lTarget - ph / 2, 1, H - ph - 1);
    const ry = clamp(rTarget - ph / 2, 1, H - ph - 1);
    rect(ctx, lx, ly, pw, ph, '#7cf5ff');
    rect(ctx, lx - 1, ly + 1, 1, ph - 2, 'rgba(124,245,255,0.4)');
    rect(ctx, rxp, ry, pw, ph, '#ff4fd8');
    rect(ctx, rxp + pw, ry + 1, 1, ph - 2, 'rgba(255,79,216,0.4)');
    if (bx < W + 2) {
      for (let i = 1; i <= 4; i++) {
        const back = Math.max(0, ballT - i * 0.03);
        const tx = tt > miss && i === 1 ? bx - 3 : lx + pw + (rxp - lx - pw - 2) * tri(back + period * 0.5, period * 2);
        const ty = 3 + (H - 8) * tri(back * 0.83 + 0.2, 1.9);
        rect(ctx, tx, ty, 2, 2, `rgba(255,255,255,${(0.35 - i * 0.07).toFixed(2)})`);
      }
      rect(ctx, bx, by, 2, 2, '#ffffff');
    }
    if (scored && tt < PADDLE_C - 0.4 && f.hud) banner(ctx, 'POINT!', W, H * 0.62, blinkOn(f, tt) ? '#7cf5ff' : '#ffffff', '#050b1f', 1);
  },
};

// ---------------------------------------------------------------------------
// Neon Snake — a glowing snake loops the arena, eating and growing.
// ---------------------------------------------------------------------------
const SNAKE_C = 8;

export const snake: Scene = {
  label: 'SNAKE',
  length: SNAKE_C,
  still: 5,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, SNAKE_C);
    const cs = W >= 110 ? 5 : 4;
    const cols = Math.floor((W - 4) / cs);
    const rows = Math.floor((H - 4) / cs);
    const ox = Math.round((W - cols * cs) / 2);
    const oy = Math.round((H - rows * cs) / 2);
    rect(ctx, 0, 0, W, H, '#03060f');
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) rect(ctx, ox + c * cs + Math.floor(cs / 2), oy + r * cs + Math.floor(cs / 2), 1, 1, '#0c1630');
    frame(ctx, ox - 1, oy - 1, cols * cs + 2, rows * cs + 2, '#2de38f');
    // a serpentine sweep across the arena, then back up the left edge
    const path: Array<[number, number]> = [];
    const x0 = 2;
    const x1 = cols - 2;
    let dir = 1;
    for (let y = 1; y <= rows - 2; y += 2) {
      if (dir > 0) for (let x = x0; x <= x1; x++) path.push([x, y]);
      else for (let x = x1; x >= x0; x--) path.push([x, y]);
      if (y + 1 <= rows - 2) path.push([dir > 0 ? x1 : x0, y + 1]);
      dir = -dir;
    }
    // …then home along the bottom (if needed) and up column 1, closing the loop at the start.
    const [lx, endY] = path[path.length - 1]!;
    let ly = endY;
    if (lx !== x0) {
      ly += 1;
      for (let x = lx; x >= 1; x--) path.push([x, ly]);
    } else path.push([1, ly]);
    for (let y = ly - 1; y >= 1; y--) path.push([1, y]);
    // pellets sit on the path
    const speed = Math.max(9, path.length / (SNAKE_C - 0.5)); // one sweep per cycle
    const head = Math.floor(tt * speed);
    const pellets = [Math.floor(path.length * 0.18), Math.floor(path.length * 0.47), Math.floor(path.length * 0.8)];
    const eaten = pellets.filter((p) => head >= p).length;
    const len = 5 + eaten * 3;
    for (let i = len - 1; i >= 0; i--) {
      const idx = head - i;
      if (idx < 0) continue;
      const [c, r] = path[idx % path.length]!;
      const x = ox + c * cs;
      const y = oy + r * cs;
      const k = i / len;
      const col = i === 0 ? '#eafff4' : k < 0.3 ? '#2de38f' : k < 0.7 ? '#1fb870' : '#137a4a';
      rect(ctx, x, y, cs - 1, cs - 1, col);
      if (i === 0) {
        rect(ctx, x - 1, y - 1, cs + 1, cs + 1, 'rgba(45,227,143,0.35)');
        rect(ctx, x + 1, y + 1, 1, 1, '#03060f');
      }
    }
    pellets.forEach((p, i) => {
      if (head >= p) return;
      const [c, r] = path[p % path.length]!;
      const pulse = blinkOn(f, f.t + i, 3, 0.5);
      rect(
        ctx,
        ox + c * cs + (pulse ? 0 : 1),
        oy + r * cs + (pulse ? 0 : 1),
        pulse ? cs - 1 : cs - 3,
        pulse ? cs - 1 : cs - 3,
        i === 2 ? '#ff4fd8' : '#ffd23f',
      );
    });
    // "+10" pop after each bite
    pellets.forEach((p) => {
      const since = tt - p / speed;
      if (since < 0 || since > 0.7 || !f.hud) return;
      const [c, r] = path[p % path.length]!;
      drawTextC(ctx, '+10', ox + c * cs + cs / 2, oy + r * cs - 6 - Math.round(since * 6), '#ffd23f', 1, '#000000');
    });
  },
};

// ---------------------------------------------------------------------------
// Brick Blitz — the ball carves through a neon wall.
// ---------------------------------------------------------------------------
const BRICKS_C = 7.6;
const BRICK_COLS = ['#ff4fd8', '#ff8a3d', '#ffd23f', '#2de38f', '#22d3ee'];

export const bricks: Scene = {
  label: 'BRICKS',
  length: BRICKS_C,
  still: 4.2,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, BRICKS_C);
    rect(ctx, 0, 0, W, H, '#070516');
    for (let y = 0; y < H; y += 3) rect(ctx, 0, y, W, 1, '#0a0820');
    const cols = W >= 110 ? 10 : 8;
    const rows = 5;
    const m = 3;
    const bw = Math.floor((W - m * 2) / cols);
    const bh = Math.max(3, Math.floor(H * 0.065));
    const top = Math.max(Math.round(H * 0.14), f.top + 9);
    const ox = Math.round((W - bw * cols) / 2);
    // ball: triangle waves; each time it reaches the wall it breaks the lowest brick in its column
    const px = 1.7;
    const py = 1.1;
    const ballX = (t: number) => m + (W - m * 2 - 2) * tri(t, px);
    const ballY = (t: number) => top + rows * bh + (H - 8 - (top + rows * bh)) * tri(t + py / 2, py);
    const broken = new Set<string>();
    const hits: number[] = [];
    // wall contacts happen at y minima: t = py * k (ball at the brick line)
    for (let k = 0; k * py <= tt; k++) {
      const at = k * py;
      const col = clamp(Math.floor((ballX(at) - ox) / bw), 0, cols - 1);
      for (let r = rows - 1; r >= 0; r--) {
        const key = `${r},${col}`;
        if (!broken.has(key)) {
          broken.add(key);
          hits.push(at);
          break;
        }
      }
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (broken.has(`${r},${c}`)) continue;
        const x = ox + c * bw;
        const y = top + r * bh;
        const col = BRICK_COLS[r % BRICK_COLS.length]!;
        rect(ctx, x, y, bw - 1, bh - 1, col);
        rect(ctx, x, y, bw - 1, 1, 'rgba(255,255,255,0.45)');
        rect(ctx, x, y + bh - 2, bw - 1, 1, 'rgba(0,0,0,0.3)');
      }
    // shards from the most recent hit
    const lastHit = hits[hits.length - 1];
    if (lastHit !== undefined && tt - lastHit < 0.4) {
      const e = (tt - lastHit) / 0.4;
      const hx = ballX(lastHit);
      const hy = top + rows * bh - 2;
      for (let i = 0; i < 6; i++)
        rect(ctx, hx + (hash(i * 2.3) - 0.5) * 14 * e, hy - (hash(i * 5.1) * 8 - 10 * e) * e, 1, 1, BRICK_COLS[i % BRICK_COLS.length]!);
    }
    const bx = ballX(tt);
    const by = ballY(tt);
    const padW = Math.max(12, Math.round(W * 0.18));
    const padX = clamp(bx - padW / 2 + Math.sin(f.t * 2) * 2, 1, W - padW - 1);
    rect(ctx, padX, H - 5, padW, 2, '#7cf5ff');
    rect(ctx, padX + 1, H - 3, padW - 2, 1, '#1f6a8a');
    rect(ctx, bx, by, 2, 2, '#ffffff');
    rect(ctx, bx - 1, by + 1, 1, 1, 'rgba(255,255,255,0.4)');
    if (f.hud) drawTextC(ctx, String(hits.length * 50).padStart(4, '0'), W / 2, f.top + 2, '#ffd23f');
  },
};

// ---------------------------------------------------------------------------
// Asteroid Run — a ship spins and splits drifting rocks.
// ---------------------------------------------------------------------------
const AST_C = 8;
const ROCKS = [
  { x: 0.18, y: 0.25, vx: 0.05, vy: 0.03, r: 7, hit: 1.6 },
  { x: 0.82, y: 0.3, vx: -0.04, vy: 0.04, r: 6, hit: 3.4 },
  { x: 0.7, y: 0.82, vx: -0.03, vy: -0.05, r: 8, hit: 5.3 },
  { x: 0.12, y: 0.78, vx: 0.04, vy: -0.02, r: 5, hit: 99 },
];

function rock(ctx: Ctx, x: number, y: number, r: number, seed: number, rot: number): void {
  const n = 8;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const rr = r * (0.75 + hash(seed * 7 + (i % n)) * 0.35);
    const qx = x + Math.cos(a) * rr;
    const qy = y + Math.sin(a) * rr;
    if (i > 0) line(ctx, px, py, qx, qy, '#c8b8ff');
    px = qx;
    py = qy;
  }
}

export const asteroids: Scene = {
  label: 'ASTEROIDS',
  length: AST_C,
  still: 3.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, AST_C);
    rect(ctx, 0, 0, W, H, '#04030c');
    starfield(ctx, W, H, f.still ? 0 : f.t, 26, 1.2, 9);
    const cx = W / 2;
    const cy = H / 2;
    const scale = Math.min(W, H) / 64;
    const pos = (r: (typeof ROCKS)[number], t: number): [number, number] => [
      ((((r.x + r.vx * t) % 1) + 1) % 1) * W,
      ((((r.y + r.vy * t) % 1) + 1) % 1) * H,
    ];
    // ship aims at the next rock to be hit
    const next = ROCKS.find((r) => r.hit > tt) ?? ROCKS[0]!;
    const [tx, ty] = pos(next, Math.min(next.hit, tt + 0.4));
    const aim = Math.atan2(ty - cy, tx - cx);
    const shipA = aim;
    const nose: [number, number] = [cx + Math.cos(shipA) * 5 * scale, cy + Math.sin(shipA) * 5 * scale];
    const left: [number, number] = [cx + Math.cos(shipA + 2.5) * 4 * scale, cy + Math.sin(shipA + 2.5) * 4 * scale];
    const right: [number, number] = [cx + Math.cos(shipA - 2.5) * 4 * scale, cy + Math.sin(shipA - 2.5) * 4 * scale];
    line(ctx, nose[0], nose[1], left[0], left[1], '#7cf5ff');
    line(ctx, nose[0], nose[1], right[0], right[1], '#7cf5ff');
    line(ctx, left[0], left[1], right[0], right[1], '#7cf5ff');
    if (!f.still && Math.floor(f.t * 12) % 2)
      rect(ctx, cx - Math.cos(shipA) * 4 * scale, cy - Math.sin(shipA) * 4 * scale, 1, 1, '#ff8a3d');
    ROCKS.forEach((r, i) => {
      const flight = 0.35;
      if (tt < r.hit) {
        const [x, y] = pos(r, tt);
        rock(ctx, x, y, r.r * scale, i + 1, tt * 0.6 + i);
        // bullet in flight
        if (tt > r.hit - flight) {
          const k = 1 - (r.hit - tt) / flight;
          const [hx, hy] = pos(r, r.hit);
          rect(ctx, cx + (hx - cx) * k, cy + (hy - cy) * k, 1, 1, '#ffd23f');
        }
      } else {
        // split into two small rocks drifting apart + debris
        const since = tt - r.hit;
        const [x, y] = pos(r, r.hit);
        for (let s = 0; s < 2; s++) {
          const dir = s ? 1 : -1;
          rock(
            ctx,
            x + dir * since * 7 * scale + r.vx * since * W,
            y - dir * since * 4 * scale + r.vy * since * H,
            r.r * 0.5 * scale,
            i * 3 + s,
            since * 2 * dir,
          );
        }
        if (since < 0.5)
          for (let k = 0; k < 6; k++) rect(ctx, x + Math.cos(k * 1.1) * since * 16, y + Math.sin(k * 1.1) * since * 16, 1, 1, '#ffd23f');
        if (since < 0.7 && f.hud) drawTextC(ctx, '+100', x, y - 8 - Math.round(since * 8), '#ffd23f', 1, '#000000');
      }
    });
    if (f.hud) {
      const hitN = ROCKS.filter((r) => r.hit <= tt).length;
      drawTextC(ctx, String(hitN * 100).padStart(4, '0'), W / 2, f.top + 2, '#7cf5ff');
    }
  },
};

// ---------------------------------------------------------------------------
// Memory Matrix — watch the pattern light up, then repeat it.
// ---------------------------------------------------------------------------
const MEM_C = 8.4;
const PAD_COLORS = ['#ff4fd8', '#22d3ee', '#ffd23f', '#2de38f', '#a78bfa', '#ff8a3d', '#38bdf8', '#ff5a5f', '#7cf5ff'];
const PATTERN = [4, 0, 8, 2, 6];

export const memory: Scene = {
  label: 'MEMORY',
  length: MEM_C,
  still: 2.0,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, MEM_C);
    rect(ctx, 0, 0, W, H, '#0a0618');
    const n = 3;
    const gap = W >= 110 ? 4 : 3;
    const top = Math.max(10 + f.top, Math.round(H * 0.16));
    const ps = Math.max(5, Math.floor((Math.min(W - 8, H - top - 11) - (n - 1) * gap) / n));
    const gw = n * ps + (n - 1) * gap;
    const gx = Math.round((W - gw) / 2);
    const gy = top;
    const showAt = 0.6;
    const step = 0.45;
    const repeatAt = showAt + PATTERN.length * step + 0.5;
    let lit = -1;
    let phase: 'watch' | 'repeat' | 'win' = 'watch';
    if (tt >= showAt && tt < showAt + PATTERN.length * step) {
      const i = Math.floor((tt - showAt) / step);
      if ((tt - showAt) % step < step * 0.7) lit = PATTERN[i]!;
    } else if (tt >= repeatAt && tt < repeatAt + PATTERN.length * step) {
      phase = 'repeat';
      const i = Math.floor((tt - repeatAt) / step);
      if ((tt - repeatAt) % step < step * 0.55) lit = PATTERN[i]!;
    } else if (tt >= repeatAt + PATTERN.length * step) phase = 'win';
    for (let i = 0; i < n * n; i++) {
      const x = gx + (i % n) * (ps + gap);
      const y = gy + Math.floor(i / n) * (ps + gap);
      const col = PAD_COLORS[i]!;
      const on = lit === i || (phase === 'win' && blinkOn(f, tt + i * 0.05, 4));
      rect(ctx, x + 1, y + 1, ps, ps, 'rgba(0,0,0,0.6)');
      rect(ctx, x, y, ps, ps, on ? col : '#1a1230');
      frame(ctx, x, y, ps, ps, col);
      if (on) {
        rect(ctx, x + 1, y + 1, ps - 2, 1, 'rgba(255,255,255,0.7)');
        rect(ctx, x - 1, y - 1, ps + 2, 1, col);
      }
      if (on && phase === 'repeat') {
        // a "finger" tap marker
        disc(ctx, x + ps / 2, y + ps / 2, Math.max(1.5, ps * 0.16), '#ffffff');
      }
    }
    if (f.hud) {
      const label = phase === 'watch' ? 'WATCH' : phase === 'repeat' ? 'REPEAT' : 'LEVEL UP!';
      if (phase !== 'win' || tt < MEM_C - 0.3)
        drawTextC(
          ctx,
          label,
          W / 2 + 0.5,
          Math.max(1, gy - 8),
          phase === 'win' ? (blinkOn(f, tt) ? '#ffd23f' : '#ffffff') : '#a78bfa',
          1,
          '#000000',
        );
      if (phase === 'win')
        for (let i = 0; i < 5; i++) sparkle(ctx, gx + hash(i + 1) * gw, gy + hash(i + 8) * gw, tt * 3 + i * 0.3, '#fff3b0');
    }
  },
};

// ---------------------------------------------------------------------------
// Block Drop — pieces fall and lock; two lines flash and clear.
// ---------------------------------------------------------------------------
const BLOCK_C = 8.4;
const WELL_W = 8;
const WELL_H = 12;
const BLOCK_COLORS = ['#22d3ee', '#ffd23f', '#a78bfa', '#2de38f', '#ff4fd8', '#ff8a3d'];
// Pre-built stack (12 rows × 8). '.' empty; digits index colours. Rows 9 and 10 are one piece away from complete.
const BASE = [
  '........',
  '........',
  '........',
  '........',
  '........',
  '........',
  '........',
  '1.......',
  '12.....5',
  '3344.5.5',
  '334445.5',
  '1122.555',
];
const DROPS: Array<{ cells: Array<[number, number]>; color: number; at: number }> = [
  // a T that plugs row 9, column 4
  {
    cells: [
      [3, 8],
      [4, 8],
      [5, 8],
      [4, 9],
    ],
    color: 2,
    at: 0.4,
  },
  // a long bar down column 6 (rows 7–10) → rows 9 and 10 complete
  {
    cells: [
      [6, 7],
      [6, 8],
      [6, 9],
      [6, 10],
    ],
    color: 0,
    at: 2.4,
  },
];
const FALL = 1.5;

export const blocks: Scene = {
  label: 'BLOCKS',
  length: BLOCK_C,
  still: 4.3,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, BLOCK_C);
    rect(ctx, 0, 0, W, H, '#060414');
    const cs = Math.max(3, Math.floor((H - 4) / WELL_H));
    const ww = cs * WELL_W;
    const wh = cs * WELL_H;
    const side = W - ww >= 30;
    const wx = side ? Math.round((W - ww) / 2 - 8) : Math.round((W - ww) / 2);
    const wy = Math.round((H - wh) / 2);
    rect(ctx, wx - 2, wy, 1, wh + 1, '#a78bfa');
    rect(ctx, wx + ww + 1, wy, 1, wh + 1, '#a78bfa');
    rect(ctx, wx - 2, wy + wh + 1, ww + 4, 1, '#a78bfa');
    for (let y = 0; y < WELL_H; y++)
      for (let x = 0; x < WELL_W; x++) rect(ctx, wx + x * cs + Math.floor(cs / 2), wy + y * cs + Math.floor(cs / 2), 1, 1, '#141030');
    const grid: Array<Array<number>> = BASE.map((row) => row.split('').map((ch) => (ch === '.' ? -1 : Number(ch))));
    let falling: { cells: Array<[number, number]>; color: number; dy: number } | null = null;
    for (const d of DROPS) {
      if (tt < d.at) break;
      const k = clamp((tt - d.at) / FALL, 0, 1);
      const minY = Math.min(...d.cells.map((c) => c[1]));
      const dist = minY + 2;
      const dy = Math.floor((1 - k) * dist);
      if (k < 1) {
        falling = { cells: d.cells, color: d.color, dy };
        break;
      }
      for (const [x, y] of d.cells) grid[y]![x] = d.color;
    }
    const clearAt = DROPS[1]!.at + FALL;
    const full = grid.map((row) => row.every((v) => v >= 0));
    const flashing = tt > clearAt && tt < clearAt + 0.6;
    const cleared = tt >= clearAt + 0.6;
    // collapse cleared rows
    let rowsToDraw = grid;
    if (cleared) {
      const kept = grid.filter((_, i) => !full[i]);
      rowsToDraw = [...Array.from({ length: WELL_H - kept.length }, () => Array<number>(WELL_W).fill(-1)), ...kept];
    }
    const cell = (x: number, y: number, color: string) => {
      rect(ctx, wx + x * cs, wy + y * cs, cs - 1, cs - 1, color);
      if (cs >= 4) rect(ctx, wx + x * cs, wy + y * cs, cs - 1, 1, 'rgba(255,255,255,0.45)');
    };
    rowsToDraw.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v < 0) return;
        const flash = flashing && full[y] && blinkOn(f, tt, 10);
        cell(x, y, flash ? '#ffffff' : BLOCK_COLORS[v]!);
      }),
    );
    if (falling) for (const [x, y] of falling.cells) if (y - falling.dy >= 0) cell(x, y - falling.dy, BLOCK_COLORS[falling.color]!);
    if (side) {
      const px = wx + ww + 5;
      drawTextC(ctx, 'NEXT', px + 8, wy, '#a78bfa');
      const nx = px + 4;
      const ny = wy + 8;
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1],
      ].forEach(([x, y]) => rect(ctx, nx + x! * 3, ny + y! * 3, 2, 2, '#ff4fd8'));
      const lines = cleared || flashing ? 2 : 0;
      drawTextC(ctx, `L${lines}`, px + 8, wy + wh - 6, '#ffd23f');
    }
    if ((flashing || (cleared && tt < BLOCK_C - 0.5)) && f.hud)
      banner(ctx, 'DOUBLE!', W, wy + wh * 0.35, blinkOn(f, tt) ? '#ffd23f' : '#ffffff', '#060414', 1);
  },
};
