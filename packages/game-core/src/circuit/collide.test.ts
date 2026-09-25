import { describe, expect, it } from 'vitest';
import { CHASSIS, type CarState } from './car.ts';
import { collideCars } from './collide.ts';

function car(x: number, y: number, heading = 0, vx = 0, vy = 0, angVel = 0): CarState {
  return {
    x: Math.fround(x),
    y: Math.fround(y),
    heading: Math.fround(heading),
    vx: Math.fround(vx),
    vy: Math.fround(vy),
    angVel,
    boost: 0,
    boostOn: false,
    drift: 0,
    seg: 0,
  };
}

const overlapDepth = (a: CarState, b: CarState) => {
  // Re-run the collision on the result: no further contact means separated.
  return collideCars(a, CHASSIS.volt, b, CHASSIS.volt);
};

describe('car–car collisions', () => {
  it('ignores cars that are apart', () => {
    expect(collideCars(car(0, 0), CHASSIS.volt, car(200, 0), CHASSIS.volt)).toBeNull();
    expect(collideCars(car(0, 0), CHASSIS.volt, car(0, 30), CHASSIS.volt)).toBeNull();
  });

  it('separates overlapping cars and conserves momentum (equal masses)', () => {
    const a = car(0, 0, 0, 300, 0);
    const b = car(40, 4, 0, 0, 0);
    const hit = collideCars(a, CHASSIS.volt, b, CHASSIS.volt)!;
    expect(hit).not.toBeNull();
    expect(hit.impact).toBeGreaterThan(200);
    expect(overlapDepth(hit.a, hit.b)).toBeNull();
    expect(hit.a.vx + hit.b.vx).toBeCloseTo(a.vx + b.vx, 1);
    expect(hit.a.vy + hit.b.vy).toBeCloseTo(a.vy + b.vy, 1);
    // The rear car slows, the front car is shoved forward.
    expect(hit.a.vx).toBeLessThan(a.vx);
    expect(hit.b.vx).toBeGreaterThan(0);
  });

  it('pushes side-by-side cars apart sideways and adds spin for off-centre hits', () => {
    const a = car(0, 0, 0, 400, 60);
    const b = car(10, 22, 0, 400, -60);
    const hit = collideCars(a, CHASSIS.volt, b, CHASSIS.volt)!;
    expect(hit.a.y).toBeLessThan(a.y);
    expect(hit.b.y).toBeGreaterThan(b.y);
    expect(hit.a.vy).toBeLessThan(a.vy);
    expect(hit.b.vy).toBeGreaterThan(b.vy);
    expect(Math.abs(hit.a.angVel) + Math.abs(hit.b.angVel)).toBeGreaterThan(0);
  });

  it('does not add energy for separating cars', () => {
    const a = car(0, 0, 0, -100, 0);
    const b = car(40, 0, 0, 100, 0);
    const hit = collideCars(a, CHASSIS.volt, b, CHASSIS.volt)!;
    expect(hit.impact).toBe(0);
    expect(hit.a.vx).toBe(a.vx);
    expect(hit.b.vx).toBe(b.vx);
  });

  it('handles exactly coincident cars deterministically', () => {
    const a = car(10, 10, 0.3);
    const b = car(10, 10, 0.3);
    const r1 = collideCars(a, CHASSIS.brick, b, CHASSIS.pixel)!;
    const r2 = collideCars(a, CHASSIS.brick, b, CHASSIS.pixel)!;
    expect(r1).toEqual(r2);
    expect(Math.hypot(r1.a.x - r1.b.x, r1.a.y - r1.b.y)).toBeGreaterThan(20);
    for (const v of [r1.a.x, r1.a.y, r1.b.x, r1.b.y, r1.a.vx, r1.b.vy]) expect(Math.fround(v)).toBe(v);
  });
});
