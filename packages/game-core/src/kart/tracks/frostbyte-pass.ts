import type { KartTrackDef } from '../trackdef.ts';

export const FROSTBYTE_PASS: KartTrackDef = {
  id: 'frostbyte-pass',
  biome: 'snow',
  points: [
    [0, 0, 0],
    [55, 0, 0],
    [110, 0, 0],
    [124, 3.8, 1],
    [134.2, 14, 2],
    [138, 28, 3],
    [138, 83, 5, 7.8],
    [138, 138, 7, 7.5],
    [135.3, 148, 7.7, 7.5],
    [128, 155.3, 8.3, 7.5],
    [118, 158, 9, 7.5],
    [48, 158, 13.5, 7.5],
    [-22, 158, 18, 7.5],
    [-29.5, 160, 18.3, 7.5],
    [-35, 165.5, 18.7, 7.5],
    [-37, 173, 19, 7.5],
    [-35, 180.5, 19.3, 7.5],
    [-29.5, 186, 19.7, 7.5],
    [-22, 188, 20, 7.5],
    [38, 188, 24, 7.5],
    [98, 188, 28, 7.5],
    [105.5, 190, 28.3, 7.5],
    [111, 195.5, 28.7, 7.5],
    [113, 203, 29, 7.5],
    [111, 210.5, 29.3, 7.5],
    [105.5, 216, 29.7, 7.5],
    [98, 218, 30, 7.5],
    [48, 218, 33.5, 7.5],
    [-2, 218, 37, 7.5],
    [-15, 221.5, 37.7, 7.7],
    [-24.5, 231, 38.3, 7.8],
    [-28, 244, 39],
    [-28, 334, 40],
    [-33.1, 353, 40],
    [-47, 366.9, 40],
    [-66, 372, 40],
    [-85, 366.9, 40],
    [-98.9, 353, 40],
    [-104, 334, 40],
    [-104, 275.6, 32],
    [-104, 217.3, 24],
    [-100.6, 200.1, 22],
    [-90.8, 185.5, 20],
    [-79.2, 165.3, 18],
    [-79.2, 142, 16],
    [-90.8, 121.8, 14],
    [-100.6, 107.2, 12],
    [-104, 90, 10],
    [-104, 30, 4],
    [-100, 15, 3],
    [-89, 4, 2],
    [-74, 0, 1],
  ],
  halfWidth: 8,
  shoulder: 3,
  offroad: 'snow',
  edge: 'wall',
  edges: [
    // The summit bend hangs over the valley: a sheer drop on its outside.
    { from: 0.612, to: 0.694, side: 'right', kind: 'drop' },
  ],
  zones: [
    // The frozen S after the crevasse: ice on the outside of each bend, grip on the tight line.
    { from: 0.776, to: 0.8, d0: -8, d1: 0.5, kind: 'ice' },
    { from: 0.803, to: 0.848, d0: -0.5, d1: 8, kind: 'ice' },
    { from: 0.851, to: 0.874, d0: -8, d1: 0.5, kind: 'ice' },
  ],
  boostPads: [
    // Hairpin exits on the climb reward the tight inside line.
    { at: 0.338, d: -3.5 },
    { at: 0.454, d: 3.5 },
    // Over the top: the run-in to the Dive.
    { at: 0.705, d: 0, length: 5 },
    { at: 0.72, d: 0, length: 5 },
    // Valley floor, for whoever kept it clean through the ice.
    { at: 0.882, d: -2.5 },
  ],
  ramps: [
    // The ski jump over the crevasse, halfway down the Dive.
    { at: 0.748, launch: 14 },
  ],
  gaps: [{ from: 0.7515, to: 0.761 }],
  itemRows: [
    { at: 0.05, count: 4 },
    { at: 0.15, count: 4 },
    { at: 0.49, count: 4 },
    { at: 0.575, count: 4 },
    { at: 0.9, count: 4 },
  ],
  hazards: [
    // Snowballs rolling down the first switchback, against traffic, one per outer lane: they wind
    // up (blinking) at the top, then roll on a steady 8 s cadence — the centre lane is always clear.
    { kind: 'roller', at: 0.298, d: -4.6, radius: 1.6, amp: 125, period: 8 },
    { kind: 'roller', at: 0.298, d: 4.6, radius: 1.6, amp: 125, period: 8, phase: 0.5 },
    // And one down the middle of the second: both sides stay clear.
    { kind: 'roller', at: 0.414, d: 0, radius: 2.5, amp: 105, period: 8.5 },
  ],
  landmarks: [
    // In the middle of the summit bend: seen from every switchback on the way up.
    { kind: 'frozen-joystick', at: 0.654, d: 38, scale: 1.3 },
    // Beyond the Dive: dead ahead at the end of every westbound switchback.
    { kind: 'ice-castle', at: 0.73, d: -46 },
  ],
  decorSeed: 9127,
  parLapMs: 45_900,
};
