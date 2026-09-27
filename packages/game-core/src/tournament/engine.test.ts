import { describe, expect, it } from 'vitest';
import { createSeededRng, defaultTournamentConfig } from '@dascade/shared';
import { TournamentEngine, autoSwissRounds } from './engine.ts';
import { live, makeTournament, playGame, winSeries } from './testkit.ts';
import { TournamentError } from './types.ts';

const deps = (seed = 'x') => {
  let t = 1_000;
  return { rng: createSeededRng(seed), now: () => (t += 1000) };
};

function fresh(patch = {}) {
  return TournamentEngine.create({ ...defaultTournamentConfig('chess'), ...patch }, deps());
}

const reg = (e: TournamentEngine, name: string, identity: string | null = null, rating = 1200) =>
  e.register({ name, avatar: 'rocket', identity, rating, ratingGames: 0, provisional: true });

describe('tournament lifecycle', () => {
  it('starts as a draft and walks DRAFT → REGISTRATION → READY → IN_PROGRESS → COMPLETE', () => {
    const e = fresh({ maxField: 8 });
    expect(e.status).toBe('DRAFT');
    expect(() => reg(e, 'Early')).toThrow(TournamentError);
    e.openRegistration();
    expect(e.status).toBe('REGISTRATION');
    const a = reg(e, 'Ada', 'g:a');
    const b = reg(e, 'Bo', 'g:b');
    e.closeRegistration();
    expect(e.status).toBe('READY');
    e.begin();
    expect(e.status).toBe('IN_PROGRESS');
    expect(e.data.seedingMethod).toBe('random');
    const [m] = live(e);
    expect(m).toBeDefined();
    expect(new Set([m!.a, m!.b])).toEqual(new Set([a.id, b.id]));
    winSeries(e, m!, 'a');
    expect(e.status).toBe('COMPLETE');
    expect(e.data.championId).toBe(m!.a);
    expect(e.participant(m!.a!)!.status).toBe('champion');
    expect(e.data.audit.some((x) => x.action === 'complete')).toBe(true);
  });

  it('check-in: unconfirmed entries become no-shows and never enter the field', () => {
    const e = fresh({ checkIn: true, checkInMinutes: 5, maxField: 8 });
    e.openRegistration();
    const ps = ['A', 'B', 'C', 'D'].map((n, i) => reg(e, n, `g:${i}`));
    expect(() => e.begin()).toThrow(/check-in/i);
    e.closeRegistration();
    expect(e.status).toBe('CHECK_IN');
    expect(e.data.checkInEndsAt).toBeGreaterThan(0);
    e.setCheckIn(ps[0]!.id, true, 'participant');
    e.setCheckIn(ps[1]!.id, true, 'participant');
    e.setCheckIn(ps[2]!.id, true, 'organizer');
    // Late entry during check-in is checked in automatically.
    const late = reg(e, 'Late', 'g:late');
    expect(late.status).toBe('checked_in');
    // Deadline passes.
    expect(e.tick(e.data.checkInEndsAt + 1)).toBe(true);
    expect(e.status).toBe('READY');
    expect(e.participant(ps[3]!.id)!.status).toBe('no_show');
    e.begin();
    const field = e.data.participants.filter((p) => p.seed > 0).map((p) => p.id);
    expect(field).toHaveLength(4);
    expect(field).not.toContain(ps[3]!.id);
  });

  it('organizer can re-admit a no-show before the start', () => {
    const e = fresh({ checkIn: true });
    e.openRegistration();
    const a = reg(e, 'A', 'g:a');
    const b = reg(e, 'B', 'g:b');
    e.openCheckIn();
    e.setCheckIn(a.id, true, 'participant');
    e.closeCheckIn();
    expect(e.participant(b.id)!.status).toBe('no_show');
    expect(() => e.setCheckIn(b.id, true, 'participant')).toThrow();
    e.setCheckIn(b.id, true, 'organizer');
    e.begin();
    expect(live(e)).toHaveLength(1);
  });

  it('needs two participants to begin', () => {
    const e = fresh();
    e.openRegistration();
    reg(e, 'Solo');
    expect(() => e.begin()).toThrow(/two participants/);
  });

  it('rejects duplicates, full fields and closed registration', () => {
    const e = fresh({ maxField: 2 });
    e.openRegistration();
    reg(e, 'A', 'g:1');
    expect(() => reg(e, 'A again', 'g:1')).toThrow(/already registered/);
    reg(e, 'B', 'g:2');
    expect(() => reg(e, 'C', 'g:3')).toThrow(/full/);
    e.closeRegistration();
    expect(() => reg(e, 'D', 'g:4')).toThrow(/closed/);
  });

  it('makes names unique and cleans them', () => {
    const e = fresh();
    e.openRegistration();
    const a = reg(e, 'Sam');
    const b = reg(e, 'sam');
    const c = reg(e, '   ');
    expect(a.name).toBe('Sam');
    expect(b.name).not.toBe(a.name);
    expect(c.name.length).toBeGreaterThan(0);
  });

  it('withdrawal before the start removes the entry; after the start forfeits', () => {
    const { engine: e, ids } = makeTournament(4, { format: 'single_elimination' }, { begin: false });
    e.withdraw(ids[3]!);
    expect(e.participant(ids[3]!)).toBeUndefined();
    e.seed('manual', ids.slice(0, 3));
    e.begin();
    // 3 players: seed 1 gets a bye.
    const [m] = live(e);
    expect(new Set([m!.a, m!.b])).toEqual(new Set([ids[1], ids[2]]));
    e.withdraw(ids[1]!);
    expect(m!.status).toBe('FORFEIT');
    expect(m!.winner).toBe(ids[2]);
    expect(e.participant(ids[1]!)!.status).toBe('withdrawn');
  });

  it('config updates are validated and locked after the start', () => {
    const e = fresh();
    e.openRegistration();
    reg(e, 'A');
    reg(e, 'B');
    reg(e, 'C');
    expect(() => e.updateConfig({ ...e.data.config, maxField: 2 })).toThrow(/field/);
    expect(() => e.updateConfig({ ...e.data.config, gameId: 'checkers' })).toThrow(/draft/);
    e.updateConfig({ ...e.data.config, format: 'round_robin' });
    expect(e.data.config.format).toBe('round_robin');
    e.begin();
    expect(() => e.updateConfig({ ...e.data.config, bestOf: 3 })).toThrow(/locked/);
  });

  it('pause stops new matches; resume releases them', () => {
    const { engine: e } = makeTournament(4, { format: 'single_elimination' });
    e.pause();
    const [m1, m2] = live(e);
    winSeries(e, m1!, 'a');
    winSeries(e, m2!, 'a');
    const final = e.match('W2-1')!;
    expect(final.status).toBe('WAITING');
    expect(final.a).not.toBeNull();
    expect(final.b).not.toBeNull();
    e.resume();
    expect(final.status).toBe('READY');
  });

  it('cancel voids unfinished matches', () => {
    const { engine: e } = makeTournament(4);
    e.cancel('office closed');
    expect(e.status).toBe('CANCELLED');
    expect(e.data.matches.every((m) => m.status === 'VOID' || m.status === 'COMPLETE' || m.status === 'FORFEIT')).toBe(true);
    expect(() => e.cancel('again')).toThrow();
    expect(e.data.audit.at(-1)).toMatchObject({ action: 'cancel', reason: 'office closed' });
  });
});

