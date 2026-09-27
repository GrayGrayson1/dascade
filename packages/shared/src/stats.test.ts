import { describe, expect, it } from 'vitest';
import {
  STAT_EXTRA_LABELS,
  STAT_LIMITS,
  StatsQuerySchema,
  formatStatDuration,
  isDurationStat,
  mergeStatExtras,
  statAggregation,
  statExtraLabel,
} from './stats.ts';

describe('stat extras aggregation', () => {
  it('picks the aggregation from the key prefix', () => {
    expect(statAggregation('maxCombo')).toBe('max');
    expect(statAggregation('bestStreak')).toBe('max');
    expect(statAggregation('minHoleStrokes')).toBe('min');
    expect(statAggregation('fewestMoves')).toBe('min');
    expect(statAggregation('correctAnswers')).toBe('sum');
    // A word that merely starts with the letters is a sum ("maximal" isn't a prefix + capital).
    expect(statAggregation('maximum')).toBe('sum');
    expect(statAggregation('minutes')).toBe('sum');
  });

  it('sums, keeps max and keeps min', () => {
    let t = mergeStatExtras({}, { correctAnswers: 3, maxCombo: 4, minHoleStrokes: 3 });
    t = mergeStatExtras(t, { correctAnswers: 5, maxCombo: 2, minHoleStrokes: 1 });
    t = mergeStatExtras(t, { correctAnswers: 1, maxCombo: 9, minHoleStrokes: 2 });
    expect(t).toEqual({ correctAnswers: 9, maxCombo: 9, minHoleStrokes: 1 });
  });

  it('ignores malformed keys and non-finite values and does not mutate its input', () => {
    const base = { a: 1 };
    const t = mergeStatExtras(base, { 'bad key': 1, '1abc': 2, nan: Number.NaN, inf: Number.POSITIVE_INFINITY, a: 2 } as Record<
      string,
      number
    >);
    expect(t).toEqual({ a: 3 });
    expect(base).toEqual({ a: 1 });
  });

  it('bounds the number of keys and the magnitude of values', () => {
    let t: Record<string, number> = {};
    for (let i = 0; i < STAT_LIMITS.extrasPerGame + 10; i++) t = mergeStatExtras(t, { [`k${i}`]: 1 });
    expect(Object.keys(t)).toHaveLength(STAT_LIMITS.extrasPerGame);
    const big = mergeStatExtras({ total: STAT_LIMITS.maxValue }, { total: STAT_LIMITS.maxValue });
    expect(big.total).toBe(STAT_LIMITS.maxValue);
    expect(mergeStatExtras({}, { neg: -1e12 }).neg).toBe(-STAT_LIMITS.maxValue);
  });

  it('labels known and unknown extras', () => {
    expect(statExtraLabel('correctAnswers')).toBe('Correct answers');
    expect(statExtraLabel('maxBounces')).toBe('Best bounces');
    expect(statExtraLabel('fewestShots')).toBe('Fewest shots');
    expect(statExtraLabel('powerUpsCollected')).toBe('Power ups collected');
  });

  it('labels the original cabinets’ extras and aggregates them the intended way', () => {
    expect(statExtraLabel('minLapMs')).toBe('Best lap');
    expect(statExtraLabel('bestPot')).toBe('Biggest pot');
    expect(statExtraLabel('questsCompleted')).toBe('Quests completed');
    // "Biggest…" values keep the highest, times keep the lowest, counts add up.
    expect(statAggregation('bestPot')).toBe('max');
    expect(statAggregation('bestWin')).toBe('max');
    expect(statAggregation('minLapMs')).toBe('min');
    expect(statAggregation('minGuessMs')).toBe('min');
    const counts = ['correctGuesses', 'drawingsGuessed', 'handsWon', 'handsPlayed', 'blackjacks', 'chipsWagered', 'bingos'];
    for (const key of [...counts, 'fastestLaps', 'questsCompleted', 'checksPassed', 'crits']) {
      expect(statAggregation(key)).toBe('sum');
      expect(STAT_EXTRA_LABELS[key]).toBeTruthy();
    }
  });

  it('formats duration extras', () => {
    expect(isDurationStat('minLapMs')).toBe(true);
    expect(isDurationStat('minGuessMs')).toBe(true);
    expect(isDurationStat('handsWon')).toBe(false);
    expect(isDurationStat('items')).toBe(false);
    expect(formatStatDuration(3_412)).toBe('3.41 s');
    expect(formatStatDuration(83_452)).toBe('1:23.452');
    expect(formatStatDuration(0)).toBe('–');
  });
});

describe('stats query', () => {
  it('accepts guest ids and rejects junk', () => {
    expect(StatsQuerySchema.safeParse({ guestId: 'g_0123456789abcdef01234567' }).success).toBe(true);
    expect(StatsQuerySchema.safeParse({}).success).toBe(true);
    expect(StatsQuerySchema.safeParse({ guestId: 'g_<script>' }).success).toBe(false);
    expect(StatsQuerySchema.safeParse({ guestId: 'x'.repeat(65) }).success).toBe(false);
  });
});
