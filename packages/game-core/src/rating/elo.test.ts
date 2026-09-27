import { describe, expect, it } from 'vitest';
import { DEFAULT_RATING, expectedScore, isProvisional, kFactor, newRating, updateElo, type Rating } from './index.ts';

const r = (rating: number, games = 30): Rating => ({ rating, games, wins: 0, losses: 0, draws: 0 });

describe('DASCADE rating (Elo)', () => {
  it('starts provisional at the default rating', () => {
    const fresh = newRating();
    expect(fresh.rating).toBe(DEFAULT_RATING);
    expect(isProvisional(fresh)).toBe(true);
    expect(kFactor(fresh)).toBe(40);
  });

  it('expected scores of both sides sum to 1 and favour the stronger player', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.9);
    expect(expectedScore(1400, 1300) + expectedScore(1300, 1400)).toBeCloseTo(1);
  });

  it('winner gains, loser loses, equal K conserves points', () => {
    const [a, b] = updateElo(r(1500), r(1500), 1);
    expect(a.rating).toBe(1512);
    expect(b.rating).toBe(1488);
    expect(a.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(a.games).toBe(31);
  });

  it('a draw between unequal players moves the favourite down', () => {
    const [strong, weak] = updateElo(r(1800), r(1400), 0.5);
    expect(strong.rating).toBeLessThan(1800);
    expect(weak.rating).toBeGreaterThan(1400);
    expect(strong.draws).toBe(1);
  });

  it('does not mutate inputs and respects the floor', () => {
    const a = r(100);
    const b = r(2000);
    const [na] = updateElo(a, b, 0);
    expect(a.rating).toBe(100);
    expect(na.rating).toBe(100);
  });
});
