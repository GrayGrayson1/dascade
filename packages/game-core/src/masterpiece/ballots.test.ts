import { describe, expect, it } from 'vitest';
import { ShowdownBallots } from './ballots.ts';

const answers = [
  { id: 'A', authorId: 'ann' },
  { id: 'B', authorId: 'bob' },
  { id: 'C', authorId: 'cat' },
  { id: 'D', authorId: 'dan' },
  { id: 'E', authorId: 'eve' },
];
const everyone = ['ann', 'bob', 'cat', 'dan', 'eve', 'zed'];

describe('ShowdownBallots — favourite', () => {
  it('accepts one pick and refuses self-votes, unknown answers and wrong counts', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, false);
    expect(box.cast('ann', ['A'], false)).toEqual({ ok: false, error: 'self_vote' });
    expect(box.cast('ann', ['Z'], false)).toEqual({ ok: false, error: 'unknown_option' });
    expect(box.cast('ann', ['B', 'C'], false)).toEqual({ ok: false, error: 'wrong_count' });
    expect(box.cast('ann', [], false)).toEqual({ ok: false, error: 'wrong_count' });
    expect(box.cast('ann', ['B', 'B'], false)).toEqual({ ok: false, error: 'duplicate_choice' });
    const ok = box.cast('ann', ['B'], false);
    expect(ok.ok).toBe(true);
    expect(box.ballotOf('ann', false)).toEqual({ voterId: 'ann', picks: ['B'], locked: true, audience: false });
  });

  it('refuses voters who are not seated in the showdown voter list', () => {
    const box = new ShowdownBallots('favourite', answers, ['ann', 'bob'], false);
    expect(box.cast('stranger', ['A'], false)).toEqual({ ok: false, error: 'not_eligible' });
    box.addVoter('stranger');
    expect(box.cast('stranger', ['A'], false).ok).toBe(true);
  });

  it('locks the first ballot when changes are off; re-sending the same ballot is a no-op', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, false);
    expect(box.cast('ann', ['B'], false)).toMatchObject({ ok: true, changed: true });
    expect(box.cast('ann', ['B'], false)).toMatchObject({ ok: true, changed: false });
    expect(box.cast('ann', ['C'], false)).toEqual({ ok: false, error: 'already_locked' });
    expect(box.playerCount).toBe(1);
    expect(box.ballotOf('ann', false)?.picks).toEqual(['B']);
  });

  it('allows changes until locked when the host permits it', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, true);
    expect(box.cast('ann', ['B'], false)).toMatchObject({ ok: true, changed: true });
    expect(box.ballotOf('ann', false)?.locked).toBe(false);
    expect(box.cast('ann', ['C'], false)).toMatchObject({ ok: true, changed: true });
    expect(box.ballotOf('ann', false)?.picks).toEqual(['C']);
    expect(box.isComplete(['ann'])).toBe(false);
    expect(box.lock('ann', false).ok).toBe(true);
    expect(box.lock('ann', false).ok).toBe(true); // idempotent
    expect(box.isComplete(['ann'])).toBe(true);
    expect(box.cast('ann', ['D'], false)).toEqual({ ok: false, error: 'already_locked' });
    expect(box.lock('bob', false)).toEqual({ ok: false, error: 'no_ballot' });
    expect(box.all()).toHaveLength(1);
  });

  it('closing makes every ballot final and refuses new ones', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, true);
    box.cast('ann', ['B'], false);
    box.close();
    expect(box.isOpen).toBe(false);
    expect(box.ballotOf('ann', false)?.locked).toBe(true);
    expect(box.cast('bob', ['A'], false)).toEqual({ ok: false, error: 'closed' });
  });

  it('keeps audience ballots apart from player ballots', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, false);
    box.cast('ann', ['B'], false);
    box.cast('fan', ['A'], true);
    expect(box.all().map((b) => [b.voterId, b.audience])).toEqual([
      ['ann', false],
      ['fan', true],
    ]);
    expect(box.playerCount).toBe(1);
    expect(box.audienceCount).toBe(1);
    // Audience voters never count toward "everyone has voted".
    expect(box.isComplete(['ann', 'fan'])).toBe(true);
  });

  it('tracks who is still pending among present voters', () => {
    const box = new ShowdownBallots('favourite', answers, everyone, false);
    box.cast('ann', ['B'], false);
    expect(box.pending(['ann', 'bob'])).toEqual(['bob']);
    expect(box.eligibleAmong(['ann', 'bob', 'nobody'])).toEqual(['ann', 'bob']);
    box.removeVoter('bob');
    expect(box.isComplete(['ann', 'bob'])).toBe(true);
  });
});

describe('ShowdownBallots — head-to-head', () => {
  const pair = [
    { id: 'X', authorId: 'ann' },
    { id: 'Y', authorId: 'bob' },
  ];

  it('authors sit out their own matchup; everyone else votes once', () => {
    const box = new ShowdownBallots('matchup', pair, ['ann', 'bob', 'cat'], false);
    expect(box.mayVote('ann', false)).toBe(false);
    expect(box.cast('ann', ['Y'], false)).toEqual({ ok: false, error: 'not_eligible' });
    expect(box.cast('bob', ['X'], false)).toEqual({ ok: false, error: 'not_eligible' });
    box.addVoter('ann'); // an author re-joining mid-vote is still not a voter
    expect(box.mayVote('ann', false)).toBe(false);
    expect(box.cast('cat', ['X'], false).ok).toBe(true);
    expect(box.cast('fan', ['Y'], true).ok).toBe(true);
    expect(box.isAuthor('ann')).toBe(true);
    expect(box.isAuthor('cat')).toBe(false);
    expect(box.ownAnswers('bob')).toEqual(['Y']);
    expect(box.isComplete(['ann', 'bob', 'cat'])).toBe(true);
  });
});

describe('ShowdownBallots — ranked', () => {
  it('needs three distinct picks, never including your own answer', () => {
    const box = new ShowdownBallots('ranked', answers, everyone, false);
    expect(box.picksRequired('ann')).toBe(3);
    expect(box.picksRequired('zed')).toBe(3);
    expect(box.cast('ann', ['B', 'C'], false)).toEqual({ ok: false, error: 'wrong_count' });
    expect(box.cast('ann', ['B', 'B', 'C'], false)).toEqual({ ok: false, error: 'duplicate_choice' });
    expect(box.cast('ann', ['A', 'B', 'C'], false)).toEqual({ ok: false, error: 'self_vote' });
    expect(box.cast('ann', ['C', 'B', 'D'], false).ok).toBe(true);
    expect(box.ballotOf('ann', false)?.picks).toEqual(['C', 'B', 'D']);
  });

  it('caps the pick count at what a voter can choose', () => {
    const box = new ShowdownBallots('ranked', answers.slice(0, 3), everyone, false);
    expect(box.picksRequired('ann')).toBe(2);
    expect(box.picksRequired('zed')).toBe(3);
  });
});
