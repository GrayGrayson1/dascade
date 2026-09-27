import { describe, expect, it } from 'vitest';
import { getKartTrack } from './index.ts';
import {
  buildTrack,
  EDGE_DROP,
  groundAt,
  hazardPose,
  KART_GRID_SLOTS,
  KartTrackError,
  locate,
  newLoc,
  pointAtS,
  ROLLER_WINDUP,
  rollerSpeed,
  SURF_DIRT,
  SURF_OFFROAD,
  SURF_ROAD,
  SURF_ICE,
  type KartTrack,
} from './track.ts';
import type { KartTrackDef } from './trackdef.ts';
import { PIXEL_PLAZA } from './tracks/pixel-plaza.ts';
import { DUNE_DRIFT } from './tracks/dune-drift.ts';

/** A plain 400 × 200 rounded rectangle for feature tests. */
const BASE: KartTrackDef = {
  id: 'pixel-plaza',
  biome: 'city',
  points: [
    [0, 0],
    [150, 0],
    [300, 0],
    [360, 40],
    [360, 160],
    [300, 200],
    [150, 200],
    [0, 200],
    [-60, 160],
    [-60, 40],
  ],
  halfWidth: 9,
  shoulder: 4,
  offroad: 'grass',
  edge: 'wall',
  decorSeed: 1,
  parLapMs: 40000,
};

const def = (patch: Partial<KartTrackDef>): KartTrackDef => ({ ...BASE, ...patch });

function checkGeometry(t: KartTrack) {
  expect(t.n).toBeGreaterThan(100);
  expect(t.spacing).toBeGreaterThan(2);
  expect(t.spacing).toBeLessThan(3);
  let sum = 0;
  for (let i = 0; i < t.n; i++) {
    expect(Math.abs(t.tx[i]! * t.tx[i]! + t.ty[i]! * t.ty[i]! - 1)).toBeLessThan(1e-9);
    if (i > 0) expect(t.s[i]!).toBeGreaterThan(t.s[i - 1]!);
    expect(t.segLen[i]!).toBeGreaterThan(t.spacing * 0.8);
    expect(t.segLen[i]!).toBeLessThan(t.spacing * 1.2);
    sum += t.segLen[i]!;
    expect(t.hwL[i]!).toBeGreaterThan(3);
    expect(t.hwR[i]!).toBeGreaterThan(3);
  }
  expect(Math.abs(sum - t.length)).toBeLessThan(1e-6);
  // Closed: the last sample joins the first.
  const dx = t.xs[0]! - t.xs[t.n - 1]!;
  const dy = t.ys[0]! - t.ys[t.n - 1]!;
  expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(t.spacing * 1.2);
}

