import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import {
  DECEPTION_LIMITS,
  DEFAULT_DECEPTION_SETTINGS,
  planSetup,
  roleTeam,
  type DeceptionRole,
  type DeceptionSettings,
} from '@dascade/shared/games/deception';
import { DECEPTION_POINTS, DeceptionGame } from './game.ts';

/** g1/g2 Glitches, jm Jammer, sc Scanner, fw Firewall, tr Tracer, su Sudo, s1..s3 Sysops. */
const ROLES: Array<[string, DeceptionRole]> = [
  ['g1', 'glitch'],
  ['g2', 'glitch'],
  ['jm', 'jammer'],
  ['sc', 'scanner'],
  ['fw', 'firewall'],
  ['tr', 'tracer'],
  ['su', 'sudo'],
  ['s1', 'sysop'],
  ['s2', 'sysop'],
  ['s3', 'sysop'],
];
const fresh = (roles: Array<[string, DeceptionRole]> = ROLES) => new DeceptionGame(new Map(roles));
const rng = (seed: string | number = 1) => createSeededRng(seed);
const VOTE = { allowSkip: true } as const;
const RULES = { allowSkip: true, tieRule: 'runoff' } as const;

describe('queries', () => {
  it('exposes roles, teams and the Glitch roster', () => {
    const g = fresh();
    expect(g.roleOf('sc')).toBe('scanner');
    expect(g.teamOf('jm')).toBe('glitches');
    expect(g.roleOf('nobody')).toBeNull();
    expect(g.glitchRoster()).toEqual([
      { id: 'g1', role: 'glitch', alive: true },
      { id: 'g2', role: 'glitch', alive: true },
      { id: 'jm', role: 'jammer', alive: true },
    ]);
    expect(g.livingOf('sysops')).toHaveLength(7);
  });

  it('lists the night actions per role', () => {
    const g = fresh();
    expect(g.actionsOf('g1')).toEqual(['attack']);
    expect(g.actionsOf('jm')).toEqual(['attack', 'jam']);
    expect(g.actionsOf('sc')).toEqual(['scan']);
    expect(g.actionsOf('fw')).toEqual(['shield']);
    expect(g.actionsOf('tr')).toEqual([]);
    expect(g.actionsOf('su')).toEqual([]);
    expect(g.actionsOf('s1')).toEqual([]);
  });

  it('deals a planned setup', () => {
    const setup = planSetup(10, DEFAULT_DECEPTION_SETTINGS);
    if (!setup.ok) throw new Error(setup.error);
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const g = DeceptionGame.deal(ids, setup.setup, rng('deal'));
    expect(g.alive()).toEqual(ids);
    expect(g.livingOf('glitches')).toHaveLength(3);
  });
});

describe('night actions', () => {
  it('are refused outside the night', () => {
    const g = fresh();
    expect(g.submitAction('sc', 'scan', 'g1')).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('validate role, status and target per ability', () => {
    const g = fresh();
    g.beginNight();
    expect(g.submitAction('s1', 'scan', 'g1')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.submitAction('g1', 'jam', 'sc')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.submitAction('ghost', 'attack', 's1')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.submitAction('sc', 'scan', 'sc')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('jm', 'jam', 'jm')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('jm', 'jam', 'g1')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('g1', 'attack', 'g2')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('g1', 'attack', 'nobody')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('fw', 'shield', 'fw')).toEqual({ ok: true });
    expect(g.submitAction('sc', 'scan', 'g1', true)).toEqual({ ok: true });
  });

  it('can change an unlocked pick but never a locked one', () => {
    const g = fresh();
    g.beginNight();
    expect(g.submitAction('g1', 'attack', 's1')).toEqual({ ok: true });
    expect(g.submitAction('g1', 'attack', 's2')).toEqual({ ok: true });
    expect(g.submitAction('g1', 'attack', null)).toEqual({ ok: true });
    expect(g.picksOf('g1')).toEqual({ attack: { target: null, locked: false } });
    expect(g.submitAction('g1', 'attack', null, true)).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('g1', 'attack', 's3', true)).toEqual({ ok: true });
    expect(g.submitAction('g1', 'attack', 's1')).toMatchObject({ ok: false, code: 'locked' });
    expect(g.picksOf('g1')).toEqual({ attack: { target: 's3', locked: true } });
  });

  it('shows the Glitch team every living Glitch’s pick', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 's1');
    g.submitAction('jm', 'attack', 's2', true);
    expect(g.teamPicks()).toEqual([
      { id: 'g1', target: 's1', locked: false },
      { id: 'g2', target: null, locked: false },
      { id: 'jm', target: 's2', locked: true },
    ]);
  });

  it('knows when every (active) actor has locked in', () => {
    const g = fresh();
    g.beginNight();
    const lockAll = (except: string[] = []) => {
      for (const id of ['g1', 'g2'].filter((x) => !except.includes(x))) g.submitAction(id, 'attack', 's1', true);
      if (!except.includes('jm')) {
        g.submitAction('jm', 'attack', 's1', true);
        g.submitAction('jm', 'jam', 's2', true);
      }
      if (!except.includes('sc')) g.submitAction('sc', 'scan', 'g1', true);
      if (!except.includes('fw')) g.submitAction('fw', 'shield', 's3', true);
    };
    lockAll(['fw']);
    expect(g.nightDone()).toBe(false);
    expect(g.nightDone((id) => id !== 'fw')).toBe(true);
    g.submitAction('fw', 'shield', 's3', true);
    expect(g.nightDone()).toBe(true);
  });

  it('a Jammer is only done once both the attack and the jam are locked', () => {
    const g = fresh([
      ['jm', 'jammer'],
      ['a', 'sysop'],
      ['b', 'sysop'],
      ['c', 'sysop'],
    ]);
    g.beginNight();
    g.submitAction('jm', 'attack', 'a', true);
    expect(g.nightDone()).toBe(false);
    g.submitAction('jm', 'jam', 'b', true);
    expect(g.nightDone()).toBe(true);
  });
});

