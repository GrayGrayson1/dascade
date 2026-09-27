import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { MAX_ROUNDS, RoundJudge, TAP_POINTS, generatePattern, kindFor, roundClearPoints, roundSpec } from './index.ts';

describe('round specs', () => {
  it('grow in length, speed and grid size', () => {
    const r1 = roundSpec('sequence', 1);
    const r10 = roundSpec('sequence', 10);
    expect(r1).toMatchObject({ kind: 'sequence', size: 3, count: 3 });
    expect(r10.count).toBeGreaterThan(r1.count);
    expect(r10.stepMs).toBeLessThan(r1.stepMs);
    expect(r10.size).toBe(4);
    expect(roundSpec('sequence', 20).size).toBe(5);
    expect(roundSpec('flash', 1)).toMatchObject({ kind: 'flash', size: 3, gapMs: 0 });
    expect(roundSpec('flash', 12).size).toBe(5);
  });

  it('keeps every spec playable (bounded counts and windows)', () => {
    for (const v of ['sequence', 'flash', 'mixed'] as const) {
      for (let r = 1; r <= MAX_ROUNDS + 5; r++) {
        const s = roundSpec(v, r);
        expect(s.count).toBeGreaterThanOrEqual(3);
        expect(s.count).toBeLessThanOrEqual(s.size * s.size - (s.kind === 'flash' ? 3 : 0) + (s.kind === 'sequence' ? 99 : 0));
        expect(s.inputMs).toBeGreaterThan(2000);
        expect(s.inputMs).toBeLessThanOrEqual(16_000);
        expect(s.showMs).toBeGreaterThan(0);
        if (s.kind === 'sequence') expect(s.showMs).toBe(s.count * s.stepMs + (s.count - 1) * s.gapMs);
      }
    }
  });

  it('mixed alternates sequence and flash', () => {
    expect(kindFor('mixed', 1)).toBe('sequence');
    expect(kindFor('mixed', 2)).toBe('flash');
    expect(kindFor('flash', 1)).toBe('flash');
  });
});

describe('pattern generation', () => {
  it('sequences stay on the grid and never repeat a tile back-to-back', () => {
    const rng = createSeededRng('seq');
    for (let r = 1; r <= 30; r++) {
      const spec = roundSpec('sequence', r);
      const p = generatePattern(spec, rng);
      expect(p).toHaveLength(spec.count);
      for (let i = 0; i < p.length; i++) {
        expect(p[i]).toBeGreaterThanOrEqual(0);
        expect(p[i]).toBeLessThan(spec.size * spec.size);
        if (i > 0) expect(p[i]).not.toBe(p[i - 1]);
      }
    }
  });

  it('flash patterns are distinct tiles; same seed → same pattern', () => {
    const spec = roundSpec('flash', 8);
    const a = generatePattern(spec, createSeededRng('f'));
    const b = generatePattern(spec, createSeededRng('f'));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('RoundJudge', () => {
  it('accepts the sequence in order and scores a clear with a speed bonus', () => {
    const spec = roundSpec('sequence', 2);
    const judge = new RoundJudge(spec, [0, 4, 8, 2]);
    expect(judge.tap(0, 100)).toMatchObject({ ok: true, progress: 1, done: false, points: TAP_POINTS });
    judge.tap(4, 200);
    judge.tap(8, 300);
    const last = judge.tap(2, 400);
    expect(last).toMatchObject({ ok: true, done: true });
    if (last.ok) expect(last.points).toBe(TAP_POINTS + roundClearPoints(spec, 400));
    expect(judge.points).toBe(4 * TAP_POINTS + roundClearPoints(spec, 400));
    expect(judge.tap(1, 500)).toMatchObject({ ok: false, reason: 'closed' });
  });

  it('a wrong tap fails the round and closes it', () => {
    const judge = new RoundJudge(roundSpec('sequence', 1), [3, 5, 1]);
    judge.tap(3, 10);
    expect(judge.tap(1, 20)).toMatchObject({ ok: false, reason: 'wrong', progress: 1 });
    expect(judge.failed).toBe(true);
    expect(judge.tap(5, 30)).toMatchObject({ ok: false, reason: 'closed' });
    expect(judge.timeout()).toBe(false);
  });

  it('flash rounds accept any order and ignore repeats', () => {
    const judge = new RoundJudge(roundSpec('flash', 2), [1, 5, 7]);
    expect(judge.tap(7, 10).ok).toBe(true);
    expect(judge.tap(7, 20)).toMatchObject({ ok: false, reason: 'repeat' });
    expect(judge.failed).toBe(false);
    judge.tap(1, 30);
    expect(judge.tap(5, 40)).toMatchObject({ ok: true, done: true });
  });

  it('rejects taps off the grid without failing; timeouts fail open rounds', () => {
    const judge = new RoundJudge(roundSpec('sequence', 1), [0, 1, 2]);
    expect(judge.tap(9, 10)).toMatchObject({ ok: false, reason: 'range' });
    expect(judge.tap(-1, 10)).toMatchObject({ ok: false, reason: 'range' });
    expect(judge.failed).toBe(false);
    expect(judge.timeout()).toBe(true);
    expect(judge.failed).toBe(true);
  });

  it('faster answers score more', () => {
    const spec = roundSpec('sequence', 5);
    expect(roundClearPoints(spec, 0)).toBeGreaterThan(roundClearPoints(spec, spec.inputMs / 2));
    expect(roundClearPoints(spec, spec.inputMs * 2)).toBe(100 * 5);
  });
});