describe('track builder', () => {
  it('samples the reference tracks evenly with unit tangents and consistent arc length', () => {
    checkGeometry(getKartTrack('pixel-plaza'));
    checkGeometry(getKartTrack('dune-drift'));
    checkGeometry(buildTrack(BASE));
  });

  it('starts at points[0] and heads toward points[1]', () => {
    const t = buildTrack(BASE);
    expect(t.xs[0]).toBeCloseTo(0, 6);
    expect(t.ys[0]).toBeCloseTo(0, 6);
    expect(t.tx[0]!).toBeGreaterThan(0.95);
  });

  it('interpolates heights and per-point half-widths from the control points', () => {
    const t = buildTrack(def({ points: BASE.points.map((p, i) => [p[0], p[1], i === 4 ? 12 : 0, i === 6 ? 12 : undefined] as const) }));
    let maxZ = 0;
    let maxW = 0;
    for (let i = 0; i < t.n; i++) {
      maxZ = Math.max(maxZ, t.zs[i]!);
      maxW = Math.max(maxW, t.hwL[i]!);
    }
    expect(maxZ).toBeGreaterThan(10);
    expect(maxW).toBeGreaterThan(11);
    expect(t.bounds.maxZ).toBeGreaterThan(10);
  });

  it('builds a 30-slot grid behind the line, every slot on the road and facing forward', () => {
    for (const t of [getKartTrack('pixel-plaza'), getKartTrack('dune-drift')]) {
      expect(t.grid).toHaveLength(KART_GRID_SLOTS);
      for (const g of t.grid) {
        const gi = groundAt(t, g.x, g.y);
        expect(gi.onRoad).toBe(true);
        expect(Math.abs(gi.d)).toBeLessThan(gi.hw - 1);
        expect(g.s).toBeGreaterThan(t.length - 90);
        const c = pointAtS(t, g.s);
        expect(Math.cos(g.heading) * c.tx + Math.sin(g.heading) * c.ty).toBeGreaterThan(0.99);
      }
      // Slots don't overlap.
      for (let a = 0; a < t.grid.length; a++)
        for (let b = a + 1; b < t.grid.length; b++) {
          const dx = t.grid[a]!.x - t.grid[b]!.x;
          const dy = t.grid[a]!.y - t.grid[b]!.y;
          expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(2.4);
        }
      // Pole first: slot 0 is closest to the line.
      expect(t.grid[0]!.s).toBeGreaterThan(t.grid[29]!.s);
    }
  });

  it('places gates in order, gate 0 on the line, never inside a branch or gap span', () => {
    const t = getKartTrack('dune-drift');
    expect(t.gates[0]).toBe(0);
    for (let g = 1; g < t.gates.length; g++) expect(t.gates[g]!).toBeGreaterThan(t.gates[g - 1]!);
    for (const g of t.gates) {
      for (const b of t.branches) expect(g >= b.from - 5 && g <= b.to + 5).toBe(false);
      for (const gap of t.gaps) expect(g >= gap.from - 25 && g <= gap.to + 15).toBe(false);
    }
    expect(t.branches).toHaveLength(1);
    expect(t.gaps).toHaveLength(1);
  });

  it('item cubes sit on the road across each row', () => {
    const t = getKartTrack('pixel-plaza');
    expect(t.itemBoxes.length).toBe(18);
    for (const b of t.itemBoxes) expect(groundAt(t, b.x, b.y).onRoad).toBe(true);
  });

  it('racing line stays on the road and cuts to the inside of corners', () => {
    const t = getKartTrack('pixel-plaza');
    let inside = 0;
    let corners = 0;
    for (let i = 0; i < t.n; i++) {
      const d = t.racingLine.d[i]!;
      expect(d).toBeLessThanOrEqual(t.hwL[i]! - 2);
      expect(d).toBeGreaterThanOrEqual(-t.hwR[i]! + 2);
      if (Math.abs(t.curvature[i]!) > 0.02) {
        corners++;
        if (Math.sign(d) === Math.sign(t.curvature[i]!)) inside++;
      }
    }
    expect(corners).toBeGreaterThan(10);
    expect(inside / corners).toBeGreaterThan(0.7);
  });
});

