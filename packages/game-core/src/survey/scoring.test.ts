import { describe, expect, it } from 'vitest';
import { SURVEY_SCORING, rankStepPoints } from '@dascade/shared/games/survey';
import { rankSlots } from './tally.ts';
import {
  isPermutation,
  maxRankDistance,
  percentErrorScaled,
  percentPoints,
  rankDistance,
  rankPoints,
  scoreMajority,
  scorePercent,
  scoreRank,
} from './scoring.ts';

const maj = (playerId: string, option: number) => ({ playerId, prediction: { kind: 'majority' as const, option } });
const rk = (playerId: string, order: number[]) => ({ playerId, prediction: { kind: 'rank' as const, order } });
const pc = (playerId: string, percent: number) => ({ playerId, prediction: { kind: 'percent' as const, percent } });
const byId = <T extends { playerId: string }>(list: T[]) => Object.fromEntries(list.map((s) => [s.playerId, s]));

describe('Majority Mind scoring', () => {
  it('awards the correct points to players who called the leader', () => {
    const scores = byId(scoreMajority([maj('a', 1), maj('b', 0), maj('c', 1)], [1]));
    expect(scores.a!.points).toBe(SURVEY_SCORING.majorityCorrect);
    expect(scores.a!.hit).toBe(true);
    expect(scores.b!.points).toBe(0);
    expect(scores.b!.hit).toBe(false);
    // 2 of 3 were right: no "called it" bonus.
    expect(scores.c!.bonus).toBe(0);
  });

  it('counts every tied leader as correct', () => {
    const scores = byId(scoreMajority([maj('a', 0), maj('b', 2), maj('c', 1), maj('d', 0)], [0, 2]));
    expect(scores.a!.hit && scores.b!.hit && scores.d!.hit).toBe(true);
    expect(scores.c!.hit).toBe(false);
  });

  it('gives a "Called it" bonus when fewer than half of predictors were right', () => {
    const scores = byId(scoreMajority([maj('a', 2), maj('b', 0), maj('c', 0), maj('d', 1)], [2]));
    expect(scores.a!.points).toBe(SURVEY_SCORING.majorityCorrect + SURVEY_SCORING.majorityCalledIt);
    expect(scores.a!.bonusLabel).toBe('Called it');
    expect(scores.b!.points).toBe(0);
  });

  it('gives no bonus at exactly half', () => {
    const scores = byId(scoreMajority([maj('a', 0), maj('b', 1)], [0]));
    expect(scores.a!.bonus).toBe(0);
  });

  it('sorts best first and keeps input order within ties', () => {
    const scores = scoreMajority([maj('x', 1), maj('y', 0), maj('z', 0)], [0]);
    expect(scores.map((s) => s.playerId)).toEqual(['y', 'z', 'x']);
  });
});

describe('Rank the Room scoring', () => {
  it('validates permutations', () => {
    expect(isPermutation([2, 0, 1], 3)).toBe(true);
    expect(isPermutation([0, 0, 1], 3)).toBe(false);
    expect(isPermutation([0, 1], 3)).toBe(false);
    expect(isPermutation([0, 1, 3], 3)).toBe(false);
    expect(isPermutation([0, 1.5, 2], 3)).toBe(false);
  });

  it('measures distance against unique ranks', () => {
    const slots = rankSlots([5, 3, 1, 0]); // order 0,1,2,3
    expect(rankDistance([0, 1, 2, 3], slots)).toBe(0);
    expect(rankDistance([1, 0, 2, 3], slots)).toBe(2);
    expect(rankDistance([3, 2, 1, 0], slots)).toBe(maxRankDistance(4));
    expect(rankDistance([0, 1, 1, 3], slots)).toBeNull();
  });

  it('never charges for placing an option anywhere inside its tie range', () => {
    const slots = rankSlots([3, 3, 0]); // options 0 and 1 tied for 1st–2nd, option 2 third
    expect(rankDistance([0, 1, 2], slots)).toBe(0);
    expect(rankDistance([1, 0, 2], slots)).toBe(0);
    expect(rankDistance([2, 0, 1], slots)).toBe(2 + 0 + 1);
  });

  it('scales points linearly from 1000 (perfect) to 0 (reversed)', () => {
    expect(maxRankDistance(3)).toBe(4);
    expect(maxRankDistance(4)).toBe(8);
    expect(maxRankDistance(5)).toBe(12);
    expect(rankPoints(0, 4)).toBe(1000);
    expect(rankPoints(2, 4)).toBe(750);
    expect(rankPoints(8, 4)).toBe(0);
    expect(rankPoints(1, 5)).toBe(917);
    expect(rankStepPoints(4)).toBe(125);
  });

  it('awards the perfect-order bonus', () => {
    const slots = rankSlots([4, 2, 1]);
    const scores = byId(scoreRank([rk('a', [0, 1, 2]), rk('b', [2, 1, 0]), rk('c', [1, 0, 2])], slots));
    expect(scores.a!.points).toBe(1000 + SURVEY_SCORING.rankPerfect);
    expect(scores.a!.bonusLabel).toBe('Perfect order');
    expect(scores.a!.hit).toBe(true);
    expect(scores.b!.points).toBe(0);
    expect(scores.b!.off).toBe(4);
    expect(scores.c!.points).toBe(500);
    expect(scores.c!.off).toBe(2);
  });

  it('drops invalid orders instead of scoring them', () => {
    const slots = rankSlots([1, 1, 1]);
    expect(scoreRank([rk('a', [0, 0, 1])], slots)).toEqual([]);
  });

  it('property: points stay within 0..1250 for every permutation of 5', () => {
    const slots = rankSlots([4, 4, 2, 1, 0]);
    const perms: number[][] = [];
    const permute = (rest: number[], acc: number[]) => {
      if (rest.length === 0) perms.push(acc);
      rest.forEach((v, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, v]));
    };
    permute([0, 1, 2, 3, 4], []);
    expect(perms).toHaveLength(120);
    for (const order of perms) {
      const [s] = scoreRank([rk('p', order)], slots);
      expect(s!.points).toBeGreaterThanOrEqual(0);
      expect(s!.points).toBeLessThanOrEqual(1250);
    }
  });
});

