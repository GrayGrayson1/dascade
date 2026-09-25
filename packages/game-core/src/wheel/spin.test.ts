import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import {
  LANDING_MARGIN,
  SPIN_ACCEL,
  SPIN_PEAK_VELOCITY,
  computeArcs,
  eligibleIndices,
  normalizeSegments,
  pickWinner,
  planSpin,
  pointerAngle,
  rotationAt,
  segmentAtPointer,
  spinEase,
  spinProgressAt,
  spinTurns,
  spinVelocity,
  weightedIndex,
  type ActiveSegment,
} from './index.ts';

const wheel = (weights: number[], labels?: string[]): ActiveSegment[] =>
  weights.map((weight, i) => ({ id: `s${i}`, label: labels?.[i] ?? `Option ${i}`, emoji: '', color: '#ffb020', weight }));

const fixed = (value: number): Rng => ({ next: () => value, int: (max) => Math.min(max - 1, Math.floor(value * max)) });

describe('weightedIndex', () => {
  it('matches the weight distribution (seeded, 200k draws)', () => {
    const rng = createSeededRng('distribution');
    const weights = [1, 2, 3, 4];
    const counts = [0, 0, 0, 0];
    const draws = 200_000;
    for (let i = 0; i < draws; i++) counts[weightedIndex(weights, rng)]!++;
    const total = 10;
    let chi2 = 0;
    weights.forEach((w, i) => {
      const expected = (w / total) * draws;
      expect(Math.abs(counts[i]! / draws - w / total)).toBeLessThan(0.006);
      chi2 += (counts[i]! - expected) ** 2 / expected;
    });
    // χ² critical value for 3 dof at p = 0.001 is 16.27.
    expect(chi2).toBeLessThan(16.27);
  });

  it('handles fractional and extreme weights', () => {
    const rng = createSeededRng('extreme');
    let rare = 0;
    for (let i = 0; i < 100_000; i++) if (weightedIndex([1000, 0.5], rng) === 1) rare++;
    // Expected 0.05% ≈ 50 hits.
    expect(rare).toBeGreaterThan(10);
    expect(rare).toBeLessThan(120);
  });

  it('never picks zero, negative or invalid weights', () => {
    const rng = createSeededRng('zeros');
    for (let i = 0; i < 20_000; i++) {
      const idx = weightedIndex([0, 3, -2, NaN, 1, Infinity], rng);
      expect([1, 4]).toContain(idx);
    }
  });

  it('respects rng edges', () => {
    expect(weightedIndex([0, 1, 1, 0], fixed(0))).toBe(1);
    expect(weightedIndex([0, 1, 1, 0], fixed(0.9999999999999999))).toBe(2);
    expect(weightedIndex([1, 1], fixed(0.5))).toBe(1);
  });

  it('throws when nothing can be drawn', () => {
    expect(() => weightedIndex([], createSeededRng('x'))).toThrow(RangeError);
    expect(() => weightedIndex([0, -1, NaN], createSeededRng('x'))).toThrow(RangeError);
  });

  it('restricts the draw to eligible indices', () => {
    const rng = createSeededRng('eligible');
    for (let i = 0; i < 5000; i++) expect(weightedIndex([5, 5, 5], rng, [0, 2])).not.toBe(1);
  });
});

describe('eligibility / no immediate repeat', () => {
  const three = wheel([1, 1, 1]);
  it('excludes the previous winner when preventing repeats', () => {
    expect(eligibleIndices(three, { previousWinnerId: 's1', preventRepeat: true })).toEqual([0, 2]);
    expect(eligibleIndices(three, { previousWinnerId: 's1', preventRepeat: false })).toEqual([0, 1, 2]);
    expect(eligibleIndices(three, { previousWinnerId: 'gone', preventRepeat: true })).toEqual([0, 1, 2]);
    expect(eligibleIndices(three, { previousWinnerId: null, preventRepeat: true })).toEqual([0, 1, 2]);
  });

  it('still allows the only option to win again', () => {
    expect(eligibleIndices(wheel([1]), { previousWinnerId: 's0', preventRepeat: true })).toEqual([0]);
  });

  it('never repeats back to back over many spins', () => {
    const rng = createSeededRng('no-repeat');
    for (const segments of [wheel([1, 1]), wheel([1, 1, 1]), wheel([100, 1, 1]), wheel([5, 0.01])]) {
      let prev: string | null = null;
      for (let i = 0; i < 2000; i++) {
        const idx = pickWinner(segments, rng, { previousWinnerId: prev, preventRepeat: true });
        const id: string = segments[idx]!.id;
        expect(id).not.toBe(prev);
        prev = id;
      }
    }
  });

  it('allows repeats when configured', () => {
    const rng = createSeededRng('repeat-ok');
    let repeats = 0;
    let prev: string | null = null;
    const segments = wheel([1, 1]);
    for (let i = 0; i < 1000; i++) {
      const id: string = segments[pickWinner(segments, rng, { previousWinnerId: prev, preventRepeat: false })]!.id;
      if (id === prev) repeats++;
      prev = id;
    }
    expect(repeats).toBeGreaterThan(300);
  });

  it('pickWinner throws on an empty wheel', () => {
    expect(() => pickWinner([], createSeededRng('empty'))).toThrow(RangeError);
  });
});

