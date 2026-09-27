/**
 * DASception room integration tests: private role distribution, night → dawn → day → vote flow,
 * win conditions, illegal/out-of-phase rejections, chat channels, reconnects, timers, leavers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { ChatMessage, GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  DECEPTION_GHOST_PREFIX,
  DECEPTION_MSG,
  roleTeam,
  type DeceptionDawnReport,
  type DeceptionFinalReport,
  type DeceptionPrivate,
  type DeceptionRole,
  type DeceptionTeamLog,
  type DeceptionVerdict,
} from '@dascade/shared/games/deception';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import type { DeceptionRoom } from '../src/rooms/deception/DeceptionRoom.ts';
import { freePort, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['deception'] });
  await server.listen(port);
  colyseus = new ColyseusTestServer(server);
  stopOutcomes = onOutcome((o, ctx) => {
    if (ctx.gameId === 'deception') outcomes.push(o);
  });
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  stopOutcomes();
  await colyseus.shutdown();
});

type Json = Record<string, any>;
interface Client {
  room: SdkRoom;
  name: string;
  id: () => string;
  token: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: DeceptionPrivate[];
  team: DeceptionTeamLog[];
  chat: ChatMessage[];
  /** Every message this client received (for leak checks). */
  all: Array<{ type: string; payload: unknown }>;
  priv: () => DeceptionPrivate | undefined;
  role: () => DeceptionRole | null;
}

const TYPES = [
  'sys:welcome',
  'sys:toast',
  'sys:error',
  'sys:removed',
  'sys:time',
  'chat:msg',
  'chat:history',
  DECEPTION_MSG.private,
  DECEPTION_MSG.team,
  DECEPTION_MSG.event,
];

async function wire(room: SdkRoom, name: string): Promise<Client> {
  const all: Client['all'] = [];
  const byType = new Map<string, unknown[]>();
  for (const type of TYPES) {
    const list: unknown[] = [];
    byType.set(type, list);
    room.onMessage(type, (payload: unknown) => {
      list.push(payload);
      all.push({ type, payload });
    });
  }
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  const welcomes = byType.get('sys:welcome') as WelcomePayload[];
  const privates = byType.get(DECEPTION_MSG.private) as DeceptionPrivate[];
  const client: Client = {
    room,
    name,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: byType.get('sys:error') as Client['errors'],
    privates,
    team: byType.get(DECEPTION_MSG.team) as DeceptionTeamLog[],
    chat: byType.get('chat:msg') as ChatMessage[],
    all,
    priv: () => privates.at(-1),
    role: () => privates.at(-1)?.role ?? null,
  };
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
type Server = Pick<DeceptionRoom, 'state'> & Record<string, any>;

interface Table {
  server: Server;
  host: Client;
  clients: Client[];
  specs: Client[];
  by: (role: DeceptionRole) => Client[];
  one: (role: DeceptionRole) => Client;
  others: (...exclude: Client[]) => Client[];
}

async function setup(n: number, opts: { settings?: Json; spectators?: number } = {}): Promise<Table> {
  const host = await wire(await colyseus.sdk.create('deception', { name: 'P0' }), 'P0');
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.countdownMs = 20;
  server.bootMs = 5000;
  server.nightFloorMs = 60;
  server.allAnsweredDelayMs = 40;
  server.dawnMs = 150;
  server.verdictMs = 150;
  server.nightMs = () => 5000;
  server.dayMs = () => 5000;
  server.voteMs = () => 5000;
  if (opts.settings) {
    host.room.send('lobby:settings', { settings: opts.settings });
    await waitFor(
      () =>
        Object.entries(opts.settings!).every(([k, v]) => JSON.stringify(JSON.parse(server.state.settingsJson)[k]) === JSON.stringify(v)),
      2000,
      'settings',
    );
  }
  const clients = [host];
  for (let i = 1; i < n; i++) clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `P${i}` }), `P${i}`));
  const specs: Client[] = [];
  for (let i = 0; i < (opts.spectators ?? 0); i++)
    specs.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `S${i}`, spectator: true }), `S${i}`));
  const by = (role: DeceptionRole) => clients.filter((c) => c.role() === role);
  return {
    server,
    host,
    clients,
    specs,
    by,
    one: (role) => {
      const found = by(role)[0];
      if (!found) throw new Error(`no ${role} dealt`);
      return found;
    },
    others: (...exclude) => clients.filter((c) => !exclude.includes(c)),
  };
}

