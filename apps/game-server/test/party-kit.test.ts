/**
 * Party kit (PartyRoom) integration tests, using the tiny fixture game in fixtures/PartyKitRoom.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { PartyPodium } from '@dascade/shared/party';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { PartyKitRoom } from './fixtures/PartyKitRoom.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: [], extraRooms: { partykit: PartyKitRoom } });
  await server.listen(port);
  colyseus = new ColyseusTestServer(server);
  stopOutcomes = onOutcome((o) => outcomes.push(o));
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
  id: () => string;
  token: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: Json[];
  all: Array<{ type: string; payload: unknown }>;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const all: Client['all'] = [];
  const client: Client = {
    room,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    privates: collect(room, 'kit:private'),
    all,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
/** The live room; tests reach protected internals through the index signature. */
type Server = Pick<PartyKitRoom, 'state' | 'box' | 'vote' | 'openTestVote' | 'finishWith'> & Record<string, any>;

async function setup(n: number, settings: Json = {}, spectators = 0) {
  const host = await wire(await colyseus.sdk.create('partykit', { name: 'P0' }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  host.room.send('lobby:settings', { settings });
  await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(server.state.settingsJson)[k] === v), 2000, 'settings');
  const clients = [host];
  for (let i = 1; i < n; i++) clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `P${i}` })));
  const specs: Client[] = [];
  for (let i = 0; i < spectators; i++)
    specs.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `S${i}`, spectator: true })));
  return { server, host, clients, specs };
}

async function start(t: { server: Server; host: Client }) {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'answer', 3000, 'answer stage');
}

