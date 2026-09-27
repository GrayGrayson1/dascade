import { describe, expect, it } from 'vitest';
import { createSeededRng, type TournamentSide } from '@dascade/shared';
import { roundRobinSchedule } from './brackets.ts';
import { tableStandings } from './standings.ts';
import { colourPreference, pairSwissRound, type SwissPlayer } from './swiss.ts';
import { invariantViolations, live, makeTournament, playGame, playout, winSeries } from './testkit.ts';

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

describe('round robin schedule (Berger)', () => {
  it('every pair meets exactly once; everyone plays at most once per round', () => {
    for (let n = 2; n <= 20; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const rounds = roundRobinSchedule(ids);
      expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
      const met = new Map<string, number>();
      for (const round of rounds) {
        const seen = new Set<string>();
        for (const p of round) {
          const players = 'bye' in p ? [p.bye] : [p.first, p.second];
          for (const x of players) {
            expect(seen.has(x)).toBe(false);
            seen.add(x);
          }
          if (!('bye' in p)) met.set(pairKey(p.first, p.second), (met.get(pairKey(p.first, p.second)) ?? 0) + 1);
        }
        expect(seen.size).toBe(n);
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      expect([...met.values()].every((v) => v === 1)).toBe(true);
    }
  });

  it('sides are balanced (±1) with no three in a row, and odd fields rest exactly once', () => {
    for (let n = 2; n <= 24; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const history = new Map<string, TournamentSide[]>(ids.map((id) => [id, []]));
      const byes = new Map<string, number>();
      for (const round of roundRobinSchedule(ids)) {
        for (const p of round) {
          if ('bye' in p) byes.set(p.bye, (byes.get(p.bye) ?? 0) + 1);
          else {
            history.get(p.first)!.push('first');
            history.get(p.second)!.push('second');
          }
        }
      }
      for (const [, sides] of history) {
        const firsts = sides.filter((s) => s === 'first').length;
        expect(Math.abs(firsts - (sides.length - firsts))).toBeLessThanOrEqual(1);
        for (let i = 2; i < sides.length; i++) expect(sides[i] === sides[i - 1] && sides[i] === sides[i - 2]).toBe(false);
      }
      if (n % 2 === 1) {
        expect(byes.size).toBe(n);
        expect([...byes.values()].every((v) => v === 1)).toBe(true);
      }
    }
  });
});

describe('round robin tournament', () => {
  it('plays everyone once and ranks by points then head-to-head', () => {
    const { engine: e, ids } = makeTournament(4, { format: 'round_robin' });
    // Seed order wins: lower index beats higher index, except P4 beats P1.
    while (e.status === 'IN_PROGRESS') {
      const m = live(e)[0]!;
      const ia = ids.indexOf(m.a!);
      const ib = ids.indexOf(m.b!);
      const aWins = (ia === 3 && ib === 0) || (!(ib === 3 && ia === 0) && ia < ib);
      winSeries(e, m, aWins ? 'a' : 'b');
    }
    const st = e.standings();
    expect(st.final).toBe(true);
    // P1 2 pts, P2 2 pts, P3 1 pt, P4 1 pt. P1 beat P2 → P1 first (head-to-head).
    // P3 and P4 have 1 point each; P3 beat P4 → P3 third.
    expect(st.rows.map((r) => [r.participantId, r.points])).toEqual([
      [ids[0], 2],
      [ids[1], 2],
      [ids[2], 1],
      [ids[3], 1],
    ]);
    expect(st.rows[0]!.tiebreaks.direct_encounter).toBe(1);
    expect(e.data.championId).toBe(ids[0]);
  });

  it('property: no participant ever has two live matches; odd fields get byes worth nothing', () => {
    const rng = createSeededRng('rr-prop');
    for (let trial = 0; trial < 40; trial++) {
      const n = 2 + rng.int(11);
      const { engine: e } = makeTournament(n, { format: 'round_robin', bestOf: [1, 2, 3][rng.int(3)]! }, { seed: `rr${trial}` });
      playout(e, rng, { drawRate: 0.25, check: () => expect(invariantViolations(e)).toEqual([]) });
      expect(e.status).toBe('COMPLETE');
      const played = e.data.matches.filter((m) => m.b !== null);
      expect(played).toHaveLength((n * (n - 1)) / 2);
      const st = e.standings();
      const total = st.rows.reduce((s, r) => s + r.points, 0);
      expect(total).toBe((n * (n - 1)) / 2); // one point per match; byes score 0
      expect(st.rows.filter((r) => r.rank === 1).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('a withdrawal forfeits the remaining schedule', () => {
    const { engine: e, ids } = makeTournament(4, { format: 'round_robin' });
    e.withdraw(ids[0]!);
    const theirs = e.data.matches.filter((m) => m.a === ids[0] || m.b === ids[0]);
    expect(theirs.every((m) => m.status === 'FORFEIT' && m.winner !== ids[0])).toBe(true);
    playout(e, createSeededRng('w'), {});
    expect(e.status).toBe('COMPLETE');
    const row = e.standings().rows.find((r) => r.participantId === ids[0])!;
    expect(row.rank).toBe(0);
  });
});

describe('swiss pairing', () => {
  const player = (id: string, points: number, seed: number, extra: Partial<SwissPlayer> = {}): SwissPlayer => ({
    id,
    points,
    seed,
    opponents: [],
    byes: 0,
    sides: [],
    ...extra,
  });

  it('round 1: top half v bottom half, bye to the lowest seed, board colours alternate', () => {
    const ps = Array.from({ length: 7 }, (_, i) => player(`p${i + 1}`, 0, i + 1));
    const r = pairSwissRound(ps, 1, { sides: true, rng: createSeededRng('r1') });
    expect(r.bye).toBe('p7');
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p5'],
      ['p3', 'p6'],
    ]);
    const tops = r.pairs.map((p) => p.firstId === p.a);
    expect(tops[0]).not.toBe(tops[1]);
    expect(tops[1]).not.toBe(tops[2]);
  });

  it('colour preferences follow the Dutch rules', () => {
    expect(colourPreference([])).toEqual({ want: null, strength: 0 });
    expect(colourPreference(['first'])).toEqual({ want: 'second', strength: 2 });
    expect(colourPreference(['first', 'second'])).toEqual({ want: 'first', strength: 1 });
    expect(colourPreference(['second', 'second'])).toEqual({ want: 'first', strength: 3 });
    expect(colourPreference(['first', 'second', 'first'])).toEqual({ want: 'second', strength: 2 });
    expect(colourPreference(['first', 'first', 'second', 'first'])).toEqual({ want: 'second', strength: 3 });
  });

  it('pairs within score groups and avoids rematches', () => {
    const ps = [
      player('a', 1, 1, { opponents: ['e'] }),
      player('b', 1, 2, { opponents: ['f'] }),
      player('c', 1, 3, { opponents: ['g'] }),
      player('d', 1, 4, { opponents: ['h'] }),
      player('e', 0, 5, { opponents: ['a'] }),
      player('f', 0, 6, { opponents: ['b'] }),
      player('g', 0, 7, { opponents: ['c'] }),
      player('h', 0, 8, { opponents: ['d'] }),
    ];
    const r = pairSwissRound(ps, 2, { sides: false, rng: createSeededRng('r2') });
    expect(r.compromises).toEqual([]);
    const groupOf = new Map(ps.map((p) => [p.id, p.points]));
    for (const pair of r.pairs) expect(groupOf.get(pair.a)).toBe(groupOf.get(pair.b));
    // Dutch shape inside the 1-point group: 1 v 3, 2 v 4.
    expect(r.pairs.slice(0, 2).map((p) => [p.a, p.b])).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('gives the bye to the lowest-ranked player without one', () => {
    const ps = [
      player('a', 2, 1, { opponents: ['b', 'c'] }),
      player('b', 1, 2, { opponents: ['a', 'd'] }),
      player('c', 1, 3, { opponents: ['e', 'a'] }),
      player('d', 1, 4, { opponents: ['b'], byes: 1 }),
      player('e', 0, 5, { opponents: ['c'], byes: 1 }),
    ];
    const r = pairSwissRound(ps, 3, { sides: false, rng: createSeededRng('bye') });
    expect(r.bye).toBe('c');
    expect(r.compromises).toEqual([]);
  });

  it('never sends the same side three times in a row when avoidable', () => {
    const ps = [
      player('a', 2, 1, { opponents: ['x1', 'x2'], sides: ['first', 'first'] }),
      player('b', 2, 2, { opponents: ['x3', 'x4'], sides: ['first', 'first'] }),
      player('c', 2, 3, { opponents: ['x5', 'x6'], sides: ['second', 'second'] }),
      player('d', 2, 4, { opponents: ['x7', 'x8'], sides: ['second', 'second'] }),
    ];
    const r = pairSwissRound(ps, 3, { sides: true, rng: createSeededRng('col') });
    for (const pair of r.pairs) {
      const firstPlayer = ps.find((p) => p.id === pair.firstId)!;
      expect(firstPlayer.sides.at(-1)).toBe('second');
    }
    expect(r.compromises).toEqual([]);
  });

  it('property: full Swiss events — no rematches, at most one bye each, balanced sides', () => {
    const rng = createSeededRng('swiss-prop');
    let checked = 0;
    for (let trial = 0; trial < 80; trial++) {
      const n = 4 + rng.int(40);
      const { engine: e } = makeTournament(n, { format: 'swiss', swissRounds: 0, bestOf: [1, 2, 3][rng.int(3)]! }, { seed: `sw${trial}` });
      const rounds = e.data.totalRounds;
      playout(e, rng, { drawRate: 0.2, check: () => expect(invariantViolations(e)).toEqual([]) });
      expect(e.status).toBe('COMPLETE');
      expect(e.data.roundsPaired).toBe(rounds);
      const met = new Set<string>();
      for (const m of e.data.matches) {
        if (!m.a || !m.b) continue;
        const k = pairKey(m.a, m.b);
        expect(met.has(k)).toBe(false);
        met.add(k);
      }
      for (const p of e.data.participants) {
        expect(p.byes).toBeLessThanOrEqual(1);
        const firsts = p.sides.filter((s) => s === 'first').length;
        expect(Math.abs(firsts - (p.sides.length - firsts))).toBeLessThanOrEqual(2);
        for (let i = 2; i < p.sides.length; i++) expect(p.sides[i] === p.sides[i - 1] && p.sides[i] === p.sides[i - 2]).toBe(false);
      }
      expect(e.data.audit.filter((a) => a.action === 'pairing')).toEqual([]);
      checked++;
    }
    expect(checked).toBe(80);
  });

  it('standings expose Buchholz, Sonneborn-Berger and friends', () => {
    const { engine: e, ids } = makeTournament(4, { format: 'swiss', swissRounds: 2 });
    // Round 1: 1 v 3, 2 v 4 (seed order). Top seeds win.
    for (const m of live(e)) winSeries(e, m, 'a');
    // Round 2: winners meet, losers meet; draw both.
    for (const m of live(e)) playGame(e, m, 'draw');
    expect(e.status).toBe('COMPLETE');
    const st = tableStandings(e.data);
    expect(st.tiebreaks).toEqual(['buchholz_cut1', 'buchholz', 'sonneborn_berger', 'direct_encounter', 'wins', 'progressive']);
    const row = (id: string) => st.rows.find((r) => r.participantId === id)!;
    expect(row(ids[0]!).points).toBe(1.5);
    expect(row(ids[1]!).points).toBe(1.5);
    // P1 met P3 (0.5) and P2 (1.5): BH 2, cut-1 1.5; SB = 1×0.5 + 0.5×1.5 = 1.25.
    expect(row(ids[0]!).tiebreaks).toMatchObject({ buchholz: 2, buchholz_cut1: 1.5, sonneborn_berger: 1.25, wins: 1, progressive: 2.5 });
    expect(st.rows[0]!.rank).toBe(1);
    expect(st.rows[0]!.shared).toBe(true); // P1 and P2 identical on every tiebreak
    expect(st.rows[1]!.rank).toBe(1);
    expect(st.rows[0]!.participantId).toBe(ids[0]); // better seed listed first
  });

  it('never pairs a disqualified player again', () => {
    const { engine: e, ids } = makeTournament(6, { format: 'swiss', swissRounds: 3 });
    for (const m of live(e)) winSeries(e, m, 'a');
    e.disqualify(ids[0]!, 'left');
    for (const m of e.data.matches.filter((x) => x.round === 2)) {
      if (m.status === 'READY') expect([m.a, m.b]).not.toContain(ids[0]);
    }
    playout(e, createSeededRng('dq'), { check: () => expect(invariantViolations(e)).toEqual([]) });
    expect(e.status).toBe('COMPLETE');
    expect(e.data.matches.filter((m) => m.round === 3).some((m) => m.a === ids[0] || m.b === ids[0])).toBe(false);
  });

  it('amending a finished Swiss result re-pairs the next (unstarted) round', () => {
    const { engine: e } = makeTournament(4, { format: 'swiss', swissRounds: 3 });
    const r1 = live(e);
    for (const m of r1) winSeries(e, m, 'a');
    const before = e.data.matches.filter((m) => m.round === 2).map((m) => `${m.a}-${m.b}`);
    expect(before).toHaveLength(2);
    e.override(r1[0]!.id, 'win', r1[0]!.b, 'wrong result reported');
    expect(e.data.roundsPaired).toBe(2);
    const after = e.data.matches.filter((m) => m.round === 2);
    expect(after).toHaveLength(2);
    expect(after.every((m) => m.status === 'READY')).toBe(true);
    expect(invariantViolations(e)).toEqual([]);
  });
});
