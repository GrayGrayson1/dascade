import { describe, expect, it } from 'vitest';
import { HAUNT_RECHECK_MAX_MS, hauntBudget, hauntLevel, msUntilHauntCheck, type HauntLevel } from './haunt.ts';
import type { SkinRenderContext } from '../types.ts';

// Local-time dates (the haunting follows the player's own clock), away from DST switch hours.
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe('hauntLevel', () => {
  it('is calm by day and spooky after dark', () => {
    expect(hauntLevel(at(2026, 10, 6, 12))).toBe(0);
    expect(hauntLevel(at(2026, 10, 6, 17, 59))).toBe(0);
    expect(hauntLevel(at(2026, 10, 6, 18))).toBe(1);
    expect(hauntLevel(at(2026, 10, 7, 5, 59))).toBe(1);
    expect(hauntLevel(at(2026, 10, 7, 6))).toBe(0);
    expect(hauntLevel(at(2026, 10, 30, 23))).toBe(1);
  });

  it('peaks on Halloween night and keeps going until dawn on Nov 1', () => {
    expect(hauntLevel(at(2026, 10, 31, 12))).toBe(1);
    expect(hauntLevel(at(2026, 10, 31, 18))).toBe(2);
    expect(hauntLevel(at(2026, 10, 31, 23, 59))).toBe(2);
    expect(hauntLevel(at(2025, 11, 1, 0, 30))).toBe(2);
    expect(hauntLevel(at(2025, 11, 1, 6))).toBe(0);
    expect(hauntLevel(at(2031, 10, 31, 20))).toBe(2);
  });

  it('works outside October too (the theme stays in the picker all year)', () => {
    expect(hauntLevel(at(2027, 3, 14, 21))).toBe(1);
    expect(hauntLevel(at(2027, 3, 14, 9))).toBe(0);
  });

  it('treats an invalid date as daytime', () => {
    expect(hauntLevel(new Date(Number.NaN))).toBe(0);
  });
});

describe('msUntilHauntCheck', () => {
  it('wakes at the next boundary, at most every five minutes, never sooner than a second', () => {
    expect(msUntilHauntCheck(at(2026, 10, 6, 17, 59))).toBe(60_000);
    expect(msUntilHauntCheck(at(2026, 10, 6, 12))).toBe(HAUNT_RECHECK_MAX_MS);
    expect(msUntilHauntCheck(at(2026, 10, 6, 23, 58))).toBe(2 * 60_000);
    expect(msUntilHauntCheck(at(2026, 10, 7, 5, 57))).toBe(3 * 60_000);
    expect(msUntilHauntCheck(new Date(2026, 9, 6, 17, 59, 59, 900))).toBe(1000);
    expect(msUntilHauntCheck(new Date(Number.NaN))).toBe(HAUNT_RECHECK_MAX_MS);
  });
});

describe('hauntBudget', () => {
  const ctx = (o: Partial<SkinRenderContext> = {}): SkinRenderContext => ({ fx: 'high', reducedMotion: false, place: 'floor', ...o });
  const levels: HauntLevel[] = [0, 1, 2];

  it('never animates in a game, at MINIMAL effects or with reduced motion', () => {
    for (const level of levels) {
      expect(hauntBudget(level, ctx({ place: 'game' }))).toEqual({ fps: 0, ghosts: 0, bats: 0, leaves: 0, fog: 0.35 });
      expect(hauntBudget(level, ctx({ fx: 'off' })).fps).toBe(0);
      expect(hauntBudget(level, ctx({ reducedMotion: true })).fps).toBe(0);
      expect(hauntBudget(level, ctx({ reducedMotion: true })).leaves).toBe(0);
      expect(hauntBudget(level, ctx({ fx: 'off' })).bats).toBe(0);
    }
  });

  it('caps REDUCED effects and quieter places', () => {
    for (const level of levels) {
      const low = hauntBudget(level, ctx({ fx: 'low' }));
      expect(low.fps).toBe(12);
      expect(low.ghosts).toBeLessThanOrEqual(1);
      expect(low.bats).toBeLessThanOrEqual(2);
      for (const place of ['lobby', 'cabinet', 'entry', 'tournament', 'other'] as const) {
        const b = hauntBudget(level, ctx({ place }));
        expect(b.ghosts).toBeLessThanOrEqual(1);
        expect(b.bats).toBeLessThanOrEqual(2);
        expect(b.leaves).toBeLessThanOrEqual(3);
      }
    }
  });

  it('gets spookier (never calmer) as the night goes on', () => {
    for (const o of [ctx(), ctx({ fx: 'low' }), ctx({ place: 'lobby' }), ctx({ fx: 'off' }), ctx({ reducedMotion: true })]) {
      const [a, b, c] = levels.map((level) => hauntBudget(level, o));
      for (const key of ['ghosts', 'bats', 'leaves', 'fog'] as const) {
        expect(b![key]).toBeGreaterThanOrEqual(a![key]);
        expect(c![key]).toBeGreaterThanOrEqual(b![key]);
      }
    }
    expect(hauntBudget(2, ctx()).ghosts).toBeGreaterThan(hauntBudget(0, ctx()).ghosts);
  });
});
