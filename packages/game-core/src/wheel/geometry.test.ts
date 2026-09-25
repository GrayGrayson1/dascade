import { describe, expect, it } from 'vitest';
import { arcIndexAt, computeArcs, initialRotation, mod, nearestApproachingPeg, normalizeRotation, pegAngles, pegCrossings, pointerAngle, segmentAtPointer } from './index.ts';

const segs = (weights: number[]) => weights.map((weight, i) => ({ id: `s${i}`, weight }));

describe('mod / normalizeRotation', () => {
  it('wraps into [0, m)', () => {
    expect(mod(370, 360)).toBe(10);
    expect(mod(-10, 360)).toBe(350);
    expect(mod(-360, 360)).toBe(0);
    expect(mod(720, 360)).toBe(0);
    expect(mod(-1e-20, 360)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
  });
});

describe('computeArcs', () => {
  it('equal mode tiles the circle with identical slices', () => {
    const arcs = computeArcs(segs([1, 5, 10, 0.5]), 'equal');
    expect(arcs.map((a) => a.size)).toEqual([90, 90, 90, 90]);
    expect(arcs[0]!.start).toBe(0);
    expect(arcs.at(-1)!.end).toBe(360);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]!.start).toBe(arcs[i - 1]!.end);
  });

  it('weighted mode sizes slices by weight', () => {
    const arcs = computeArcs(segs([1, 3]), 'weighted');
    expect(arcs[0]).toMatchObject({ start: 0, end: 90, size: 90, mid: 45 });
    expect(arcs[1]).toMatchObject({ start: 90, end: 360, size: 270, mid: 225 });
  });

  it('weighted mode falls back to equal slices when no weight is usable', () => {
    const arcs = computeArcs(segs([0, NaN, -2]), 'weighted');
    expect(arcs.map((a) => a.size)).toEqual([120, 120, 120]);
  });

  it('handles 0, 1 and 200 segments', () => {
    expect(computeArcs([], 'equal')).toEqual([]);
    expect(computeArcs(segs([1]), 'weighted')).toEqual([{ id: 's0', start: 0, end: 360, size: 360, mid: 180 }]);
    const many = computeArcs(segs(Array.from({ length: 200 }, (_, i) => (i % 5) + 1)), 'weighted');
    expect(many).toHaveLength(200);
    expect(many.at(-1)!.end).toBe(360);
    const sum = many.reduce((s, a) => s + a.size, 0);
    expect(sum).toBeCloseTo(360, 9);
  });

  it('keeps extreme weight ratios representable', () => {
    const arcs = computeArcs(segs([1000, 0.001]), 'weighted');
    expect(arcs[1]!.size).toBeGreaterThan(0);
    expect(arcs[1]!.end).toBe(360);
  });
});

describe('arcIndexAt / pointer', () => {
  const arcs = computeArcs(segs([1, 1, 1, 1]), 'equal');
  it('finds the arc containing an angle, start inclusive', () => {
    expect(arcIndexAt(arcs, 0)).toBe(0);
    expect(arcIndexAt(arcs, 89.999)).toBe(0);
    expect(arcIndexAt(arcs, 90)).toBe(1);
    expect(arcIndexAt(arcs, 359.9999)).toBe(3);
    expect(arcIndexAt(arcs, 360)).toBe(0);
    expect(arcIndexAt(arcs, -1)).toBe(3);
    expect(arcIndexAt(arcs, 725)).toBe(0);
    expect(arcIndexAt([], 10)).toBe(-1);
  });

  it('maps rotation to the local angle under the 12 o’clock pointer', () => {
    expect(pointerAngle(0)).toBe(0);
    expect(pointerAngle(90)).toBe(270);
    expect(pointerAngle(-90)).toBe(90);
    // Rotating the wheel 45° clockwise brings slice 3 (270–360) under the pointer.
    expect(segmentAtPointer(arcs, 45)).toBe(3);
    expect(segmentAtPointer(arcs, 135 + 3600)).toBe(2);
  });
});

describe('initialRotation', () => {
  it('centers the first slice under the pointer', () => {
    const arcs = computeArcs(segs([1, 1, 1, 1]), 'equal');
    expect(initialRotation(arcs)).toBe(315);
    expect(segmentAtPointer(arcs, initialRotation(arcs))).toBe(0);
    expect(pointerAngle(initialRotation(arcs))).toBeCloseTo(45, 9);
    expect(initialRotation([])).toBe(0);
    expect(initialRotation(computeArcs(segs([1]), 'equal'))).toBe(180);
  });
});

describe('pegs', () => {
  const arcs = computeArcs(segs([1, 1, 1, 1, 1, 1]), 'equal');
  const pegs = pegAngles(arcs);

  it('places a peg on every boundary', () => {
    expect(pegs).toEqual([0, 60, 120, 180, 240, 300]);
    expect(pegAngles(computeArcs(segs([1]), 'equal'))).toEqual([0]);
    expect(pegAngles([])).toEqual([]);
  });

  it('counts pegs passing the pointer', () => {
    expect(pegCrossings(pegs, 0, 360)).toBe(6);
    expect(pegCrossings(pegs, 10, 50)).toBe(0);
    // Rotation 60 brings the peg at local 300 under the pointer.
    expect(pegCrossings(pegs, 50, 61)).toBe(1);
    expect(pegCrossings(pegs, 1, 3601)).toBe(60);
    expect(pegCrossings(pegs, 100, 100)).toBe(0);
    expect(pegCrossings(pegs, 100, 50)).toBe(0);
    expect(pegCrossings(pegs, NaN, 50)).toBe(0);
  });

  it('reports the approaching peg distance', () => {
    expect(nearestApproachingPeg(pegs, 55)).toBeCloseTo(-5, 9);
    expect(nearestApproachingPeg(pegs, 60)).toBe(0);
    expect(nearestApproachingPeg(pegs, 61)).toBeCloseTo(-59, 9);
    expect(nearestApproachingPeg([], 10)).toBe(-Infinity);
  });
});