describe('projection', () => {
  it('projects points back to their arc length and lateral offset', () => {
    const t = getKartTrack('pixel-plaza');
    const loc = newLoc();
    for (let k = 0; k < 40; k++) {
      const s = (k / 40) * t.length + 3.3;
      const c = pointAtS(t, s);
      const d = ((k % 7) - 3) * 2;
      const x = c.x - c.ty * d;
      const y = c.y + c.tx * d;
      locate(t, x, y, -1, -1, loc);
      expect(Math.abs(((loc.s - s + t.length * 1.5) % t.length) - t.length / 2)).toBeLessThan(0.2);
      expect(loc.d).toBeCloseTo(d, 1);
    }
  });

  it('stays on the local road near a hairpin when given a hint (no aliasing onto the other leg)', () => {
    // A hairpin: two parallel legs 22 u apart.
    const hairpin = buildTrack(
      def({
        points: [
          [0, 0],
          [200, 0],
          [225, 5],
          [235, 15],
          [225, 25],
          [200, 30],
          [0, 30],
          [-25, 25],
          [-35, 15],
          [-25, 5],
        ],
        halfWidth: 4,
        shoulder: 2,
      }),
    );
    const loc = newLoc();
    // Walk along the lower leg with hints: s must advance continuously, never jump to the upper leg.
    let seg = 0;
    let last = 0;
    for (let x = 5; x < 190; x += 1) {
      locate(hairpin, x, 3, -1, seg, loc);
      seg = loc.seg;
      expect(loc.s).toBeGreaterThanOrEqual(last);
      expect(loc.s).toBeLessThan(220);
      last = loc.s;
    }
  });

  it('switches onto a branch when the kart drives into it and maps progress onto the span', () => {
    const t = getKartTrack('dune-drift');
    const b = t.branches[0]!;
    const i = Math.floor(b.n / 2);
    const gi = groundAt(t, b.xs[i]!, b.ys[i]!, { branch: b.index, seg: i });
    expect(gi.branch).toBe(b.index);
    expect(gi.s).toBeGreaterThan(b.from);
    expect(gi.s).toBeLessThan(b.to);
    expect(gi.surface).toBe(SURF_DIRT);
    // Walking the branch from the main line with hints keeps the kart on it and s monotonic.
    let hint = { branch: -1, seg: Math.floor(b.from / t.spacing) };
    let last = b.from - 1;
    let onBranch = 0;
    for (let k = 2; k < b.n - 2; k++) {
      const g = groundAt(t, b.xs[k]! + 0.01, b.ys[k]!, hint);
      hint = { branch: g.branch, seg: g.seg };
      if (g.branch === b.index) onBranch++;
      expect(g.s).toBeGreaterThanOrEqual(last - 0.5);
      last = g.s;
    }
    expect(onBranch).toBeGreaterThan(b.n * 0.6);
  });

  it('reports surfaces: road, shoulder off-road, drop edges without ground', () => {
    const t = buildTrack(
      def({ edges: [{ from: 0.1, to: 0.2, side: 'left', kind: 'drop' }], zones: [{ from: 0.5, to: 0.55, d0: -9, d1: 9, kind: 'ice' }] }),
    );
    const at = (f: number, d: number) => {
      const c = pointAtS(t, f * t.length);
      return groundAt(t, c.x - c.ty * d, c.y + c.tx * d);
    };
    expect(at(0.3, 0).surface).toBe(SURF_ROAD);
    expect(at(0.3, 11).surface).toBe(SURF_OFFROAD);
    expect(at(0.3, 11).hasGround).toBe(true);
    expect(at(0.15, 16).hasGround).toBe(false);
    expect(at(0.15, 16).edge).toBe(EDGE_DROP);
    expect(at(0.15, -16).hasGround).toBe(true);
    expect(at(0.52, 3).surface).toBe(SURF_ICE);
  });
});

describe('junctions (TRACK_NOTES #3/#4)', () => {
  // A road branch that bulges 40 u out to the left of the bottom straight.
  const t = buildTrack(
    def({
      branches: [
        {
          from: 0.03,
          to: 0.22,
          surface: 'road',
          halfWidth: 7,
          points: [
            [80, 25],
            [170, 40],
            [250, 25],
          ],
        },
      ],
    }),
  );
  const b = t.branches[0]!;

  it('a kart brushing the branch side of the main road at the mouth stays on the main road', () => {
    const loc = newLoc();
    let seg = 0;
    let branch = -1;
    for (let sv = 5; sv < b.to + 30; sv += 0.5) {
      const c = pointAtS(t, sv);
      locate(t, c.x - c.ty * 6, c.y + c.tx * 6, branch, seg, loc); // d = +6 of a 9 half-width road: inside, on the branch side
      seg = loc.seg;
      branch = loc.branch;
      expect(loc.branch).toBe(-1);
    }
  });

  it('driving the branch to its end hands back to the main road (roadS never exceeds the branch)', () => {
    const loc = newLoc();
    let seg = 0;
    let branch = b.index;
    for (let k = 1; k < b.n; k++) {
      locate(t, b.xs[k]!, b.ys[k]!, branch, seg, loc);
      seg = loc.seg;
      branch = loc.branch;
      if (loc.branch >= 0) expect(loc.roadS).toBeLessThanOrEqual(b.length + 1e-9);
    }
    // Keep going along the main road past the rejoin.
    for (let x = b.xs[b.n - 1]!; x < b.xs[b.n - 1]! + 40; x += 1) {
      locate(t, x, 0, branch, seg, loc);
      seg = loc.seg;
      branch = loc.branch;
    }
    expect(loc.branch).toBe(-1);
    expect(loc.s).toBeGreaterThan(b.to);
  });
});