describe('night resolution', () => {
  it('corrupts the target, records intel for every ability and the recap', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 's1', true);
    g.submitAction('g2', 'attack', 's1', true);
    g.submitAction('jm', 'attack', 's1', true);
    g.submitAction('jm', 'jam', 's2', true);
    g.submitAction('sc', 'scan', 'g2', true);
    g.submitAction('fw', 'shield', 's3', true);
    const out = g.resolveNight(rng());
    expect(out.corrupted).toBe('s1');
    expect(g.isAlive('s1')).toBe(false);
    expect(g.seats.get('s1')).toMatchObject({ fate: 'corrupted', outCycle: 1 });
    expect(g.intelOf('sc')).toEqual([{ kind: 'scan', cycle: 1, targetId: 'g2', result: 'glitch' }]);
    expect(g.intelOf('fw')).toEqual([{ kind: 'shield', cycle: 1, targetId: 's3', outcome: 'quiet' }]);
    expect(g.intelOf('jm')).toContainEqual({ kind: 'jam', cycle: 1, targetId: 's2' });
    expect(g.intelOf('g1')).toEqual([{ kind: 'attack', cycle: 1, targetId: 's1', outcome: 'corrupted' }]);
    const clue = g.intelOf('tr')[0];
    expect(clue).toMatchObject({ kind: 'clue', cycle: 1, jammed: false });
    expect(g.intelOf('s2')).toEqual([]);
    expect(g.intelOf('su')).toEqual([]);
    expect(g.nights).toHaveLength(1);
    expect(g.nights[0]).toMatchObject({ cycle: 1, attackTarget: 's1', blocked: false });
    expect(g.isNight).toBe(false);
  });

  it('reports a held shield to the Firewall and the Glitches', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 'sc');
    g.submitAction('fw', 'shield', 'sc', true);
    const out = g.resolveNight(rng());
    expect(out.blocked).toBe(true);
    expect(g.isAlive('sc')).toBe(true);
    expect(g.intelOf('fw')).toEqual([{ kind: 'shield', cycle: 1, targetId: 'sc', outcome: 'held' }]);
    expect(g.intelOf('g2')).toEqual([{ kind: 'attack', cycle: 1, targetId: 'sc', outcome: 'blocked' }]);
  });

  it('counts unlocked picks when the timer runs out', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 's2');
    g.submitAction('sc', 'scan', 'jm');
    const out = g.resolveNight(rng());
    expect(out.corrupted).toBe('s2');
    expect(g.intelOf('sc')[0]).toMatchObject({ result: 'glitch' });
  });

  it('forbids shielding the same player two nights in a row (a skipped night resets it)', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('fw', 'shield', 's1', true);
    g.resolveNight(rng());
    expect(g.lastShieldOf('fw')).toBe('s1');
    g.beginNight();
    expect(g.submitAction('fw', 'shield', 's1')).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.submitAction('fw', 'shield', 'fw', true)).toEqual({ ok: true });
    g.resolveNight(rng());
    g.beginNight();
    expect(g.submitAction('fw', 'shield', 's1')).toEqual({ ok: true });
    g.submitAction('fw', 'shield', null);
    g.resolveNight(rng());
    expect(g.lastShieldOf('fw')).toBeNull();
  });

  it('the no-repeat rule applies even when last night’s shield was jammed', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('fw', 'shield', 's1', true);
    g.submitAction('jm', 'jam', 'fw', true);
    g.resolveNight(rng());
    expect(g.intelOf('fw')[0]).toMatchObject({ outcome: 'jammed' });
    g.beginNight();
    expect(g.submitAction('fw', 'shield', 's1')).toMatchObject({ ok: false });
  });

  it('eliminating a player mid-night voids picks aimed at them', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 's1', true);
    g.submitAction('sc', 'scan', 's1', true);
    g.eliminate('s1', 'left');
    expect(g.picksOf('g1').attack).toEqual({ target: null, locked: false });
    expect(g.picksOf('sc').scan).toEqual({ target: null, locked: false });
    const out = g.resolveNight(rng());
    expect(out.attackTarget).toBeNull();
  });

  it('an offline player can no longer act', () => {
    const g = fresh();
    g.beginNight();
    g.eliminate('sc', 'corrupted');
    expect(g.submitAction('sc', 'scan', 'g1')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.actionsOf('sc')).toEqual([]);
  });
});