describe('seeding', () => {
  it('manual order is applied exactly and validated', () => {
    const { engine: e, ids } = makeTournament(4, {}, { begin: false });
    const order = [ids[2]!, ids[0]!, ids[3]!, ids[1]!];
    e.seed('manual', order);
    expect(order.map((id) => e.participant(id)!.seed)).toEqual([1, 2, 3, 4]);
    expect(() => e.seed('manual', [ids[0]!, ids[1]!])).toThrow(/exactly once/);
    expect(() => e.seed('manual', [ids[0]!, ids[0]!, ids[1]!, ids[2]!])).toThrow();
    expect(() => e.seed('manual')).toThrow();
    expect(e.data.seedingMethod).toBe('manual');
  });

  it('rating seeding orders by DASCADE rating, ties by lot', () => {
    const { engine: e, ids } = makeTournament(5, {}, { begin: false, ratings: [1100, 1500, 1300, 1500, 900] });
    e.seed('rating');
    const bySeed = [...e.data.participants].sort((a, b) => a.seed - b.seed).map((p) => p.rating);
    expect(bySeed).toEqual([1500, 1500, 1300, 1100, 900]);
    expect(e.data.audit.at(-1)!.text).toMatch(/lot/);
    expect(ids).toHaveLength(5);
  });

  it('random seeding is a permutation and differs across seeds', () => {
    const orders = new Set<string>();
    for (let s = 0; s < 8; s++) {
      const { engine: e } = makeTournament(8, {}, { begin: false, seed: `rs${s}` });
      e.seed('random');
      const seeds = e.data.participants.map((p) => p.seed).sort((a, b) => a - b);
      expect(seeds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      orders.add(e.data.participants.map((p) => p.seed).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('late entries after seeding are seeded last at the start', () => {
    const { engine: e, ids } = makeTournament(3, {}, { begin: false });
    e.seed('manual', [ids[2]!, ids[1]!, ids[0]!]);
    const late = e.register({ name: 'Late', avatar: 'rocket', identity: 'g:late', rating: 2000, ratingGames: 5, provisional: true });
    e.begin();
    expect(e.participant(ids[2]!)!.seed).toBe(1);
    expect(e.participant(late.id)!.seed).toBe(4);
  });

  it('disqualifying before the start renumbers seeds', () => {
    const { engine: e, ids } = makeTournament(4, {}, { begin: false });
    e.seed('manual', ids);
    e.disqualify(ids[1]!, 'unsporting');
    expect(ids.map((id) => e.participant(id)!.seed)).toEqual([1, 0, 2, 3]);
    expect(() => e.register({ name: 'Back', avatar: 'rocket', identity: 'g:2', rating: 1200, ratingGames: 0, provisional: true })).toThrow(/already/);
  });
});

describe('results & idempotency', () => {
  it('a repeated or stale game report never advances anyone twice', () => {
    const { engine: e } = makeTournament(4, { bestOf: 3 });
    const m = live(e)[0]!;
    expect(playGame(e, m, 'a').accepted).toBe(true);
    const snapshot = JSON.stringify(e.data);
    // Same game number again.
    expect(e.recordGame(m.id, 1, m.a, 'dup')).toMatchObject({ accepted: false, reason: 'stale' });
    // A future game number.
    expect(e.recordGame(m.id, 3, m.a, 'skip')).toMatchObject({ accepted: false, reason: 'stale' });
    // A winner that is not in the match.
    expect(e.recordGame(m.id, 2, 'pNOBODY', 'x')).toMatchObject({ accepted: false, reason: 'invalid_winner' });
    expect(JSON.stringify(e.data)).toBe(snapshot);
    playGame(e, m, 'a');
    expect(m.status).toBe('COMPLETE');
    const after = JSON.stringify(e.data);
    expect(e.recordGame(m.id, 3, m.a, 'late')).toMatchObject({ accepted: false, reason: 'not_live' });
    expect(JSON.stringify(e.data)).toBe(after);
  });

  it('two concurrent completions give the same bracket in either order', () => {
    const run = (order: 0 | 1) => {
      const { engine: e } = makeTournament(8, { format: 'double_elimination' }, { seed: 'conc', fixedClock: true });
      const ms = live(e);
      const plan: Array<[typeof ms[number], 'a' | 'b']> = [
        [ms[0]!, 'a'],
        [ms[1]!, 'b'],
      ];
      if (order === 1) plan.reverse();
      for (const [m, side] of plan) winSeries(e, m, side);
      return e.data.matches.map((m) => `${m.id}:${m.status}:${m.a}:${m.b}:${m.winner}`).join('|');
    };
    expect(run(0)).toBe(run(1));
  });

  it('forfeit: the other participant wins and it is audited', () => {
    const { engine: e } = makeTournament(4);
    const m = live(e)[0]!;
    e.forfeit(m.id, m.a!, 'no-show', 'system');
    expect(m.status).toBe('FORFEIT');
    expect(m.winner).toBe(m.b);
    expect(m.resultKind).toBe('forfeit');
    expect(e.data.audit.at(-1)).toMatchObject({ actor: 'system', action: 'no_show', matchId: m.id });
    expect(() => e.forfeit(m.id, m.a!, 'again')).toThrow();
  });

  it('override decides a stuck match and writes an audit entry', () => {
    const { engine: e } = makeTournament(4);
    const m = live(e)[0]!;
    playGame(e, m, 'draw'); // Bo1 chess draw → deciders
    expect(m.status).toBe('IN_PROGRESS');
    expect(() => e.override(m.id, 'draw', null, 'agreed')).toThrow(/winner/);
    expect(() => e.override(m.id, 'win', 'pNOPE', 'agreed')).toThrow();
    e.override(m.id, 'win', m.b, 'server hiccup, both agreed');
    expect(m).toMatchObject({ status: 'COMPLETE', winner: m.b, resultKind: 'override' });
    expect(e.data.audit.at(-1)).toMatchObject({ action: 'override', reason: 'server hiccup, both agreed', matchId: m.id });
  });

  it('override can amend a finished result until the next match starts', () => {
    const { engine: e, ids } = makeTournament(4);
    const [m1, m2] = live(e);
    winSeries(e, m1!, 'a');
    const final = e.match('W2-1')!;
    expect(final.a).toBe(m1!.a);
    e.override(m1!.id, 'win', m1!.b, 'scoring error');
    expect(final.a).toBe(m1!.b);
    winSeries(e, m2!, 'a');
    playGame(e, final, 'draw');
    expect(final.status).toBe('IN_PROGRESS');
    expect(() => e.override(m1!.id, 'win', m1!.a, 'again')).toThrow(/already started/);
    expect(ids).toHaveLength(4);
  });

  it('disqualification mid-event forfeits the live match and later slots', () => {
    const { engine: e, ids } = makeTournament(8, { format: 'single_elimination' });
    const m = live(e).find((x) => x.a === ids[0])!;
    e.disqualify(ids[0]!, 'cheating');
    expect(m.status).toBe('FORFEIT');
    expect(m.resultKind).toBe('dq');
    expect(m.winner).toBe(m.b);
    expect(e.participant(ids[0]!)!.status).toBe('disqualified');
  });

  it('end: finishes early with standings (Swiss) and voids unfinished matches', () => {
    const { engine: e } = makeTournament(6, { format: 'swiss', swissRounds: 3 });
    for (const m of live(e)) winSeries(e, m, 'a');
    expect(e.data.roundsPaired).toBe(2);
    e.end('out of time');
    expect(e.status).toBe('COMPLETE');
    expect(e.data.endedEarly).toBe(true);
    expect(e.data.championId).not.toBeNull();
    expect(e.data.matches.filter((m) => m.round === 2).every((m) => m.status === 'VOID' || m.resultKind === 'bye')).toBe(true);
  });
});

describe('auto Swiss rounds', () => {
  it('scales with the field and never exceeds N-1', () => {
    expect(autoSwissRounds(2)).toBe(1);
    expect(autoSwissRounds(3)).toBe(2);
    expect(autoSwissRounds(4)).toBe(3);
    expect(autoSwissRounds(8)).toBe(3);
    expect(autoSwissRounds(16)).toBe(5);
    expect(autoSwissRounds(64)).toBe(7);
  });
});