describe('planSpin', () => {
  const cases: Array<{ name: string; weights: number[] }> = [
    { name: '1 item', weights: [1] },
    { name: '2 items', weights: [1, 1] },
    { name: '2 lopsided', weights: [1000, 0.001] },
    { name: '3 mixed', weights: [0.5, 2, 7] },
    { name: '12 even', weights: Array.from({ length: 12 }, () => 1) },
    { name: '60 varied', weights: Array.from({ length: 60 }, (_, i) => (i % 9) + 0.5) },
    { name: '200 varied', weights: Array.from({ length: 200 }, (_, i) => ((i * 37) % 13) + 1) },
  ];

  for (const mode of ['equal', 'weighted'] as const) {
    for (const c of cases) {
      it(`lands strictly inside the winner arc (${mode}, ${c.name})`, () => {
        const segments = wheel(c.weights);
        const arcs = computeArcs(segments, mode);
        const rng = createSeededRng(`${mode}-${c.name}`);
        let from = 0;
        for (let i = 0; i < 300; i++) {
          const plan = planSpin({ segments, sliceMode: mode, rng, fromRotation: from, durationMs: 2000 + (i % 11) * 1000 });
          const arc = arcs[plan.winnerIndex]!;
          const margin = arc.size * LANDING_MARGIN * 0.999;
          expect(plan.landingAngle).toBeGreaterThan(arc.start + margin);
          expect(plan.landingAngle).toBeLessThan(arc.end - margin);
          // The final rotation puts that exact angle under the pointer.
          const under = pointerAngle(plan.toRotation);
          expect(Math.abs(under - plan.landingAngle) < 1e-6 || Math.abs(under - plan.landingAngle) > 360 - 1e-6).toBe(true);
          expect(segmentAtPointer(arcs, plan.toRotation)).toBe(plan.winnerIndex);
          expect(plan.winnerId).toBe(segments[plan.winnerIndex]!.id);
          // Always clockwise, with the promised number of full turns.
          expect(plan.toRotation - plan.fromRotation).toBeGreaterThanOrEqual(plan.turns * 360);
          expect(plan.toRotation - plan.fromRotation).toBeLessThan((plan.turns + 1) * 360);
          from = plan.toRotation;
        }
      });
    }
  }

  it('normalizes a weird starting rotation', () => {
    const segments = wheel([1, 2, 3]);
    for (const from of [-725, 1e7, NaN, Infinity, 359.99999]) {
      const plan = planSpin({ segments, sliceMode: 'weighted', rng: createSeededRng(String(from)), fromRotation: from, durationMs: 5000 });
      expect(plan.fromRotation).toBeGreaterThanOrEqual(0);
      expect(plan.fromRotation).toBeLessThan(360);
      expect(Number.isFinite(plan.toRotation)).toBe(true);
    }
  });

  it('is deterministic for a given RNG sequence', () => {
    const segments = wheel([1, 2, 3, 4]);
    const a = planSpin({ segments, sliceMode: 'equal', rng: createSeededRng('same'), fromRotation: 12, durationMs: 6000 });
    const b = planSpin({ segments, sliceMode: 'equal', rng: createSeededRng('same'), fromRotation: 12, durationMs: 6000 });
    expect(a).toEqual(b);
  });

  it('honours prevent-repeat', () => {
    const segments = wheel([1, 1]);
    const plan = planSpin({ segments, sliceMode: 'equal', rng: fixed(0), fromRotation: 0, durationMs: 4000, previousWinnerId: 's0', preventRepeat: true });
    expect(plan.winnerId).toBe('s1');
  });

  it('winner frequencies follow weights even in equal-slice mode', () => {
    const segments = wheel([1, 4]);
    const rng = createSeededRng('equal-weighted');
    let heavy = 0;
    for (let i = 0; i < 20_000; i++) if (planSpin({ segments, sliceMode: 'equal', rng, fromRotation: 0, durationMs: 3000 }).winnerIndex === 1) heavy++;
    expect(heavy / 20_000).toBeGreaterThan(0.78);
    expect(heavy / 20_000).toBeLessThan(0.82);
  });

  it('works with normalized real-world input (duplicates, zero weights, huge labels)', () => {
    const segments = normalizeSegments([
      { id: 'a', label: 'Pizza', weight: 1, color: '#ff0000', emoji: '', enabled: true },
      { id: 'b', label: 'Pizza', weight: 1, color: '#00ff00', emoji: '', enabled: true },
      { id: 'c', label: 'Nope', weight: 0, color: '#0000ff', emoji: '', enabled: true },
      { id: 'd', label: 'x'.repeat(5000), weight: 2, color: '#ffffff', emoji: '', enabled: true },
    ]);
    expect(segments.map((s) => s.id)).toEqual(['a', 'b', 'd']);
    const rng = createSeededRng('real');
    for (let i = 0; i < 500; i++) {
      const plan = planSpin({ segments, sliceMode: 'weighted', rng, fromRotation: 0, durationMs: 4000 });
      expect(['a', 'b', 'd']).toContain(plan.winnerId);
    }
  });
});

