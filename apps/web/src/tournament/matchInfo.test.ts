import { describe, expect, it } from 'vitest';
import { gameLabel, parseMatchInfo } from './matchInfo.ts';

describe('tournament match info', () => {
  it('parses a valid binding and rejects junk', () => {
    const info = {
      tournamentCode: 'ABCDE',
      tournamentName: 'Cup',
      matchId: 'W1-1',
      roundLabel: 'Final',
      format: 'single_elimination',
      bestOf: 3,
      gameNumber: 1,
      seriesScore: {},
      participants: [],
    };
    expect(parseMatchInfo(JSON.stringify(info))).toMatchObject({ tournamentCode: 'ABCDE' });
    expect(parseMatchInfo('')).toBeNull();
    expect(parseMatchInfo(null)).toBeNull();
    expect(parseMatchInfo('{nope')).toBeNull();
    expect(parseMatchInfo('{"tournamentCode":5}')).toBeNull();
    expect(parseMatchInfo('null')).toBeNull();
  });

  it('labels games, deciders and single-game matches', () => {
    expect(gameLabel({ gameNumber: 1, bestOf: 1 })).toBe('Single game');
    expect(gameLabel({ gameNumber: 2, bestOf: 3 })).toBe('Game 2 of 3');
    expect(gameLabel({ gameNumber: 0, bestOf: 3 })).toBe('Game 1 of 3');
    expect(gameLabel({ gameNumber: 4, bestOf: 3 })).toBe('Decider game');
    expect(gameLabel({ gameNumber: 3, bestOf: 2, decider: 'sudden_death' })).toBe('Decider game');
    expect(gameLabel({ gameNumber: 4, bestOf: 2, decider: 'armageddon' })).toBe('Armageddon decider');
  });
});