async function start(t: Table): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'boot', 3000, 'boot');
  await waitFor(() => t.clients.every((c) => c.priv()?.match === t.server.state.match && c.role() !== null), 3000, 'roles dealt');
}

async function toNight(t: Table): Promise<void> {
  for (const c of t.clients) c.room.send(DECEPTION_MSG.ready, { ready: true });
  await waitFor(() => t.server.state.stage === 'night', 3000, 'night');
}

const act = (c: Client, kind: string, target: Client | null, lock = true) =>
  c.room.send(DECEPTION_MSG.act, { kind, target: target ? target.id() : null, lock });
const vote = (c: Client, target: Client | 'skip', sudo?: boolean) =>
  c.room.send(DECEPTION_MSG.vote, { target: target === 'skip' ? 'skip' : target.id(), ...(sudo ? { sudo } : {}) });
const say = (c: Client, text: string) => c.room.send('chat:send', { text });
const stage = (t: Table) => t.server.state.stage;

async function waitStage(t: Table, name: string, timeout = 4000): Promise<void> {
  await waitFor(() => stage(t) === name, timeout, `stage ${name}`);
}

/** Everyone online votes "ready" to end the discussion. */
async function toVote(t: Table): Promise<void> {
  await waitStage(t, 'day');
  for (const c of t.clients) if (t.server.state.nodes.get(c.id())?.alive) c.room.send(DECEPTION_MSG.ready, { ready: true });
  await waitStage(t, 'vote');
}

describe('DASception: roles are dealt privately', () => {
  it('gives each player only their own role; Glitches learn their allies; spectators get nothing', async () => {
    const t = await setup(8, { spectators: 1 });
    await start(t);
    const setupCounts = JSON.parse(t.server.state.setupJson).counts as Record<DeceptionRole, number>;
    const dealt: Record<string, number> = {};
    for (const c of t.clients) dealt[c.role()!] = (dealt[c.role()!] ?? 0) + 1;
    for (const [role, n] of Object.entries(setupCounts)) expect(dealt[role] ?? 0).toBe(n);
    expect(setupCounts.glitch + setupCounts.jammer).toBe(2);

    const glitches = t.clients.filter((c) => c.priv()!.team === 'glitches');
    expect(glitches).toHaveLength(2);
    const glitchIds = glitches.map((c) => c.id()).sort();
    for (const g of glitches)
      expect(
        g
          .priv()!
          .allies.map((a) => a.id)
          .sort(),
      ).toEqual(glitchIds);
    for (const c of t.clients.filter((x) => x.priv()!.team === 'sysops')) {
      expect(c.priv()!.allies).toEqual([]);
      expect(c.priv()!.teamPicks).toEqual([]);
      expect(c.team).toEqual([]);
    }
    // Server truth matches what each player was told.
    for (const c of t.clients) expect(t.server['game'].roleOf(c.id())).toBe(c.role());

    // Public state never carries a hidden role; spectators receive no private traffic at all.
    for (const viewer of [...t.clients, ...t.specs]) {
      const state = json(viewer);
      expect(Object.values(state.nodes as Record<string, { role: string }>).every((n) => n.role === '')).toBe(true);
    }
    const spec = t.specs[0]!;
    await sleep(100);
    // Before any reveal, nothing a Sysop or spectator receives (besides their own card) names a role.
    const ROLE_NAMES = /\b(Scanner|Firewall|Tracer|Sudo|Glitch|Jammer)\b/;
    for (const viewer of [...t.clients.filter((c) => c.priv()!.team === 'sysops'), spec]) {
      const publicTraffic = viewer.all.filter((m) => m.type !== DECEPTION_MSG.private);
      expect(JSON.stringify(publicTraffic)).not.toMatch(ROLE_NAMES);
      for (const p of viewer.privates) expect(p.role).toBe(viewer.role());
    }
    expect(spec.privates).toEqual([]);
    expect(spec.team).toEqual([]);
    const specTraffic = JSON.stringify(spec.all);
    for (const id of glitchIds) expect(specTraffic).not.toMatch(new RegExp(`${id}[^}]*"role":"(glitch|jammer)"`));
    // Boot readiness is public ("read my card"), never anything role-related.
    expect(json(spec).seats[t.host.id()]).toMatchObject({ answered: false, eligible: true });
  });

  it('blocks a start that cannot be balanced', async () => {
    const t = await setup(4, { settings: { roleSet: 'custom', glitchCount: 2 } });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => /minority/.test(e.message)), 2000, 'start refused');
    expect(t.server.state.phase).toBe('LOBBY');
  });
});

