import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoiseSpec, ToneSpec } from '../../audio/voices.ts';
import {
  AMBIENCE,
  AMBIENCE_EVENTS,
  AMBIENCE_MAX_GAIN,
  AMBIENCE_MAX_NOISE_S,
  firstDelayMs,
  nextDelayMs,
  startAmbience,
  type AmbienceEventName,
} from './ambienceCore.ts';

/** Deterministic 0..1 sequence (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function harness(opts: { canPlay?: () => boolean; level?: number; seed?: number } = {}) {
  const played: Array<{ name: AmbienceEventName; at: number }> = [];
  const stop = startAmbience({
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    random: seeded(opts.seed ?? 7),
    canPlay: opts.canPlay ?? (() => true),
    play: (name) => played.push({ name, at: Date.now() }),
    level: () => opts.level ?? 0,
  });
  return { played, stop };
}

const gaps = (played: Array<{ at: number }>) => played.slice(1).map((p, i) => p.at - played[i]!.at);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('Halloween Night floor ambience: schedule', () => {
  it('waits 15–30 s after arriving before the first sound', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      vi.setSystemTime(0);
      const h = harness({ seed });
      vi.advanceTimersByTime(14_999);
      expect(h.played).toHaveLength(0);
      vi.advanceTimersByTime(15_001);
      expect(h.played).toHaveLength(1);
      h.stop();
    }
  });

  it('spaces sounds 40–90 s apart, up to 30% more often at full haunt', () => {
    const calm = harness({ seed: 11 });
    vi.advanceTimersByTime(4 * 3_600_000);
    for (const g of gaps(calm.played)) {
      expect(g).toBeGreaterThanOrEqual(40_000);
      expect(g).toBeLessThanOrEqual(90_000);
    }
    calm.stop();
    const haunted = harness({ seed: 11, level: 1 });
    vi.advanceTimersByTime(4 * 3_600_000);
    for (const g of gaps(haunted.played)) {
      expect(g).toBeGreaterThanOrEqual(28_000);
      expect(g).toBeLessThanOrEqual(63_000);
    }
    expect(haunted.played.length).toBeGreaterThan(calm.played.length);
    haunted.stop();
  });

  it('never plays the same sound twice in a row, and uses all four', () => {
    const h = harness({ seed: 3 });
    vi.advanceTimersByTime(6 * 3_600_000);
    expect(h.played.length).toBeGreaterThan(100);
    for (let i = 1; i < h.played.length; i++) expect(h.played[i]!.name).not.toBe(h.played[i - 1]!.name);
    expect(new Set(h.played.map((p) => p.name))).toEqual(new Set(AMBIENCE_EVENTS));
    h.stop();
  });

  it('skips sounds it may not play right now, without catching up later', () => {
    let ok = false;
    const h = harness({ canPlay: () => ok, seed: 5 });
    vi.advanceTimersByTime(600_000);
    expect(h.played).toHaveLength(0);
    ok = true;
    vi.advanceTimersByTime(0);
    expect(h.played).toHaveLength(0);
    vi.advanceTimersByTime(90_000);
    expect(h.played.length).toBeGreaterThanOrEqual(1);
    expect(h.played.length).toBeLessThanOrEqual(2);
    h.stop();
  });

  it('stop() leaves no timer behind', () => {
    const h = harness();
    vi.advanceTimersByTime(200_000);
    h.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(h.played.length).toBeLessThanOrEqual(5);
  });

  it('clamps its inputs', () => {
    expect(firstDelayMs(0)).toBe(15_000);
    expect(firstDelayMs(0.999)).toBeLessThanOrEqual(30_000);
    expect(nextDelayMs(0, 0)).toBe(40_000);
    expect(nextDelayMs(0, 0.999)).toBeLessThanOrEqual(90_000);
    expect(nextDelayMs(1, 0)).toBe(28_000);
    expect(nextDelayMs(5, 0.5)).toBe(nextDelayMs(1, 0.5));
    expect(nextDelayMs(Number.NaN, 0.5)).toBe(nextDelayMs(0, 0.5));
  });
});

describe('Halloween Night floor ambience: sounds', () => {
  for (const name of AMBIENCE_EVENTS) {
    it(`${name} stays quiet (never dips the jukebox) and fits the 1 s noise buffer`, () => {
      const tones: ToneSpec[] = [];
      const noises: NoiseSpec[] = [];
      AMBIENCE[name]({ tone: (o) => tones.push(o), noise: (o) => noises.push(o), note: (n) => 440 * Math.pow(2, (n - 69) / 12) });
      expect(tones.length + noises.length).toBeGreaterThan(0);
      for (const o of [...tones, ...noises]) {
        expect(o.gain).toBeDefined();
        expect(o.gain!).toBeLessThanOrEqual(AMBIENCE_MAX_GAIN);
        expect(o.gain!).toBeLessThan(0.04);
        expect(o.attack ?? 0).toBeLessThan(o.dur);
      }
      for (const n of noises) expect(n.dur).toBeLessThanOrEqual(AMBIENCE_MAX_NOISE_S);
    });
  }
});
