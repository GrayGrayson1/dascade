/**
 * Napalm flame geometry (pure; unit tested). A `fire` event carries the burning columns of a
 * settled pool (intensity 1..9). The pool is shown spreading out from its origin — fuel runs
 * downhill from the highest burning ground — then burning, then dying down. The renderer asks
 * for the flame tongues of a layer at a moment and draws them.
 */
import type { Terrain } from '@dascade/game-core/tanks';

export interface FireShape {
  x0: number;
  cells: readonly number[];
  dur: number;
  origin: number;
}

export interface Flame {
  /** Column centre (world x) and the ground height under it. */
  x: number;
  base: number;
  /** Tongue height (world units) and opacity 0..1. */
  height: number;
  alpha: number;
  /** Cell intensity 1..9 (colour: hotter = whiter). */
  heat: number;
}

/** Flames advance this fast (units/s) from the origin while the pool forms. */
export const FIRE_SPREAD = 420;
/** Each column flares up over this long once the flames reach it. */
const FIRE_RISE_MS = 240;
/** The whole pool dies down over this long at the end. */
const FIRE_FADE_MS = 700;

/** Tongue height for a cell intensity. */
export function flameHeight(heat: number): number {
  return 6 + Math.max(0, Math.min(9, heat)) * 4.2;
}

/**
 * The flame tongues of `layer` `elapsed` ms after it ignited, one every `step` columns.
 * `flicker(col)` (0..1, default steady) lets the renderer animate heights without changing the layout.
 */
export function fireFlames(
  layer: FireShape,
  terrain: Terrain,
  elapsed: number,
  step = 3,
  flicker: (col: number) => number = () => 1,
): Flame[] {
  const out: Flame[] = [];
  if (elapsed < 0 || elapsed > layer.dur) return out;
  const reach = (elapsed / 1000) * FIRE_SPREAD;
  const fade = elapsed > layer.dur - FIRE_FADE_MS ? Math.max(0, (layer.dur - elapsed) / FIRE_FADE_MS) : 1;
  const s = Math.max(1, Math.round(step));
  for (let k = 0; k < layer.cells.length; k += s) {
    // The hottest cell of this step stands for the group.
    let heat = 0;
    for (let j = k; j < Math.min(layer.cells.length, k + s); j++) heat = Math.max(heat, layer.cells[j]!);
    if (heat <= 0) continue;
    const col = layer.x0 + k;
    if (col < 0 || col >= terrain.width) continue;
    const dist = Math.abs(col - layer.origin);
    if (dist > reach) continue;
    const since = ((reach - dist) / FIRE_SPREAD) * 1000;
    const rise = Math.min(1, since / FIRE_RISE_MS);
    const alpha = rise * fade;
    if (alpha <= 0) continue;
    out.push({
      x: col + Math.min(s, layer.cells.length - k) / 2,
      base: terrain.h[col]!,
      height: flameHeight(heat) * (0.55 + 0.45 * rise) * (0.7 + 0.3 * flicker(col)) * (0.6 + 0.4 * fade),
      alpha,
      heat,
    });
  }
  return out;
}

/** World-x span of the burning columns (for glow and sound), or null when nothing burns. */
export function fireSpan(layer: Pick<FireShape, 'x0' | 'cells'>): { x0: number; x1: number } | null {
  let lo = -1;
  let hi = -1;
  for (let k = 0; k < layer.cells.length; k++) {
    if (!(layer.cells[k]! > 0)) continue;
    if (lo < 0) lo = k;
    hi = k;
  }
  return lo < 0 ? null : { x0: layer.x0 + lo, x1: layer.x0 + hi + 1 };
}