describe('hazards', () => {
  const t = buildTrack(
    def({
      hazards: [
        { kind: 'bumper', at: 0.2, d: 3, period: 1 },
        { kind: 'stomper', at: 0.3, d: 0, period: 2 },
        { kind: 'sweeper', at: 0.4, d: 0, period: 3, amp: 5 },
        { kind: 'roller', at: 0.6, d: 0, period: 4, amp: 50 },
        { kind: 'laser', at: 0.8, d: 0, period: 2, phase: 0.25 },
      ],
    }),
  );

  it('poses are a pure periodic function of the tick', () => {
    for (let i = 0; i < t.hazards.length; i++) {
      const P = t.hazards[i]!.periodTicks;
      for (const tick of [0, 17, 95, 1234]) {
        expect(hazardPose(t, i, tick)).toEqual(hazardPose(t, i, tick + P * 3));
      }
    }
  });

  it('each kind moves as documented', () => {
    expect(hazardPose(t, 0, 0).active).toBe(true);
    const stomp = Array.from({ length: 120 }, (_, k) => hazardPose(t, 1, k));
    expect(stomp.some((p) => p.active)).toBe(true);
    expect(stomp.some((p) => !p.active)).toBe(true);
    expect(Math.min(...stomp.map((p) => p.z))).toBeLessThan(Math.max(...stomp.map((p) => p.z)) - 3);
    const sweep = Array.from({ length: 180 }, (_, k) => hazardPose(t, 2, k).d);
    expect(Math.max(...sweep)).toBeCloseTo(5, 1);
    expect(Math.min(...sweep)).toBeCloseTo(-5, 1);
    const roll = Array.from({ length: 240 }, (_, k) => hazardPose(t, 3, k).s);
    expect(roll[0]! - roll[200]!).toBeGreaterThan(30); // rolls against traffic
    // Telegraph: it waits (inactive) at the top of its run first, then rolls at a constant speed.
    const P = t.hazards[3]!.periodTicks;
    const wind = Math.floor(P * ROLLER_WINDUP);
    for (let k = 0; k < wind; k++) {
      expect(hazardPose(t, 3, k).active).toBe(false);
      expect(hazardPose(t, 3, k).s).toBeCloseTo(t.hazards[3]!.s, 6);
    }
    const a = hazardPose(t, 3, wind + 10).s;
    const b = hazardPose(t, 3, wind + 40).s;
    expect(hazardPose(t, 3, wind + 10).active).toBe(true);
    expect(((a - b) / 30) * 60).toBeCloseTo(rollerSpeed(t.hazards[3]!), 3);
    const laser = Array.from({ length: 120 }, (_, k) => hazardPose(t, 4, k).active);
    expect(laser.filter(Boolean).length).toBe(60);
  });
});