describe('spinTurns', () => {
  it('scales with duration and stays bounded', () => {
    const rng = createSeededRng('turns');
    for (let i = 0; i < 200; i++) {
      const short = spinTurns(2000, rng);
      const long = spinTurns(12_000, rng);
      expect(short).toBeGreaterThanOrEqual(2);
      expect(short).toBeLessThanOrEqual(3);
      expect(long).toBeGreaterThanOrEqual(10);
      expect(long).toBeLessThanOrEqual(11);
    }
    expect(spinTurns(NaN, rng)).toBeGreaterThanOrEqual(2);
  });
});

describe('easing', () => {
  it('starts at 0, ends at exactly 1 and is monotonic', () => {
    expect(spinEase(0)).toBe(0);
    expect(spinEase(-1)).toBe(0);
    expect(spinEase(1)).toBe(1);
    expect(spinEase(2)).toBe(1);
    expect(spinEase(NaN)).toBe(0);
    let prev = 0;
    for (let i = 1; i <= 10_000; i++) {
      const p = spinEase(i / 10_000);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('accelerates first, then decelerates smoothly (C1 at the junction)', () => {
    const a = SPIN_ACCEL;
    expect(spinEase(a - 1e-9)).toBeCloseTo(spinEase(a + 1e-9), 6);
    expect(spinVelocity(a - 1e-9)).toBeCloseTo(spinVelocity(a + 1e-9), 5);
    expect(spinVelocity(a)).toBeCloseTo(SPIN_PEAK_VELOCITY, 9);
    expect(spinVelocity(a / 2)).toBeLessThan(spinVelocity(a));
    expect(spinVelocity(0.5)).toBeLessThan(spinVelocity(a));
    expect(spinVelocity(0.95)).toBeLessThan(spinVelocity(0.5));
    expect(spinVelocity(0.999)).toBeLessThan(0.001 * SPIN_PEAK_VELOCITY + 1e-6);
    expect(spinVelocity(1)).toBe(0);
    // Numerical derivative agrees with the analytic velocity.
    for (const u of [0.02, 0.2, 0.5, 0.8]) {
      const h = 1e-6;
      expect((spinEase(u + h) - spinEase(u - h)) / (2 * h)).toBeCloseTo(spinVelocity(u), 3);
    }
  });

  it('rotationAt follows the plan in server time', () => {
    const spin = { startAt: 10_000, durationMs: 4000, fromRotation: 30, toRotation: 30 + 5 * 360 + 77 };
    expect(rotationAt(spin, 0)).toBe(30);
    expect(rotationAt(spin, 10_000)).toBe(30);
    expect(rotationAt(spin, 14_000)).toBe(spin.toRotation);
    expect(rotationAt(spin, 99_000)).toBe(spin.toRotation);
    const mid = rotationAt(spin, 12_000);
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(spin.toRotation);
    expect(spinProgressAt(spin, 11_000)).toBe(0.25);
    expect(spinProgressAt({ ...spin, durationMs: 0 }, 10_001)).toBe(1);
  });
});
