import { describe, expect, it } from 'vitest';
import { countVotes, leaders, rankSlots, sharePercents, spread } from './tally.ts';

describe('countVotes', () => {
  it('counts votes per option', () => {
    expect(countVotes([0, 1, 1, 2, 1], 3)).toEqual([1, 3, 1]);
  });
  it('ignores out-of-range and non-integer votes', () => {
    expect(countVotes([0, 5, -1, 1.5, Number.NaN, 1], 2)).toEqual([1, 1]);
  });
  it('returns zeros when nobody voted', () => {
    expect(countVotes([], 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('sharePercents', () => {
  it('rounds to one decimal', () => {
    expect(sharePercents([1, 2])).toEqual([33.3, 66.7]);
    expect(sharePercents([1, 1, 1])).toEqual([33.3, 33.3, 33.3]);
    expect(sharePercents([3, 1])).toEqual([75, 25]);
  });
  it('handles an empty tally', () => {
    expect(sharePercents([0, 0])).toEqual([0, 0]);
  });
  it('covers 30 voters exactly', () => {
    expect(sharePercents([10, 20])).toEqual([33.3, 66.7]);
    expect(sharePercents([15, 15])).toEqual([50, 50]);
  });
});

describe('leaders', () => {
  it('returns the single leader', () => {
    expect(leaders([1, 4, 2])).toEqual([1]);
  });
  it('returns every tied leader', () => {
    expect(leaders([3, 1, 3, 0])).toEqual([0, 2]);
    expect(leaders([1, 1, 1])).toEqual([0, 1, 2]);
  });
  it('is empty with no votes', () => {
    expect(leaders([0, 0, 0])).toEqual([]);
  });
});

describe('rankSlots', () => {
  it('orders by votes with unique ranks', () => {
    expect(rankSlots([1, 5, 3])).toEqual([
      { option: 1, lo: 1, hi: 1 },
      { option: 2, lo: 2, hi: 2 },
      { option: 0, lo: 3, hi: 3 },
    ]);
  });
  it('gives tied options a shared range and keeps question order inside a tie', () => {
    expect(rankSlots([2, 0, 2, 1, 0])).toEqual([
      { option: 0, lo: 1, hi: 2 },
      { option: 2, lo: 1, hi: 2 },
      { option: 3, lo: 3, hi: 3 },
      { option: 1, lo: 4, hi: 5 },
      { option: 4, lo: 4, hi: 5 },
    ]);
  });
  it('treats an all-tied tally as one range', () => {
    expect(rankSlots([1, 1, 1]).map((s) => [s.lo, s.hi])).toEqual([
      [1, 3],
      [1, 3],
      [1, 3],
    ]);
  });
});

describe('spread', () => {
  it('returns the top share and the lead over the runner-up', () => {
    expect(spread([6, 3, 1])).toEqual({ top: 60, margin: 30 });
    expect(spread([2, 2])).toEqual({ top: 50, margin: 0 });
    expect(spread([3])).toEqual({ top: 100, margin: 100 });
    expect(spread([0, 0])).toEqual({ top: 0, margin: 0 });
  });
});
