import { describe, expect, it } from 'vitest';
import { KART_GHOST_MAX_BYTES } from '@dascade/shared/games/kart';
import { ghostDocBytes, mergeBest, parseBest, parseGhostDoc, type KartGhostDoc } from './docs.ts';
import { fitProjection } from './hud/minimap.ts';
import { resampleTrace } from './net/netClient.ts';

describe('personal bests', () => {
  it('rejects malformed or foreign docs', () => {
    expect(parseBest(null, 'pixel-plaza')).toBeNull();
    expect(parseBest({ v: 1, trackId: 'dune-drift', race: { '3': 90_000 }, lapMs: 30_000 }, 'pixel-plaza')).toBeNull();
    expect(parseBest({ v: 2, trackId: 'pixel-plaza', race: {}, lapMs: 30_000 }, 'pixel-plaza')).toBeNull();
    expect(parseBest({ v: 1, trackId: 'pixel-plaza', race: { x: 1 }, lapMs: -3 }, 'pixel-plaza')).toBeNull();
  });
  it('keeps only valid lap counts and times', () => {
    const d = parseBest(
      { v: 1, trackId: 'pixel-plaza', race: { '3': 120_000, '9': 1, '1': 'nope', '2': Infinity }, lapMs: 39_000 },
      'pixel-plaza',
    )!;
    expect(d.race).toEqual({ '3': 120_000 });
    expect(d.lapMs).toBe(39_000);
  });
  it('merges a run: race PB per lap count, lap PB across all', () => {
    const a = mergeBest(null, 'pixel-plaza', 3, 120_000, 39_000, 1);
    expect(a).toMatchObject({ racePb: true, lapPb: true });
    const b = mergeBest(a.doc, 'pixel-plaza', 3, 121_000, 38_500, 2);
    expect(b).toMatchObject({ racePb: false, lapPb: true });
    expect(b.doc.race['3']).toBe(120_000);
    const c = mergeBest(b.doc, 'pixel-plaza', 1, 41_000, 41_000, 3);
    expect(c.racePb).toBe(true);
    expect(c.lapPb).toBe(false);
    expect(c.doc.race).toEqual({ '3': 120_000, '1': 41_000 });
  });
});

describe('ghost docs', () => {
  const good: KartGhostDoc = {
    v: 1,
    trackId: 'pixel-plaza',
    laps: 3,
    raceMs: 120_000,
    racer: 'nova',
    body: 'buggy',
    paint: '#f97316',
    data: '{"v":1}',
  };
  it('validates shape, look and track', () => {
    expect(parseGhostDoc(good, 'pixel-plaza')).toEqual(good);
    expect(parseGhostDoc(good, 'dune-drift')).toBeNull();
    expect(parseGhostDoc({ ...good, racer: 'mario' }, 'pixel-plaza')).toBeNull();
    expect(parseGhostDoc({ ...good, paint: 'red' }, 'pixel-plaza')).toBeNull();
    expect(parseGhostDoc({ ...good, laps: 9 }, 'pixel-plaza')).toBeNull();
    expect(parseGhostDoc({ ...good, data: 5 }, 'pixel-plaza')).toBeNull();
  });
  it('respects the size cap', () => {
    const big = { ...good, data: 'x'.repeat(KART_GHOST_MAX_BYTES) };
    expect(ghostDocBytes(big)).toBeGreaterThan(KART_GHOST_MAX_BYTES);
    expect(parseGhostDoc(big, 'pixel-plaza')).toBeNull();
  });
});

describe('resampleTrace', () => {
  it('puts sample i exactly i·every ticks after GO', () => {
    const trace = [0, 3, 6, 9, 12, 15].map((t) => ({ tick: 100 + t, x: t, y: 0, z: 0, heading: 0 }));
    const out = resampleTrace(trace, 101, 6);
    expect(out.map((p) => p.tick)).toEqual([101, 107, 113]);
    expect(out.map((p) => p.x)).toEqual([1, 7, 13]);
  });
  it('needs a trace and a GO tick', () => {
    expect(resampleTrace([], 0, 6)).toEqual([]);
    expect(resampleTrace([{ tick: 1, x: 0, y: 0, z: 0, heading: 0 }], -1, 6)).toEqual([]);
  });
});

describe('fitProjection', () => {
  it('fits and flips y (track y up → canvas y down)', () => {
    const { project } = fitProjection([{ xs: [0, 100], ys: [0, 50], closed: false }], 220, 120, 10);
    const [x0, y0] = project(0, 0);
    const [x1, y1] = project(100, 50);
    expect(x0).toBeCloseTo(10);
    expect(x1).toBeCloseTo(210);
    expect(y0).toBeGreaterThan(y1);
  });
});
