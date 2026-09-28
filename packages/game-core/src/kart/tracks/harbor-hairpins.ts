import type { KartTrackDef } from '../trackdef.ts';

export const HARBOR_HAIRPINS: KartTrackDef = {
  id: 'harbor-hairpins',
  biome: 'harbor',
  points: [
    [0, 0, 1],
    [65, 0, 1],
    [130, 0, 1],
    [141, 2.9, 0.8, 6.3],
    [149.1, 11, 0.7, 6.2],
    [152, 22, 0.5, 6],
    [152, 72, 0.2, 5.8],
    [152, 122, 0, 5.5],
    [153.3, 126.8, 0, 5.5],
    [156.8, 130.2, 0, 5.5],
    [161.5, 131.5, 0, 5.5],
    [166.2, 130.2, 0, 5.5],
    [169.7, 126.8, 0, 5.5],
    [171, 122, 0, 5.5],
    [171, 37, 0, 5.5],
    [173, 29.5, 0.3, 5.8],
    [178.5, 24, 0.7, 6.2],
    [186, 22, 1],
    [216, 22, 2],
    [225.6, 20.3, 2],
    [234, 15.4, 2],
    [245.5, 9.7, 2],
    [258.5, 9.7, 2],
    [270, 15.4, 2],
    [278.4, 20.3, 2],
    [288, 22, 2],
    [358, 22, 2],
    [367, 19.6, 2],
    [373.6, 13, 2],
    [376, 4, 2],
    [376, -58, 2],
    [374.5, -63.5, 2],
    [370.5, -67.5, 2],
    [365, -69, 2],
    [325, -69, 2],
    [313, -70.9, 2.2],
    [302, -76.2, 2.5],
    [287.2, -82.6, 2.7],
    [271, -82.6, 2.8],
    [256.2, -76.2, 3],
    [245.2, -70.9, 3],
    [233.2, -69, 3],
    [148.5, -69, 2.3],
    [63.7, -69, 1.7],
    [-21, -69, 1],
    [-33, -65.8, 1],
    [-41.8, -57, 1],
    [-45, -45, 1],
    [-45, -20, 1],
    [-42.3, -10, 1],
    [-35, -2.7, 1],
    [-25, 0, 1],
  ],
  halfWidth: 6.5,
  shoulder: 1.5,
  offroad: 'gravel',
  edge: 'wall',
  edges: [
    // The quay after the start: open water on the left.
    { from: 0.02, to: 0.1, side: 'left', kind: 'drop' },
    // Lighthouse pier: water on the outside of both legs and round the hairpin.
    { from: 0.125, to: 0.325, side: 'left', kind: 'drop' },
    // The drydock: the flooded dock on the outside.
    { from: 0.49, to: 0.57, side: 'left', kind: 'drop' },
  ],
  zones: [
    // Net sheds: fish-oil slick on the wide line of the double right…
    { from: 0.905, to: 0.955, d0: 1.5, d1: 6.5, kind: 'mud' },
  ],
  boostPads: [
    // …and a pad on the tight inside line of its second apex.
    { at: 0.962, d: -3.8 },
    // Hug the inside of each hairpin to hit the exit pad.
    { at: 0.25, d: -2.6 },
    { at: 0.578, d: -3.5 },
  ],
  ramps: [
    // The drawbridge: lifted just enough to jump the canal.
    { at: 0.785, launch: 12 },
  ],
  gaps: [{ from: 0.789, to: 0.796 }],
  itemRows: [
    { at: 0.07, count: 4 },
    { at: 0.29, count: 3, spread: 0.6 },
    { at: 0.44, count: 4 },
    { at: 0.585, count: 4 },
    { at: 0.86, count: 4 },
  ],
  hazards: [
    // Crane crates swinging out over one half of the road (the other half stays clear)…
    { kind: 'sweeper', at: 0.18, d: -2.9, amp: 1.6, radius: 1.9, period: 3.2 },
    // …over the container yard…
    { kind: 'sweeper', at: 0.455, d: 2.9, amp: 1.6, radius: 1.9, period: 3.6, phase: 0.3 },
    // …and across the drydock.
    { kind: 'sweeper', at: 0.535, d: -2.9, amp: 1.6, radius: 1.9, period: 3.4, phase: 0.7 },
  ],
  landmarks: [
    // At the tip of the pier, beyond the apex of the lighthouse hairpin: dead ahead all the way out.
    { kind: 'lighthouse', at: 0.233, d: 22, scale: 1.2 },
    { kind: 'cargo-ship', at: 0.06, d: 48 },
    // Gantry cranes framed at the end of the yard straight and of the drawbridge straight.
    { kind: 'crane', at: 0.53, d: 26 },
    { kind: 'crane', at: 0.905, d: 30 },
  ],
  decorSeed: 4417,
  parLapMs: 38_700,
};
