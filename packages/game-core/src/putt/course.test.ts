import { describe, expect, it } from 'vitest';
import { puttRoute, PUTT_HOLE_COUNT, PUTT_PLAYOFF_HOLES } from '@dascade/shared/games/putt';
import { COURSE_PAR, NEON_NINE, getHole } from './course.ts';
import { HoleDefSchema, type HoleDef } from './types.ts';
import { validateHole } from './validate.ts';
import { distanceToCup, flowField, searchShots, solveHole } from './solver.ts';
import { PHYS, simulateShot } from './physics.ts';
import { dcos, dsin, angleDir, pointInPoly, unitsToRad } from './math.ts';

describe('deterministic math', () => {
  it('dsin/dcos match Math.sin/cos to 1e-10 across many turns', () => {
    for (let i = -2000; i <= 2000; i++) {
      const x = i * 0.0173;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-10);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-10);
    }
  });
  it('intent angles map to unit directions (0 = east, 9000 = down)', () => {
    expect(angleDir(0).x).toBeCloseTo(1, 12);
    expect(angleDir(9000).y).toBeCloseTo(1, 12);
    expect(angleDir(18000).x).toBeCloseTo(-1, 12);
    for (let a = 0; a < 36000; a += 137) {
      const d = angleDir(a);
      expect(Math.abs(d.x * d.x + d.y * d.y - 1)).toBeLessThan(1e-12);
      expect(Math.abs(Math.atan2(d.y, d.x) - Math.atan2(Math.sin(unitsToRad(a)), Math.cos(unitsToRad(a))))).toBeLessThan(1e-9);
    }
  });
  it('point in polygon', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
    expect(pointInPoly(-1, 5, sq)).toBe(false);
  });
});

describe('Neon Nine course', () => {
  it('has nine uniquely named holes in order', () => {
    expect(NEON_NINE).toHaveLength(PUTT_HOLE_COUNT);
    NEON_NINE.forEach((h, i) => expect(h.number).toBe(i + 1));
    expect(new Set(NEON_NINE.map((h) => h.id)).size).toBe(9);
    expect(new Set(NEON_NINE.map((h) => h.name)).size).toBe(9);
    expect(getHole(5).id).toBe('coolant-canal');
    expect(() => getHole(10)).toThrow();
    expect(COURSE_PAR).toBe(NEON_NINE.reduce((s, h) => s + h.par, 0));
    expect(COURSE_PAR).toBeGreaterThanOrEqual(24);
  });

  it.each(NEON_NINE.map((h) => [h.number, h] as const))('hole %i passes schema + semantic validation', (_n, hole) => {
    expect(HoleDefSchema.safeParse(hole).success).toBe(true);
    expect(validateHole(hole)).toEqual([]);
  });

  it('escalates mechanics across the nine holes', () => {
    const has = (h: HoleDef) => ({
      slope: Boolean(h.slopes?.length),
      sand: Boolean(h.sand?.length),
      water: Boolean(h.water?.length),
      windmill: Boolean(h.movers?.some((m) => m.kind === 'windmill')),
      sweeper: Boolean(h.movers?.some((m) => m.kind === 'sweeper')),
      bumpers: Boolean(h.bumpers?.length),
      portals: Boolean(h.portals?.length),
      bank: h.walls.some((w) => w.kind === 'bank'),
    });
    const f = NEON_NINE.map(has);
    expect(Object.values(f[0]!).some(Boolean)).toBe(false); // 1: plain intro
    expect(f[1]!.bank).toBe(true);
    expect(f[2]!.slope).toBe(true);
    expect(f[3]!.sand).toBe(true);
    expect(f[4]!.water).toBe(true);
    expect(f[5]!.windmill).toBe(true);
    expect(f[6]!.bumpers).toBe(true);
    expect(f[7]!.portals).toBe(true);
    const finale = f[8]!;
    expect([finale.sweeper, finale.slope, finale.water, finale.portals, finale.bumpers].every(Boolean)).toBe(true);
    // No two holes share an outline.
    expect(new Set(NEON_NINE.map((h) => JSON.stringify(h.turf))).size).toBe(9);
  });

  it('rejects broken hole data', () => {
    const bad: HoleDef = { ...NEON_NINE[0]!, tee: [10, 10] };
    expect(validateHole(bad).length).toBeGreaterThan(0);
    const inWall: HoleDef = { ...NEON_NINE[0]!, cup: [1095, 300] };
    expect(validateHole(inWall).join()).toMatch(/cup/);
    const shape = { ...NEON_NINE[0]!, par: 9 };
    expect(validateHole(shape as HoleDef).length).toBeGreaterThan(0);
    const bowtie: HoleDef = {
      ...NEON_NINE[0]!,
      sand: [
        [
          [300, 250],
          [400, 450],
          [400, 250],
          [300, 450],
        ],
      ],
    };
    expect(validateHole(bowtie).join()).toMatch(/self-intersecting/);
  });

  it('routes and playoff holes reference real holes', () => {
    expect(puttRoute({ course: 'full', hole: 1 })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(puttRoute({ course: 'front', hole: 1 })).toEqual([1, 2, 3]);
    expect(puttRoute({ course: 'back', hole: 1 })).toEqual([7, 8, 9]);
    expect(puttRoute({ course: 'single', hole: 6 })).toEqual([6]);
    for (const n of PUTT_PLAYOFF_HOLES) expect(getHole(n)).toBeTruthy();
  });

  it('the cup is reachable on foot from the tee on every hole (flow field)', () => {
    for (const h of NEON_NINE) {
      const d = distanceToCup(h, h.tee[0], h.tee[1]);
      expect(Number.isFinite(d), `hole ${h.number}`).toBe(true);
      expect(flowField(h).dist.some((v) => v === 0)).toBe(true);
    }
  });

  it.each(NEON_NINE.map((h) => [h.number, h] as const))(
    'hole %i can be holed within par by a searched line',
    (_n, hole) => {
      const times = hole.movers?.length ? [0, 800, 1600, 2400] : [0];
      const res = solveHole(hole, { beam: 4, maxStrokes: hole.par, angleStep: 300, obstacleMs: times });
      expect(res, `hole ${hole.number} not solved within par`).not.toBeNull();
      // Replaying the found line reproduces the hole-out exactly.
      let lie = { x: hole.tee[0], y: hole.tee[1] };
      let result = '';
      for (const s of res!.line) {
        const sim = simulateShot(hole, lie, s.angle, s.power, s.obstacleMs);
        result = sim.result;
        lie = sim.end;
      }
      expect(result).toBe('cup');
    },
    60_000,
  );

  it('a max-power smash straight at the cup is never an ace', () => {
    for (const h of NEON_NINE) {
      const ideal = Math.round((Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]) * 18000) / Math.PI + 36000) % 36000;
      for (let da = -100; da <= 100; da += 25) {
        const sim = simulateShot(h, { x: h.tee[0], y: h.tee[1] }, (ideal + da + 36000) % 36000, 1000, 0);
        expect(sim.result, `hole ${h.number} offset ${da}`).not.toBe('cup');
      }
    }
  });

  it('shot search prefers shots that end closer to the cup', () => {
    const h = NEON_NINE[0]!;
    const best = searchShots(h, { x: h.tee[0], y: h.tee[1] }, { angleStep: 200, keep: 3 });
    expect(best.length).toBeGreaterThan(0);
    const tee = distanceToCup(h, h.tee[0], h.tee[1]);
    expect(best[0]!.score).toBeLessThan(tee * 0.2);
    expect(PHYS.cupR).toBeGreaterThan(PHYS.ballR);
  });
});
