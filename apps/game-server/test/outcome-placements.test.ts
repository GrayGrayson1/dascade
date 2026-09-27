import { describe, expect, it } from 'vitest';
import { groupSorted, withLeaversLast } from '../src/rooms/outcomePlacements.ts';

describe('outcome placement helpers', () => {
  const rows = [
    { id: 'a', score: 9 },
    { id: 'b', score: 7 },
    { id: 'c', score: 7 },
    { id: 'd', score: 1 },
  ];

  it('groups neighbours that tie into one place, best first', () => {
    expect(groupSorted(rows, (r) => r.id, (x, y) => x.score === y.score)).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(groupSorted([], (r: { id: string }) => r.id, () => true)).toEqual([]);
  });

  it('appends leavers as one last group, never twice and never an empty group', () => {
    expect(withLeaversLast([['a'], [], ['b']], ['z', 'a', 'z', 'y'])).toEqual([['a'], ['b'], ['z', 'y']]);
    expect(withLeaversLast([['a']], [])).toEqual([['a']]);
    expect(withLeaversLast([], ['z'])).toEqual([['z']]);
  });
});
