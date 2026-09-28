import type { KartTrackDef } from '../trackdef.ts';
import { pieceFrac, turtle } from './path.ts';

/**
 * Pixel Plaza — the starter track, built to teach drifting. A wide neon boulevard around the giant
 * DASCADE cabinet: a pad-lined start straight, a fast sweeper, a chicane to flick the drift
 * direction, the long 180° cabinet U (hold it for a stage-2/3 mini-turbo), the back straight over
 * a gentle crest, a tight hairpin that needs a drift, and a fast S back onto the line.
 *
 * Laid out with exact radii (tracks/path.ts); features are placed relative to the pieces.
 */
const P = turtle([
  { straight: 100 }, // 0 start straight (the grid sits on piece 16, before the line)
  { arc: 90, r: 48 }, // 1 sweeper (fast; wide drift)
  { straight: 150 }, // 2 right side
  { arc: 30, r: 22 }, // 3 chicane left
  { arc: -30, r: 22 }, // 4 chicane right
  { straight: 20 }, // 5
  { arc: 180, r: 24 }, // 6 the cabinet U
  { straight: 89 }, // 7 U exit
  { arc: -90, r: 30 }, // 8 onto the back straight
  { straight: 130, z: 2.5 }, // 9 back straight, up the crest
  { straight: 137, z: 0, hw: 9 }, // 10 … and down
  { arc: 180, r: 16, hw: 8 }, // 11 the hairpin
  { straight: 40, hw: 9 }, // 12
  { arc: -90, r: 28 }, // 13 S (right)
  { straight: 30 }, // 14
  { arc: 90, r: 35 }, // 15 S (left) onto the start straight
  { straight: 100 }, // 16 the grid
]);
const f = (piece: number, t = 0.5) => pieceFrac(P, piece, t);

export const PIXEL_PLAZA: KartTrackDef = {
  id: 'pixel-plaza',
  biome: 'city',
  points: P.points,
  halfWidth: 10,
  shoulder: 5,
  offroad: 'grass',
  edge: 'wall',
  boostPads: [
    { at: f(0, 0.45), d: 0 },
    // Rewards for a clean exit line out of the drift corners.
    { at: f(7, 0.6), d: -3 },
    { at: f(12, 0.55), d: -2 },
    { at: f(15, 0.25), d: 3 },
  ],
  itemRows: [
    { at: f(0, 0.95), count: 5 },
    { at: f(2, 0.5), count: 4 },
    { at: f(9, 0.35), count: 5 },
    { at: f(10, 0.7), count: 4 },
  ],
  landmarks: [
    // The giant cabinet in the infield: framed at the end of the start straight and all along the back straight.
    { kind: 'arcade-cabinet', at: f(9, 0.55), d: 58, scale: 1.1 },
    { kind: 'billboard', at: f(6, 0.5), d: -34 },
    { kind: 'tower', at: f(11, 0.5), d: -40 },
    { kind: 'arch', at: f(0, 0.02), d: 0 },
  ],
  decorSeed: 1101,
  parLapMs: 36_000,
};

/** Authoring aid: the piece fractions (see lab/probe.ts). */
export const PIXEL_PLAZA_PATH = P;
