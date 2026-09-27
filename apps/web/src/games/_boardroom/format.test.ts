import { describe, expect, it } from 'vitest';
import { formatClock, lowTimeMs } from './format.ts';

describe('boardroom clock formatting', () => {
  it('shows tenths under ten seconds, m:ss below an hour, h:mm:ss above', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(-50)).toBe('0:00.0');
    expect(formatClock(9_870)).toBe('0:09.8');
    expect(formatClock(10_000)).toBe('0:10');
    expect(formatClock(59_999)).toBe('0:59');
    expect(formatClock(5 * 60_000)).toBe('5:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('warns at 10% of the base time, clamped to 10–30 s', () => {
    expect(lowTimeMs({ baseMs: 60_000 })).toBe(10_000);
    expect(lowTimeMs({ baseMs: 180_000 })).toBe(18_000);
    expect(lowTimeMs({ baseMs: 900_000 })).toBe(30_000);
  });
});
