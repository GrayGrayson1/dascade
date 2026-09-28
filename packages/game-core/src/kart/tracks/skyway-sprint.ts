import type { KartTrackDef } from '../trackdef.ts';

export const SKYWAY_SPRINT: KartTrackDef = {
  id: 'skyway-sprint',
  biome: 'sky',
  points: [
    [0, 0, 20],
    [75, 0, 20],
    [150, 0, 20],
    [178.5, 3.7, 21.5],
    [205, 14.7, 23],
    [260, 29.5, 21.5],
    [315, 14.7, 20],
    [370, 0, 22],
    [425, 14.7, 24],
    [451.5, 25.7, 23],
    [480, 29.5, 22],
    [530, 29.5, 26],
    [562, 38, 26.7],
    [585.4, 61.5, 27.3],
    [594, 93.5, 28],
    [585.4, 125.5, 28.7],
    [562, 148.9, 29.3],
    [530, 157.5, 30],
    [451.5, 157.5, 33.3],
    [373, 157.5, 36.7],
    [294.5, 157.5, 40],
    [282.5, 157.5, 41],
    [244.5, 157.5, 33, 12],
    [208.5, 157.5, 32, 12],
    [191.3, 154, 31.5, 12],
    [176.7, 144.3, 31, 12],
    [127.8, 95.4, 30.5, 11.5],
    [79, 46.5, 30, 11],
    [30.1, -2.3, 29.5, 10.5],
    [-18.8, -51.2, 29],
    [-31.3, -58.7, 28],
    [-45.9, -59.4, 27],
    [-59, -53.2, 26],
    [-67.7, -41.5, 25],
    [-69.9, -27.1, 24],
    [-64.9, -13.3, 23],
    [-54.1, -3.5, 22],
    [-40, 0, 21],
  ],
  halfWidth: 10,
  shoulder: 2,
  offroad: 'grass',
  edge: 'drop',
  edges: [
    // The cloud canyon: walled on both sides (the rest of the skyway has none).
    { from: 0.35, to: 0.49, side: 'both', kind: 'wall' },
    // The Sky Hook: a wall on the inside of the hairpin; its outside is the void.
    { from: 0.897, to: 0.999, side: 'right', kind: 'wall' },
    // Rails where you land from the Leap and where the flyover crosses the start straight.
    { from: 0.66, to: 0.705, side: 'both', kind: 'wall' },
    { from: 0.8, to: 0.875, side: 'both', kind: 'wall' },
  ],
  boostPads: [
    // The S: a pad on each apex, right on the edge of the world.
    { at: 0.115, d: 6.5 },
    { at: 0.166, d: -6.5 },
    { at: 0.234, d: 6.5 },
    { at: 0.284, d: -6.5 },
    // Inside of the canyon U.
    { at: 0.42, d: 7 },
    // The Leap: a centre chain up to the lip.
    { at: 0.585, d: 0, length: 5 },
    { at: 0.6, d: 0, length: 5 },
    { at: 0.615, d: 0, length: 5 },
    { at: 0.63, d: 0, length: 5 },
    // Out of the Sky Hook.
    { at: 0.965, d: -1.5 },
  ],
  ramps: [
    // The Leap: off the lip, over the void, down onto the landing deck.
    { at: 0.643, launch: 16 },
  ],
  gaps: [{ from: 0.6455, to: 0.659 }],
  itemRows: [
    { at: 0.045, count: 4 },
    { at: 0.33, count: 4 },
    { at: 0.52, count: 4 },
    { at: 0.76, count: 4 },
  ],
  landmarks: [
    // Hangs over the landing deck: dead ahead all the way up the Leap.
    { kind: 'blimp', at: 0.672, d: 0, z: -14, scale: 1.2 },
    // In the middle of the canyon U.
    { kind: 'cloud-island', at: 0.42, d: 64, scale: 1.4 },
    // In the middle of the east lobe, seen from the whole S.
    { kind: 'data-spire', at: 0.25, d: 70, scale: 1.3 },
    { kind: 'hot-air-balloon', at: 0.15, d: -45 },
    { kind: 'hot-air-balloon', at: 0.8, d: 50 },
  ],
  decorSeed: 2203,
  parLapMs: 47_600,
};
