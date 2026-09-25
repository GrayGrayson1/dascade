import { describe, expect, it } from 'vitest';
import type { Rng } from '@dascade/shared';
import { breakTieAuto, countVotes, tallyVotes, tieRuleText, type VoteOption } from './votes.ts';

/** Rng that always picks index `pick` (to observe coin flips). */
const fixed = (pick: number): Rng & { calls: number } => {
  const rng = {
    calls: 0,
    int(n: number) {
      rng.calls += 1;
      return Math.min(pick, n - 1);
    },
    next() {
      return 0;
    },
  };
  return rng;
};

const opts = (...pairs: Array<[string, number]>): VoteOption[] => pairs.map(([choiceId, odds]) => ({ choiceId, odds }));

describe('vote tally', () => {
  it('counts only votes for valid options', () => {
    const { counts, total } = countVotes(opts(['a', 1], ['b', 1]), { p1: 'a', p2: 'b', p3: 'a', p4: 'ghost' });
    expect(counts).toEqual({ a: 2, b: 1 });
    expect(total).toBe(3);
  });

  it('the most votes wins outright', () => {
    const r = tallyVotes({ options: opts(['a', 0.2], ['b', 0.9]), votes: { p1: 'a', p2: 'a', p3: 'b' }, mode: 'auto', rng: fixed(0) });
    expect(r).toMatchObject({ winner: 'a', rule: 'majority', topCount: 2, tied: ['a'], needsHost: false });
  });

  it('a double vote from the same voter is impossible (one entry per voter replaces)', () => {
    const votes: Record<string, string> = { p1: 'a' };
    votes.p1 = 'b';
    const r = tallyVotes({ options: opts(['a', 1], ['b', 1]), votes, mode: 'auto', rng: fixed(0) });
    expect(r.counts).toEqual({ a: 0, b: 1 });
    expect(r.winner).toBe('b');
  });

  it('ties go to the best party odds first', () => {
    const r = tallyVotes({ options: opts(['risky', 0.35], ['safe', 1], ['meh', 0.6]), votes: { p1: 'risky', p2: 'safe' }, leaderVote: 'risky', mode: 'auto', rng: fixed(0) });
    expect(r).toMatchObject({ winner: 'safe', rule: 'odds', odds: 1, tied: ['risky', 'safe'] });
    expect(tieRuleText(r.rule, r.odds)).toBe('Tie broken by best odds (100%)');
  });

  it("equal odds fall back to the leader's vote", () => {
    const r = tallyVotes({ options: opts(['a', 0.5], ['b', 0.5]), votes: { p1: 'a', p2: 'b' }, leaderVote: 'b', mode: 'auto', rng: fixed(0) });
    expect(r).toMatchObject({ winner: 'b', rule: 'leader' });
    expect(tieRuleText(r.rule)).toBe("Tie broken by the leader's vote");
  });

  it('then to a server coin flip', () => {
    const rng = fixed(1);
    const r = tallyVotes({ options: opts(['a', 0.5], ['b', 0.5]), votes: { p1: 'a', p2: 'b' }, leaderVote: null, mode: 'auto', rng });
    expect(r).toMatchObject({ winner: 'b', rule: 'random' });
    expect(rng.calls).toBe(1);
    expect(tieRuleText('random')).toBe('Tie broken by a server coin flip');
  });

  it("ignores a leader vote that isn't among the best-odds options", () => {
    const r = tallyVotes({ options: opts(['a', 0.5], ['b', 0.5], ['c', 0.1]), votes: { p1: 'a', p2: 'b', p3: 'c' }, leaderVote: 'c', mode: 'auto', rng: fixed(0) });
    expect(r).toMatchObject({ winner: 'a', rule: 'random' });
  });

  it("'host' mode: the leader's vote settles a tie, otherwise the host must pick", () => {
    const base = { options: opts(['a', 0.9], ['b', 0.1], ['c', 0.5]), votes: { p1: 'a', p2: 'b' }, mode: 'host' as const, rng: fixed(0) };
    expect(tallyVotes({ ...base, leaderVote: 'b' })).toMatchObject({ winner: 'b', rule: 'leader', needsHost: false });
    const needs = tallyVotes({ ...base, leaderVote: 'c' });
    expect(needs).toMatchObject({ winner: null, needsHost: true, tied: ['a', 'b'] });
    expect(breakTieAuto(needs.tied, base.options, 'c', fixed(0))).toMatchObject({ winner: 'a', rule: 'odds' });
    expect(tieRuleText('host')).toBe('Tie broken by the host');
  });

  it('no votes at all: the auto rule runs across every option, even in host mode', () => {
    const r = tallyVotes({ options: opts(['a', 0.3], ['b', 0.8]), votes: {}, mode: 'host', rng: fixed(0) });
    expect(r).toMatchObject({ noVotes: true, winner: 'b', rule: 'odds', needsHost: false, tied: ['a', 'b'] });
  });

  it('a single option always wins', () => {
    expect(tallyVotes({ options: opts(['go', 1]), votes: {}, mode: 'auto', rng: fixed(0) })).toMatchObject({ winner: 'go', rule: 'majority' });
  });

  it('no options yields no winner', () => {
    expect(tallyVotes({ options: [], votes: { p1: 'x' }, mode: 'auto', rng: fixed(0) })).toMatchObject({ winner: null });
  });
});
