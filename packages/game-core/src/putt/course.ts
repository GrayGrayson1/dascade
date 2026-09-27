/**
 * "Neon Nine" — the original DAS Putt course. Nine holes with escalating mechanics:
 *  1 straight intro · 2 dog-leg bank · 3 uphill ramp · 4 sand traps · 5 water carry (bridge)
 *  6 windmill · 7 bumper chamber · 8 teleport relay · 9 finale (sweeper, ramp, pond, portal, bumpers)
 *
 * Coordinates are world units (y down). Helpers below keep the data readable; everything they
 * produce is plain data validated by HoleDefSchema + validateHole() (see validate.ts).
 * Curves are generated with Math.cos/sin at module load: they are fixed constants of the course
 * definition (not simulation), and the resulting numbers are rounded to 1/4 unit so every engine
 * builds exactly the same course.
 */
import type { HoleDef, Pt } from './types.ts';

const q = (v: number) => Math.round(v * 4) / 4;

/** Axis-aligned rectangle with optional chamfered corners (clockwise, y down). */
function rect(x0: number, y0: number, x1: number, y1: number, c = 0): Pt[] {
  if (c <= 0) {
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

/** Ring sector (crescent) polygon between radii r0..r1 and angles a0..a1 (degrees, 0 = +x, 90 = down). */
function arcBand(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n = 12): Pt[] {
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    outer.push([q(cx + Math.cos(a) * r1), q(cy + Math.sin(a) * r1)]);
    inner.push([q(cx + Math.cos(a) * r0), q(cy + Math.sin(a) * r0)]);
  }
  return [...outer, ...inner.reverse()];
}

/** Rounded blob: ellipse with per-vertex radius wobble (deterministic), for organic bunkers. */
function blob(cx: number, cy: number, rx: number, ry: number, wobble: number[], rot = 0): Pt[] {
  const n = wobble.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (wobble[i] ?? 0);
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    out.push([q(cx + x * Math.cos(rot) - y * Math.sin(rot)), q(cy + x * Math.sin(rot) + y * Math.cos(rot))]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1 · Launch Pad — straight intro
// ---------------------------------------------------------------------------
const h1Turf = rect(100, 220, 1100, 480, 60);
const hole1: HoleDef = {
  number: 1,
  id: 'launch-pad',
  name: 'Launch Pad',
  par: 2,
  tip: 'A straight runway. Feel out your power.',
  tee: [215, 395],
  cup: [975, 305],
  turf: [h1Turf],
  walls: [{ pts: h1Turf, closed: true }],
  decor: [
    { kind: 'chevrons', at: [420, 350], dir: [1, 0], count: 3 },
    { kind: 'chevrons', at: [700, 350], dir: [1, 0], count: 3 },
    { kind: 'lamp', at: [100, 220], color: '#a3e635' },
    { kind: 'lamp', at: [1100, 220], color: '#fde047' },
    { kind: 'lamp', at: [100, 480], color: '#a3e635' },
    { kind: 'lamp', at: [1100, 480], color: '#fde047' },
  ],
};

// ---------------------------------------------------------------------------
// 2 · Dogleg Drift — L-shaped, 45° bank cushion in the outer corner
// ---------------------------------------------------------------------------
const h2Turf: Pt[] = [
  [100, 470],
  [140, 430],
  [860, 430],
  [860, 110],
  [900, 70],
  [1060, 70],
  [1100, 110],
  [1100, 520],
  [990, 630],
  [140, 630],
  [100, 590],
];
const hole2: HoleDef = {
  number: 2,
  id: 'dogleg-drift',
  name: 'Dogleg Drift',
  par: 3,
  tip: 'Play the glowing 45° bank to turn the corner.',
  tee: [210, 530],
  cup: [980, 180],
  turf: [h2Turf],
  walls: [
    {
      pts: [
        [1100, 520],
        [1100, 110],
        [1060, 70],
        [900, 70],
        [860, 110],
        [860, 430],
        [140, 430],
        [100, 470],
        [100, 590],
        [140, 630],
        [990, 630],
      ],
    },
    {
      pts: [
        [990, 630],
        [1100, 520],
      ],
      kind: 'bank',
    },
  ],
  posts: [{ at: [560, 530], r: 16 }],
  decor: [
    { kind: 'chevrons', at: [760, 530], dir: [1, 0], count: 2 },
    { kind: 'chevrons', at: [980, 380], dir: [0, -1], count: 2 },
    { kind: 'lamp', at: [860, 430], color: '#fde047' },
    { kind: 'lamp', at: [100, 530], color: '#a3e635' },
  ],
};

// ---------------------------------------------------------------------------
// 3 · Uplink Ramp — climb a steep ramp onto a half-pipe green
// ---------------------------------------------------------------------------
const h3Turf: Pt[] = [
  [100, 290],
  [140, 250],
  [470, 250],
  [540, 190],
  [1060, 190],
  [1100, 230],
  [1100, 470],
  [1060, 510],
  [540, 510],
  [470, 450],
  [140, 450],
  [100, 410],
];
const hole3: HoleDef = {
  number: 3,
  id: 'uplink-ramp',
  name: 'Uplink Ramp',
  par: 3,
  tip: 'Too soft and the ramp rolls you back. The green breaks downhill — aim high.',
  tee: [200, 350],
  cup: [955, 290],
  turf: [h3Turf],
  walls: [{ pts: h3Turf, closed: true }],
  slopes: [
    // The ramp: steep uphill (pushes back towards the tee).
    { poly: rect(560, 170, 760, 530), accel: [-420, 0] },
    // The green breaks towards the bottom rail (gentler than friction: it curls rolling balls only).
    { poly: rect(770, 170, 1120, 530), accel: [0, 170] },
  ],
  decor: [
    { kind: 'sign', at: [660, 350], text: 'RAMP' },
    { kind: 'lamp', at: [540, 190], color: '#fde047' },
    { kind: 'lamp', at: [540, 510], color: '#fde047' },
    { kind: 'lamp', at: [1100, 230], color: '#a3e635' },
    { kind: 'lamp', at: [1100, 470], color: '#a3e635' },
  ],
};

// ---------------------------------------------------------------------------
// 4 · Dune Byte — sand traps guarding every straight line
// ---------------------------------------------------------------------------
const h4Turf = rect(100, 140, 1100, 560, 60);
const hole4: HoleDef = {
  number: 4,
  id: 'dune-byte',
  name: 'Dune Byte',
  par: 3,
  tip: 'Sand eats speed. Thread a lane and curl round the crescent.',
  tee: [200, 350],
  cup: [930, 350],
  turf: [h4Turf],
  walls: [{ pts: h4Turf, closed: true }],
  sand: [
    blob(560, 350, 120, 88, [0.05, 0.1, 0, -0.08, 0.04, 0.12, 0.02, -0.05, 0.08, 0.1, -0.02, 0.06, 0, -0.06, 0.05, 0.09]),
    arcBand(930, 350, 52, 96, 118, 242, 14),
    blob(800, 190, 70, 34, [0.1, 0, -0.1, 0.05, 0.12, 0, -0.05, 0.08, 0, 0.1]),
    blob(380, 520, 76, 30, [0, 0.1, 0.05, -0.08, 0, 0.12, 0.04, -0.05, 0.1, 0]),
  ],
  posts: [{ at: [1040, 350], r: 14 }],
  decor: [
    { kind: 'lamp', at: [100, 200], color: '#fde047' },
    { kind: 'lamp', at: [100, 500], color: '#fde047' },
    { kind: 'lamp', at: [1100, 200], color: '#a3e635' },
    { kind: 'lamp', at: [1100, 500], color: '#a3e635' },
  ],
};

// ---------------------------------------------------------------------------
// 5 · Coolant Canal — carry the canal on a rail-less bridge
// ---------------------------------------------------------------------------
const h5Bridge = rect(400, 322, 720, 386);
const hole5: HoleDef = {
  number: 5,
  id: 'coolant-canal',
  name: 'Coolant Canal',
  par: 3,
  tip: 'The bridge has no rails. Water costs a stroke and sends you back.',
  tee: [200, 354],
  cup: [985, 245],
  turf: [
    // Tee deck (its canal side is open), bridge, green deck.
    [
      [100, 240],
      [140, 200],
      [420, 200],
      [420, 520],
      [140, 520],
      [100, 480],
    ],
    h5Bridge,
    [
      [700, 140],
      [1050, 140],
      [1100, 190],
      [1100, 510],
      [1050, 560],
      [700, 560],
    ],
  ],
  water: [rect(420, 110, 700, 590, 0)],
  walls: [
    {
      pts: [
        [420, 200],
        [140, 200],
        [100, 240],
        [100, 480],
        [140, 520],
        [420, 520],
      ],
    },
    {
      pts: [
        [700, 140],
        [1050, 140],
        [1100, 190],
        [1100, 510],
        [1050, 560],
        [700, 560],
      ],
    },
  ],
  decor: [
    { kind: 'lamp', at: [420, 200], color: '#22d3ee' },
    { kind: 'lamp', at: [420, 520], color: '#22d3ee' },
    { kind: 'lamp', at: [700, 140], color: '#22d3ee' },
    { kind: 'lamp', at: [700, 560], color: '#22d3ee' },
    { kind: 'chevrons', at: [560, 354], dir: [1, 0], count: 2 },
  ],
};

// ---------------------------------------------------------------------------
// 6 · Windmill Array — time your putt through the spinning turnstile
// ---------------------------------------------------------------------------
const h6Turf: Pt[] = [
  [100, 270],
  [140, 230],
  [430, 230],
  [520, 272],
  [680, 272],
  [770, 200],
  [1060, 200],
  [1100, 240],
  [1100, 460],
  [1060, 500],
  [770, 500],
  [680, 428],
  [520, 428],
  [430, 470],
  [140, 470],
  [100, 430],
];
const hole6: HoleDef = {
  number: 6,
  id: 'windmill-array',
  name: 'Windmill Array',
  par: 3,
  tip: 'The turnstile never stops. Time the gap between the blades.',
  tee: [200, 350],
  cup: [965, 350],
  turf: [h6Turf],
  walls: [{ pts: h6Turf, closed: true }],
  movers: [{ kind: 'windmill', at: [600, 350], arms: 4, length: 70, width: 12, hubR: 20, periodMs: 4200, phase: 0.06, dir: 1 }],
  decor: [
    { kind: 'lamp', at: [520, 272], color: '#fde047' },
    { kind: 'lamp', at: [680, 272], color: '#fde047' },
    { kind: 'lamp', at: [520, 428], color: '#fde047' },
    { kind: 'lamp', at: [680, 428], color: '#fde047' },
    { kind: 'chevrons', at: [860, 350], dir: [1, 0], count: 2 },
  ],
};

// ---------------------------------------------------------------------------
// 7 · Tilt Chamber — pop bumpers and slingshot kickers
// ---------------------------------------------------------------------------
const h7Turf: Pt[] = [
  [100, 450],
  [330, 450],
  [330, 170],
  [410, 90],
  [1020, 90],
  [1100, 170],
  [1100, 530],
  [1020, 610],
  [330, 610],
  [330, 570],
  [100, 570],
];
const hole7: HoleDef = {
  number: 7,
  id: 'tilt-chamber',
  name: 'Tilt Chamber',
  par: 3,
  tip: 'Pop bumpers fire the ball back harder than it arrived.',
  tee: [190, 510],
  cup: [985, 205],
  turf: [h7Turf],
  walls: [
    {
      pts: [
        [100, 570],
        [100, 450],
        [330, 450],
        [330, 170],
        [410, 90],
        [1020, 90],
        [1100, 170],
        [1100, 530],
        [1020, 610],
        [330, 610],
        [330, 570],
        [100, 570],
      ],
    },
    // Slingshot kickers in the two lower corners of the chamber.
    {
      pts: [
        [372, 470],
        [430, 560],
      ],
      kind: 'kicker',
    },
    {
      pts: [
        [1060, 450],
        [990, 560],
      ],
      kind: 'kicker',
    },
  ],
  bumpers: [
    { at: [590, 380], r: 28 },
    { at: [735, 250], r: 28 },
    { at: [760, 480], r: 28 },
    { at: [890, 370], r: 28 },
  ],
  posts: [
    { at: [900, 170], r: 12 },
    { at: [1040, 290], r: 12 },
  ],
  decor: [
    { kind: 'lamp', at: [330, 450], color: '#ff4fd8' },
    { kind: 'lamp', at: [410, 90], color: '#ff4fd8' },
    { kind: 'lamp', at: [1020, 90], color: '#fde047' },
    { kind: 'lamp', at: [1020, 610], color: '#fde047' },
  ],
};

// ---------------------------------------------------------------------------
// 8 · Wormhole Relay — two sealed rooms joined by portals
// ---------------------------------------------------------------------------
const h8Left = rect(100, 130, 520, 570, 50);
const h8Right = rect(680, 130, 1100, 570, 50);
const hole8: HoleDef = {
  number: 8,
  id: 'wormhole-relay',
  name: 'Wormhole Relay',
  par: 3,
  tip: 'Only wormholes cross the gap. B hides under the ledge but lands by the cup. Avoid C.',
  tee: [215, 350],
  cup: [1005, 235],
  turf: [h8Left, h8Right],
  walls: [
    { pts: h8Left, closed: true },
    { pts: h8Right, closed: true },
    // Ledge over wormhole B: reach it along the bottom rail or with a bank.
    {
      pts: [
        [330, 440],
        [520, 440],
      ],
    },
  ],
  portals: [
    { from: [440, 215], to: [745, 500], exit: [1, 0], color: 'cyan', label: 'A' },
    { from: [445, 512], to: [955, 480], exit: [0, -1], color: 'magenta', label: 'B' },
    { from: [760, 215], to: [175, 470], exit: [0, -1], color: 'amber', label: 'C' },
  ],
  posts: [{ at: [870, 330], r: 16 }],
  decor: [
    { kind: 'lamp', at: [520, 180], color: '#22d3ee' },
    { kind: 'lamp', at: [680, 180], color: '#ff4fd8' },
    { kind: 'lamp', at: [520, 520], color: '#ff4fd8' },
    { kind: 'lamp', at: [680, 520], color: '#22d3ee' },
  ],
};

// ---------------------------------------------------------------------------
// 9 · Grand Cascade — sweeper gate, ramp, pond, shortcut portal and bumpers
// ---------------------------------------------------------------------------
const hole9: HoleDef = {
  number: 9,
  id: 'grand-cascade',
  name: 'Grand Cascade',
  par: 4,
  tip: 'Slip the sweeper, climb the ramp and skirt the pond — or gamble on the wormhole.',
  tee: [200, 530],
  cup: [215, 195],
  turf: [
    // Lower lane.
    [
      [100, 450],
      [140, 410],
      [900, 410],
      [900, 460],
      [1100, 460],
      [1100, 580],
      [1050, 630],
      [150, 630],
      [100, 580],
    ],
    // Right climb (ramp).
    [
      [900, 140],
      [1100, 140],
      [1100, 470],
      [900, 470],
    ],
    // Upper lane + green (the pond side has no rail).
    [
      [100, 140],
      [150, 90],
      [1050, 90],
      [1100, 140],
      [1100, 280],
      [320, 280],
      [320, 300],
      [150, 300],
      [100, 250],
    ],
  ],
  water: [
    [
      [320, 280],
      [900, 280],
      [900, 410],
      [320, 410],
    ],
  ],
  walls: [
    {
      pts: [
        [320, 300],
        [150, 300],
        [100, 250],
        [100, 140],
        [150, 90],
        [1050, 90],
        [1100, 140],
        [1100, 580],
        [1050, 630],
        [150, 630],
        [100, 580],
        [100, 450],
        [140, 410],
        [900, 410],
        [900, 280],
      ],
    },
    {
      pts: [
        [320, 280],
        [320, 300],
      ],
    },
    // Gate housing for the sweeper.
    {
      pts: [
        [470, 410],
        [470, 440],
      ],
    },
    {
      pts: [
        [470, 600],
        [470, 630],
      ],
    },
  ],
  slopes: [{ poly: rect(900, 250, 1100, 420), accel: [0, 380] }],
  movers: [{ kind: 'sweeper', a: [470, 490], b: [470, 550], axis: [0, 1], halfLength: 44, width: 14, periodMs: 3200, phase: 0.2 }],
  bumpers: [
    { at: [470, 170], r: 24 },
    { at: [380, 230], r: 20 },
  ],
  portals: [{ from: [820, 580], to: [640, 185], exit: [-1, 0], color: 'cyan', label: 'W' }],
  posts: [{ at: [1000, 530], r: 14 }],
  decor: [
    { kind: 'chevrons', at: [760, 185], dir: [-1, 0], count: 2 },
    { kind: 'lamp', at: [320, 280], color: '#22d3ee' },
    { kind: 'lamp', at: [900, 280], color: '#22d3ee' },
    { kind: 'lamp', at: [100, 580], color: '#a3e635' },
    { kind: 'lamp', at: [1100, 140], color: '#fde047' },
  ],
};

/** The nine holes, in order. */
export const NEON_NINE: readonly HoleDef[] = [hole1, hole2, hole3, hole4, hole5, hole6, hole7, hole8, hole9];

export const COURSE_NAME = 'Neon Nine';

/** 1-based hole number → definition. */
export function getHole(number: number): HoleDef {
  const h = NEON_NINE[number - 1];
  if (!h) throw new RangeError(`No hole ${number}`);
  return h;
}

export const COURSE_PAR = NEON_NINE.reduce((s, h) => s + h.par, 0);