describe('DASception: a full match', () => {
  it('night → dawn → day → vote → verdict: Sysops disconnect the Glitch and win', async () => {
    const t = await setup(5, { spectators: 1 });
    await start(t);
    const [g, sc, fw] = [t.one('glitch'), t.one('scanner'), t.one('firewall')];
    const [s1, s2] = t.by('sysop') as [Client, Client];
    await toNight(t);

    // Night is completely silent in public state.
    const nightState = json(s1);
    expect(
      Object.values(nightState.seats as Record<string, { answered: boolean; eligible: boolean }>).every((s) => !s.answered && !s.eligible),
    ).toBe(true);
    act(g, 'attack', s1);
    act(sc, 'scan', g);
    act(fw, 'shield', fw);
    await waitStage(t, 'dawn');
    const dawn = JSON.parse(t.server.state.dawnJson) as DeceptionDawnReport;
    expect(dawn).toMatchObject({ cycle: 1, outcome: 'corrupted', playerId: s1.id(), role: 'sysop' });
    await waitFor(() => json(s2).nodes[s1.id()].alive === false, 2000, 'node offline');
    expect(json(s2).nodes[s1.id()]).toMatchObject({ fate: 'corrupted', role: 'sysop', outCycle: 1 });
    await waitFor(() => sc.priv()!.intel.length === 1, 2000, 'scan intel');
    expect(sc.priv()!.intel[0]).toEqual({ kind: 'scan', cycle: 1, targetId: g.id(), result: 'glitch' });
    expect(fw.priv()!.intel[0]).toMatchObject({ kind: 'shield', targetId: fw.id(), outcome: 'quiet' });
    expect(fw.priv()!.lastShield).toBe(fw.id());
    expect(g.priv()!.intel[0]).toMatchObject({ kind: 'attack', targetId: s1.id(), outcome: 'corrupted' });
    // Nobody else learned the scan.
    for (const c of [g, fw, s2, ...t.specs]) expect(JSON.stringify(c.all)).not.toContain('"result":"glitch"');

    await toVote(t);
    // The corrupted player can't vote; votes stay private until the reveal.
    vote(s1, g);
    await waitFor(() => s1.errors.some((e) => e.type === DECEPTION_MSG.vote), 2000, 'dead vote refused');
    vote(sc, g);
    await waitFor(() => json(s2).seats[sc.id()].answered === true, 2000, 'voted flag');
    expect(JSON.stringify(json(s2))).not.toContain(`"target":"${g.id()}"`);
    expect(t.server.state.verdictJson).toBe('');
    expect(sc.priv()!.vote).toEqual({ target: g.id(), sudo: false });
    expect(s2.priv()!.vote).toBeNull();
    vote(fw, g);
    vote(s2, g);
    vote(g, s2);
    await waitStage(t, 'verdict');
    const verdict = JSON.parse(t.server.state.verdictJson) as DeceptionVerdict;
    expect(verdict).toMatchObject({ outcome: 'disconnected', playerId: g.id(), role: 'glitch', mode: 'full', abstained: 0 });
    expect(verdict.votes).toContainEqual({ voterId: g.id(), target: s2.id(), weight: 1 });
    expect(verdict.tally[0]).toEqual({ target: g.id(), votes: 3 });

    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    expect(t.server.state.winner).toBe('sysops');
    const final = JSON.parse(t.server.state.finalJson) as DeceptionFinalReport;
    expect(final.winner).toBe('sysops');
    expect(final.roles).toHaveLength(5);
    expect(final.nights[0]).toMatchObject({ attackTarget: s1.id(), blocked: false });
    // Full reveal for everyone at the end — spectators included.
    const specNodes = json(t.specs[0]!).nodes as Record<string, { role: string }>;
    await waitFor(
      () => Object.values(json(t.specs[0]!).nodes as Record<string, { role: string }>).every((n) => n.role !== ''),
      2000,
      'reveal',
    );
    expect(Object.keys(specNodes)).toHaveLength(5);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    const outcome = outcomes[0]!;
    expect(outcome.placements).toHaveLength(2);
    expect(outcome.placements[0]!.sort()).toEqual([sc, fw, s1, s2].map((c) => c.id()).sort());
    expect(outcome.placements[1]).toEqual([g.id()]);
    expect(outcome.reason).toBe('purged');
    expect(json(t.host).players[sc.id()].score).toBeGreaterThan(json(t.host).players[g.id()].score);
  });

  it('Glitches win once they equal the Sysops (Firewall blocks, then no repeat shield)', async () => {
    const t = await setup(4, { settings: { allowSkip: true } });
    await start(t);
    const [g, sc, fw, s] = [t.one('glitch'), t.one('scanner'), t.one('firewall'), t.one('sysop')];
    await toNight(t);
    act(g, 'attack', sc);
    act(fw, 'shield', sc);
    act(sc, 'scan', s);
    await waitStage(t, 'dawn');
    expect(JSON.parse(t.server.state.dawnJson)).toEqual({ cycle: 1, outcome: 'blocked' });
    await waitFor(() => fw.priv()!.intel.some((i) => i.kind === 'shield' && i.outcome === 'held'), 2000, 'shield held');
    await toVote(t);
    for (const c of [g, sc, fw, s]) vote(c, 'skip');
    await waitStage(t, 'verdict');
    expect(JSON.parse(t.server.state.verdictJson)).toMatchObject({ outcome: 'skipped' });
    await waitStage(t, 'night');
    expect(t.server.state.cycle).toBe(2);
    // Same player two nights in a row is refused.
    act(fw, 'shield', sc);
    await waitFor(() => fw.errors.some((e) => /two nights in a row/.test(e.message)), 2000, 'repeat refused');
    act(fw, 'shield', fw);
    act(g, 'attack', s);
    act(sc, 'scan', g);
    await waitStage(t, 'dawn');
    act(g, 'attack', sc); // too late: the night is over
    await waitFor(() => g.errors.some((e) => e.code === 'wrong_phase'), 2000, 'late action refused');
    await toVote(t);
    vote(sc, g);
    vote(fw, sc);
    vote(g, sc);
    await waitStage(t, 'verdict');
    expect(JSON.parse(t.server.state.verdictJson)).toMatchObject({ outcome: 'disconnected', playerId: sc.id() });
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    expect(t.server.state.winner).toBe('glitches');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]).toEqual([g.id()]);
    expect(outcomes[0]!.reason).toBe('takeover');
  });
});