describe('validation', () => {
  const bad = (patch: Partial<KartTrackDef>, msg: RegExp) => {
    expect(() => buildTrack(def(patch))).toThrow(KartTrackError);
    expect(() => buildTrack(def(patch))).toThrow(msg);
  };

  it('rejects malformed basics', () => {
    bad(
      {
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      },
      /at least 4/,
    );
    bad({ halfWidth: 30 }, /halfWidth/);
    bad({ points: BASE.points.map((p, i) => (i === 3 ? [p[0], p[1], 500] : p)) as KartTrackDef['points'] }, /height/);
  });

  it('rejects self-intersections and overlapping roads (unless one passes ≥ 6 above)', () => {
    const figure8: KartTrackDef['points'] = [
      [0, 0],
      [100, 100],
      [200, 0],
      [300, 100],
      [200, 200],
      [100, 100.5],
      [0, 200],
      [-100, 100],
    ];
    bad({ points: figure8 }, /overlaps itself|self-intersection/);
  });

  it('rejects curves too tight for the road width', () => {
    bad(
      {
        points: [
          [0, 0],
          [100, 0],
          [104, 4],
          [100, 8],
          [0, 30],
          [-40, 15],
        ],
      },
      /too tight/,
    );
  });

  it('rejects features off the road', () => {
    bad({ boostPads: [{ at: 0.1, d: 9 }] }, /boost pad.*off the road/);
    bad({ ramps: [{ at: 0.1, d: 6, width: 10, launch: 8 }] }, /wider than the road/);
    bad({ itemRows: [{ at: 0.1, count: 9 }] }, /2\.\.6/);
    bad({ hazards: [{ kind: 'bumper', at: 0.1, d: 30, period: 1 }] }, /off the road/);
    bad({ landmarks: [{ kind: 'tower', at: 0.1, d: 3 }] }, /sits on the road/);
    bad({ landmarks: [{ kind: 'arch', at: 0.1, d: 4 }] }, /sits on the road/);
    bad({ zones: [{ from: 0.1, to: 0.2, d0: 2, d1: 1, kind: 'mud' }] }, /d0 < d1/);
  });

  it('rejects rollers that leave no safe lane (fairness)', () => {
    // Two snowballs side by side across a 9-half-width road: nowhere to go.
    bad(
      {
        hazards: [
          { kind: 'roller', at: 0.2, d: -3, radius: 2.2, amp: 60, period: 6 },
          { kind: 'roller', at: 0.2, d: 3, radius: 2.2, amp: 60, period: 6, phase: 0.5 },
        ],
      },
      /leave no safe lane/,
    );
    // Lanes far enough apart leave the centre clear.
    expect(() =>
      buildTrack(
        def({
          hazards: [
            { kind: 'roller', at: 0.2, d: -5.5, radius: 1.6, amp: 60, period: 6 },
            { kind: 'roller', at: 0.2, d: 5.5, radius: 1.6, amp: 60, period: 6, phase: 0.5 },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects ramps that launch into walls and gaps that cannot be jumped', () => {
    // Ramp just before the first bend: the flight leaves the road.
    // A ramp right before a hairpin.
    const hairpinPts: KartTrackDef['points'] = [
      [0, 0],
      [200, 0],
      [225, 5],
      [235, 15],
      [225, 25],
      [200, 30],
      [0, 30],
      [-25, 25],
      [-35, 15],
      [-25, 5],
    ];
    const L = buildTrack(def({ points: hairpinPts, halfWidth: 4, shoulder: 2 })).length;
    bad({ points: hairpinPts, halfWidth: 4, shoulder: 2, ramps: [{ at: 212 / L, launch: 12 }] }, /launches into the wall/);
    bad({ gaps: [{ from: 0.1, to: 0.12 }] }, /no ramp/);
    bad({ ramps: [{ at: 0.05, launch: 5 }], gaps: [{ from: 0.06, to: 0.1 }] }, /too long to jump/);
  });

  it('rejects branches that do not leave/rejoin the road properly', () => {
    bad({ branches: [{ from: 0.1, to: 0.3, surface: 'road', points: [[-20, 5]] }] }, /not ahead of its junction/);
    bad({ branches: [{ from: 0.3, to: 0.1, surface: 'road', points: [[200, 20]] }] }, /must not wrap/);
    bad(
      {
        branches: [
          {
            from: 0.02,
            to: 0.25,
            surface: 'road',
            points: [
              [150, 60],
              [400, 60],
            ],
          },
        ],
      },
      /not before its rejoin/,
    );
  });

  it('accepts the reference tracks and a valid branch/gap/ramp combination', () => {
    expect(() => buildTrack(PIXEL_PLAZA)).not.toThrow();
    expect(() => buildTrack(DUNE_DRIFT)).not.toThrow();
    // Arches span the road when centred on it; floating landmarks may hover over it.
    expect(() =>
      buildTrack(
        def({
          landmarks: [
            { kind: 'arch', at: 0.1, d: 0 },
            { kind: 'blimp', at: 0.4, d: 2 },
            { kind: 'tower', at: 0.6, d: 3, z: 20 },
          ],
        }),
      ),
    ).not.toThrow();
    const t = buildTrack(def({ ramps: [{ at: 0.1, launch: 14 }], gaps: [{ from: 0.104, to: 0.112 }] }));
    expect(t.gaps).toHaveLength(1);
    expect(t.noGround.some((v) => v === 1)).toBe(true);
  });
});
