import type { KartTrackDef } from '../trackdef.ts';
import { pieceFrac, turtle } from './path.ts';

/**
 * Dune Drift — sweeping desert bends on sand. A fast opening sweeper, a tight right to snap into
 * a drift, a climb onto the mesa through the long 150° sweeper (hold it for stage 3 — or cut the
 * dirt chord across its inside if you have a boost), a tight left onto the long descending run-up,
 * then the canyon: hit the ramp with speed, press drift at the lip for a trick boost. A long
 * sweeper after the landing, under the mesa arch, and home.
 *
 * Laid out with exact radii (tracks/path.ts); features are placed relative to the pieces.
 */
const P = turtle(
  [
    { straight: 60 }, // 0 start
    { arc: 70, r: 55, z: 3 }, // 1 opening sweeper
    { straight: 60, z: 4 }, // 2
    { arc: -110, r: 24 }, // 3 tight right
    { straight: 50, z: 6 }, // 4 climb
    { arc: 150, r: 50, z: 8 }, // 5 the mesa sweeper (dirt cut across its inside)
    { straight: 90 }, // 6 mesa top
    { arc: 80, r: 22 }, // 7 tight left onto the run-up
    { straight: 340, z: 4.5 }, // 8 the long descending run-up
    { straight: 44, z: 2.5 }, // 9 the canyon (ramp at its start)
    { arc: 90, r: 60, z: 2 }, // 10 landing sweeper
    { straight: 70 }, // 11 under the mesa arch
    { arc: 80, r: 40 }, // 12
    { straight: 150 }, // 13 the grid
  ],
  { z0: 2 },
);
const f = (piece: number, t = 0.5) => pieceFrac(P, piece, t);

// The dirt chord across the inside of the mesa sweeper.
const cutA = P.at(5, 0.1);
const cutB = P.at(5, 0.9);
const cut = (t: number, inward: number): [number, number, number] => {
  const mid = P.at(5, 0.1 + 0.8 * t);
  const cx = cutA.x + (cutB.x - cutA.x) * t;
  const cy = cutA.y + (cutB.y - cutA.y) * t;
  // Slightly bowed toward the main road so it leaves and rejoins smoothly.
  return [cx + (mid.x - cx) * inward, cy + (mid.y - cy) * inward, mid.z];
};

export const DUNE_DRIFT: KartTrackDef = {
  id: 'dune-drift',
  biome: 'desert',
  points: P.points,
  halfWidth: 9,
  shoulder: 7,
  offroad: 'sand',
  edge: 'wall',
  ramps: [{ at: f(9, 0.02), launch: 14 }],
  gaps: [{ from: f(9, 0.1), to: f(9, 0.36) }],
  branches: [
    {
      from: f(5, 0.1),
      to: f(5, 0.9),
      surface: 'dirt',
      halfWidth: 6,
      points: [cut(0.2, 0.25), cut(0.5, 0), cut(0.8, 0.25)],
    },
  ],
  boostPads: [
    { at: f(8, 0.72), d: 0 },
    // The shortcut's reward: a pad on the rejoin line.
    { at: f(6, 0.15), d: 3 },
    { at: f(3, 0.9), d: -2 },
  ],
  itemRows: [
    { at: f(2, 0.5), count: 4 },
    { at: f(4, 0.55), count: 4 },
    { at: f(8, 0.3), count: 5 },
    { at: f(11, 0.3), count: 4 },
  ],
  zones: [
    // Sand drifts on the outside of the opening sweeper: run wide and you wade.
    { from: f(1, 0.35), to: f(1, 0.85), d0: -9, d1: -5, kind: 'mud' },
  ],
  landmarks: [
    { kind: 'mesa-arch', at: f(11, 0.6), d: 0 },
    { kind: 'hot-air-balloon', at: f(9, 0.3), d: 6, z: 22 },
    { kind: 'radar-dish', at: f(6, 0.5), d: -40 },
  ],
  decorSeed: 2202,
  parLapMs: 39_200,
};

/** Authoring aid: the piece fractions. */
export const DUNE_DRIFT_PATH = P;
