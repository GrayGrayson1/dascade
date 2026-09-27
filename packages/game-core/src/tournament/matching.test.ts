import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { maxWeightMatching, type WeightedEdge } from './matching.ts';

/** Exhaustive reference: best (cardinality?, weight) over all matchings. */
function bruteForce(n: number, edges: WeightedEdge[], maxCardinality: boolean): { card: number; weight: number } {
  const adj = new Map<string, number>();
  for (const [i, j, w] of edges) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    adj.set(key, Math.max(adj.get(key) ?? -Infinity, w));
  }
  let best = { card: -1, weight: -Infinity };
  const used = new Array(n).fill(false);
  const rec = (v: number, card: number, weight: number): void => {
    while (v < n && used[v]) v++;
    if (v >= n) {
      const better = maxCardinality
        ? card > best.card || (card === best.card && weight > best.weight)
        : weight > best.weight || (weight === best.weight && card > best.card);
      if (better) best = { card, weight };
      return;
    }
    used[v] = true;
    rec(v + 1, card, weight); // v unmatched
    for (let u = v + 1; u < n; u++) {
      if (used[u]) continue;
      const w = adj.get(`${v}-${u}`);
      if (w === undefined) continue;
      used[u] = true;
      rec(v + 1, card + 1, weight + w);
      used[u] = false;
    }
    used[v] = false;
  };
  rec(0, 0, 0);
  return best;
}

function evaluate(mate: number[], edges: WeightedEdge[]): { card: number; weight: number } {
  const weights = new Map<string, number>();
  for (const [i, j, w] of edges) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    weights.set(key, Math.max(weights.get(key) ?? -Infinity, w));
  }
  let card = 0;
  let weight = 0;
  for (let v = 0; v < mate.length; v++) {
    const u = mate[v]!;
    if (u < 0) continue;
    expect(mate[u]).toBe(v);
    if (v < u) {
      card++;
      const w = weights.get(`${v}-${u}`);
      expect(w).toBeDefined();
      weight += w!;
    }
  }
  return { card, weight };
}

