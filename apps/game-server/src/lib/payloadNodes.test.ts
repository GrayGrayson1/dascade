import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_NODES, exceedsNodeLimit } from './payloadNodes.ts';

/** An array that counts every element read (to prove the guard never walks an oversized payload). */
function countingArray(length: number): { arr: unknown[]; reads: () => number } {
  let reads = 0;
  const arr = new Proxy(new Array<number>(length).fill(1), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { arr, reads: () => reads };
}

describe('exceedsNodeLimit', () => {
  it('counts every object, array and primitive once', () => {
    // root, seq, inputs, 8 frames = 11 values
    const packet = { seq: 1, inputs: [1, 2, 3, 4, 5, 6, 7, 8] };
    expect(exceedsNodeLimit(packet, 11)).toBe(false);
    expect(exceedsNodeLimit(packet, 10)).toBe(true);
    expect(exceedsNodeLimit(null, 1)).toBe(false);
    expect(exceedsNodeLimit(undefined, 1)).toBe(false);
    expect(exceedsNodeLimit('a'.repeat(100_000), 1)).toBe(false); // strings count one (their length is O(1) to check)
    expect(exceedsNodeLimit(new Uint8Array(100_000), 1)).toBe(false);
    expect(exceedsNodeLimit({}, 0)).toBe(true);
    expect(exceedsNodeLimit([[], [[]], { a: { b: [1] } }], 8)).toBe(false);
    expect(exceedsNodeLimit([[], [[]], { a: { b: [1] } }], 7)).toBe(true);
  });

  it('counts Map and Set entries', () => {
    expect(exceedsNodeLimit(new Map([['a', 1]]), 3)).toBe(false);
    expect(exceedsNodeLimit(new Map([['a', 1]]), 2)).toBe(true);
    expect(exceedsNodeLimit(new Set([1, 2]), 3)).toBe(false);
    expect(exceedsNodeLimit(new Set([1, 2]), 2)).toBe(true);
  });

  it('ignores inherited properties', () => {
    const child = Object.create({ inherited: [1, 2, 3, 4, 5] }) as Record<string, unknown>;
    child.own = 1;
    expect(exceedsNodeLimit(child, 2)).toBe(false);
  });

  it('refuses an oversized array without reading its elements', () => {
    const { arr, reads } = countingArray(240_000);
    expect(exceedsNodeLimit({ seq: 1, inputs: arr }, 16)).toBe(true);
    expect(reads()).toBe(0);
  });

  it('reads at most about `limit` values of an oversized nested payload', () => {
    const inner = Array.from({ length: 2_000 }, () => countingArray(8));
    const payload = { events: inner.map((c) => ({ pts: c.arr })) };
    expect(exceedsNodeLimit(payload, 1_500)).toBe(true);
    const total = inner.reduce((sum, c) => sum + c.reads(), 0);
    expect(total).toBeLessThanOrEqual(1_500);
  });

  it('handles deep nesting iteratively and many wide objects', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 50_000; i++) deep = [deep];
    expect(exceedsNodeLimit(deep, 100_001)).toBe(false);
    expect(exceedsNodeLimit(deep, DEFAULT_MAX_NODES)).toBe(true);
    const wide = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${i}`, i]));
    expect(exceedsNodeLimit(wide, DEFAULT_MAX_NODES)).toBe(true);
    expect(exceedsNodeLimit(wide, 50_001)).toBe(false);
  });

  it('is cheap on a full-size hostile frame', () => {
    const hostile = { seq: 1, inputs: new Array<number>(250_000).fill(1) };
    const t0 = performance.now();
    for (let i = 0; i < 1_000; i++) exceedsNodeLimit(hostile, 16);
    // 1,000 checks well under the cost of one Zod parse of the same payload (~20 ms).
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
