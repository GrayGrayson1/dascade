import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  AnswerBox,
  VoteBox,
  allowedTypos,
  anonymize,
  answerKey,
  applyDeltas,
  assignTeams,
  balanceTeams,
  closestWins,
  matchAnswer,
  normalizeAnswer,
  parseNumberAnswer,
  pickWinners,
  placementGroups,
  podium,
  rankStandings,
  smallestTeam,
  speedBonus,
  streakBonus,
  teamSizes,
  teamTotals,
  withinShare,
} from './index.ts';

// ---------------------------------------------------------------------------
describe('AnswerBox', () => {
  it('accepts one locked answer per player and rejects duplicates idempotently', () => {
    const box = new AnswerBox<number>({ openedAt: 1000 });
    expect(box.submit('a', 1, 1500)).toEqual({ ok: true, changed: false, locked: true });
    expect(box.submit('a', 2, 1600)).toEqual({ ok: false, reason: 'already_locked' });
    expect(box.get('a')?.value).toBe(1);
    expect(box.count).toBe(1);
    expect(box.elapsed('a')).toBe(500);
    expect(box.elapsed('zz')).toBeNull();
  });

  it('refuses ineligible players and anything after close', () => {
    const box = new AnswerBox<string>({ eligible: ['a', 'b'] });
    expect(box.submit('x', 'hi')).toEqual({ ok: false, reason: 'not_eligible' });
    box.addEligible('x');
    expect(box.submit('x', 'hi').ok).toBe(true);
    box.close();
    box.close();
    expect(box.submit('a', 'late')).toEqual({ ok: false, reason: 'closed' });
    expect(box.isOpen).toBe(false);
  });

  it('allowChange: resubmits until lock, then refuses', () => {
    const box = new AnswerBox<string>({ allowChange: true, openedAt: 0 });
    expect(box.submit('a', 'one', 10)).toEqual({ ok: true, changed: false, locked: false });
    expect(box.submit('a', 'two', 20)).toEqual({ ok: true, changed: true, locked: false });
    const r = box.get('a')!;
    expect([r.value, r.firstAt, r.at, r.changes, r.locked]).toEqual(['two', 10, 20, 1, false]);
    expect(box.isComplete(['a'])).toBe(false);
    expect(box.lock('a')).toBe(true);
    expect(box.lock('a')).toBe(false);
    expect(box.submit('a', 'three')).toEqual({ ok: false, reason: 'already_locked' });
    expect(box.isComplete(['a'])).toBe(true);
  });

  it('close() locks every pending submission', () => {
    const box = new AnswerBox<string>({ allowChange: true });
    box.submit('a', 'x');
    box.close();
    expect(box.isLocked('a')).toBe(true);
    expect(box.lock('a')).toBe(false);
  });

  it('pending / isComplete honour eligibility and presence', () => {
    const box = new AnswerBox<number>({ eligible: ['a', 'b', 'c'] });
    expect(box.isComplete()).toBe(false);
    box.submit('a', 1);
    expect(box.pending().sort()).toEqual(['b', 'c']);
    // c is disconnected: only wait for b
    expect(box.pending(['a', 'b'])).toEqual(['b']);
    box.submit('b', 2);
    expect(box.isComplete(['a', 'b'])).toBe(true);
    expect(box.isComplete()).toBe(false);
    box.removeEligible('c');
    expect(box.isComplete()).toBe(true);
    expect(box.eligibleIds().sort()).toEqual(['a', 'b']);
  });

  it('open eligibility (null) waits for present players only', () => {
    const box = new AnswerBox<number>();
    expect(box.isEligible('anyone')).toBe(true);
    box.submit('a', 1);
    expect(box.pending(['a', 'b'])).toEqual(['b']);
    box.removeEligible('b');
    expect(box.isEligible('b')).toBe(false);
    expect(box.isEligible('a')).toBe(true);
  });

  it('discard withdraws an answer; entries keep arrival order', () => {
    const box = new AnswerBox<number>();
    box.submit('b', 2);
    box.submit('a', 1);
    expect(box.entries().map((e) => e.playerId)).toEqual(['b', 'a']);
    expect(box.discard('b')).toBe(true);
    expect(box.answeredIds()).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
describe('VoteBox', () => {
  const owners: Record<string, string> = { e1: 'a', e2: 'b', e3: 'c' };
  const box = (extra: Partial<ConstructorParameters<typeof VoteBox>[0]> = {}) =>
    new VoteBox({ options: ['e1', 'e2', 'e3'], voters: ['a', 'b', 'c', 'd'], ownerOf: (o) => owners[o], ...extra });

  it('counts single-choice votes and ranks options', () => {
    const v = box();
    expect(v.cast('a', 'e2')).toEqual({ ok: true, changed: false });
    expect(v.cast('b', 'e1').ok).toBe(true);
    expect(v.cast('d', 'e2').ok).toBe(true);
    const t = v.tally();
    expect(t.options.map((o) => [o.optionId, o.votes, o.points])).toEqual([
      ['e2', 2, 2],
      ['e1', 1, 1],
      ['e3', 0, 0],
    ]);
    expect(t.options[0]!.voters.sort()).toEqual(['a', 'd']);
    expect(t.cast).toBe(3);
    expect(v.winners()).toEqual(['e2']);
  });

  it('refuses self votes, unknown options, ineligible voters and duplicates', () => {
    const v = box();
    expect(v.cast('a', 'e1')).toEqual({ ok: false, reason: 'self_vote' });
    expect(v.cast('a', 'nope')).toEqual({ ok: false, reason: 'unknown_option' });
    expect(v.cast('zz', 'e1')).toEqual({ ok: false, reason: 'not_eligible' });
    expect(v.cast('a', 'e2').ok).toBe(true);
    expect(v.cast('a', 'e3')).toEqual({ ok: false, reason: 'already_locked' });
    expect(v.tally().options.find((o) => o.optionId === 'e3')!.votes).toBe(0);
    expect(v.optionsFor('a')).toEqual(['e2', 'e3']);
  });

  it('allowSelfVote lets owners vote for themselves', () => {
    const v = box({ allowSelfVote: true });
    expect(v.cast('a', 'e1').ok).toBe(true);
  });

  it('abstain only when allowed', () => {
    expect(box().cast('a', null)).toEqual({ ok: false, reason: 'abstain_not_allowed' });
    const v = box({ allowAbstain: true });
    expect(v.cast('a', null).ok).toBe(true);
    expect(v.tally().abstained).toBe(1);
    expect(v.winners()).toEqual([]);
  });

  it('allowChange: latest ballot counts until lock/close', () => {
    const v = box({ allowChange: true });
    v.cast('d', 'e1');
    expect(v.cast('d', 'e3')).toEqual({ ok: true, changed: true });
    expect(v.winners()).toEqual(['e3']);
    expect(v.lock('d')).toBe(true);
    expect(v.cast('d', 'e2')).toEqual({ ok: false, reason: 'already_locked' });
    v.close();
    expect(v.cast('a', 'e2')).toEqual({ ok: false, reason: 'closed' });
  });

  it('ranked ballots score Borda points and validate choices', () => {
    const v = box({ maxChoices: 2 });
    expect(v.cast('d', ['e1', 'e1'])).toEqual({ ok: false, reason: 'duplicate_choice' });
    expect(v.cast('d', ['e1', 'e2', 'e3'])).toEqual({ ok: false, reason: 'too_many_choices' });
    expect(v.cast('a', ['e2', 'e1'])).toEqual({ ok: false, reason: 'self_vote' });
    expect(v.cast('d', ['e1', 'e2']).ok).toBe(true); // e1 +2, e2 +1
    expect(v.cast('a', ['e2', 'e3']).ok).toBe(true); // e2 +2, e3 +1
    expect(v.cast('b', ['e3', 'e1']).ok).toBe(true); // e3 +2, e1 +1
    const t = v.tally();
    // All on 3 points and 1 first-choice vote → authoring order.
    expect(t.options.map((o) => [o.optionId, o.points, o.votes])).toEqual([
      ['e1', 3, 1],
      ['e2', 3, 1],
      ['e3', 3, 1],
    ]);
    expect(v.winners('share')).toEqual(['e1', 'e2', 'e3']);
  });

  it('requireFullRanking needs a complete ballot (capped by options available to the voter)', () => {
    const v = box({ maxChoices: 3, requireFullRanking: true });
    // a owns e1, so only 2 options are available to a.
    expect(v.cast('a', ['e2'])).toEqual({ ok: false, reason: 'invalid' });
    expect(v.cast('a', ['e2', 'e3']).ok).toBe(true);
    expect(v.cast('d', ['e2', 'e3'])).toEqual({ ok: false, reason: 'invalid' });
  });

  it('tie rules: share, none, first, random (deterministic with a seeded rng)', () => {
    const v = box();
    v.cast('a', 'e2');
    v.cast('b', 'e1');
    expect(v.winners('share')).toEqual(['e1', 'e2']);
    expect(v.winners('none')).toEqual([]);
    expect(v.winners('first')).toEqual(['e1']);
    const r1 = v.winners('random', createSeededRng('tie'));
    const r2 = v.winners('random', createSeededRng('tie'));
    expect(r1).toEqual(r2);
    expect(['e1', 'e2']).toContain(r1[0]);
    expect(() => v.winners('random')).toThrow();
  });

  it('points beat first-choice votes, then first-choice votes break point ties', () => {
    const t = {
      options: [
        { optionId: 'x', votes: 2, points: 5, voters: [] },
        { optionId: 'y', votes: 1, points: 5, voters: [] },
      ],
      cast: 3,
      abstained: 0,
    };
    expect(pickWinners(t, 'share')).toEqual(['x']);
  });

  it('pending/isComplete and removeVoter', () => {
    const v = box();
    v.cast('a', 'e2');
    expect(v.pending().sort()).toEqual(['b', 'c', 'd']);
    v.removeVoter('b');
    v.removeVoter('c');
    expect(v.isComplete()).toBe(false);
    v.cast('d', 'e3');
    expect(v.isComplete()).toBe(true);
    expect(v.hasVoted('d')).toBe(true);
    expect(v.ballot('d')?.choices).toEqual(['e3']);
  });
});

// ---------------------------------------------------------------------------
describe('scoring', () => {
  it('speedBonus is linear and clamps', () => {
    expect(speedBonus(0, 10_000, 250)).toBe(250);
    expect(speedBonus(5_000, 10_000, 250)).toBe(125);
    expect(speedBonus(10_000, 10_000, 250)).toBe(0);
    expect(speedBonus(12_000, 10_000, 250)).toBe(0);
    expect(speedBonus(-50, 10_000, 250)).toBe(250);
    expect(speedBonus(100, 0, 250)).toBe(0);
    expect(speedBonus(Number.NaN, 1000, 250)).toBe(0);
  });

  it('streakBonus grows per step and caps', () => {
    expect(streakBonus(0, 50, 250)).toBe(0);
    expect(streakBonus(1, 50, 250)).toBe(0);
    expect(streakBonus(2, 50, 250)).toBe(50);
    expect(streakBonus(4, 50, 250)).toBe(150);
    expect(streakBonus(40, 50, 250)).toBe(250);
  });

  it('rankStandings uses competition ranking with ties', () => {
    const s = rankStandings([
      { id: 'a', score: 10, order: 1 },
      { id: 'b', score: 30, order: 2 },
      { id: 'c', score: 10, order: 3 },
      { id: 'd', score: 5, order: 4 },
    ]);
    expect(s.map((x) => [x.id, x.place, x.tied])).toEqual([
      ['b', 1, false],
      ['a', 2, true],
      ['c', 2, true],
      ['d', 4, false],
    ]);
    expect(placementGroups(s)).toEqual([['b'], ['a', 'c'], ['d']]);
    expect(podium(s, 2).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('rankStandings lowerIsBetter + all tied', () => {
    const s = rankStandings(
      [
        { id: 'a', score: 3 },
        { id: 'b', score: 1 },
      ],
      { lowerIsBetter: true },
    );
    expect(s.map((x) => x.id)).toEqual(['b', 'a']);
    const tied = rankStandings([
      { id: 'a', score: 0 },
      { id: 'b', score: 0 },
    ]);
    expect(placementGroups(tied)).toEqual([['a', 'b']]);
  });

  it('applyDeltas sums into a new table', () => {
    const base = { a: 10 };
    expect(applyDeltas(base, { a: 5, b: -2 })).toEqual({ a: 15, b: -2 });
    expect(base).toEqual({ a: 10 });
  });

  it('closestWins: all guesses at the minimum distance share the win (over or under)', () => {
    const r = closestWins(
      [
        { id: 'a', value: 95 },
        { id: 'b', value: 105 },
        { id: 'c', value: 120 },
        { id: 'd', value: Number.NaN },
      ],
      100,
    );
    expect(r.winners.sort()).toEqual(['a', 'b']);
    expect(r.distance).toBe(5);
    expect(r.ranked.map((g) => [g.id, g.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('closestWins: exact hits, floats and no guesses', () => {
    expect(closestWins([], 5)).toEqual({ winners: [], distance: Infinity, ranked: [] });
    const r = closestWins(
      [
        { id: 'a', value: 0.1 + 0.2 },
        { id: 'b', value: 0.3 },
      ],
      0.3,
    );
    expect(r.winners.sort()).toEqual(['a', 'b']);
    expect(r.ranked.every((g) => g.exact)).toBe(true);
  });

  it('withinShare', () => {
    expect(withinShare(110, 100, 0.1)).toBe(true);
    expect(withinShare(111, 100, 0.1)).toBe(false);
    expect(withinShare(-0.05, 0, 0.1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('teams', () => {
  const teams = ['volt', 'nova', 'wave'];

  it('assignTeams deals evenly and deterministically with a seeded rng', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const a = assignTeams(ids, teams, createSeededRng('teams'));
    const b = assignTeams(ids, teams, createSeededRng('teams'));
    expect([...a]).toEqual([...b]);
    const sizes = [...teamSizes(a, teams).values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((x, y) => x + y, 0)).toBe(10);
  });

  it('assignTeams evens out for many seeds (property)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const n = 1 + (seed % 30);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const a = assignTeams(ids, teams, createSeededRng(seed));
      const sizes = [...teamSizes(a, teams).values()];
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(a.size).toBe(n);
    }
  });

  it('smallestTeam prefers the earliest team on ties', () => {
    const m = new Map([['a', 'nova']]);
    expect(smallestTeam(m, teams)).toBe('volt');
    m.set('b', 'volt');
    expect(smallestTeam(m, teams)).toBe('wave');
  });

  it('balanceTeams keeps valid assignments, places newcomers, evens sizes', () => {
    const current = new Map([
      ['a', 'volt'],
      ['b', 'volt'],
      ['c', 'volt'],
      ['d', 'nova'],
      ['x', 'bogus'],
    ]);
    const out = balanceTeams(current, ['a', 'b', 'c', 'd', 'x', 'e'], teams);
    expect(out.size).toBe(6);
    expect(out.get('a')).toBe('volt');
    const sizes = [...teamSizes(out, teams).values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    // players who left are dropped
    expect(balanceTeams(out, ['a'], teams).size).toBe(1);
  });

  it('teamTotals: sum and average (empty teams score 0)', () => {
    const assignment = new Map([
      ['a', 'volt'],
      ['b', 'volt'],
      ['c', 'nova'],
    ]);
    const scores = { a: 100, b: 51, c: 90 };
    expect(teamTotals(scores, assignment, teams, 'sum')).toEqual({ volt: 151, nova: 90, wave: 0 });
    expect(teamTotals(scores, assignment, teams, 'average')).toEqual({ volt: 76, nova: 90, wave: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('text normalization', () => {
  it('normalizes case, accents, punctuation, ampersands and articles', () => {
    expect(normalizeAnswer('  The Beatles! ')).toBe('beatles');
    expect(normalizeAnswer('Pokémon')).toBe('pokemon');
    expect(normalizeAnswer('Ångström')).toBe('angstrom');
    expect(normalizeAnswer('Rock & Roll')).toBe('rock and roll');
    expect(normalizeAnswer("Rock 'n' Roll")).toBe('rock n roll');
    expect(normalizeAnswer('An Apple')).toBe('apple');
    expect(normalizeAnswer('A')).toBe('a');
    expect(normalizeAnswer('The')).toBe('the');
    expect(normalizeAnswer('Washington, D.C.')).toBe('washington d c');
    expect(answerKey('e-mail')).toBe('email');
  });

  it('matches exact answers and alternates', () => {
    expect(matchAnswer('the netherlands', ['Netherlands', 'Holland']).verdict).toBe('exact');
    expect(matchAnswer('HOLLAND', ['Netherlands', 'Holland']).matched).toBe('Holland');
    expect(matchAnswer('New York', ['NewYork']).verdict).toBe('exact');
    expect(matchAnswer('', ['x']).verdict).toBe('wrong');
  });

  it('tolerates small typos only where safe', () => {
    expect(matchAnswer('Mississipi', ['Mississippi'])).toMatchObject({ verdict: 'typo', distance: 1 });
    expect(matchAnswer('Misissipi', ['Mississippi'])).toMatchObject({ verdict: 'typo', distance: 2 });
    expect(matchAnswer('Misisipi', ['Mississippi']).verdict).toBe('wrong'); // 3 edits
    expect(matchAnswer('Pars', ['Paris']).verdict).toBe('typo');
    expect(matchAnswer('Parus', ['Paris']).verdict).toBe('typo');
    expect(matchAnswer('Pa', ['Paris']).verdict).toBe('wrong');
    expect(matchAnswer('Doris', ['Paris']).verdict).toBe('wrong'); // first letter must match
    expect(matchAnswer('Iron', ['Irun']).verdict).toBe('wrong'); // short answers exact only
    expect(matchAnswer('1970', ['1969']).verdict).toBe('wrong'); // digits never fuzzy
    expect(matchAnswer('Austria', ['Australia']).verdict).toBe('wrong'); // 9 letters → 1 edit allowed, this is 2
    expect(matchAnswer('Mississipi', ['Mississippi'], { typos: false }).verdict).toBe('wrong');
    expect(matchAnswer('Sweeden', ['Sweden'], { reject: ['Sweeden'] }).verdict).toBe('wrong');
  });

  it('allowedTypos thresholds', () => {
    expect(allowedTypos('abcd')).toBe(0);
    expect(allowedTypos('abcde')).toBe(1);
    expect(allowedTypos('abcdefghij')).toBe(1);
    expect(allowedTypos('abcdefghijk')).toBe(2);
    expect(allowedTypos('route66')).toBe(0);
  });

  it('parses typed numbers', () => {
    expect(parseNumberAnswer('1,234')).toBe(1234);
    expect(parseNumberAnswer(' 1 234 ')).toBe(1234);
    expect(parseNumberAnswer('-3.5')).toBe(-3.5);
    expect(parseNumberAnswer('+7')).toBe(7);
    expect(parseNumberAnswer('.5')).toBe(0.5);
    expect(parseNumberAnswer('1_000')).toBe(1000);
    expect(parseNumberAnswer('12,34')).toBeNull();
    expect(parseNumberAnswer('abc')).toBeNull();
    expect(parseNumberAnswer('1e5')).toBeNull();
    expect(parseNumberAnswer('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('anonymize', () => {
  it('shuffles deterministically with a seeded rng and assigns unique opaque keys', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const x = anonymize(items, createSeededRng('anon'));
    const y = anonymize(items, createSeededRng('anon'));
    expect(x).toEqual(y);
    expect(new Set(x.map((e) => e.key)).size).toBe(items.length);
    expect(x.map((e) => e.item).sort()).toEqual(items);
    expect(x.every((e) => /^[A-Za-z0-9]{10}$/.test(e.key))).toBe(true);
  });
});
