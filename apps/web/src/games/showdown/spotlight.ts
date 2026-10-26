/**
 * The Spotlight picker's geometry and choreography (PCK-01 D), as pure functions of their inputs —
 * no DOM, no clock, no randomness — so every screen draws the same sweep and the tests can pin it.
 *
 *  - seatLayout(): the audience grid sized to the room (6 to 60 seats, more if it must) inside the
 *    overlay's area, as big as it fits; names stay readable (≈ 20 px at 60 seats on a 1080p stage).
 *  - seatFont(): a name's size on its seat (two balanced lines at most, never breaking inside a word).
 *  - spotFrame(): where the three spotlights are `t` ms after the draw. They wander along seeded paths
 *    (the seed is the draw number, so every screen sweeps the same way), then converge on the winner's
 *    seat during the last SHOWDOWN_CONVERGE_MS before the landing — starting from where they are.
 *
 * The server already decided who was picked; nothing here can change it. Only + - * / are used, so
 * the paths are the same on every browser.
 */

/** The converge before the landing (ms). */
export const SPOT_CONVERGE_MS = 1500;
/** The landing card stays up this long after the landing (ms); then the podium holds the name. */
export const SPOT_CARD_MS = 2500;
/** The overlay fades out over this long after the card (ms). */
export const SPOT_OUT_MS = 900;
/** Three spotlights sweep the room. */
export const SPOT_COUNT = 3;

/** Average width of a character on a seat, in em. */
const CHAR_EM = 0.66;
/** A seat's preferred shape (width : height) and the widest it may get. */
const SEAT_ASPECT = 2.4;
const SEAT_MAX_ASPECT = 3.1;

export interface SeatLayout {
  cols: number;
  rows: number;
  /** One seat (px). */
  w: number;
  h: number;
  gap: number;
  /** The grid's top-left corner inside the area (px): the grid is centred. */
  x0: number;
  y0: number;
}

/**
 * The seat grid for `n` seats in a `width` × `height` area (px). Picks the column count that gives
 * the tallest seats; seats never grow past a sixth of the area's height (six people still look like
 * an audience, not six buttons). Among equally tall layouts: the fewest empty places, then the widest
 * rows (a theatre, not a tower).
 */
export function seatLayout(n: number, width: number, height: number): SeatLayout {
  const count = Math.max(1, Math.floor(n));
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const gap = Math.max(4, Math.round(Math.min(W, H) * 0.022));
  const maxH = H * 0.17;
  let best: SeatLayout | null = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    // A layout with a whole empty row is never better than one column fewer.
    if (rows > 1 && (rows - 1) * cols >= count) continue;
    const cellW = (W - (cols - 1) * gap) / cols;
    const cellH = (H - (rows - 1) * gap) / rows;
    const h = Math.min(cellH, cellW / SEAT_ASPECT, maxH);
    if (h <= 0) continue;
    const w = Math.min(cellW, h * SEAT_MAX_ASPECT);
    const gridW = cols * w + (cols - 1) * gap;
    const gridH = rows * h + (rows - 1) * gap;
    const layout: SeatLayout = { cols, rows, w, h, gap, x0: (W - gridW) / 2, y0: (H - gridH) / 2 };
    if (!best || h > best.h + 0.5) {
      best = layout;
      continue;
    }
    if (h < best.h - 0.5) continue;
    const empty = cols * rows - count;
    const bestEmpty = best.cols * best.rows - count;
    if (empty < bestEmpty || (empty === bestEmpty && cols > best.cols)) best = layout;
  }
  return best!;
}

/** The centre of seat `i` (of `n`) in the area (px). A short last row is centred. */
export function seatCenter(layout: SeatLayout, i: number, n: number): { x: number; y: number } {
  const row = Math.floor(i / layout.cols);
  const col = i % layout.cols;
  const inRow = row === layout.rows - 1 ? n - row * layout.cols : layout.cols;
  const shift = ((layout.cols - inRow) * (layout.w + layout.gap)) / 2;
  return {
    x: layout.x0 + shift + col * (layout.w + layout.gap) + layout.w / 2,
    y: layout.y0 + row * (layout.h + layout.gap) + layout.h / 2,
  };
}

/**
 * A name's font size on a seat (px): up to a third of the seat's height, smaller when the name needs
 * it — the whole name in two lines, and its longest word on one.
 */
