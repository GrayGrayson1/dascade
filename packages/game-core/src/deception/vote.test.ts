import { describe, expect, it } from 'vitest';
import { tallyVotes, type CastVote, type VoteInput } from './vote.ts';

const PLAYERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function tally(votes: Record<string, string | [string, 'sudo']>, patch: Partial<VoteInput> = {}) {
  const map = new Map<string, CastVote>();
  for (const [voter, v] of Object.entries(votes))
    map.set(voter, Array.isArray(v) ? { target: v[0], sudo: true } : { target: v, sudo: false });
  return tallyVotes({
    voters: new Set(PLAYERS),
    candidates: new Set(PLAYERS),
    votes: map,
    allowSkip: true,
    tieRule: 'runoff',
    isRunoff: false,
    ...patch,
  });
}

describe('tallyVotes', () => {
  it('disconnects the player with the most votes', () => {
    const r = tally({ a: 'b', c: 'b', d: 'e', e: 'b', f: 'skip' });
    expect(r.outcome).toBe('disconnected');
    expect(r.playerId).toBe('b');
    expect(r.tally).toEqual([
      { target: 'b', votes: 3 },
      { target: 'e', votes: 1 },
      { target: 'skip', votes: 1 },
    ]);
    expect(r.abstained).toBe(1);
  });

  it('lets Skip win when it has more votes', () => {
    expect(tally({ a: 'skip', b: 'skip', c: 'd' }).outcome).toBe('skipped');
  });

  it('lets Skip win a tie with the top player', () => {
    const r = tally({ a: 'skip', b: 'skip', c: 'd', e: 'd' });
    expect(r.outcome).toBe('skipped');
    expect(r.playerId).toBeUndefined();
  });

  it('reports all-skip and no-vote rounds', () => {
    expect(tally({ a: 'skip' }).outcome).toBe('skipped');
    const none = tally({});
    expect(none.outcome).toBe('no_votes');
    expect(none.abstained).toBe(6);
    expect(none.tally).toEqual([]);
  });

  it('sends a tie to a runoff with the tied players', () => {
    const r = tally({ a: 'b', b: 'c', d: 'c', e: 'b' });
    expect(r.outcome).toBe('runoff');
    expect(r.tied).toEqual(['b', 'c']);
  });

  it('a tie inside the runoff (or with the "none" rule) disconnects nobody', () => {
    expect(tally({ a: 'b', b: 'c' }, { isRunoff: true }).outcome).toBe('tie');
    const none = tally({ a: 'b', b: 'c' }, { tieRule: 'none' });
    expect(none.outcome).toBe('tie');
    expect(none.tied).toEqual(['b', 'c']);
  });

  it('counts a Sudo vote twice', () => {
    const r = tally({ a: ['b', 'sudo'], c: 'd' });
    expect(r.outcome).toBe('disconnected');
    expect(r.playerId).toBe('b');
    expect(r.sudo).toBe(true);
    expect(r.lines).toContainEqual({ voterId: 'a', target: 'b', weight: 2 });
    expect(r.tally[0]).toEqual({ target: 'b', votes: 2 });
  });

  it('a Sudo vote can beat Skip', () => {
    expect(tally({ a: ['b', 'sudo'], c: 'skip' }).outcome).toBe('disconnected');
  });

  it('ignores self-votes, non-voters, non-candidates and Skip when disabled', () => {
    const r = tally({ a: 'a', x: 'b', c: 'zz', d: 'skip', e: 'b' }, { allowSkip: false });
    expect(r.lines).toEqual([{ voterId: 'e', target: 'b', weight: 1 }]);
    expect(r.outcome).toBe('disconnected');
    expect(r.abstained).toBe(5);
  });

  it('restricts a runoff to its candidates', () => {
    const r = tally({ a: 'b', c: 'd', e: 'd', f: 'b' }, { candidates: new Set(['b', 'c']), isRunoff: true });
    expect(r.outcome).toBe('disconnected');
    expect(r.playerId).toBe('b');
  });

  it('orders the tally by votes, players before Skip, then id', () => {
    const r = tally({ a: 'skip', b: 'd', c: 'e', d: 'skip', e: 'd' });
    expect(r.tally.map((t) => t.target)).toEqual(['d', 'skip', 'e']);
  });
});
