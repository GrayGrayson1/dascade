import { describe, expect, it } from 'vitest';
import { phaseLabel, roomTabTitle } from './roomTitle.ts';

describe('roomTabTitle', () => {
  it('names the room, the game and where it is', () => {
    expect(roomTabTitle('ABCDE', 'DAS Chess', 'LOBBY')).toBe('ABCDE · DAS Chess · Lobby');
    expect(roomTabTitle('ABCDE', 'DAS Chess', 'PLAYING')).toBe('ABCDE · DAS Chess · In progress');
    expect(roomTabTitle('ABCDE', 'DAS Chess', 'RESULTS')).toBe('ABCDE · DAS Chess · Results');
  });

  it('round breaks read as in progress, and an unknown phase as the lobby', () => {
    expect(phaseLabel('INTERMISSION')).toBe('In progress');
    expect(phaseLabel(undefined)).toBe('Lobby');
  });
});
