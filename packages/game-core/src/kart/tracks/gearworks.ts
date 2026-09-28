import type { KartTrackDef } from '../trackdef.ts';

export const GEARWORKS: KartTrackDef = {
  id: 'gearworks',
  biome: 'factory',
  points: [
    [0, 0, 0],
    [70, 0, 0],
    [140, 0, 0],
    [148, 2.1, 0],
    [153.9, 8, 0],
    [156, 16, 0],
    [156, 66, 0],
    [156, 116, 0],
    [154.1, 123, 0, 6.7],
    [149, 128.1, 0, 6.3],
    [142, 130, 0, 6],
    [67, 130, 0, 6],
    [-8, 130, 0, 6],
    [-15, 131.9, 0, 6.3],
    [-20.1, 137, 0, 6.7],
    [-22, 144, 0],
    [-22, 204, 8],
    [-19.6, 213, 8],
    [-13, 219.6, 8],
    [-4, 222, 8],
    [62.7, 222, 8],
    [129.3, 222, 8],
    [196, 222, 8],
    [204, 219.9, 8],
    [209.9, 214, 8],
    [212, 206, 8],
    [212, 146, 2],
    [213.1, 140.9, 1.7],
    [216.1, 136.5, 1.3],
    [220.6, 133.8, 1],
    [225.8, 130.3, 0.8],
    [228.7, 124.7, 0.6],
    [228.7, 118.4, 0.4],
    [225.8, 112.9, 0.2],
    [220.6, 109.4, 0],
    [216.1, 106.6, 0],
    [213.1, 102.3, 0],
    [212, 97.1, 0],
    [212, 26.6, 0],
    [212, -44, 0],
    [209.6, -53, 0],
    [203, -59.6, 0],
    [194, -62, 0],
    [129.3, -62, 0],
    [64.7, -62, 0],
    [0, -62, 0],
    [-8, -59.9, 0],
    [-13.9, -54, 0],
    [-16, -46, 0],
    [-16, -16, 0],
    [-13.9, -8, 0],
    [-8, -2.1, 0],
  ],
  halfWidth: 7,
  shoulder: 2,
  offroad: 'metal',
  edge: 'wall',
  edges: [
    // The mezzanine catwalk has no rails.
    { from: 0.41, to: 0.55, side: 'both', kind: 'drop' },
  ],
  zones: [
    // Feed belt up the first leg: shoves everyone to the inside.
    { from: 0.13, to: 0.19, d0: -7, d1: 7, kind: 'conveyor', push: 4 },
    // Catwalk belt on the right half, pushing toward the drop — the pad at its end is the prize.
    { from: 0.44, to: 0.53, d0: -7, d1: 0, kind: 'conveyor', push: -5 },
    // Return belt along the bottom, pushing the other way (to the left).
    { from: 0.82, to: 0.9, d0: -7, d1: 7, kind: 'conveyor', push: 3.5 },
  ],
  boostPads: [
    // Clean exit from the press line.
    { at: 0.33, d: -3 },
    // End of the catwalk belt, right at the edge.
    { at: 0.535, d: -3.5 },
    // Out of the gear-teeth chicane.
    { at: 0.68, d: 0 },
    // Across the bottom belt.
    { at: 0.91, d: 3 },
  ],
  branches: [
    {
      // The service tunnel: veer left at the mouth of the press line and loop up the service
      // ramp. Safe, but longer.
      from: 0.222,
      to: 0.378,
      points: [
        [114, 121, 0],
        [80, 110, 0],
        [36, 108, 0],
        [-12, 112, 1],
        [-42, 128, 3],
        [-50, 156, 5],
        [-38, 184, 7],
      ],
      surface: 'road',
      halfWidth: 6,
    },
  ],
  itemRows: [
    { at: 0.06, count: 4 },
    { at: 0.18, count: 4 },
    { at: 0.41, count: 3 },
    { at: 0.69, count: 4 },
    { at: 0.8, count: 4 },
  ],
  hazards: [
    // The press line: five stompers in a travelling wave, alternating sides — slalom through the
    // clear lane beside each press, or hold a steady ~22 u/s down the middle and each one falls
    // just behind you. They lift and shudder before every slam.
    { kind: 'stomper', at: 0.238, d: 2.4, radius: 3, period: 2, phase: 0 },
    { kind: 'stomper', at: 0.256, d: -2.4, radius: 3, period: 2, phase: 0.45 },
    { kind: 'stomper', at: 0.274, d: 2.4, radius: 3, period: 2, phase: 0.9 },
    { kind: 'stomper', at: 0.292, d: -2.4, radius: 3, period: 2, phase: 0.35 },
    { kind: 'stomper', at: 0.31, d: 2.4, radius: 3, period: 2, phase: 0.8 },
  ],
  landmarks: [
    // Between the press line and the catwalk: seen from both levels.
    { kind: 'gears', at: 0.265, d: -46 },
    // Framed at the end of the catwalk.
    { kind: 'smokestack', at: 0.555, d: 34 },
    // Straight ahead down the bottom straight.
    { kind: 'crane', at: 0.93, d: -32 },
  ],
  decorSeed: 7309,
  parLapMs: 45_100,
};