describe('DASception: rules enforcement', () => {
  it('rejects illegal and out-of-phase actions, and duplicate votes are idempotent', async () => {
    const t = await setup(6, { spectators: 1 });
    await start(t);
    const [g, sc, fw, su] = [t.one('glitch'), t.one('scanner'), t.one('firewall'), t.one('sudo')];
    const s = t.one('sysop');
    const spec = t.specs[0]!;
    // Boot: no votes or actions yet.
    vote(s, g);
    act(sc, 'scan', g);
    await waitFor(() => s.errors.length > 0 && sc.errors.length > 0, 2000, 'boot refusals');
    expect(s.errors[0]!.code).toBe('wrong_phase');
    expect(sc.errors[0]!.code).toBe('wrong_phase');
    await toNight(t);
    const count = (c: Client) => c.errors.length;
    const before = new Map(t.clients.map((c) => [c, count(c)]));
    act(s, 'scan', g); // no ability
    act(sc, 'scan', sc); // self-scan
    act(g, 'jam', sc); // not a Jammer
    act(g, 'attack', g); // a Glitch
    vote(fw, g); // not voting time
    su.room.send(DECEPTION_MSG.teamSay, { text: 'let me in' }); // not a Glitch
    spec.room.send(DECEPTION_MSG.act, { kind: 'attack', target: s.id(), lock: true });
    await waitFor(() => [s, sc, g, fw, su].every((c) => count(c) > before.get(c)!) && spec.errors.length > 0, 2000, 'night refusals');
    expect(spec.errors.at(-1)!.code).toBe('not_allowed');
    act(sc, 'scan', g);
    await waitFor(() => sc.priv()!.picks.scan?.locked === true, 2000, 'locked');
    act(sc, 'scan', s);
    await waitFor(() => sc.errors.some((e) => /already locked/.test(e.message)), 2000, 'lock is final');
    expect(t.server['game'].picksOf(sc.id()).scan).toEqual({ target: g.id(), locked: true });

    t.server.nightMs = () => 5000;
    act(g, 'attack', s);
    act(fw, 'shield', s);
    await waitStage(t, 'dawn');
    await toVote(t);
    vote(fw, fw); // self-vote
    await waitFor(() => fw.errors.some((e) => /yourself/.test(e.message)), 2000, 'self vote refused');
    vote(fw, g);
    vote(fw, s);
    await waitFor(() => fw.errors.some((e) => /already locked/.test(e.message)), 2000, 'double vote refused');
    expect(t.server['game'].voteOf(fw.id())).toEqual({ target: g.id(), sudo: false });
    // A non-Sudo can't cast a Sudo vote.
    vote(sc, g, true);
    await waitFor(() => sc.errors.some((e) => /Only the Sudo/.test(e.message)), 2000, 'fake sudo refused');
  });

  it('runoff between tied players, with a Sudo vote counting twice', async () => {
    const t = await setup(6);
    t.server.voteMs = () => 700;
    await start(t);
    const [g, sc, fw, su] = [t.one('glitch'), t.one('scanner'), t.one('firewall'), t.one('sudo')];
    const [s1, s2] = t.by('sysop') as [Client, Client];
    await toNight(t);
    t.server['finishStage']();
    await waitStage(t, 'dawn');
    expect(JSON.parse(t.server.state.dawnJson).outcome).toBe('quiet');
    await toVote(t);
    vote(sc, s1);
    vote(fw, s2);
    await waitStage(t, 'verdict');
    const first = JSON.parse(t.server.state.verdictJson) as DeceptionVerdict;
    expect(first.outcome).toBe('runoff');
    expect(first.tied!.sort()).toEqual([s1.id(), s2.id()].sort());
    await waitStage(t, 'runoff');
    expect(JSON.parse(t.server.state.runoffJson).sort()).toEqual([s1.id(), s2.id()].sort());
    vote(g, sc); // not in the runoff
    await waitFor(() => g.errors.some((e) => /runoff/.test(e.message)), 2000, 'runoff target refused');
    vote(su, s1, true);
    vote(g, s2);
    await waitStage(t, 'verdict');
    const second = JSON.parse(t.server.state.verdictJson) as DeceptionVerdict;
    expect(second).toMatchObject({ runoff: true, outcome: 'disconnected', playerId: s1.id(), sudo: true });
    expect(second.votes).toContainEqual({ voterId: su.id(), target: s1.id(), weight: 2 });
    await waitFor(() => su.priv()!.sudoUsed === true, 2000, 'sudo spent');
  });

  it('tally-only reveal hides who voted for whom', async () => {
    const t = await setup(5, { settings: { voteReveal: 'tally' } });
    await start(t);
    await toNight(t);
    t.server['finishStage']();
    await toVote(t);
    const [g, sc] = [t.one('glitch'), t.one('scanner')];
    for (const c of t.others(g)) vote(c, g);
    vote(g, sc);
    await waitStage(t, 'verdict');
    const verdict = JSON.parse(t.server.state.verdictJson) as DeceptionVerdict;
    expect(verdict.mode).toBe('tally');
    expect(verdict.votes).toEqual([]);
    expect(verdict.tally).toEqual([
      { target: g.id(), votes: 4 },
      { target: sc.id(), votes: 1 },
    ]);
  });
});

