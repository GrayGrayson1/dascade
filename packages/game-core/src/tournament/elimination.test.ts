import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { bracketSize, buildDoubleElimination, buildSingleElimination, seedOrder } from './brackets.ts';
import { isFinished } from './standings.ts';
import { invariantViolations, live, makeTournament, playGame, playout, winSeries } from './testkit.ts';
import type { EngineMatch } from './types.ts';

describe('bracket structure', () => {
  it('bracket size and standard seed order', () => {
    expect([2, 3, 4, 5, 8, 9, 16, 33, 64].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16, 16, 64, 64]);
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // Every first-round pair sums to size + 1; seeds 1 and 2 are in opposite halves.
    for (const size of [4, 8, 16, 32, 64]) {
      const order = seedOrder(size);
      for (let i = 0; i < size; i += 2) expect(order[i]! + order[i + 1]!).toBe(size + 1);
      expect(order.indexOf(1) < size / 2).not.toBe(order.indexOf(2) < size / 2);
    }
  });

  it('single elimination links every match to exactly one next match (except the final)', () => {
    for (const n of [2, 3, 5, 8, 13, 16, 64]) {
      const ms = buildSingleElimination(n, 1);
      expect(ms).toHaveLength(bracketSize(n) - 1);
      const finals = ms.filter((m) => !m.next);
      expect(finals).toHaveLength(1);
      expect(finals[0]!.roundLabel).toBe('Final');
    }
    const labels = [...new Set(buildSingleElimination(16, 1).map((m) => m.roundLabel))];
    expect(labels).toEqual(['Round of 16', 'Quarterfinal', 'Semifinal', 'Final']);
  });

  it('double elimination: every winners-bracket loser drops into exactly one losers slot', () => {
    for (const n of [2, 3, 4, 6, 8, 12, 16, 32, 64]) {
      const ms = buildDoubleElimination(n, 1, true);
      const byId = new Map(ms.map((m) => [m.id, m]));
      const size = bracketSize(n);
      const k = Math.log2(size);
      const wb = ms.filter((m) => m.bracket === 'winners');
      const lb = ms.filter((m) => m.bracket === 'losers');
      expect(wb).toHaveLength(size - 1);
      expect(lb).toHaveLength(size > 2 ? size - 2 : 0);
      expect(new Set(lb.map((m) => m.round)).size).toBe(2 * (k - 1));
      // Each WB match's loser is referenced by exactly one slot.
      for (const m of wb) {
        const refs = ms.filter((x) => !x.conditional && x.sources.some((s) => s?.kind === 'loser' && s.matchId === m.id));
        expect(refs).toHaveLength(1);
        expect(m.loserNext?.matchId).toBe(refs[0]!.id);
      }
      // The WB final loser meets the losers champion in the LB final (or the grand final when there's no LB).
      const wbFinalLoserDest = byId.get(`W${k}-1`)!.loserNext!.matchId;
      expect(wbFinalLoserDest).toBe(size > 2 ? `L${2 * (k - 1)}-1` : 'GF');
      expect(byId.get('GF2')!.conditional).toBe(true);
    }
  });

  it('double elimination drop-ins avoid immediate rematches in a full bracket', () => {
    const rng = createSeededRng('dropins');
    for (const n of [8, 16, 32]) {
      for (let trial = 0; trial < 30; trial++) {
        const { engine: e } = makeTournament(n, { format: 'double_elimination' }, { seed: `d${n}-${trial}` });
        const met = new Set<string>();
        const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
        let firstDropRoundRematch = 0;
        while (e.status === 'IN_PROGRESS') {
          const ms = live(e);
          const m = ms[rng.int(ms.length)]!;
          if (m.bracket === 'losers' && m.round === 2 && met.has(key(m.a!, m.b!))) firstDropRoundRematch++;
          met.add(key(m.a!, m.b!));
          winSeries(e, m, rng.int(2) === 0 ? 'a' : 'b');
        }
        expect(firstDropRoundRematch).toBe(0);
      }
    }
  });
});

