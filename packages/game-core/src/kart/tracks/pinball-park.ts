import type { KartTrackDef } from '../trackdef.ts';

export const PINBALL_PARK: KartTrackDef = {
  id: 'pinball-park',
  biome: 'carnival',
  points: [
    [0, 0, 0],
    [0, 70, 0.3],
    [0, 140, 0.7],
    [0, 210, 1],
    [-9.6, 246, 1.3, 11.6],
    [-36, 272.4, 1.7, 11.7],
    [-72, 282, 2, 11.8],
    [-108, 272.4, 2.3, 11.8],
    [-134.4, 246, 2.7, 11.9],
    [-144, 210, 3, 12],
    [-144, 140, 2],
    [-141.9, 130.7, 1.5],
    [-136.1, 123.1, 1],
    [-129.3, 114.2, 0.8, 11.6],
    [-126.9, 103.2, 0.5, 11.8],
    [-129.3, 92.2, 0.2, 11.9],
    [-136.1, 83.3, 0, 12],
    [-205.1, 25.5, 0, 12],
    [-211.9, 16.5, 0, 11.8],
    [-214.4, 5.5, 0],
    [-214.4, -64.5, 4],
    [-210.9, -77.5, 2.7],
    [-201.4, -87, 1.3],
    [-188.4, -90.5, 0],
    [-139.2, -90.5, 0, 11.8],
    [-90, -90.5, 0, 12],
    [-79, -93.4, 0, 11.8],
    [-70.9, -101.5, 0, 11.7],
    [-68, -112.5, 0],
    [-68, -137.5, 0],
    [-63.4, -154.5, 0],
    [-51, -166.9, 0],
    [-34, -171.5, 0],
    [-17, -166.9, 0],
    [-4.6, -154.5, 0],
    [0, -137.5, 0],
    [0, -68.7, 0],
  ],
  halfWidth: 11.5,
  shoulder: 3,
  offroad: 'grass',
  edge: 'wall',
  boostPads: [
    // The plunger: a pad per lane fires the pack up the right side of the table.
    { at: 0.06, d: -5.5, length: 6 },
    { at: 0.06, d: 5.5, length: 6 },
    { at: 0.1, d: 0, length: 6 },
    // Threading the pop bumpers on the inside of the arch pays off.
    { at: 0.315, d: 8 },
    // Out of the jet-bumper field on the inside.
    { at: 0.555, d: 6 },
    // The kickback: a pad at the apex of the U for the tightest line.
    { at: 0.84, d: 8.5 },
  ],
  ramps: [
    // The big top: a crest jump for a trick boost.
    { at: 0.622, launch: 9 },
    // The drain jump between the flippers.
    { at: 0.69, launch: 13 },
  ],
  gaps: [{ from: 0.6935, to: 0.7025 }],
  itemRows: [
    { at: 0.03, count: 5 },
    { at: 0.18, count: 5 },
    { at: 0.39, count: 5 },
    { at: 0.585, count: 5 },
    { at: 0.67, count: 5 },
    { at: 0.778, count: 4 },
    { at: 0.93, count: 5 },
  ],
  hazards: [
    // Pop bumpers in a triangle across the top arch.
    { kind: 'bumper', at: 0.262, d: 0, radius: 2.6, period: 1 },
    { kind: 'bumper', at: 0.282, d: 6, radius: 2.6, period: 1 },
    { kind: 'bumper', at: 0.282, d: -6, radius: 2.6, period: 1 },
    // The slingshot.
    { kind: 'bumper', at: 0.455, d: -5, radius: 2.6, period: 1 },
    // The jet-bumper field in the widest section.
    { kind: 'bumper', at: 0.49, d: 5, radius: 2.6, period: 1 },
    { kind: 'bumper', at: 0.51, d: -4, radius: 2.6, period: 1 },
    { kind: 'bumper', at: 0.53, d: 3, radius: 2.6, period: 1 },
    // Flipper posts either side of the drain.
    { kind: 'bumper', at: 0.683, d: 8.5, radius: 2.2, period: 1 },
    { kind: 'bumper', at: 0.683, d: -8.5, radius: 2.2, period: 1 },
    // The kickback post in the middle of the U.
    { kind: 'bumper', at: 0.82, d: -1, radius: 2.6, period: 1 },
  ],
  landmarks: [
    // Beyond the top of the arch: dead ahead all the way up the plunger lane.
    { kind: 'ferris-wheel', at: 0.235, d: -80, scale: 1.3 },
    { kind: 'circus-tent', at: 0.6, d: 70 },
    { kind: 'hot-air-balloon', at: 0.5, d: -45, z: 10 },
    { kind: 'hot-air-balloon', at: 0.05, d: -40, z: 20 },
  ],
  decorSeed: 5531,
  parLapMs: 39_500,
};