describe('DASception: chat channels', () => {
  it('blackout at night, a private Glitch channel, and a ghost channel for offline players', async () => {
    const t = await setup(8, { spectators: 1 });
    await start(t);
    const glitches = t.clients.filter((c) => c.priv()!.team === 'glitches');
    const sysops = t.clients.filter((c) => c.priv()!.team === 'sysops');
    const spec = t.specs[0]!;
    // Team channel is night-only.
    glitches[0]!.room.send(DECEPTION_MSG.teamSay, { text: 'too early' });
    await waitFor(() => glitches[0]!.errors.some((e) => e.type === DECEPTION_MSG.teamSay), 2000, 'team closed in boot');
    await toNight(t);

    say(sysops[0]!, 'can anyone hear me');
    await waitFor(() => sysops[0]!.chat.some((m) => /comms are offline/.test(m.text)), 2000, 'blackout notice');
    glitches[0]!.room.send(DECEPTION_MSG.teamSay, { text: 'secret-plan-omega' });
    await waitFor(() => glitches.every((g) => g.team.at(-1)?.lines.some((l) => l.text === 'secret-plan-omega')), 2000, 'team line');
    await sleep(100);
    for (const c of [...sysops, spec]) {
      expect(JSON.stringify(c.all)).not.toContain('secret-plan-omega');
      expect(JSON.stringify(c.all)).not.toContain('can anyone hear me');
    }
    for (const c of [...glitches.slice(1), ...sysops.slice(1)]) expect(JSON.stringify(c.all)).not.toContain('can anyone hear me');

    // The Glitch team sees each other's picks live; nobody else does.
    const victim = sysops[0]!;
    act(glitches[0]!, 'attack', victim, false);
    await waitFor(
      () => glitches[1]!.priv()!.teamPicks.some((p) => p.id === glitches[0]!.id() && p.target === victim.id()),
      2000,
      'team picks',
    );
    for (const c of sysops) expect(c.priv()!.teamPicks).toEqual([]);
    for (const g of glitches) act(g, 'attack', victim);
    await waitFor(() => glitches[0]!.priv()!.teamPicks.every((p) => p.locked), 2000, 'team locked');
    t.server['finishStage']();
    await waitStage(t, 'dawn');
    await waitFor(() => t.server.state.nodes.get(victim.id())?.alive === false, 2000, 'victim offline');

    // The offline player talks in the ghost channel: only ghosts (offline + spectators) see it.
    await waitStage(t, 'day');
    say(victim, 'boo from beyond');
    await waitFor(() => spec.chat.some((m) => m.text === 'boo from beyond'), 2000, 'ghost line');
    const ghostLine = spec.chat.find((m) => m.text === 'boo from beyond')!;
    expect(ghostLine.id.startsWith(DECEPTION_GHOST_PREFIX)).toBe(true);
    say(sysops[1]!, 'daytime talk');
    await waitFor(() => victim.chat.some((m) => m.text === 'daytime talk'), 2000, 'public reaches ghosts');
    for (const c of t.clients.filter((x) => x !== victim)) expect(c.chat.some((m) => m.text === 'boo from beyond')).toBe(false);
    // Spectators talk in the same ghost channel.
    say(spec, 'spectator whisper');
    await waitFor(() => victim.chat.some((m) => m.text === 'spectator whisper'), 2000, 'spectator ghost line');
    await sleep(80);
    for (const c of t.clients.filter((x) => x !== victim)) expect(c.chat.some((m) => m.text === 'spectator whisper')).toBe(false);
    // Offline players can't act or ready up.
    victim.room.send(DECEPTION_MSG.ready, { ready: true });
    await waitFor(() => victim.errors.some((e) => e.type === DECEPTION_MSG.ready), 2000, 'offline ready refused');
  });
});

