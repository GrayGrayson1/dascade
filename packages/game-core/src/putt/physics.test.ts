import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { PUTT_PATH_SAMPLE } from '@dascade/shared/games/putt';
import {
  PHYS,
  compileHole,
  inMoverSweep,
  launchSpeed,
  moverBars,
  moverPose,
  simulateShot,
  surfaceAt,
  type ShotSim,
} from './physics.ts';
import { decodePath, encodeEvents, encodePath, pathPosition } from './path.ts';
import { clearance, validateHole } from './validate.ts';
import { NEON_NINE } from './course.ts';
import type { HoleDef, Pt } from './types.ts';

/** A walled test box (x 0..W, y 0..H) with the cup tucked in a far corner. */
function box(extra: Partial<HoleDef> = {}, W = 1200, H = 400): HoleDef {
  const turf: Pt[] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  return {
    number: 1,
    id: 'test-box',
    name: 'Test Box',
    par: 3,
    tip: 'test hole',
    tee: [100, H / 2],
    cup: [W - 40, 40],
    turf: [turf],
    walls: [{ pts: turf, closed: true }],
    ...extra,
  };
}

const EAST = 0;
const NORTH = 27000;

/** Speed (units/s) between two samples around sample index k. */
function sampleSpeed(sim: ShotSim, k: number): number {
  const s = sim.samples;
  const dx = s[(k + 1) * 2]! - s[k * 2]!;
  const dy = s[(k + 1) * 2 + 1]! - s[k * 2 + 1]!;
  return (Math.sqrt(dx * dx + dy * dy) * PHYS.tickHz) / PUTT_PATH_SAMPLE;
}

/** Impact test: fire at a collider and compare speed just before vs just after the first contact. */
function reboundRatio(hole: HoleDef, angle: number, power: number, from = { x: hole.tee[0], y: hole.tee[1] }): { ratio: number; sim: ShotSim } {
  const sim = simulateShot(hole, from, angle, power, 0);
  const ev = sim.events.find((e) => e.kind !== 'sand');
  expect(ev, 'expected a collision').toBeTruthy();
  const k = Math.floor(ev!.tick / PUTT_PATH_SAMPLE);
  const before = sampleSpeed(sim, k - 2);
  const after = sampleSpeed(sim, k + 1);
  return { ratio: after / before, sim };
}

describe('launch + rolling', () => {
  it('maps power to a monotonic launch speed with a soft low end', () => {
    expect(launchSpeed(1000)).toBeCloseTo(PHYS.vMax, 6);
    expect(launchSpeed(0)).toBe(0);
    let prev = -1;
    for (let p = 15; p <= 1000; p += 5) {
      const v = launchSpeed(p);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(launchSpeed(500)).toBeLessThan(PHYS.vMax * 0.5);
  });

  it('rolls straight, decelerates and comes to rest on flat turf', () => {
    const hole = box();
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 500, 0);
    expect(sim.result).toBe('rest');
    expect(sim.capped).toBe(false);
    expect(sim.end.y).toBeCloseTo(200, 6);
    expect(sim.end.x).toBeGreaterThan(200);
    // Speed never increases on flat ground.
    const speeds: number[] = [];
    for (let k = 0; k + 1 < sim.samples.length / 2 - 1; k++) speeds.push(sampleSpeed(sim, k));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThanOrEqual(speeds[i - 1]! + 1e-6);
  });

  it('rolls further with more power', () => {
    const hole = box({}, 3000, 400);
    let prev = 0;
    for (const p of [100, 250, 400, 550, 700]) {
      const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, p, 0);
      expect(sim.end.x).toBeGreaterThan(prev);
      prev = sim.end.x;
    }
  });

  it('is deterministic: identical inputs give identical results', () => {
    const hole = NEON_NINE[6]!;
    const a = simulateShot(hole, { x: 190, y: 510 }, 33000, 950, 1234);
    const b = simulateShot(hole, { x: 190, y: 510 }, 33000, 950, 1234);
    expect(b).toEqual(a);
  });

  it('samples every PUTT_PATH_SAMPLE ticks and ends on the final position', () => {
    const sim = simulateShot(box(), { x: 100, y: 200 }, EAST, 300, 0);
    const n = sim.samples.length / 2;
    expect(n).toBe(Math.ceil(sim.ticks / PUTT_PATH_SAMPLE) + 1);
    expect(sim.samples[(n - 1) * 2]).toBe(sim.end.x);
    expect(sim.samples[(n - 1) * 2 + 1]).toBe(sim.end.y);
  });
});