describe('day vote', () => {
  it('validates voters and targets', () => {
    const g = fresh();
    expect(g.castVote('s1', 'g1', VOTE)).toMatchObject({ ok: false, code: 'wrong_phase' });
    g.beginVote();
    expect(g.castVote('s1', 's1', VOTE)).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.castVote('s1', 'nobody', VOTE)).toMatchObject({ ok: false, code: 'invalid_target' });
    expect(g.castVote('ghost', 'g1', VOTE)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('s1', 'skip', { allowSkip: false })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('s1', 'g1', VOTE)).toEqual({ ok: true });
    expect(g.castVote('s1', 'g2', VOTE)).toMatchObject({ ok: false, code: 'already_voted' });
    expect(g.voteOf('s1')).toEqual({ target: 'g1', sudo: false });
    expect(g.hasVoted('s1')).toBe(true);
  });

  it('refuses votes from and for offline players', () => {
    const g = fresh();
    g.eliminate('s2', 'corrupted');
    g.beginVote();
    expect(g.castVote('s2', 'g1', VOTE)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('s1', 's2', VOTE)).toMatchObject({ ok: false, code: 'invalid_target' });
  });

  it('disconnects the top suspect and records it', () => {
    const g = fresh();
    g.beginVote();
    for (const v of ['s1', 's2', 's3', 'sc']) g.castVote(v, 'g1', VOTE);
    g.castVote('g2', 's1', VOTE);
    expect(g.votesDone()).toBe(false);
    expect(g.votesDone((id) => g.hasVoted(id))).toBe(true);
    const out = g.resolveVote(RULES);
    expect(out.outcome).toBe('disconnected');
    expect(out.playerId).toBe('g1');
    expect(g.seats.get('g1')).toMatchObject({ alive: false, fate: 'disconnected' });
    expect(g.isVoting).toBe(false);
    expect(g.voteOf('s1')).toBeNull();
  });

  it('Sudo: counts double, once per game, never on Skip, only for the Sudo', () => {
    const g = fresh();
    g.beginVote();
    expect(g.castVote('s1', 'g1', { ...VOTE, sudo: true })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('su', 'skip', { ...VOTE, sudo: true })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('su', 'g2', { ...VOTE, sudo: true })).toEqual({ ok: true });
    expect(g.sudoUsed('su')).toBe(true);
    g.castVote('s1', 'g1', VOTE);
    const out = g.resolveVote(RULES);
    expect(out.playerId).toBe('g2');
    expect(out.sudo).toBe(true);
    g.beginVote();
    expect(g.castVote('su', 'g1', { ...VOTE, sudo: true })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(g.castVote('su', 'g1', VOTE)).toEqual({ ok: true });
  });

  it('runs a runoff between tied players; a second tie disconnects nobody', () => {
    const g = fresh();
    g.beginVote();
    g.castVote('s1', 'g1', VOTE);
    g.castVote('s2', 's3', VOTE);
    const first = g.resolveVote(RULES);
    expect(first.outcome).toBe('runoff');
    expect(g.runoff).toEqual(['g1', 's3']);
    g.beginVote(g.runoff);
    expect(g.voteCandidates()).toEqual(['g1', 's3']);
    expect(g.castVote('s1', 's2', VOTE)).toMatchObject({ ok: false, code: 'invalid_target' });
    g.castVote('s1', 'g1', VOTE);
    g.castVote('s2', 's3', VOTE);
    const second = g.resolveVote(RULES);
    expect(second.outcome).toBe('tie');
    expect(g.runoff).toBeNull();
    expect(g.alive()).toHaveLength(10);
  });

  it('with the "none" tie rule a tie ends the vote at once', () => {
    const g = fresh();
    g.beginVote();
    g.castVote('s1', 'g1', VOTE);
    g.castVote('s2', 's3', VOTE);
    expect(g.resolveVote({ allowSkip: true, tieRule: 'none' }).outcome).toBe('tie');
    expect(g.runoff).toBeNull();
  });

  it('voids votes for a player who leaves mid-vote without un-marking their voters (and refunds a Sudo vote)', () => {
    const g = fresh();
    g.beginVote();
    g.castVote('su', 's3', { ...VOTE, sudo: true });
    g.castVote('s1', 's3', VOTE);
    g.castVote('s2', 'g1', VOTE);
    g.castVote('s3', 'g1', VOTE);
    g.eliminate('s3', 'left');
    // Who has voted is public: voters for the leaver still count as having voted…
    expect(g.hasVoted('su')).toBe(true);
    expect(g.hasVoted('s1')).toBe(true);
    expect(g.hasVoted('s3')).toBe(false);
    // …but privately their ballot is void: the Sudo is refunded and they may vote again.
    expect(g.voteOf('s1')).toBeNull();
    expect(g.voteOf('su')).toBeNull();
    expect(g.sudoUsed('su')).toBe(false);
    expect(g.voteOf('s2')).toEqual({ target: 'g1', sudo: false });
    expect(g.castVote('s2', 'g2', VOTE)).toMatchObject({ ok: false, code: 'already_voted' });
    expect(g.castVote('s1', 'g1', VOTE)).toEqual({ ok: true });
    expect(g.castVote('s1', 'g2', VOTE)).toMatchObject({ ok: false, code: 'already_voted' });
    // A void ballot left as it is counts as an abstention.
    const voters = g.alive().length;
    const out = g.resolveVote(RULES);
    expect(out.lines.map((l) => l.voterId).sort()).toEqual(['s1', 's2']);
    expect(out.tally).toEqual([{ target: 'g1', votes: 2 }]);
    expect(out.abstained).toBe(voters - 2);
    expect(out.outcome).toBe('disconnected');
    expect(out.playerId).toBe('g1');
  });
});