describe('maxWeightMatching', () => {
  it('handles trivial graphs', () => {
    expect(maxWeightMatching([])).toEqual([]);
    expect(maxWeightMatching([[0, 1, 1]])).toEqual([1, 0]);
    expect(maxWeightMatching([[1, 2, 10], [2, 3, 11]])).toEqual([-1, -1, 3, 2]);
    expect(maxWeightMatching([[1, 2, 5], [2, 3, 11], [3, 4, 5]])).toEqual([-1, -1, 3, 2, -1]);
    expect(maxWeightMatching([[1, 2, 5], [2, 3, 11], [3, 4, 5]], true)).toEqual([-1, 2, 1, 4, 3]);
  });

  it('matches the reference test cases (blossoms, nested blossoms, expansion)', () => {
    // van Rantwijk test suite: S-blossom, relabel, nested, expand, etc.
    expect(maxWeightMatching([[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7]])).toEqual([-1, 2, 1, 4, 3]);
    expect(maxWeightMatching([[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7], [1, 6, 5], [4, 5, 6]])).toEqual([-1, 6, 3, 2, 5, 4, 1]);
    expect(maxWeightMatching([[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 4], [1, 6, 3]])).toEqual([-1, 6, 3, 2, 5, 4, 1]);
    expect(maxWeightMatching([[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 3], [1, 6, 4]])).toEqual([-1, 6, 3, 2, 5, 4, 1]);
    expect(maxWeightMatching([[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 3], [3, 6, 4]])).toEqual([-1, 2, 1, 6, 5, 4, 3]);
    expect(maxWeightMatching([[1, 2, 9], [1, 3, 9], [2, 3, 10], [2, 4, 8], [3, 5, 8], [4, 5, 10], [5, 6, 6]])).toEqual([-1, 3, 4, 1, 2, 6, 5]);
    expect(maxWeightMatching([[1, 2, 10], [1, 7, 10], [2, 3, 12], [3, 4, 20], [3, 5, 20], [4, 5, 25], [5, 6, 10], [6, 7, 10], [7, 8, 8]])).toEqual([-1, 2, 1, 4, 3, 6, 5, 8, 7]);
    expect(maxWeightMatching([[1, 2, 8], [1, 3, 8], [2, 3, 10], [2, 4, 12], [3, 5, 12], [4, 5, 14], [4, 6, 12], [5, 7, 12], [6, 7, 14], [7, 8, 12]])).toEqual([-1, 2, 1, 5, 6, 3, 4, 8, 7]);
    expect(maxWeightMatching([[1, 2, 23], [1, 5, 22], [1, 6, 15], [2, 3, 25], [3, 4, 22], [4, 5, 25], [4, 8, 14], [5, 7, 13]])).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4]);
    expect(maxWeightMatching([[1, 2, 19], [1, 3, 20], [1, 8, 8], [2, 3, 25], [2, 4, 18], [3, 5, 18], [4, 5, 13], [4, 7, 7], [5, 6, 7]])).toEqual([-1, 8, 3, 2, 7, 6, 5, 4, 1]);
    expect(maxWeightMatching([[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 35], [5, 7, 26], [9, 10, 5]])).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
    expect(maxWeightMatching([[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 26], [5, 7, 40], [9, 10, 5]])).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
    expect(maxWeightMatching([[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 28], [5, 7, 26], [9, 10, 5]])).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
    expect(maxWeightMatching([[1, 2, 45], [1, 7, 45], [2, 3, 50], [3, 4, 45], [4, 5, 95], [4, 6, 94], [5, 6, 94], [6, 7, 50], [1, 8, 30], [3, 11, 35], [5, 9, 36], [7, 10, 26], [11, 12, 5]])).toEqual([-1, 8, 3, 2, 6, 9, 4, 10, 1, 5, 7, 12, 11]);
    expect(maxWeightMatching([[1, 2, 40], [1, 3, 40], [2, 3, 60], [2, 4, 55], [3, 5, 55], [4, 5, 50], [1, 8, 15], [5, 7, 30], [7, 6, 10], [8, 10, 10], [4, 9, 30]])).toEqual([-1, 2, 1, 5, 9, 3, 7, 6, 10, 4, 8]);
  });

  it('agrees with brute force on random graphs (max weight and max cardinality)', () => {
    const rng = createSeededRng('matching');
    for (let trial = 0; trial < 700; trial++) {
      const n = 2 + rng.int(9); // 2..10 vertices
      const edges: WeightedEdge[] = [];
      const density = 0.3 + rng.next() * 0.7;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (rng.next() < density) edges.push([i, j, rng.int(trial % 3 === 0 ? 5 : 60) + (trial % 5 === 0 ? -20 : 1)]);
        }
      }
      if (edges.length === 0) continue;
      for (const maxCard of [false, true]) {
        const mate = maxWeightMatching(edges, maxCard);
        const got = evaluate(mate, edges);
        const want = bruteForce(n, edges, maxCard);
        if (maxCard) {
          expect(got.card).toBe(want.card);
          expect(got.weight).toBe(want.weight);
        } else {
          expect(got.weight).toBe(want.weight);
        }
      }
    }
  });

  it('stays exact with the large tiered weights the Swiss pairer uses', () => {
    const rng = createSeededRng('big-weights');
    const BASE = 2 ** 46;
    for (let trial = 0; trial < 150; trial++) {
      const n = 4 + rng.int(7);
      const edges: WeightedEdge[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const penalty = rng.int(3) * 2 ** 40 + rng.int(2) * 2 ** 34 + rng.int(900) * 2 ** 18 + rng.int(3) * 2 ** 11 + rng.int(64);
          edges.push([i, j, BASE - penalty]);
        }
      }
      const mate = maxWeightMatching(edges, true);
      const got = evaluate(mate, edges);
      const want = bruteForce(n, edges, true);
      expect(got.card).toBe(want.card);
      expect(got.weight).toBe(want.weight);
    }
  });

  it('finds a perfect matching on a 64-vertex complete graph quickly', () => {
    const rng = createSeededRng('perf');
    const edges: WeightedEdge[] = [];
    for (let i = 0; i < 64; i++) for (let j = i + 1; j < 64; j++) edges.push([i, j, 2 ** 46 - rng.int(2 ** 30)]);
    const started = performance.now();
    const mate = maxWeightMatching(edges, true);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(mate.every((m) => m >= 0)).toBe(true);
  });

  it('rejects malformed edges', () => {
    expect(() => maxWeightMatching([[0, 0, 1]])).toThrow();
    expect(() => maxWeightMatching([[0, 1, 1.5]])).toThrow();
  });
});