describe('collisions', () => {
  it('reflects off a wall with restitution ≈ wallE', () => {
    const hole = box();
    const { ratio, sim } = reboundRatio(hole, EAST, 700, { x: 900, y: 200 });
    expect(sim.events[0]!.kind).toBe('wall');
    expect(ratio).toBeGreaterThan(PHYS.wallE - 0.08);
    expect(ratio).toBeLessThan(PHYS.wallE + 0.04);
    // Came back west after the bounce.
    expect(sim.end.x).toBeLessThan(1200 - PHYS.ballR - 7);
    expect(sim.end.x).toBeLessThan(1100);
  });

  it('keeps tangential speed on glancing wall hits (angle in = angle out)', () => {
    const hole = box({}, 1200, 400);
    const sim = simulateShot(hole, { x: 100, y: 200 }, 4500 - 9000 + 36000, 800, 0); // 45° up-right
    const hitK = Math.floor(sim.events[0]!.tick / PUTT_PATH_SAMPLE);
    const s = sim.samples;
    const vxBefore = s[(hitK - 1) * 2]! - s[(hitK - 3) * 2]!;
    const vxAfter = s[(hitK + 3) * 2]! - s[(hitK + 1) * 2]!;
    const vyAfter = s[(hitK + 3) * 2 + 1]! - s[(hitK + 1) * 2 + 1]!;
    expect(vxAfter).toBeGreaterThan(vxBefore * 0.85);
    expect(vyAfter).toBeGreaterThan(0); // now heading down
  });

  it('banks 90° off a 45° cushion', () => {
    const hole = box({
      walls: [
        {
          pts: [
            [0, 0],
            [1200, 0],
            [1200, 400],
            [0, 400],
          ],
          closed: true,
        },
        {
          pts: [
            [700, 400],
            [1100, 0],
          ],
          kind: 'bank',
        },
      ],
    });
    const sim = simulateShot(hole, { x: 100, y: 250 }, EAST, 900, 0);
    const bank = sim.events.find((e) => e.kind === 'wall')!;
    expect(bank).toBeTruthy();
    const k = Math.floor(bank.tick / PUTT_PATH_SAMPLE) + 2;
    const dx = sim.samples[(k + 1) * 2]! - sim.samples[k * 2]!;
    const dy = sim.samples[(k + 1) * 2 + 1]! - sim.samples[k * 2 + 1]!;
    expect(dy).toBeLessThan(0);
    expect(Math.abs(dx)).toBeLessThan(Math.abs(dy) * 0.2);
  });

  it('pop bumpers return the ball faster than it arrived', () => {
    const hole = box({ bumpers: [{ at: [600, 200], r: 28 }] });
    const { ratio, sim } = reboundRatio(hole, EAST, 720);
    expect(sim.events[0]!.kind).toBe('bumper');
    expect(sim.events[0]!.v).toBe(0); // bumper index
    expect(ratio).toBeGreaterThan(1.05);
  });

  it('round posts absorb most of the impact', () => {
    const hole = box({ posts: [{ at: [600, 200], r: 16 }] });
    const { ratio, sim } = reboundRatio(hole, EAST, 700);
    expect(sim.events[0]!.kind).toBe('post');
    expect(ratio).toBeGreaterThan(PHYS.postE - 0.1);
    expect(ratio).toBeLessThan(PHYS.postE + 0.06);
  });

  it('kicker cushions add energy', () => {
    const hole = box({
      walls: [
        {
          pts: [
            [0, 0],
            [1200, 0],
            [1200, 400],
            [0, 400],
          ],
          closed: true,
        },
        {
          pts: [
            [700, 60],
            [700, 340],
          ],
          kind: 'kicker',
        },
      ],
    });
    const { ratio } = reboundRatio(hole, EAST, 820);
    expect(ratio).toBeGreaterThan(1.1);
  });

  it('never tunnels through walls at any speed or angle', () => {
    const hole = box({}, 600, 300);
    const rng = createSeededRng('tunnel');
    for (let i = 0; i < 300; i++) {
      const from = { x: 40 + rng.next() * 520, y: 40 + rng.next() * 220 };
      const sim = simulateShot(hole, from, rng.int(36000), 200 + rng.int(801), 0);
      expect(sim.result).not.toBe('oob');
      for (let k = 0; k < sim.samples.length; k += 2) {
        expect(sim.samples[k]!).toBeGreaterThan(7 + PHYS.ballR - 0.5);
        expect(sim.samples[k]!).toBeLessThan(600 - 7 - PHYS.ballR + 0.5);
        expect(sim.samples[k + 1]!).toBeGreaterThan(7 + PHYS.ballR - 0.5);
        expect(sim.samples[k + 1]!).toBeLessThan(300 - 7 - PHYS.ballR + 0.5);
      }
    }
  });
});

