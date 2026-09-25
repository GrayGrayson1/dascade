import { describe, expect, it } from 'vitest';
import { ARTIST_SHARE, GUESS_MIN_POINTS, GUESS_SPEED_POINTS, RANK_BONUS, artistShare, guessPoints, rankStandings } from './scoring.ts';

describe('guessPoints', () => {
  const drawMs = 80_000;

  it('rewards faster guesses with more points', () => {
    let prev = Infinity;
    for (let t = 0; t <= drawMs; t += 8000) {
      const p = guessPoints(t, drawMs, 5);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    expect(guessPoints(0, drawMs, 5)).toBe(GUESS_MIN_POINTS + GUESS_SPEED_POINTS);
    expect(guessPoints(drawMs, drawMs, 5)).toBe(GUESS_MIN_POINTS);
  });

  it('adds a podium bonus for the first three guessers', () => {
    const t = 20_000;
    const plain = guessPoints(t, drawMs, 4);
    expect(guessPoints(t, drawMs, 1)).toBe(plain + RANK_BONUS[0]);
    expect(guessPoints(t, drawMs, 2)).toBe(plain + RANK_BONUS[1]);
    expect(guessPoints(t, drawMs, 3)).toBe(plain + RANK_BONUS[2]);
  });

  it('clamps out-of-range times and always returns tidy multiples of five', () => {
    expect(guessPoints(-500, drawMs, 9)).toBe(GUESS_MIN_POINTS + GUESS_SPEED_POINTS);
    expect(guessPoints(drawMs * 3, drawMs, 9)).toBe(GUESS_MIN_POINTS);
    expect(guessPoints(1000, 0, 9)).toBe(GUESS_MIN_POINTS);
    for (let t = 0; t < drawMs; t += 1234) expect(guessPoints(t, drawMs, 9) % 5).toBe(0);
  });
});

describe('artistShare', () => {
  it('normalises by the number of eligible guessers', () => {
    expect(artistShare(300, 1)).toBe(Math.round((300 * ARTIST_SHARE) / 5) * 5);
    expect(artistShare(300, 10)).toBe(25);
    expect(artistShare(300, 0)).toBe(artistShare(300, 1));
  });

  it('always pays at least a little for a correct guess, nothing otherwise', () => {
    expect(artistShare(50, 29)).toBe(5);
    expect(artistShare(0, 3)).toBe(0);
  });

  it('means a full room earns the artist about the average guess value', () => {
    const guesses = [300, 260, 200, 180, 90];
    const total = guesses.reduce((n, p) => n + artistShare(p, guesses.length), 0);
    const avg = guesses.reduce((n, p) => n + p, 0) / guesses.length;
    expect(Math.abs(total - avg * ARTIST_SHARE)).toBeLessThanOrEqual(15);
  });
});

describe('rankStandings', () => {
  it('orders by score and shares placements on ties', () => {
    const ranked = rankStandings([
      { id: 'a', score: 100, joinOrder: 1 },
      { id: 'b', score: 300, joinOrder: 2 },
      { id: 'c', score: 100, joinOrder: 3 },
      { id: 'd', score: 50, joinOrder: 4 },
    ]);
    expect(ranked.map((r) => [r.id, r.placement])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });
});