describe('Guess the Percentage scoring', () => {
  it('computes the scaled error exactly', () => {
    // 2 of 3 = 66.67%. Guess 67 → |67·3 − 200| = 1 (i.e. 1/3 of a point).
    expect(percentErrorScaled(67, 2, 3)).toBe(1);
    expect(percentErrorScaled(66, 2, 3)).toBe(2);
    expect(percentErrorScaled(50, 5, 10)).toBe(0);
  });

  it('loses 20 points per percentage point off and never goes negative', () => {
    expect(percentPoints(0, 10)).toBe(1000);
    expect(percentPoints(10 * 10, 10)).toBe(800);
    expect(percentPoints(50 * 4, 4)).toBe(0);
    expect(percentPoints(80 * 4, 4)).toBe(0);
    // 1/3 point off → 1000 − 6.67 = 993.33 → 993
    expect(percentPoints(1, 3)).toBe(993);
  });

  it('gives the closest bonus to the closest prediction', () => {
    const { scores, closest } = scorePercent([pc('a', 40), pc('b', 70), pc('c', 90)], 2, 3); // 66.67%
    expect(closest).toEqual(['b']);
    const s = byId(scores);
    expect(s.b!.bonus).toBe(SURVEY_SCORING.percentClosest);
    expect(s.b!.bonusLabel).toBe('Closest');
    expect(s.a!.bonus).toBe(0);
    expect(s.b!.off).toBe(3.3);
  });

  it('shares the closest bonus between exact ties (equal distance either side)', () => {
    // 50% actual: 45 and 55 are both exactly 5 points off.
    const { scores, closest } = scorePercent([pc('a', 45), pc('b', 55), pc('c', 20)], 2, 4);
    expect(closest.sort()).toEqual(['a', 'b']);
    const s = byId(scores);
    expect(s.a!.points).toBe(s.b!.points);
    expect(s.a!.bonus).toBe(SURVEY_SCORING.percentClosest);
    expect(s.b!.bonus).toBe(SURVEY_SCORING.percentClosest);
  });

  it('detects ties on thirds without floating-point drift', () => {
    // 1 of 3 = 33.33…: 33 is 1/3 off and so is… nothing else; 34 is 2/3 off.
    const { closest } = scorePercent([pc('a', 33), pc('b', 34)], 1, 3);
    expect(closest).toEqual(['a']);
  });

  it('labels an exact guess a bullseye', () => {
    const { scores } = scorePercent([pc('a', 25)], 1, 4);
    expect(scores[0]!.points).toBe(1000 + SURVEY_SCORING.percentClosest);
    expect(scores[0]!.bonusLabel).toBe('Bullseye');
    expect(scores[0]!.hit).toBe(true);
  });

  it('marks predictions within 5 points as hits', () => {
    const { scores } = scorePercent([pc('a', 55), pc('b', 56)], 1, 2);
    const s = byId(scores);
    expect(s.a!.hit).toBe(true);
    expect(s.b!.hit).toBe(false);
  });

  it('scores nothing without respondents', () => {
    expect(scorePercent([pc('a', 50)], 0, 0)).toEqual({ scores: [], closest: [] });
  });
});
