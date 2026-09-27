import { describe, expect, it } from 'vitest';
import { MP_POINTS } from '@dascade/shared/games/masterpiece';
import type { Ballot } from './ballots.ts';
import { computeAwards, emptyStats, tallyShowdown, walkoverPoints } from './scoring.ts';

const vote = (voterId: string, picks: string[], audience = false): Ballot => ({ voterId, picks, audience, locked: true });
const byId = <T extends { id: string }>(list: T[]) => Object.fromEntries(list.map((t) => [t.id, t]));

const pair = [
  { id: 'X', authorId: 'ann' },
  { id: 'Y', authorId: 'bob' },
];

describe('tallyShowdown — head-to-head', () => {
  it('awards points per vote plus the winner bonus', () => {
    const t = byId(tallyShowdown('matchup', pair, [vote('cat', ['X']), vote('dan', ['X']), vote('eve', ['Y'])]));
    expect(t.X).toMatchObject({ votes: 2, winner: true, sweep: false, points: 2 * MP_POINTS.vote + MP_POINTS.win });
    expect(t.Y).toMatchObject({ votes: 1, winner: false, points: MP_POINTS.vote });
  });

  it('gives a sweep when every voter picks the same answer (min two votes)', () => {
    const t = byId(tallyShowdown('matchup', pair, [vote('cat', ['X']), vote('dan', ['X'])]));
    expect(t.X).toMatchObject({ sweep: true, points: 2 * MP_POINTS.vote + MP_POINTS.win + MP_POINTS.sweep });
    const single = byId(tallyShowdown('matchup', pair, [vote('cat', ['X'])]));
    expect(single.X?.sweep).toBe(false);
  });

  it('shares the winner bonus on a tie and gives nothing with no votes', () => {
    const tie = byId(tallyShowdown('matchup', pair, [vote('cat', ['X']), vote('dan', ['Y'])]));
    expect(tie.X?.winner && tie.Y?.winner).toBe(true);
    expect(tie.X?.points).toBe(MP_POINTS.vote + MP_POINTS.win);
    const none = tallyShowdown('matchup', pair, []);
    for (const a of none) expect(a).toMatchObject({ winner: false, sweep: false, points: 0 });
  });

  it('applies the round multiplier to everything', () => {
    const t = byId(tallyShowdown('matchup', pair, [vote('cat', ['X']), vote('dan', ['X'])], 2));
    expect(t.X?.points).toBe(2 * (2 * MP_POINTS.vote + MP_POINTS.win + MP_POINTS.sweep));
  });
});

describe('tallyShowdown — favourite gallery', () => {
  const gallery = [
    { id: 'A', authorId: 'ann' },
    { id: 'B', authorId: 'bob' },
    { id: 'C', authorId: 'cat' },
  ];

  it('an author voting elsewhere does not break a sweep', () => {
    // bob and cat both pick A; ann (A's author) picks B.
    const t = byId(tallyShowdown('favourite', gallery, [vote('ann', ['B']), vote('bob', ['A']), vote('cat', ['A'])]));
    expect(t.A).toMatchObject({ votes: 2, sweep: true, winner: true });
    expect(t.B).toMatchObject({ votes: 1, sweep: false });
  });

  it('ignores self-picks even if a caller let one through', () => {
    const t = byId(tallyShowdown('favourite', gallery, [vote('ann', ['A']), vote('bob', ['C'])]));
    expect(t.A?.votes).toBe(0);
    expect(t.C?.votes).toBe(1);
  });
});

describe('tallyShowdown — ranked', () => {
  const five = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, authorId: id.toLowerCase() }));

  it('scores gold / silver / bronze picks', () => {
    const t = byId(tallyShowdown('ranked', five, [vote('a', ['B', 'C', 'D']), vote('b', ['C', 'A', 'D'])]));
    expect(t.C).toMatchObject({ votes: 2, firsts: 1, votePoints: MP_POINTS.ranked[1]! + MP_POINTS.ranked[0]! });
    expect(t.D?.votePoints).toBe(2 * MP_POINTS.ranked[2]!);
    expect(t.C?.winner).toBe(true);
  });

  it('sweeps on every gold pick', () => {
    const t = byId(tallyShowdown('ranked', five, [vote('a', ['B', 'C', 'D']), vote('c', ['B', 'A', 'D']), vote('d', ['B', 'A', 'C'])]));
    expect(t.B?.sweep).toBe(true);
    expect(t.A?.sweep).toBe(false);
  });
});

describe('tallyShowdown — audience', () => {
  it('audience ballots add only the audience bonus, never vote points', () => {
    const ballots = [vote('cat', ['X']), vote('f1', ['Y'], true), vote('f2', ['Y'], true), vote('f3', ['X'], true)];
    const t = byId(tallyShowdown('matchup', pair, ballots));
    expect(t.Y).toMatchObject({ votes: 0, audienceVotes: 2, audiencePick: true, winner: false, points: MP_POINTS.audience });
    expect(t.X).toMatchObject({ votes: 1, audienceVotes: 1, audiencePick: false, winner: true });
  });

  it('ties share the audience bonus; audience ballots do not count toward sweeps', () => {
    const t = byId(tallyShowdown('matchup', pair, [vote('cat', ['X']), vote('dan', ['X']), vote('f1', ['X'], true), vote('f2', ['Y'], true)]));
    expect(t.X?.audiencePick && t.Y?.audiencePick).toBe(true);
    expect(t.X?.sweep).toBe(true);
  });

  it('ranked audience ballots only count their gold pick', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, authorId: id.toLowerCase() }));
    const t = byId(tallyShowdown('ranked', five, [vote('fan', ['E', 'D', 'C'], true)]));
    expect(t.E?.audienceVotes).toBe(1);
    expect(t.D?.audienceVotes).toBe(0);
  });
});

describe('walkover', () => {
  it('walkovers score a fixed bonus', () => {
    expect(walkoverPoints()).toBe(MP_POINTS.walkover);
    expect(walkoverPoints(2)).toBe(2 * MP_POINTS.walkover);
  });
});

describe('computeAwards', () => {
  it('hands out awards for positive stats only, ties to the earlier joiner', () => {
    const ann = { ...emptyStats('ann', 'Ann', 1), votes: 5, sweeps: 1, wins: 2, submitted: 2, required: 2, submitMs: 20_000 };
    const bob = { ...emptyStats('bob', 'Bob', 2), votes: 5, audiencePicks: 3, wins: 3, submitted: 2, required: 2, submitMs: 9_000 };
    const cat = { ...emptyStats('cat', 'Cat', 3), submitted: 1, required: 2, submitMs: 1_000 };
    const awards = Object.fromEntries(computeAwards([ann, bob, cat]).map((a) => [a.id, a]));
    expect(awards.crowd).toMatchObject({ playerId: 'ann', value: '5 votes' });
    expect(awards.sweeper).toMatchObject({ playerId: 'ann', value: '1 sweep' });
    expect(awards.consistent).toMatchObject({ playerId: 'bob', value: '3 showdowns won' });
    expect(awards.audience).toMatchObject({ playerId: 'bob' });
    // cat skipped a prompt, so the quickest complete writer wins.
    expect(awards.quick).toMatchObject({ playerId: 'bob', value: '4.5s per answer' });
    expect(computeAwards([emptyStats('z', 'Z', 1)])).toEqual([]);
  });
});
