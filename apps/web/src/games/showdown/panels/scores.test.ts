import { describe, expect, it } from 'vitest';
import { emptyMedals, type ShowdownScorePerson } from '@dascade/shared/games/showdown';
import { FINALE_STEP_WORDS, csvCell, finaleStepWords, medalSpeech, medalWords, scoresCsv, scoresFileName } from './scores.ts';

const person = (over: Partial<ShowdownScorePerson>): ShowdownScorePerson => ({
  playerId: 'p',
  name: 'Ada',
  points: 0,
  rank: 0,
  medals: emptyMedals(),
  positionHits: 0,
  perfect: 0,
  gems: 0,
  calls: 0,
  rounds: [0, 0],
  ...over,
});

describe('scores: medals in words', () => {
  it('lists only the medals someone has, pumpkin first', () => {
    expect(medalWords({ pumpkin: 1, gold: 2, silver: 0, bronze: 0, ribbon: 1 })).toBe('🎃1 🥇2 🎗️1');
    expect(medalWords(emptyMedals())).toBe('');
    expect(medalWords(null)).toBe('');
    expect(medalSpeech({ pumpkin: 0, gold: 1, silver: 0, bronze: 2, ribbon: 0 })).toBe('1 Gold, 2 Bronze');
    expect(medalSpeech(emptyMedals())).toBe('No medals');
  });
});

describe('scores: CSV', () => {
  it('quotes what needs quoting and never lets a name run as a formula', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell(12)).toBe('12');
    expect(csvCell('Smith, J.')).toBe('"Smith, J."');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
    for (const evil of ['=SUM(A1)', '+1', '-2+3', '@cmd', '\tx']) expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('=1,2')).toBe(`"'=1,2"`);
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('has rank, name, points, medals, position hits, perfect bonuses, then every round’s points', () => {
    const csv = scoresCsv({
      people: [
        person({
          playerId: 'a',
          name: 'Ada',
          points: 31,
          rank: 1,
          positionHits: 3,
          perfect: 1,
          rounds: [20, 11],
          medals: { ...emptyMedals(), gold: 1 },
        }),
        person({ playerId: 'b', name: '=Bobby', points: 31, rank: 1, rounds: [31, 0] }),
        person({ playerId: 'c', name: 'Cy, Jr.', points: 0, rank: 0, medals: { ...emptyMedals(), ribbon: 2 } }),
      ],
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Rank,Name,Points,Medals,Position hits,Perfect bonuses,Round 1,Round 2');
    expect(lines[1]).toBe('1,Ada,31,🥇1,3,1,20,11');
    expect(lines[2]).toBe("1,'=Bobby,31,,0,0,31,0");
    expect(lines[3]).toBe(',"Cy, Jr.",0,🎗️2,0,0,0,0');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(scoresCsv({ people: [] })).toBe('Rank,Name,Points,Medals,Position hits,Perfect bonuses\r\n');
  });

  it('names files like the audit log, safely', () => {
    expect(scoresFileName('ABCDE', 'csv')).toBe('dasoween-scores-ABCDE.csv');
    expect(scoresFileName('AB/../CD', 'json')).toBe('dasoween-scores-ABCD.json');
    expect(scoresFileName('', 'json')).toBe('dasoween-scores-room.json');
  });
});

describe('scores: the finale in words', () => {
  it('names each step, and the last one as the winner', () => {
    expect(FINALE_STEP_WORDS.third).toBe('3rd place');
    expect(finaleStepWords('medals')).toBe('The medal ceremony');
    expect(finaleStepWords('first')).toBe('1st place — the winner');
  });
});