describe('win conditions', () => {
  it('Sysops win once every Glitch is offline', () => {
    const g = fresh();
    for (const id of ['g1', 'g2']) g.eliminate(id, 'disconnected');
    expect(g.winner()).toBeNull();
    g.eliminate('jm', 'disconnected');
    expect(g.winner()).toEqual({ team: 'sysops', reason: 'purged' });
  });

  it('Glitches win once they equal the Sysops', () => {
    const g = fresh();
    for (const id of ['s1', 's2', 's3']) g.eliminate(id, 'corrupted');
    expect(g.winner()).toBeNull();
    g.eliminate('su', 'disconnected');
    expect(g.winner()).toEqual({ team: 'glitches', reason: 'takeover' });
  });

  it('a leaving player can end the match', () => {
    const g = fresh([
      ['g', 'glitch'],
      ['a', 'sysop'],
      ['b', 'sysop'],
      ['c', 'sysop'],
    ]);
    g.eliminate('g', 'left');
    expect(g.winner()?.team).toBe('sysops');
  });
});

describe('final report', () => {
  it('reveals every role with scores and awards', () => {
    const g = fresh();
    g.beginNight();
    g.submitAction('g1', 'attack', 'sc', true);
    g.submitAction('fw', 'shield', 'sc', true);
    g.submitAction('sc', 'scan', 'g1', true);
    g.resolveNight(rng());
    g.beginVote();
    for (const v of ['s1', 's2', 'sc', 'fw']) g.castVote(v, 'g1', VOTE);
    g.resolveVote(RULES);
    for (const id of ['g2', 'jm']) g.eliminate(id, 'disconnected');
    const win = g.winner()!;
    expect(win.team).toBe('sysops');
    const names = new Map(ROLES.map(([id]) => [id, id.toUpperCase()]));
    const report = g.finalReport(win, names);
    expect(report.roles).toHaveLength(10);
    const s1 = report.roles.find((r) => r.playerId === 's1')!;
    expect(s1).toMatchObject({ name: 'S1', role: 'sysop', alive: true, fate: '' });
    expect(s1.score).toBe(DECEPTION_POINTS.win + DECEPTION_POINTS.survive + DECEPTION_POINTS.goodVote);
    const g1 = report.roles.find((r) => r.playerId === 'g1')!;
    expect(g1).toMatchObject({ alive: false, fate: 'disconnected', score: 0 });
    expect(report.awards.map((a) => a.id)).toEqual(expect.arrayContaining(['sharp', 'scanner', 'shield']));
    expect(report.nights).toHaveLength(1);
    expect(report.nights[0]!.blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seeded random playouts: every legal random game terminates with a consistent winner and
// never breaks an invariant.
// ---------------------------------------------------------------------------

function randomOf<T>(items: readonly T[], r: Rng): T | undefined {
  return items.length ? items[r.int(items.length)] : undefined;
}

function playout(n: number, seed: number, settings: Partial<DeceptionSettings> = {}) {
  const s = { ...DEFAULT_DECEPTION_SETTINGS, ...settings };
  const setup = planSetup(n, s);
  if (!setup.ok) throw new Error(setup.error);
  const r = createSeededRng(`playout-${n}-${seed}`);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const g = DeceptionGame.deal(ids, setup.setup, r);
  let cycles = 0;
  while (!g.winner() && cycles < DECEPTION_LIMITS.maxCycles) {
    g.beginNight();
    cycles++;
    const before = g.alive().length;
    for (const id of g.alive()) {
      for (const kind of g.actionsOf(id)) {
        // Random (possibly illegal) targets: the engine must refuse the illegal ones.
        for (let tries = 0; tries < 6; tries++) {
          const res = g.submitAction(id, kind, randomOf(ids, r) ?? null, r.int(2) === 0);
          if (res.ok) break;
        }
      }
    }
    const night = g.resolveNight(r);
    expect(before - g.alive().length).toBeLessThanOrEqual(1);
    if (night.corrupted) expect(g.isGlitch(night.corrupted)).toBe(false);
    for (const scan of night.scans) {
      if (scan.result !== 'jammed') expect(scan.result).toBe(g.isGlitch(scan.targetId) ? 'glitch' : 'clean');
    }
    for (const clue of night.clues) {
      if (clue.pair) expect(clue.pair.filter((id) => g.isGlitch(id))).toHaveLength(1);
    }
    if (g.winner()) break;
    let runoff: readonly string[] | null = null;
    for (let round = 0; round < 2; round++) {
      g.beginVote(runoff);
      for (const id of g.alive()) {
        if (r.int(8) === 0) continue; // abstain
        const target =
          r.int(6) === 0
            ? 'skip'
            : (randomOf(
                g.voteCandidates().filter((c) => c !== id),
                r,
              ) ?? 'skip');
        g.castVote(id, target, { allowSkip: s.allowSkip, sudo: g.roleOf(id) === 'sudo' && !g.sudoUsed(id) && target !== 'skip' });
      }
      const alive = g.alive().length;
      const vote = g.resolveVote({ allowSkip: s.allowSkip, tieRule: s.tieRule });
      expect(alive - g.alive().length).toBe(vote.outcome === 'disconnected' ? 1 : 0);
      if (vote.outcome !== 'runoff') break;
      runoff = g.runoff;
    }
  }
  return { g, cycles };
}

describe('seeded random playouts', () => {
  it('always terminate with a consistent winner and intact invariants', () => {
    const winners = { sysops: 0, glitches: 0 };
    for (let n = 4; n <= 20; n += 2) {
      for (let seed = 0; seed < 25; seed++) {
        const { g, cycles } = playout(n, seed, seed % 3 === 0 ? { roleSet: 'beginner' } : {});
        expect(cycles).toBeLessThanOrEqual(DECEPTION_LIMITS.maxCycles);
        const win = g.winner();
        if (!win) continue; // hit the safety cap
        winners[win.team]++;
        const glitches = g.livingOf('glitches').length;
        const sysops = g.livingOf('sysops').length;
        if (win.team === 'sysops') expect(glitches).toBe(0);
        else expect(glitches).toBeGreaterThanOrEqual(sysops);
        // Every seat's final role matches its team, and the report agrees.
        const report = g.finalReport(win, new Map());
        for (const row of report.roles) expect(roleTeam(row.role)).toBe(g.teamOf(row.playerId));
      }
    }
    // Random play is chaotic, but both teams must be able to win.
    expect(winners.sysops).toBeGreaterThan(0);
    expect(winners.glitches).toBeGreaterThan(0);
  });

  it('is reproducible for a seed', () => {
    const a = playout(12, 3);
    const b = playout(12, 3);
    expect(a.g.nights).toEqual(b.g.nights);
    expect([...a.g.seats.values()]).toEqual([...b.g.seats.values()]);
  });
});