describe('party kit — PartyRoom', () => {
  it('publishes who answered (never what), ends the stage early and scores at the reveal', async () => {
    const t = await setup(3, { answerMs: 8000, rounds: 1 }, 1);
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    expect(t.server.state.eligibleCount).toBe(3);
    a.room.send('kit:answer', { seq: 1, text: 'SECRET-ALPHA' });
    await waitFor(() => json(b).seats[a.id()]?.answered === true, 2000, 'answered flag');
    expect(json(b).answeredCount).toBe(1);
    // The answer text is only in the author's private message — never state or other players' traffic.
    expect(JSON.stringify(json(b))).not.toContain('SECRET-ALPHA');
    expect(JSON.stringify(b.all)).not.toContain('SECRET-ALPHA');
    expect(JSON.stringify(t.specs[0]!.all)).not.toContain('SECRET-ALPHA');
    await waitFor(() => a.privates.length === 1, 2000, 'private echo');
    expect(a.privates[0]).toMatchObject({ seq: 1, text: 'SECRET-ALPHA', locked: true });

    // Duplicate + spectator attempts are rejected.
    a.room.send('kit:answer', { seq: 1, text: 'again' });
    t.specs[0]!.room.send('kit:answer', { seq: 1, text: 'spec' });
    await waitFor(() => a.errors.length > 0 && t.specs[0]!.errors.length > 0, 2000, 'rejections');
    expect(a.errors[0]!.message).toMatch(/already locked/i);
    expect(t.specs[0]!.errors[0]!.code).toBe('not_allowed');

    b.room.send('kit:answer', { seq: 1, text: 'b' });
    c.room.send('kit:answer', { seq: 1, text: 'c' });
    // Everyone answered → stage ends well before the 8s timer; reveal scores 10 each.
    await waitFor(() => t.server.state.stage === 'reveal' || t.server.state.stage === 'final', 2000, 'early reveal');
    await waitFor(() => json(a).players[a.id()].score === 10, 2000, 'scores');
    expect(json(a).seats[b.id()]).toMatchObject({ delta: 10, rank: 1 });
    expect(json(a).scoreSeq).toBeGreaterThan(0);
  });

  it('reconnect (seat-token rejoin) restores private mailbox payloads', async () => {
    const t = await setup(2, { answerMs: 8000 });
    await start(t);
    const [a] = t.clients as [Client, Client];
    a.room.send('kit:answer', { seq: 1, text: 'remember-me' });
    await waitFor(() => a.privates.length === 1, 2000, 'private');
    const token = a.token();
    const id = a.id();
    a.room.reconnection.enabled = false;
    (a.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P0', seatToken: token }));
    expect(again.id()).toBe(id);
    await waitFor(() => again.privates.length > 0, 2000, 'private resent');
    expect(again.privates.at(-1)).toMatchObject({ seq: 1, text: 'remember-me' });
  });

  it('disconnect of the last pending player ends the stage (never stalls)', async () => {
    const t = await setup(2, { answerMs: 8000, rounds: 1 });
    await start(t);
    const [a, b] = t.clients as [Client, Client];
    a.room.send('kit:answer', { seq: 1, text: 'x' });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'one answer');
    await b.room.leave(true);
    await waitFor(() => t.server.state.stage === 'reveal' || t.server.phase === 'RESULTS', 2000, 'stage ended');
  });

  it('host pause / resume / skip; non-hosts are refused', async () => {
    const t = await setup(2, { answerMs: 5000 });
    await start(t);
    const [host, guest] = t.clients as [Client, Client];
    guest.room.send('party:host', { action: 'skip' });
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'), 2000, 'not host');
    host.room.send('party:host', { action: 'pause' });
    await waitFor(() => t.server.state.paused, 2000, 'paused');
    expect(t.server.state.phaseEndsAt).toBe(0);
    expect(t.server.state.pausedMs).toBeGreaterThan(3000);
    host.room.send('party:host', { action: 'resume' });
    await waitFor(() => !t.server.state.paused && t.server.state.phaseEndsAt > Date.now(), 2000, 'resumed');
    host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage === 'reveal', 2000, 'skipped');
  });

  it('a forgotten pause auto-resumes (rooms never stall on an absent host)', async () => {
    const t = await setup(2, { answerMs: 5000 });
    t.server.maxPauseMs = 150;
    await start(t);
    t.host.room.send('party:host', { action: 'pause' });
    await waitFor(() => t.server.state.paused, 2000, 'paused');
    await waitFor(() => !t.server.state.paused && t.server.state.phaseEndsAt > Date.now(), 2000, 'auto-resumed');
    expect(t.server.state.stage).toBe('answer');
  });

  it('nothing locks in while paused, and a prompt completed during the pause ends as soon as it resumes', async () => {
    const t = await setup(3, { answerMs: 8000, rounds: 1 });
    await start(t);
    const [host, b, c] = t.clients as [Client, Client, Client];
    host.room.send('kit:answer', { seq: 1, text: 'before' });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'one answer');
    host.room.send('party:host', { action: 'pause' });
    await waitFor(() => t.server.state.paused, 2000, 'paused');
    // Answers wait for the clock: refused while paused (and nothing is recorded).
    b.room.send('kit:answer', { seq: 1, text: 'during' });
    await waitFor(() => b.errors.some((e) => e.type === 'kit:answer'), 2000, 'refused');
    expect(b.errors.find((e) => e.type === 'kit:answer')).toMatchObject({ code: 'wrong_phase', message: 'The game is paused.' });
    expect(t.server.box!.has(b.id())).toBe(false);
    expect(t.server.state.answeredCount).toBe(1);
    b.room.send('kit:answer', { seq: 1, text: 'b' });
    await waitFor(() => b.errors.filter((e) => e.type === 'kit:answer').length === 2, 2000, 'refused again');
    // The last two leave while paused: everyone still here has answered, but the frozen stage waits…
    await b.room.leave(true);
    await c.room.leave(true);
    await sleep(120);
    expect(t.server.state.stage).toBe('answer');
    expect(t.server.state.paused).toBe(true);
    // …and ends right after the resume instead of running out the remaining ~8 s.
    host.room.send('party:host', { action: 'resume' });
    await waitFor(() => t.server.state.stage !== 'answer', 1500, 'stage ended after resume');
  });

  it('players who left mid-match are placed last in the reported outcome', async () => {
    const t = await setup(3, { answerMs: 6000, rounds: 1 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    // c scores first, then leaves before the end: it must not dodge the result (nor keep its lead).
    c.room.send('kit:answer', { seq: 1, text: 'c' });
    a.room.send('kit:answer', { seq: 1, text: 'a' });
    await waitFor(() => t.server.state.answeredCount === 2, 2000, 'answers');
    await c.room.leave(true);
    await waitFor(() => json(a).players[c.id()] === undefined, 2000, 'c left');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).phase === 'RESULTS' && json(a).podiumJson !== '', 4000, 'results');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements).toEqual([[a.id()], [b.id()], [c.id()]]);
    // The podium only lists who is still here.
    const podium = JSON.parse(json(a).podiumJson) as PartyPodium;
    expect(podium.players.map((p) => p.id)).toEqual([a.id(), b.id()]);

    // Explicit placements (hidden-team games) list leavers last too.
    const t2 = await setup(3, { answerMs: 6000 });
    await start(t2);
    const [x, y, z] = t2.clients as [Client, Client, Client];
    await z.room.leave(true);
    await waitFor(() => json(x).players[z.id()] === undefined, 2000, 'z left');
    outcomes.length = 0;
    t2.server.finishWith([[z.id(), y.id()], [x.id()]]);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome 2');
    expect(outcomes[0]!.placements).toEqual([[y.id()], [x.id()], [z.id()]]);
  });

  it('team mode: balanced teams, late joiner joins the smallest team, team totals + podium + outcome', async () => {
    const t = await setup(4, { teams: 2, rounds: 1, answerMs: 6000 });
    await start(t);
    await waitFor(() => json(t.host).teamMode === true && Object.keys(json(t.host).teams).length === 2, 2000, 'teams synced');
    const state = json(t.host);
    const sizes = Object.values(state.teams as Record<string, { size: number }>).map((x) => x.size);
    expect(sizes.sort()).toEqual([2, 2]);
    const late = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'Late' }));
    await waitFor(() => Boolean(json(t.host).seats[late.id()]?.teamId), 2000, 'late team');
    expect(
      Object.values(json(t.host).teams as Record<string, { size: number }>)
        .map((x) => x.size)
        .sort(),
    ).toEqual([2, 3]);
    // Late joiner may answer the open prompt.
    expect(json(t.host).seats[late.id()].eligible).toBe(true);

    const teamOf = (c: Client) => json(t.host).seats[c.id()].teamId as string;
    const volt = [...t.clients, late].filter((c) => teamOf(c) === teamOf(t.host));
    for (const c of volt) c.room.send('kit:answer', { seq: 1, text: 'hi' });
    await waitFor(() => t.server.state.answeredCount === volt.length, 2000, 'team answers');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(t.host).phase === 'RESULTS' && json(t.host).podiumJson !== '', 4000, 'results');
    const final = json(t.host);
    const podium = JSON.parse(final.podiumJson) as PartyPodium;
    expect(podium.teams).not.toBeNull();
    expect(podium.winningTeamIds).toEqual([teamOf(t.host)]);
    expect(podium.winnerIds.sort()).toEqual(volt.map((c) => c.id()).sort());
    expect(final.teams[teamOf(t.host)].score).toBe(volt.length * 10);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]!.sort()).toEqual(volt.map((c) => c.id()).sort());
    expect(outcomes[0]!.details).toMatchObject({ teamMode: true, kit: true });
  });

  it('free-for-all podium ties share a place; outcome placements group ties', async () => {
    const t = await setup(3, { rounds: 1, answerMs: 6000 });
    await start(t);
    const [a, b] = t.clients as [Client, Client, Client];
    a.room.send('kit:answer', { seq: 1, text: 'x' });
    b.room.send('kit:answer', { seq: 1, text: 'y' });
    await waitFor(() => t.server.state.answeredCount === 2, 2000, 'two answers');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).phase === 'RESULTS' && json(a).podiumJson !== '', 4000, 'results');
    const podium = JSON.parse(json(a).podiumJson) as PartyPodium;
    expect(podium.players.map((p) => p.place)).toEqual([1, 1, 3]);
    expect(podium.winnerIds.sort()).toEqual([a.id(), b.id()].sort());
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements.map((g) => g.length)).toEqual([2, 1]);
    // Back to lobby resets the kit state.
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => json(a).phase === 'LOBBY', 2000, 'lobby');
    expect(json(a)).toMatchObject({ stage: 'idle', podiumJson: '', teamMode: false, answeredCount: 0 });
    expect(Object.keys(json(a).seats)).toEqual([]);
  });

  it('finishParty({ placements }) overrides score order (hidden-team games)', async () => {
    const t = await setup(3, { answerMs: 6000 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    // a scores, but b + c win as a (secret) team.
    a.room.send('kit:answer', { seq: 1, text: 'x' });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'answered');
    t.server.finishWith([[b.id(), c.id(), 'not-a-player'], [a.id()]]);
    await waitFor(() => json(a).phase === 'RESULTS' && json(a).podiumJson !== '', 3000, 'results');
    const podium = JSON.parse(json(a).podiumJson) as PartyPodium;
    expect(podium.winnerIds.sort()).toEqual([b.id(), c.id()].sort());
    expect(podium.players.map((p) => [p.id, p.place])).toEqual(
      expect.arrayContaining([
        [b.id(), 1],
        [c.id(), 1],
        [a.id(), 3],
      ]),
    );
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements.map((g) => g.sort())).toEqual([[b.id(), c.id()].sort(), [a.id()]]);
    expect(outcomes[0]!.reason).toBe('team_win');
  });

  it('change-until-lock: answered flag on submit, stage waits for lock-in', async () => {
    const t = await setup(2, { allowChange: true, answerMs: 6000 });
    await start(t);
    const [a, b] = t.clients as [Client, Client];
    a.room.send('kit:answer', { seq: 1, text: 'first' });
    a.room.send('kit:answer', { seq: 1, text: 'second' });
    b.room.send('kit:answer', { seq: 1, text: 'b' });
    await waitFor(() => t.server.state.answeredCount === 2, 2000, 'answered');
    await sleep(150);
    expect(t.server.state.stage).toBe('answer');
    expect(t.server.box!.get(a.id())!.value).toBe('second');
    a.room.send('kit:lock', {});
    b.room.send('kit:lock', {});
    await waitFor(() => t.server.state.stage === 'reveal', 2000, 'locked → reveal');
  });

  it('a seated player who was offline when a prompt opened can answer it after reconnecting', async () => {
    const t = await setup(3, { answerMs: 8000, rounds: 2 });
    await start(t);
    const [a, b] = t.clients as [Client, Client, Client];
    const token = b.token();
    const id = b.id();
    b.room.reconnection.enabled = false;
    (b.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.server.state.players.get(id)?.connected === false, 2000, 'b offline');
    // Round 2 opens while b is offline: b is not waited for…
    t.host.room.send('party:host', { action: 'skip', stageSeq: t.server.state.stageSeq });
    await waitFor(() => t.server.state.stage === 'reveal', 2000, 'reveal 1');
    t.host.room.send('party:host', { action: 'skip', stageSeq: t.server.state.stageSeq });
    await waitFor(() => t.server.state.stage === 'answer' && t.server.state.round === 2, 2000, 'round 2');
    expect(t.server.state.seats.get(id)?.eligible).toBe(false);
    // …but may answer once back (same seat).
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P1', seatToken: token }));
    expect(again.id()).toBe(id);
    await waitFor(() => t.server.state.seats.get(id)?.eligible === true, 2000, 'eligible again');
    again.room.send('kit:answer', { seq: 2, text: 'back' });
    await waitFor(() => again.privates.some((p) => p.seq === 2), 2000, 'answer accepted');
    expect(again.errors).toEqual([]);
    // Spectators / custom-eligibility collectors are unaffected: a reconnect never adds a spectator.
    a.room.send('kit:answer', { seq: 2, text: 'a' });
    await waitFor(() => t.server.state.answeredCount === 2, 2000, 'two answers');
  });

  it('a duplicated host skip (double tap / resend) advances one stage only', async () => {
    const t = await setup(2, { answerMs: 6000, rounds: 2 });
    t.server.revealMs = 5000;
    await start(t);
    const seq = t.server.state.stageSeq;
    t.host.room.send('party:host', { action: 'skip', stageSeq: seq });
    t.host.room.send('party:host', { action: 'skip', stageSeq: seq });
    await waitFor(() => t.server.state.stage === 'reveal', 2000, 'skipped once');
    await sleep(150);
    expect(t.server.state.stage).toBe('reveal');
    expect(t.server.state.round).toBe(1);
    // A skip carrying the current stage still works.
    t.host.room.send('party:host', { action: 'skip', stageSeq: t.server.state.stageSeq });
    await waitFor(() => t.server.state.stage === 'answer' && t.server.state.round === 2, 2000, 'next round');
  });

  it('votes: self-vote refused, ballots private until the tally', async () => {
    const t = await setup(3, { answerMs: 6000 });
    await start(t);
    t.server.openTestVote();
    const [a, b, c] = t.clients as [Client, Client, Client];
    a.room.send('kit:vote', { choice: a.id() });
    await waitFor(() => a.errors.some((e) => /own entry/.test(e.message)), 2000, 'self vote refused');
    a.room.send('kit:vote', { choice: b.id() });
    b.room.send('kit:vote', { choice: 'not-a-player' });
    await waitFor(() => b.errors.some((e) => e.code === 'invalid_payload'), 2000, 'unknown option');
    await waitFor(() => json(c).seats[a.id()].answered === true, 2000, 'voted flag');
    expect(JSON.stringify(c.all)).not.toContain(`"choice"`);
    expect(t.server.vote!.tally().options[0]).toMatchObject({ optionId: b.id(), votes: 1 });
  });
});