export function seatFont(layout: Pick<SeatLayout, 'w' | 'h'>, name: string): number {
  const chars = Array.from(name.trim());
  const len = Math.max(4, chars.length);
  const wlen = Math.max(
    3,
    ...name
      .trim()
      .split(/\s+/)
      .map((word) => Array.from(word).length),
  );
  // ≈ 0.66 em per character for the seats' heavy UI face (measured: "Montgomery" is 6.4 em); 88 % of
  // the seat's width is usable.
  const usable = layout.w * 0.88;
  const twoLines = (2 * usable) / (CHAR_EM * len);
  const oneWord = usable / (CHAR_EM * wlen);
  const cap = layout.h * 0.34;
  const floor = layout.h * 0.18;
  return Math.max(floor, Math.min(cap, twoLines, oneWord));
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every screen. */
export function seeded(seed: number): () => number {
  let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpotPath {
  /** Waypoints in the area's own 0…1 coordinates. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Ms between waypoints. */
  step: number;
}

/** Where on the area the spots may wander (normalized; the edges stay clear). */
const X_MIN = 0.07;
const X_MAX = 0.93;
const Y_MIN = 0.1;
const Y_MAX = 0.9;

/**
 * The spotlights' wandering paths for a draw, seeded by its number. Each spot starts in its own
 * third of the room and moves at its own pace, and each hop is long enough to read as a sweep.
 */
export function spotPaths(drawNo: number, durationMs: number, count = SPOT_COUNT): SpotPath[] {
  const rand = seeded(drawNo * 7919 + 17);
  const out: SpotPath[] = [];
  for (let i = 0; i < count; i++) {
    const step = 620 + i * 110 + Math.floor(rand() * 120);
    const n = Math.max(4, Math.ceil(durationMs / step) + 3);
    const points: Array<readonly [number, number]> = [];
    let x = X_MIN + ((i + 0.2 + rand() * 0.6) / count) * (X_MAX - X_MIN);
    let y = Y_MIN + (0.25 + rand() * 0.5) * (Y_MAX - Y_MIN);
    points.push([x, y]);
    for (let k = 1; k < n; k++) {
      // A few tries for a hop that travels (a spot that barely moves reads as stuck).
      let nx = x;
      let ny = y;
      for (let tries = 0; tries < 6; tries++) {
        nx = X_MIN + rand() * (X_MAX - X_MIN);
        ny = Y_MIN + rand() * (Y_MAX - Y_MIN);
        const dx = nx - x;
        const dy = ny - y;
        if (dx * dx + dy * dy >= 0.08) break;
      }
      x = nx;
      y = ny;
      points.push([x, y]);
    }
    out.push({ points, step });
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Catmull-Rom between waypoints: a smooth curve through every point. */
export function spotPoint(path: SpotPath, t: number): [number, number] {
  const pts = path.points;
  const last = pts.length - 1;
  const u = Math.max(0, t) / path.step;
  const seg = Math.min(last - 1, Math.floor(u));
  const k = Math.min(1, u - seg);
  const p0 = pts[Math.max(0, seg - 1)]!;
  const p1 = pts[seg]!;
  const p2 = pts[Math.min(last, seg + 1)]!;
  const p3 = pts[Math.min(last, seg + 2)]!;
  const k2 = k * k;
  const k3 = k2 * k;
  const at = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (3 * b - 3 * c + d - a) * k3);
  return [clamp01(at(p0[0], p1[0], p2[0], p3[0])), clamp01(at(p0[1], p1[1], p2[1], p3[1]))];
}

/** Ease in and out (cubic). */
export function easeInOut(k: number): number {
  const v = clamp01(k);
  return v < 0.5 ? 4 * v * v * v : 1 - ((-2 * v + 2) * (-2 * v + 2) * (-2 * v + 2)) / 2;
}

export interface SpotFrame {
  /** Each spot's centre, normalized to the area. */
  spots: Array<[number, number]>;
  /** 0 while sweeping → 1 at the landing (how far the converge has gone). */
  converge: number;
}

/**
 * The three spots `t` ms after the draw. `landT` = ms from the draw to the landing; `target` = the
 * winner's seat centre (normalized). They sweep until `landT - SPOT_CONVERGE_MS`, then glide from
 * where they are onto the target, arriving together exactly at `landT`.
 */
export function spotFrame(paths: readonly SpotPath[], t: number, landT: number, target: readonly [number, number]): SpotFrame {
  const startConverge = Math.max(0, landT - SPOT_CONVERGE_MS);
  const span = Math.max(1, landT - startConverge);
  const converge = t <= startConverge ? 0 : easeInOut((t - startConverge) / span);
  const spots = paths.map((path): [number, number] => {
    if (converge === 0) return spotPoint(path, t);
    const from = spotPoint(path, startConverge);
    return [from[0] + (target[0] - from[0]) * converge, from[1] + (target[1] - from[1]) * converge];
  });
  return { spots, converge };
}

export type PickPhase = 'idle' | 'sweep' | 'card' | 'out';

/**
 * Where a draw is at `now` (server ms) for a screen that saw it at `seenAt`. A screen that first sees
 * the draw after its landing (a reload, a reconnect, a restored show) shows no sweep and no card:
 * nothing replays — the podium simply holds the name.
 */
export function pickPhase(draw: { pickAt: number; landAt: number; seenAt: number }, now: number): PickPhase {
  const { pickAt, landAt, seenAt } = draw;
  if (!pickAt || !landAt || seenAt >= landAt) return 'idle';
  if (now < landAt) return now >= pickAt - 250 ? 'sweep' : 'idle';
  if (now < landAt + SPOT_CARD_MS) return 'card';
  if (now < landAt + SPOT_CARD_MS + SPOT_OUT_MS) return 'out';
  return 'idle';
}