describe('surfaces', () => {
  it('a slope steeper than rolling friction rolls a resting ball downhill', () => {
    const hole = box({ slopes: [{ poly: [[300, 0], [900, 0], [900, 400], [300, 400]], accel: [400, 0] }] });
    const sim = simulateShot(hole, { x: 500, y: 200 }, NORTH, 15, 0);
    expect(sim.end.x).toBeGreaterThan(900);
  });

  it('a gentle slope (below friction) holds a resting ball', () => {
    const hole = box({ slopes: [{ poly: [[300, 0], [900, 0], [900, 400], [300, 400]], accel: [200, 0] }] });
    const sim = simulateShot(hole, { x: 500, y: 200 }, NORTH, 15, 0);
    expect(Math.abs(sim.end.x - 500)).toBeLessThan(3);
  });

  it('a weak putt up a ramp rolls back down; a firm one crests it', () => {
    const hole = box({ slopes: [{ poly: [[400, 0], [600, 0], [600, 400], [400, 400]], accel: [-420, 0] }] });
    const weak = simulateShot(hole, { x: 100, y: 200 }, EAST, 700, 0);
    expect(weak.samples.some((v, i) => i % 2 === 0 && v > 430)).toBe(true);
    expect(weak.end.x).toBeLessThan(400);
    const firm = simulateShot(hole, { x: 100, y: 200 }, EAST, 1000, 0);
    expect(firm.end.x).toBeGreaterThan(600);
  });

  it('sand kills speed', () => {
    const turf = simulateShot(box(), { x: 100, y: 200 }, EAST, 600, 0);
    const sandy = simulateShot(box({ sand: [[[150, 0], [1200, 0], [1200, 400], [150, 400]]] }), { x: 100, y: 200 }, EAST, 600, 0);
    expect(sandy.events.some((e) => e.kind === 'sand')).toBe(true);
    expect(sandy.end.x - 100).toBeLessThan((turf.end.x - 100) * 0.45);
  });

  it('water ends the roll with a splash', () => {
    const turf: Pt[] = [
      [0, 0],
      [600, 0],
      [600, 400],
      [0, 400],
    ];
    const hole = box({
      turf: [turf, [[800, 0], [1200, 0], [1200, 400], [800, 400]]],
      water: [[[600, 0], [800, 0], [800, 400], [600, 400]]],
      walls: [{ pts: [[600, 0], [0, 0], [0, 400], [600, 400]] }],
    });
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 800, 0);
    expect(sim.result).toBe('water');
    expect(sim.events.at(-1)!.kind).toBe('water');
    expect(sim.end.x).toBeGreaterThanOrEqual(600);
    expect(surfaceAt(compileHole(hole), sim.end.x, sim.end.y)).toBe('water');
  });

  it('rolling off an open edge is out of bounds', () => {
    const turf: Pt[] = [
      [0, 0],
      [600, 0],
      [600, 400],
      [0, 400],
    ];
    const hole = box({ turf: [turf], walls: [{ pts: [[600, 0], [0, 0], [0, 400], [600, 400]] }], cup: [500, 60] });
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 700, 0);
    expect(sim.result).toBe('oob');
  });
});

