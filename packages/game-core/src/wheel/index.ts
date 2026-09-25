/**
 * Wheel of DAStiny engine: pure, deterministic, framework-free.
 *
 *  segments.ts  normalization of settings into the active wheel, colors
 *  geometry.ts  slice arcs, pointer / peg math
 *  spin.ts      weighted winner selection, spin planning, the shared easing curve
 *  bulk.ts      bulk paste parsing (newline + CSV-like extras)
 */
export * from './segments.ts';
export * from './geometry.ts';
export * from './spin.ts';
export * from './bulk.ts';
