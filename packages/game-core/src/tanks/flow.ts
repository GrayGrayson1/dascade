/**
 * Liquids on the heightmap: burning fuel (napalm) and liquid earth (mudslide).
 *
 * A pour runs downhill from where it lands to the bottom of the dip it finds, leaving a thin
 * film along the way, and the rest settles there as a pool. A pool's surface isn't perfectly
 * flat — it slopes down from its centre by `viscosity` per column — so on flat ground a pour
 * makes a puddle with a body instead of thinning out forever, while in a valley it fills from
 * the bottom up (and runs over a low rim when the far side drops away faster than that). The
 * pool level is found by bisection on the volume. Only + - * / and min/max are used: the same
 * pour gives the same pool everywhere.
 */
import { TANKS_WORLD } from '@dascade/shared/games/tanks';
import { quantize, type Terrain } from './terrain.ts';

export interface PourOptions {
  /** How far (columns) the liquid may run from the pour point each way. */
  reach: number;
  /** How fast the pool surface falls away from its centre (columns → units). Thicker liquids pile higher. */
  viscosity: number;
  /** Depth left behind on each column the liquid runs down. */
  film: number;
}

export const NAPALM_FLOW: PourOptions = { reach: 520, viscosity: 0.25, film: 0.6 };
export const MUD_FLOW: PourOptions = { reach: 480, viscosity: 0.5, film: 0.3 };

export interface Pool {
  /** First column covered by `depth`. */
  x0: number;
  /** Liquid depth per column from x0 (world units). */
  depth: Float64Array;
}

/** Pour `volume` (depth × columns) at column x and let it run downhill and settle. */
export function pour(t: Terrain, x: number, volume: number, opts: PourOptions): Pool {
  const cx = Math.max(0, Math.min(t.width - 1, Math.floor(x)));
  const x0 = Math.max(0, cx - opts.reach);
  const x1 = Math.min(t.width - 1, cx + opts.reach);
  const n = x1 - x0 + 1;
  const d = new Float64Array(n);
  const h = (i: number) => t.h[i]!;
  let left = volume;

  // Run downhill (steepest lower neighbour) to the bottom of the dip, filming the way.
  let m = cx;
  for (let guard = 0; guard < n; guard++) {
    const l = m > x0 ? h(m - 1) : Infinity;
    const r = m < x1 ? h(m + 1) : Infinity;
    const here = h(m);
    if (l >= here && r >= here) break;
    const film = Math.min(opts.film, left * 0.5);
    d[m - x0] = d[m - x0]! + film;
    left -= film;
    m = l < r ? m - 1 : m + 1;
  }

  // Settle the rest as a pool centred on the bottom: find the level that holds exactly `left`.
  const visc = opts.viscosity;
  const held = (level: number): number => {
    let sum = 0;
    for (let i = m; i >= x0; i--) {
      const s = level - visc * (m - i) - h(i);
      if (s <= 0) break;
      sum += s;
    }
    for (let i = m + 1; i <= x1; i++) {
      const s = level - visc * (i - m) - h(i);
      if (s <= 0) break;
      sum += s;
    }
    return sum;
  };
  let lo = h(m);
  let hi = h(m) + left + 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (held(mid) < left) lo = mid;
    else hi = mid;
  }
  const level = (lo + hi) / 2;
  for (let i = m; i >= x0; i--) {
    const s = level - visc * (m - i) - h(i);
    if (s <= 0) break;
    d[i - x0] = d[i - x0]! + s;
  }
  for (let i = m + 1; i <= x1; i++) {
    const s = level - visc * (i - m) - h(i);
    if (s <= 0) break;
    d[i - x0] = d[i - x0]! + s;
  }
  return { x0, depth: d };
}

/** Columns [a, b) of a pool that actually hold liquid (empty when dry). */
export function wetRange(pool: Pool, min = 0.05): { a: number; b: number } {
  let a = -1;
  let b = -1;
  for (let i = 0; i < pool.depth.length; i++) {
    if (pool.depth[i]! > min) {
      if (a < 0) a = i;
      b = i;
    }
  }
  return a < 0 ? { a: 0, b: 0 } : { a: pool.x0 + a, b: pool.x0 + b + 1 };
}

/** Burning intensity 1..9 per column (0 = not burning) for the client's flames. */
export function fireCells(pool: Pool): { x0: number; cells: number[] } {
  const { a, b } = wetRange(pool, 0.25);
  const cells: number[] = [];
  for (let x = a; x < b; x++) {
    const v = pool.depth[x - pool.x0]!;
    cells.push(v < 0.25 ? 0 : Math.min(9, 1 + Math.floor(v / 1.2)));
  }
  return { x0: a, cells };
}

/** Heat under a tank's tracks: summed fuel depth over its footprint. */
export function heatUnder(pool: Pool, x: number, halfWidth: number): number {
  let sum = 0;
  const i0 = Math.max(0, Math.floor(x - halfWidth) - pool.x0);
  const i1 = Math.min(pool.depth.length - 1, Math.floor(x + halfWidth) - pool.x0);
  for (let i = i0; i <= i1; i++) sum += pool.depth[i]!;
  return sum;
}

/**
 * Let liquid earth set: adds the pool's depth to the terrain (capped at the ceiling) and
 * returns the quantized heights it wrote, ready for a 'patch' event (empty when dry).
 */
export function setMud(t: Terrain, pool: Pool): { x0: number; h: number[] } {
  const { a, b } = wetRange(pool, 0.05);
  const h: number[] = [];
  for (let x = a; x < b; x++) {
    const next = quantize(Math.min(TANKS_WORLD.ceiling, t.h[x]! + pool.depth[x - pool.x0]!));
    t.h[x] = next;
    h.push(next);
  }
  return { x0: a, h };
}