describe('cup', () => {
  const hole = box({ cup: [600, 200] });
  it('captures a slow, centred putt', () => {
    let holed = 0;
    for (let p = 540; p <= 760; p += 5) {
      const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, p, 0);
      if (sim.result === 'cup') {
        holed++;
        expect(sim.end).toEqual({ x: 600, y: 200 });
        expect(sim.events.at(-1)!.kind).toBe('cup');
      }
    }
    expect(holed).toBeGreaterThan(2);
  });

  it('a centred putt that is far too fast skips over the cup', () => {
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 1000, 0);
    expect(sim.events.some((e) => e.kind === 'lip')).toBe(true);
    const lip = sim.events.find((e) => e.kind === 'lip')!;
    expect(lip.v).toBeGreaterThan(PHYS.captureSpeed);
  });

  it('a firm putt that clips the edge of the cup lips out', () => {
    let lipOuts = 0;
    for (let off = 8; off <= 20; off += 2) {
      const sim = simulateShot(hole, { x: 100, y: 200 + off }, EAST, 760, 0);
      if (sim.events.some((e) => e.kind === 'lip') && sim.result !== 'cup') lipOuts++;
    }
    expect(lipOuts).toBeGreaterThan(0);
  });

  it('capture window shrinks off-centre (speed-dependent)', () => {
    const count = (off: number) => {
      let n = 0;
      for (let p = 500; p <= 900; p += 5) if (simulateShot(hole, { x: 100, y: 200 + off }, EAST, p, 0).result === 'cup') n++;
      return n;
    };
    expect(count(0)).toBeGreaterThan(count(13));
  });
});

describe('moving obstacles', () => {
  const windmill: HoleDef = box({
    movers: [{ kind: 'windmill', at: [600, 200], arms: 4, length: 90, width: 12, hubR: 20, periodMs: 4000, phase: 0, dir: 1 }],
  });

  it('pose is a pure, periodic function of the hole clock', () => {
    const m = windmill.movers![0]!;
    const a = moverPose(m, 1234.5);
    const b = moverPose(m, 1234.5 + 4000 * 3);
    expect(b.angle).toBeCloseTo(a.angle, 9);
    expect(moverBars(m, 777)).toEqual(moverBars(m, 777));
    const sweeper = NEON_NINE[8]!.movers![0]!;
    const p0 = moverPose(sweeper, 0);
    const p1 = moverPose(sweeper, sweeper.periodMs);
    expect(p1.cx).toBeCloseTo(p0.cx, 9);
    expect(p1.cy).toBeCloseTo(p0.cy, 9);
  });

  it('the same shot at the same hole-clock time replays identically; timing changes the outcome', () => {
    const results = new Set<string>();
    for (let t = 0; t < 4000; t += 250) {
      const a = simulateShot(windmill, { x: 100, y: 170 }, EAST, 820, t);
      const b = simulateShot(windmill, { x: 100, y: 170 }, EAST, 820, t);
      expect(b).toEqual(a);
      results.add(`${a.events.some((e) => e.kind === 'blade')}:${Math.round(a.end.x)}`);
    }
    expect(results.size).toBeGreaterThan(2);
  });

  it('blades push a ball and a ball never comes to rest inside a sweep', () => {
    const h = compileHole(windmill);
    const rng = createSeededRng('sweep');
    let bladeHits = 0;
    for (let i = 0; i < 120; i++) {
      const sim = simulateShot(windmill, { x: 300 + rng.next() * 150, y: 60 + rng.next() * 280 }, rng.int(36000), 100 + rng.int(700), rng.int(4000));
      if (sim.events.some((e) => e.kind === 'blade')) bladeHits++;
      if (!sim.capped && sim.result === 'rest') expect(inMoverSweep(h, sim.end.x, sim.end.y)).toBe(false);
    }
    expect(bladeHits).toBeGreaterThan(5);
  });
});

