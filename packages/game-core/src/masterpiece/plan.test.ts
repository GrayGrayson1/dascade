import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { MP_LIMITS, type MpVoteKind } from '@dascade/shared/games/masterpiece';
import { balancedSizes, planRound, resolveShowdown, roundKind } from './plan.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('roundKind', () => {
  it('uses the fixed modes as-is (ranked falls back to favourite for small groups)', () => {
    expect(roundKind('favourite', 1, 3)).toBe('favourite');
    expect(roundKind('matchups', 2, 30)).toBe('matchup');
    expect(roundKind('ranked', 1, 5)).toBe('ranked');
    expect(roundKind('ranked', 1, 4)).toBe('favourite');
  });

  it('rotates showtime styles by group size', () => {
    expect([1, 2, 3, 4].map((r) => roundKind('showtime', r, 3))).toEqual(['matchup', 'favourite', 'matchup', 'favourite']);
    expect([1, 2, 3, 4].map((r) => roundKind('showtime', r, 6))).toEqual(['matchup', 'favourite', 'ranked', 'matchup']);
    expect([1, 2, 3].map((r) => roundKind('showtime', r, 10))).toEqual(['matchup', 'favourite', 'ranked']);
    expect([1, 2, 3].map((r) => roundKind('showtime', r, 11))).toEqual(['favourite', 'ranked', 'favourite']);
    expect(roundKind('showtime', 0, 6)).toBe('matchup');
  });
});

describe('balancedSizes', () => {
  it('splits evenly with the remainder spread over the first parts', () => {
    expect(balancedSizes(30, 3)).toEqual([10, 10, 10]);
    expect(balancedSizes(11, 2)).toEqual([6, 5]);
    expect(balancedSizes(21, 3)).toEqual([7, 7, 7]);
    expect(balancedSizes(23, 3)).toEqual([8, 8, 7]);
    expect(balancedSizes(5, 0)).toEqual([]);
  });
});

function countAppearances(groups: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of groups) for (const id of g) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

describe('planRound', () => {
  it('head-to-head for 3–8 writers: everyone answers two prompts, every pair is distinct', () => {
    for (let n = 3; n <= MP_LIMITS.matchupDoubleMax; n++) {
      for (const seed of ['a', 'b', 'c']) {
        const plan = planRound(ids(n), 'matchup', createSeededRng(`${seed}${n}`));
        expect(plan.perWriter).toBe(2);
        expect(plan.groups).toHaveLength(n);
        const counts = countAppearances(plan.groups);
        expect(counts.size).toBe(n);
        for (const c of counts.values()) expect(c).toBe(2);
        const pairs = plan.groups.map((g) => {
          expect(g).toHaveLength(2);
          expect(g[0]).not.toBe(g[1]);
          return [...g].sort().join('|');
        });
        expect(new Set(pairs).size).toBe(n);
      }
    }
  });

  it('head-to-head for bigger groups: one prompt each, pairs plus a trio when odd', () => {
    for (let n = MP_LIMITS.matchupDoubleMax + 1; n <= 30; n++) {
      const plan = planRound(ids(n), 'matchup', createSeededRng(n));
      expect(plan.perWriter).toBe(1);
      const counts = countAppearances(plan.groups);
      expect(counts.size).toBe(n);
      for (const c of counts.values()) expect(c).toBe(1);
      const sizes = plan.groups.map((g) => g.length).sort();
      if (n % 2 === 0) expect(sizes.every((s) => s === 2)).toBe(true);
      else expect(sizes.filter((s) => s === 3)).toHaveLength(1);
      // Every matchup leaves at least one voter.
      for (const g of plan.groups) expect(n - g.length).toBeGreaterThan(0);
    }
  });

  it('galleries: everyone once, at most galleryMax per gallery, balanced', () => {
    for (const kind of ['favourite', 'ranked'] as MpVoteKind[]) {
      for (let n = 3; n <= 30; n++) {
        const plan = planRound(ids(n), kind, createSeededRng(`${kind}${n}`));
        expect(plan.perWriter).toBe(1);
        expect(plan.groups).toHaveLength(Math.ceil(n / MP_LIMITS.galleryMax));
        const counts = countAppearances(plan.groups);
        expect(counts.size).toBe(n);
        const sizes = plan.groups.map((g) => g.length);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(MP_LIMITS.galleryMax);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('shuffles writers with the rng (join order does not predict pairings)', () => {
    const signature = (seed: string) => planRound(ids(6), 'matchup', createSeededRng(seed)).groups.map((g) => g.join('-')).join(',');
    const variants = new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map(signature));
    expect(variants.size).toBeGreaterThan(4);
    expect(signature('same')).toBe(signature('same'));
  });

  it('handles degenerate inputs', () => {
    expect(planRound([], 'matchup', createSeededRng(1)).groups).toEqual([]);
    expect(planRound(['a', 'a', 'b'], 'favourite', createSeededRng(1)).groups.flat().sort()).toEqual(['a', 'b']);
  });
});

describe('resolveShowdown', () => {
  const e = (authorId: string, text: string | null) => ({ authorId, text });

  it('skips a showdown nobody answered', () => {
    expect(resolveShowdown('matchup', [e('a', null), e('b', null)]).format).toBe('empty');
    expect(resolveShowdown('favourite', [e('a', null)]).format).toBe('empty');
  });

  it('turns a lone head-to-head answer into a walkover that still shows the blank', () => {
    const r = resolveShowdown('matchup', [e('a', 'Hello'), e('b', null)]);
    expect(r.format).toBe('walkover');
    expect(r.entries).toEqual([e('a', 'Hello'), e('b', null)]);
  });

  it('drops blanks from a trio and from galleries', () => {
    const trio = resolveShowdown('matchup', [e('a', 'x'), e('b', null), e('c', 'y')]);
    expect(trio.format).toBe('matchup');
    expect(trio.entries.map((x) => x.authorId)).toEqual(['a', 'c']);
    const gallery = resolveShowdown('favourite', [e('a', 'x'), e('b', null), e('c', 'y'), e('d', '')]);
    expect(gallery.format).toBe('favourite');
    expect(gallery.entries.map((x) => x.authorId)).toEqual(['a', 'c']);
    expect(resolveShowdown('favourite', [e('a', 'x'), e('b', null)]).entries).toEqual([e('a', 'x')]);
  });

  it('downgrades a small ranked gallery to a favourite vote', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => e(id, id));
    expect(resolveShowdown('ranked', four).format).toBe('favourite');
    expect(resolveShowdown('ranked', [...four, e('z', 'z')]).format).toBe('ranked');
  });
});
