import { describe, expect, it } from 'vitest';
import { parseBestDoc } from './bestDoc.ts';

describe('parseBestDoc', () => {
  it('keeps a valid personal best', () => {
    const doc = { trackId: 'neon-loop', lapMs: 41_230, splits: [9_000, 20_100, 30_500], raceMs: 130_000, laps: 3, savedAt: 1 };
    expect(parseBestDoc(doc, 'neon-loop')).toEqual(doc);
  });

  it.each([null, 'x', 42, [], {}, { trackId: 'neon-loop' }, { trackId: 'neon-loop', lapMs: 'fast', splits: [] }, { trackId: 'neon-loop', lapMs: 0 }])(
    'treats %j as no personal best',
    (raw) => expect(parseBestDoc(raw, 'neon-loop')).toBeNull(),
  );

  it("ignores another track's record and repairs junk splits", () => {
    expect(parseBestDoc({ trackId: 'other', lapMs: 5, splits: [], savedAt: 1 }, 'neon-loop')).toBeNull();
    expect(parseBestDoc({ trackId: 'neon-loop', lapMs: 5_000, splits: 'nope', savedAt: 'then' }, 'neon-loop')).toEqual({
      trackId: 'neon-loop',
      lapMs: 5_000,
      splits: [],
      savedAt: 0,
    });
    expect(parseBestDoc({ trackId: 'neon-loop', lapMs: 5_000, splits: [1, null, -3, 4], savedAt: 2 }, 'neon-loop')?.splits).toEqual([1, 0, 0, 4]);
  });
});