describe('portals', () => {
  const hole = box({
    portals: [{ from: [400, 200], to: [900, 300], exit: [0, -1], color: 'cyan', label: 'A' }],
    cup: [1150, 40],
  });
  it('teleports to the exit and leaves along the exit direction', () => {
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 640, 0);
    const ev = sim.events.find((e) => e.kind === 'portal')!;
    expect(ev).toBeTruthy();
    expect(ev.v).toBe(0);
    const k = Math.ceil(ev.tick / PUTT_PATH_SAMPLE);
    expect(sim.samples[k * 2]).toBeCloseTo(900, 0);
    expect(sim.end.y).toBeLessThan(300);
    expect(Math.abs(sim.end.x - 900)).toBeLessThan(1);
  });
  it('a slow entry still exits with the minimum exit speed', () => {
    const sim = simulateShot(hole, { x: 340, y: 200 }, EAST, 300, 0);
    expect(sim.events.some((e) => e.kind === 'portal')).toBe(true);
    expect(300 - sim.end.y).toBeGreaterThan(20);
  });
});

describe('termination', () => {
  it('caps the simulation length', () => {
    const hole = box({
      slopes: [
        { poly: [[0, 0], [600, 0], [600, 400], [0, 400]], accel: [600, 0] },
        { poly: [[600, 0], [1200, 0], [1200, 400], [600, 400]], accel: [-600, 0] },
      ],
    });
    const sim = simulateShot(hole, { x: 100, y: 200 }, EAST, 900, 0, { maxTicks: 240 });
    expect(sim.ticks).toBeLessThanOrEqual(240);
  });

  it('every hole terminates with finite positions for random shots (seeded playouts)', () => {
    const rng = createSeededRng('playouts');
    for (const hole of NEON_NINE) {
      const h = compileHole(hole);
      let lie = { x: hole.tee[0], y: hole.tee[1] };
      for (let i = 0; i < 40; i++) {
        const sim = simulateShot(h, lie, rng.int(36000), 15 + rng.int(986), rng.int(20000));
        expect(Number.isFinite(sim.end.x) && Number.isFinite(sim.end.y)).toBe(true);
        expect(sim.ticks).toBeLessThanOrEqual(PHYS.maxTicks);
        if (sim.result === 'rest') {
          const s = surfaceAt(h, sim.end.x, sim.end.y);
          expect(s === 'turf' || s === 'sand').toBe(true);
          expect(clearance(hole, sim.end.x, sim.end.y)).toBeGreaterThan(-0.5);
          lie = { x: sim.end.x, y: sim.end.y };
        } else if (sim.result === 'cup') {
          lie = { x: hole.tee[0], y: hole.tee[1] };
        }
      }
    }
  });

  it('trajectory previews stop at the first contact', () => {
    const sim = simulateShot(box(), { x: 900, y: 200 }, EAST, 900, 0, { untilFirstContact: true });
    expect(sim.events.length).toBe(1);
    expect(sim.end.x).toBeGreaterThan(1150);
  });
});

describe('wire path', () => {
  it('round-trips positions within 0.05 units and interpolates', () => {
    const sim = simulateShot(NEON_NINE[1]!, { x: 210, y: 530 }, 600, 960, 0);
    const enc = encodePath(sim.samples);
    const dec = decodePath(enc);
    for (let i = 0; i < sim.samples.length; i++) expect(Math.abs(dec[i]! - sim.samples[i]!)).toBeLessThanOrEqual(0.05 + 1e-9);
    const p = pathPosition(dec, sim.ticks, sim.ticks, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(sim.end.x, 1);
    const mid = pathPosition(dec, sim.ticks, 3, { x: 0, y: 0 });
    expect(mid.x).toBeGreaterThan(dec[2]!);
    expect(mid.x).toBeLessThan(dec[4]!);
    const ev = encodeEvents(sim.events);
    expect(ev.every((e) => e.length === 5 && e.every(Number.isInteger))).toBe(true);
  });

  it('never slides across the map during a teleport', () => {
    const pos = new Float64Array([0, 0, 10, 0, 500, 500, 505, 500]);
    const p = pathPosition(pos, 6, 3, { x: 0, y: 0 });
    expect(p.x === 10 || p.x === 500).toBe(true);
  });
});

describe('synthetic holes are valid', () => {
  it('the test box validates', () => {
    expect(validateHole(box())).toEqual([]);
  });
});