describe('DASception: resilience', () => {
  it('reconnect restores the role and intel (auto-reconnect and seat-token rejoin)', async () => {
    const t = await setup(5);
    await start(t);
    const sc = t.one('scanner');
    const g = t.one('glitch');
    await toNight(t);
    act(sc, 'scan', g);
    act(g, 'attack', t.one('sysop'));
    await waitFor(() => sc.priv()!.picks.scan?.locked === true, 2000, 'scan locked');
    t.server['finishStage']();
    await waitFor(() => sc.priv()!.intel.length === 1, 3000, 'intel');

    // 1) Transport drop + auto-reconnect inside the grace period.
    sc.room.reconnection.minUptime = 0;
    const before = sc.privates.length;
    const reconnected = new Promise<void>((r) => sc.room.onReconnect(() => r()));
    (sc.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await reconnected;
    await waitFor(() => sc.privates.length > before, 3000, 'private after reconnect');
    expect(sc.priv()).toMatchObject({ role: 'scanner', alive: true });
    expect(sc.priv()!.intel[0]).toMatchObject({ kind: 'scan', targetId: g.id(), result: 'glitch' });

    // 2) The Glitch closes the tab; comes back later with the seat token.
    const token = g.token();
    const gid = g.id();
    g.room.reconnection.enabled = false;
    (g.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P-again', seatToken: token }), 'again');
    expect(again.id()).toBe(gid);
    await waitFor(() => again.priv() !== undefined && again.team.length > 0, 2000, 'glitch private resent');
    expect(again.priv()).toMatchObject({ role: 'glitch', team: 'glitches' });
    expect(again.priv()!.allies.map((a) => a.id)).toEqual([gid]);
  });

  it('timers auto-resolve when nobody acts (quiet night, no votes) and the match keeps going', async () => {
    const t = await setup(5);
    t.server.nightMs = () => 300;
    t.server.dayMs = () => 300;
    t.server.voteMs = () => 300;
    t.server.bootMs = 300;
    await start(t);
    await waitStage(t, 'night');
    await waitStage(t, 'dawn');
    expect(JSON.parse(t.server.state.dawnJson)).toEqual({ cycle: 1, outcome: 'quiet' });
    await waitStage(t, 'day');
    await waitStage(t, 'vote');
    await waitStage(t, 'verdict');
    expect(JSON.parse(t.server.state.verdictJson)).toMatchObject({ outcome: 'no_votes', abstained: 5 });
    await waitFor(() => stage(t) === 'night' && t.server.state.cycle === 2, 3000, 'second night');
  });

  it('the safety cap ends an endless match: the Glitches outlasted the audit', async () => {
    const t = await setup(5);
    await start(t);
    await toNight(t);
    t.server['finishStage']();
    await toVote(t);
    for (const c of t.clients) vote(c, 'skip');
    await waitStage(t, 'verdict');
    t.server['game'].cycle = 15;
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    expect(t.server.state.winner).toBe('glitches');
    expect(JSON.parse(t.server.state.finalJson).reason).toBe('timeout');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.reason).toBe('timeout');
  });

  it('a disconnected actor does not stall the night — and dropping never ends it early (no timing tell)', async () => {
    const t = await setup(5);
    t.server.nightMs = () => 1500;
    await start(t);
    const [g, sc, fw] = [t.one('glitch'), t.one('scanner'), t.one('firewall')];
    await toNight(t);
    act(g, 'attack', t.one('sysop'));
    act(sc, 'scan', g);
    await waitFor(() => sc.priv()?.picks.scan?.locked === true, 2000, 'scan locked');
    const nightEndsAt = t.server.state.phaseEndsAt;
    fw.room.reconnection.enabled = false;
    (fw.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.server.state.players.get(fw.id())?.connected === false, 2000, 'firewall offline');
    // Ending the night right now would tell everyone the Firewall was the last actor still choosing.
    await sleep(300);
    expect(stage(t)).toBe('night');
    expect(t.server.state.phaseEndsAt).toBe(nightEndsAt);
    // The timer still ends it: the offline actor simply doesn't act.
    await waitStage(t, 'dawn', 3000);
  });

  it('a leaver never ends the night early either', async () => {
    const t = await setup(5, { settings: { revealRoles: false } });
    t.server.nightMs = () => 1500;
    await start(t);
    const [g, sc, fw] = [t.one('glitch'), t.one('scanner'), t.one('firewall')];
    await toNight(t);
    act(g, 'attack', t.others(g, sc, fw)[0]!);
    act(sc, 'scan', g);
    await waitFor(() => sc.priv()?.picks.scan?.locked === true && g.priv()?.picks.attack?.locked === true, 2000, 'locked');
    await fw.room.leave(true);
    await waitFor(() => t.server.state.nodes.get(fw.id())?.fate === 'left', 2000, 'left');
    await sleep(300);
    expect(stage(t)).toBe('night');
    await waitStage(t, 'dawn', 3000);
  });

  it('a Glitch who leaves goes offline with their role revealed — and can end the match', async () => {
    const t = await setup(4);
    await start(t);
    const g = t.one('glitch');
    await toNight(t);
    await g.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    expect(t.server.state.winner).toBe('sysops');
    const log = JSON.parse(t.server.state.logJson) as Array<{ kind: string; role?: string }>;
    expect(log).toContainEqual(expect.objectContaining({ kind: 'left', role: 'glitch' }));
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[1]).toEqual([g.id()]);
  });

  it('votes for a leaver are voided and those voters can vote again', async () => {
    const t = await setup(6);
    await start(t);
    await toNight(t);
    t.server['finishStage']();
    await toVote(t);
    const [s1, s2] = t.by('sysop') as [Client, Client];
    const sc = t.one('scanner');
    vote(sc, s2);
    await waitFor(() => json(sc).seats[sc.id()].answered === true, 2000, 'voted');
    await s2.room.leave(true);
    await waitFor(() => json(sc).seats[sc.id()]?.answered === false, 2000, 'vote voided');
    await waitFor(() => sc.priv()!.vote === null, 2000, 'private vote cleared');
    vote(sc, s1);
    await waitFor(() => json(sc).seats[sc.id()].answered === true, 2000, 'voted again');
  });

  it('the host cannot kick a seated player mid-match (no parity swings), but can in the lobby', async () => {
    const t = await setup(5);
    await start(t);
    const victim = t.clients[1]!;
    t.host.room.send('lobby:kick', { playerId: victim.id() });
    await waitFor(() => t.host.errors.some((e) => e.type === 'lobby:kick'), 2000, 'kick refused');
    expect(t.host.errors.find((e) => e.type === 'lobby:kick')!.code).toBe('not_allowed');
    expect(t.server.state.players.get(victim.id())).toBeDefined();
    expect(t.server.state.nodes.get(victim.id())?.alive).toBe(true);
  });

  it('host can pause and skip the discussion, but never the night or the vote', async () => {
    const t = await setup(5);
    await start(t);
    await toNight(t);
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.host.errors.some((e) => /can’t be skipped/.test(e.message)), 2000, 'night skip refused');
    t.server['finishStage']();
    await waitStage(t, 'day');
    t.host.room.send('party:host', { action: 'pause' });
    await waitFor(() => t.server.state.paused, 2000, 'paused');
    t.host.room.send('party:host', { action: 'skip' });
    await waitStage(t, 'vote');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.host.errors.filter((e) => /can’t be skipped/.test(e.message)).length === 2, 2000, 'vote skip refused');
  });

  it('the night cannot be paused (a Glitch host could buy their channel extra time)', async () => {
    const t = await setup(5);
    await start(t);
    await toNight(t);
    t.host.room.send('party:host', { action: 'pause' });
    await waitFor(
      () => t.host.all.some((m) => m.type === 'sys:toast' && /night can’t be paused/.test((m.payload as { text: string }).text)),
      2000,
      'night pause refused',
    );
    expect(t.server.state.paused).toBe(false);
    expect(stage(t)).toBe('night');
  });

  it('play again: back to the lobby resets everything; the next deal is a new match', async () => {
    const t = await setup(4);
    await start(t);
    await toNight(t);
    const leaver = t.one('glitch');
    await leaver.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    // The leaver may have been the host: whoever holds the role now runs "Play again".
    await waitFor(() => t.clients.some((c) => c !== leaver && c.id() === t.server.state.hostId), 2000, 'host');
    const host = t.clients.find((c) => c !== leaver && c.id() === t.server.state.hostId)!;
    host.room.send('lobby:toLobby', {});
    await waitFor(() => t.server.state.phase === 'LOBBY', 2000, 'lobby');
    expect(t.server.state.stage).toBe('idle');
    expect(t.server.state.nodes.size).toBe(0);
    expect(t.server.state.finalJson).toBe('');
    const firstMatch = t.server.state.match;
    const late = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'Late' }), 'Late');
    t.clients.push(late);
    const players = t.clients.filter((c) => t.server.state.players.has(c.id()));
    expect(players).toHaveLength(4);
    host.room.send('lobby:start', {});
    await waitFor(() => t.server.state.stage === 'boot' && t.server.state.match === firstMatch + 1, 3000, 'second match');
    await waitFor(() => players.every((c) => c.priv()?.match === firstMatch + 1), 2000, 'new roles');
    const roles = players.map((c) => c.role()!);
    expect(roles.filter((r) => roleTeam(r) === 'glitches')).toHaveLength(1);
  });
});