describe('single elimination', () => {
  it('byes go to the top seeds and advance automatically', () => {
    const { engine: e, ids } = makeTournament(5, { format: 'single_elimination' });
    // Size 8: seeds 1, 2, 3 have byes (their opponents 8, 7, 6 don't exist).
    const byes = e.data.matches.filter((m) => m.resultKind === 'bye');
    expect(byes.map((m) => m.winner).sort()).toEqual([ids[0], ids[1], ids[2]].sort());
    expect(byes.every((m) => m.status === 'COMPLETE')).toBe(true);
    // Seeds 4 v 5 play round 1; seed 1 waits for that winner; seeds 2 and 3 already meet in round 2.
    const ready = live(e);
    expect(ready.map((m) => m.id).sort()).toEqual(['W1-2', 'W2-2']);
    expect(new Set([e.match('W1-2')!.a, e.match('W1-2')!.b])).toEqual(new Set([ids[3], ids[4]]));
    expect(new Set([e.match('W2-2')!.a, e.match('W2-2')!.b])).toEqual(new Set([ids[1], ids[2]]));
    expect(e.match('W2-1')).toMatchObject({ status: 'WAITING', a: ids[0], b: null });
  });

  it('two players: one match decides the champion', () => {
    const { engine: e, ids } = makeTournament(2, { format: 'single_elimination' });
    const m = live(e)[0]!;
    winSeries(e, m, 'b');
    expect(e.status).toBe('COMPLETE');
    expect(e.data.championId).toBe(m.b);
    const standings = e.standings();
    expect(standings.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(ids).toContain(e.data.championId);
  });

  it('places: final loser 2nd, semifinal losers share 3rd, quarterfinal losers share 5th', () => {
    const { engine: e } = makeTournament(8, { format: 'single_elimination' });
    while (e.status === 'IN_PROGRESS') winSeries(e, live(e)[0]!, 'a');
    const rows = e.standings().rows;
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
    expect(rows.filter((r) => r.shared).length).toBe(6);
    expect(rows[1]!.eliminatedIn).toBe('Final');
    expect(rows[2]!.eliminatedIn).toBe('Semifinal');
  });

  it('property: random playouts always end with exactly one unbeaten champion', () => {
    const rng = createSeededRng('se-prop');
    for (let trial = 0; trial < 120; trial++) {
      const n = 2 + rng.int(63);
      const bestOf = [1, 3, 5][rng.int(3)]!;
      const { engine: e } = makeTournament(n, { format: 'single_elimination', bestOf }, { seed: `se${trial}` });
      playout(e, rng, {
        drawRate: 0.2,
        check: () => expect(invariantViolations(e)).toEqual([]),
      });
      expect(e.status).toBe('COMPLETE');
      const champ = e.data.championId!;
      expect(champ).toBeTruthy();
      const decided = e.data.matches.filter((m) => m.status !== 'VOID' && m.resultKind !== 'bye');
      expect(decided).toHaveLength(n - 1);
      expect(decided.filter((m) => m.loser === champ)).toHaveLength(0);
      // Everyone else lost exactly once.
      for (const p of e.data.participants) {
        if (p.id === champ) continue;
        expect(decided.filter((m) => m.loser === p.id)).toHaveLength(1);
        expect(p.status).toBe('eliminated');
      }
    }
  });
});

describe('double elimination', () => {
  function losses(ms: EngineMatch[], pid: string) {
    return ms.filter((m) => m.loser === pid && m.resultKind !== 'bye').length;
  }

  it('grand final reset is played only when the losers champion wins the grand final', () => {
    for (const lbWins of [false, true]) {
      const { engine: e, ids } = makeTournament(4, { format: 'double_elimination' });
      // Top seeds win every winners-bracket and losers-bracket match.
      while (!e.match('GF') || e.match('GF')!.status !== 'READY') {
        const m = live(e)[0]!;
        const aSeed = e.participant(m.a!)!.seed;
        const bSeed = e.participant(m.b!)!.seed;
        winSeries(e, m, aSeed < bSeed ? 'a' : 'b');
      }
      const gf = e.match('GF')!;
      expect(gf.a).toBe(ids[0]); // WB champion (seed 1)
      winSeries(e, gf, lbWins ? 'b' : 'a');
      const reset = e.match('GF2')!;
      if (!lbWins) {
        expect(reset.status).toBe('VOID');
        expect(e.status).toBe('COMPLETE');
        expect(e.data.championId).toBe(ids[0]);
      } else {
        expect(reset.status).toBe('READY');
        expect(new Set([reset.a, reset.b])).toEqual(new Set([gf.a, gf.b]));
        winSeries(e, reset, 'b');
        expect(e.status).toBe('COMPLETE');
        expect(e.data.championId).toBe(gf.b);
      }
    }
  });

  it('without reset the grand final decides it', () => {
    const { engine: e } = makeTournament(4, { format: 'double_elimination', grandFinalReset: false });
    while (e.status === 'IN_PROGRESS') {
      const m = live(e)[0]!;
      winSeries(e, m, m.bracket === 'grand_final' ? 'b' : 'a');
    }
    expect(e.match('GF2')).toBeUndefined();
    expect(e.data.championId).toBe(e.match('GF')!.b);
  });

  it('property: nobody is eliminated before two losses; the champion lost at most once', () => {
    const rng = createSeededRng('de-prop');
    for (let trial = 0; trial < 120; trial++) {
      const n = 2 + rng.int(40);
      const { engine: e } = makeTournament(n, { format: 'double_elimination', grandFinalReset: rng.int(4) !== 0 }, { seed: `de${trial}` });
      const lostInWinners = new Set<string>();
      playout(e, rng, {
        drawRate: 0.1,
        check: () => {
          expect(invariantViolations(e)).toEqual([]);
          for (const m of e.data.matches) {
            if (m.bracket === 'winners' && isFinished(m) && m.loser) lostInWinners.add(m.loser);
            // An eliminated / dropped player never re-enters the winners bracket.
            if (m.bracket === 'winners' && !isFinished(m) && m.status !== 'WAITING') {
              expect(lostInWinners.has(m.a!)).toBe(false);
              expect(lostInWinners.has(m.b!)).toBe(false);
            }
          }
        },
      });
      expect(e.status).toBe('COMPLETE');
      const champ = e.data.championId!;
      expect(champ).toBeTruthy();
      const all = e.data.matches;
      expect(losses(all, champ)).toBeLessThanOrEqual(1);
      for (const p of e.data.participants) {
        if (p.id === champ) continue;
        expect(p.status).toBe('eliminated');
        // Two losses — except the winners champion beaten in a grand final without a reset (one loss).
        const noResetGfLoser = !e.match('GF2') && e.match('GF')!.loser === p.id && e.match('GF')!.a === p.id;
        expect(losses(all, p.id)).toBe(noResetGfLoser ? 1 : 2);
      }
    }
  });

  it('standings: 2nd from the grand final, 3rd from the losers final', () => {
    const { engine: e } = makeTournament(8, { format: 'double_elimination' });
    while (e.status === 'IN_PROGRESS') {
      const m = live(e)[0]!;
      winSeries(e, m, e.participant(m.a!)!.seed < e.participant(m.b!)!.seed ? 'a' : 'b');
    }
    const rows = e.standings().rows;
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    expect(rows[1]!.eliminatedIn).toBe('Grand final');
    expect(rows[2]!.eliminatedIn).toBe('Losers final');
  });

  it('a disqualified player’s future slot becomes a walkover', () => {
    const { engine: e, ids } = makeTournament(4, { format: 'double_elimination' });
    const [m1] = live(e);
    const loser = m1!.a === ids[0] ? m1!.b! : m1!.a!;
    winSeries(e, m1!, m1!.a === ids[0] ? 'a' : 'b');
    e.disqualify(loser, 'left the office');
    const l1 = e.match('L1-1')!;
    // The other WB round-1 match is still running; when it finishes, its loser gets the LB walkover.
    const m2 = live(e).find((m) => m.bracket === 'winners' && m.round === 1)!;
    winSeries(e, m2, 'a');
    expect(l1.status).toBe('FORFEIT');
    expect(l1.winner).toBe(m2.b);
    expect(invariantViolations(e)).toEqual([]);
  });
});

describe('series inside a bracket', () => {
  it('best of 3 plays until decided; chess sides alternate', () => {
    const { engine: e } = makeTournament(2, { format: 'single_elimination', bestOf: 3 });
    const m = live(e)[0]!;
    expect(m.firstId).not.toBeNull();
    const first = m.firstId!;
    playGame(e, m, 'a');
    expect(e.nextGame(m)).toMatchObject({ n: 2, firstId: first === m.a ? m.b : m.a });
    playGame(e, m, 'b');
    playGame(e, m, 'a');
    expect(m.status).toBe('COMPLETE');
    expect(m.winner).toBe(m.a);
    expect(m.games.map((g) => g.firstId)).toEqual([first, first === m.a ? m.b : m.a, first]);
  });

  it('elimination draws go to deciders, Armageddon last (chess)', () => {
    const { engine: e } = makeTournament(2, { format: 'single_elimination', bestOf: 1 });
    const m = live(e)[0]!;
    playGame(e, m, 'draw');
    expect(e.nextGame(m)).toMatchObject({ n: 2, decider: 'sudden_death' });
    playGame(e, m, 'draw');
    expect(e.nextGame(m)).toMatchObject({ n: 3, decider: 'armageddon' });
    const armFirst = e.nextGame(m)!.firstId!;
    playGame(e, m, 'draw');
    expect(m.status).toBe('COMPLETE');
    expect(m.winner).toBe(armFirst === m.a ? m.b : m.a);
    expect(m.resultNote).toBe('Armageddon');
  });

  it('side-less game level after every decider is decided by lot (audited)', () => {
    const { engine: e } = makeTournament(2, { format: 'single_elimination', bestOf: 1 }, { gameId: 'putt' });
    const m = live(e)[0]!;
    expect(m.firstId).toBeNull();
    playGame(e, m, 'draw');
    playGame(e, m, 'draw');
    playGame(e, m, 'draw');
    expect(m).toMatchObject({ status: 'COMPLETE', resultKind: 'lots' });
    expect([m.a, m.b]).toContain(m.winner);
    expect(e.data.audit.some((x) => x.action === 'lots')).toBe(true);
  });
});
