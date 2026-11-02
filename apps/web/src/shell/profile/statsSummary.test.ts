import { describe, expect, it } from 'vitest';
import type { GameId } from '@dascade/shared';
import type { GameStatLine } from '@dascade/shared/stats';
import { averageLabel, averageScore, formatAverage, summarize } from './statsSummary.ts';

function line(gameId: GameId, over: Partial<GameStatLine> = {}): GameStatLine {
  return {
    gameId,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    podiums: 0,
    bestScore: null,
    lowerIsBetter: false,
    totalScore: 0,
    scoredGames: 0,
    tournamentGames: 0,
    lastPlayedAt: 0,
    extras: {},
    ...over,
  };
}

describe('averageScore', () => {
  it('averages the scored games and needs at least two of them', () => {
    expect(averageScore({ totalScore: 8100, scoredGames: 2 })).toBe(4050);
    expect(averageScore({ totalScore: 4200, scoredGames: 1 })).toBeNull();
    expect(averageScore({ totalScore: 0, scoredGames: 0 })).toBeNull();
    expect(averageScore({ totalScore: 7, scoredGames: 3 })).toBeCloseTo(2.333, 3);
  });
});

describe('averageLabel', () => {
  it('follows the game’s own best-score label', () => {
    expect(averageLabel({ scoreLabel: 'Best race time', scoreFormat: 'ms' }, false)).toBe('Average race time');
    expect(averageLabel({ scoreLabel: 'Best final stack' }, false)).toBe('Average final stack');
    expect(averageLabel({}, false)).toBe('Average score');
    expect(averageLabel({}, true)).toBe('Average (lower is better)');
  });
});

describe('formatAverage', () => {
  it('rounds to whole numbers from 100 up, else one decimal', () => {
    expect(formatAverage(4050.5)).toBe((4051).toLocaleString());
    expect(formatAverage(2.3333)).toBe((2.3).toLocaleString());
    expect(formatAverage(31)).toBe('31');
  });
});

describe('summarize', () => {
  it('totals games and wins, counts different games and picks the most played', () => {
    const s = summarize(
      [
        line('trivia', { games: 4, wins: 2, lastPlayedAt: 30 }),
        line('blocks', { games: 6, lastPlayedAt: 10 }),
        line('quest', { games: 3, wins: 3, lastPlayedAt: 20 }),
      ],
      (id) => id === 'quest',
    );
    expect(s).toEqual({ games: 13, kinds: 3, mostPlayed: { gameId: 'blocks', games: 6 }, wins: 2 });
  });

  it('breaks a tie for most played with the most recent game', () => {
    const s = summarize([line('chess', { games: 5, lastPlayedAt: 10 }), line('checkers', { games: 5, lastPlayedAt: 50 })]);
    expect(s.mostPlayed).toEqual({ gameId: 'checkers', games: 5 });
  });

  it('has no most-played game without games', () => {
    expect(summarize([])).toEqual({ games: 0, kinds: 0, mostPlayed: null, wins: 0 });
  });
});
