/**
 * DASterpiece integration tests: the full write → vote → reveal loop against a real server,
 * anonymity (no authors / texts before their time), voting rules, scoring, no-submission and
 * disconnect handling, audience voting, reconnects and host controls.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { PartyPodium } from '@dascade/shared/party';
import {
  MASTERPIECE_MSG,
  MP_POINTS,
  type MasterpiecePublicState,
  type MpGameEvent,
  type MpPodiumExtras,
  type MpPrivate,
  type MpPromptsPrivate,
} from '@dascade/shared/games/masterpiece';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import type { MasterpieceRoom } from '../src/rooms/masterpiece/MasterpieceRoom.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['masterpiece'] });
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

interface Client {
  room: SdkRoom;
  name: string;
  id: () => string;
  token: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  views: MpPrivate[];
  events: MpGameEvent[];
  prompts: MpPromptsPrivate[];
  /** Every message received (type + JSON), for leak checks. */
  raw: string[];
  view: () => MpPrivate;
}

async function wire(room: SdkRoom, name: string): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const raw: string[] = [];
  const client: Client = {
    room,
    name,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    views: collect(room, MASTERPIECE_MSG.private),
    events: collect(room, MASTERPIECE_MSG.event),
    prompts: collect(room, MASTERPIECE_MSG.prompts),
    raw,
    view: () => client.views.at(-1)!,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => raw.push(`${String(type)} ${JSON.stringify(payload)}`));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

type Server = MasterpieceRoom & Record<string, any>;
const pub = (c: Client) => (c.room.state as unknown as { toJSON(): MasterpiecePublicState }).toJSON();

interface Table {
  server: Server;
  host: Client;
  clients: Client[];
  specs: Client[];
  byId: (id: string) => Client;
  st: () => MasterpiecePublicState;
}

const FAST = {
  countdownMs: 20,
  introMs: 40,
  revealBaseMs: 80,
  revealPerAnswerMs: 0,
  revealMaxMs: 80,
  walkoverMs: 80,
  scoresMs: 80,
  noVotersMs: 80,
  minSkipGapMs: 0,
  allAnsweredDelayMs: 20,
  writeMsOverride: 5000,
  voteMsOverride: 5000,
};

async function setup(n: number, settings: Record<string, unknown> = {}, opts: { spectators?: number; tune?: Record<string, unknown> } = {}): Promise<Table> {
  const host = await wire(await colyseus.sdk.create('masterpiece', { name: 'P0' }), 'P0');
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  Object.assign(server, FAST, opts.tune ?? {});
  host.room.send('lobby:settings', { settings: { rounds: 1, ...settings } });
  await waitFor(() => JSON.parse(server.state.settingsJson).rounds === (settings.rounds ?? 1), 2000, 'settings');
  const clients = [host];
  for (let i = 1; i < n; i++) clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `P${i}` }), `P${i}`));
  const specs: Client[] = [];
  for (let i = 0; i < (opts.spectators ?? 0); i++) specs.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `S${i}`, spectator: true }), `S${i}`));
  const all = [...clients, ...specs];
  return { server, host, clients, specs, byId: (id) => all.find((c) => c.id() === id)!, st: () => pub(host) };
}

async function start(t: Table): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'write', 3000, 'write stage');
  await waitFor(() => t.clients.every((c) => c.view()?.assignments.length > 0 && c.view().round === t.server.state.round), 3000, 'assignments');
}

const answerText = (c: Client, i: number) => `${c.name} answer ${i} zq`;

/** Every writer (except `skip`) answers all of their prompts. */
async function writeAll(t: Table, skip: Client[] = []): Promise<void> {
  for (const c of t.clients) {
    if (skip.includes(c)) continue;
    c.view().assignments.forEach((a, i) => c.room.send(MASTERPIECE_MSG.submit, { showdownId: a.showdownId, text: answerText(c, i) }));
  }
}

async function waitStage(t: Table, stage: string, timeout = 4000): Promise<void> {
  await waitFor(() => t.server.state.stage === stage, timeout, `stage ${stage}`);
}

/** Vote for the first answer each voter may pick in the current showdown. */
function voteFirstAllowed(c: Client, st: MasterpiecePublicState, count = 1): string[] {
  const own = new Set(c.view().ownAnswerIds);
  const picks = st.answers.filter((a) => !own.has(a.id)).slice(0, count).map((a) => a.id);
  c.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks });
  return picks;
}

/** Private vote views AND the public patch for the server's current showdown have reached the clients. */
async function waitVoteView(t: Table, clients: Client[]): Promise<void> {
  await waitFor(() => clients.every((c) => c.view()?.showdownId === t.server.state.showdownId && (c.view().canVote || c.view().voteBlock !== '')), 3000, 'vote views');
  await waitFor(() => clients.every((c) => pub(c).showdownId === t.server.state.showdownId && pub(c).stage === 'vote' && pub(c).answers.length === t.server.state.answers.length), 3000, 'vote patch');
}

describe('DASterpiece — full loop', () => {
  it('3 players: head-to-head matchups (non-authors vote), author reveal only after voting, results + outcome', async () => {
    const t = await setup(3, { votingMode: 'matchups' });
    await start(t);
    await waitFor(() => t.st().stage === 'write' && t.st().perWriter === 2, 2000, 'write patch');
    const st0 = t.st();
    expect(st0.roundKind).toBe('matchup');
    expect(st0.perWriter).toBe(2);
    for (const c of t.clients) expect(c.view().assignments).toHaveLength(2);
    // Prompts are dealt privately: never in public state.
    const allPrompts = t.clients.flatMap((c) => c.view().assignments.map((a) => a.prompt));
    expect(JSON.stringify(st0)).not.toContain(allPrompts[0]!.slice(0, 20));

    await writeAll(t);
    await waitStage(t, 'vote');
    // Nobody saw anyone else's answer before voting opened.
    for (const c of t.clients) {
      const before = c.raw.join('\n');
      for (const other of t.clients) if (other !== c) expect(before).not.toContain(answerText(other, 0));
    }

    const seenAnswerIds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await waitStage(t, 'vote');
      await waitFor(() => t.st().showdownIndex === i && t.st().answers.length === 2, 2000, 'answers');
      const st = t.st();
      expect(st.showdownCount).toBe(3);
      // Anonymous: no authors, no tallies, opaque ids unrelated to player ids.
      for (const a of st.answers) {
        expect(a.authorId).toBe('');
        expect(a.authorName).toBe('');
        expect(a.votes).toBe(0);
        expect(a.id).toMatch(/^[A-Za-z0-9]{10}$/u);
        expect(t.clients.map((c) => c.id())).not.toContain(a.id);
        seenAnswerIds.add(a.id);
      }
      expect(JSON.stringify(st.seats)).not.toContain('"answered":true');
      await waitVoteView(t, t.clients);
      const voters = t.clients.filter((c) => c.view().canVote);
      const authors = t.clients.filter((c) => c.view().voteBlock === 'author');
      expect(voters).toHaveLength(1);
      expect(authors).toHaveLength(2);
      for (const a of authors) expect(a.view().ownAnswerIds).toHaveLength(1);
      expect(voters[0]!.view().ownAnswerIds).toEqual([]);
      expect(st.votersExpected).toBe(1);
      // Authors are refused.
      const before = authors[0]!.errors.length;
      voteFirstAllowed(authors[0]!, st);
      await waitFor(() => authors[0]!.errors.length > before, 2000, 'author refused');
      expect(authors[0]!.errors.at(-1)!.type).toBe(MASTERPIECE_MSG.vote);
      const [pick] = voteFirstAllowed(voters[0]!, st);
      await waitStage(t, 'reveal');
      await waitFor(() => t.st().answers.every((a) => a.authorId !== ''), 2000, 'authors revealed');
      const revealed = t.st();
      const winner = revealed.answers.find((a) => a.id === pick)!;
      expect(winner).toMatchObject({ votes: 1, winner: true, points: MP_POINTS.vote + MP_POINTS.win });
      expect(authors.map((a) => a.id()).sort()).toEqual(revealed.answers.map((a) => a.authorId).sort());
      expect(revealed.answers.every((a) => a.authorName.startsWith('P'))).toBe(true);
    }
    expect(seenAnswerIds.size).toBe(6);

    await waitStage(t, 'scores');
    const sum = () => Object.values(t.st().players).reduce((n, p) => n + p.score, 0);
    await waitFor(() => sum() === 3 * (MP_POINTS.vote + MP_POINTS.win), 2000, 'round scores');
    const scores = t.st();
    expect(Object.values(scores.seats).some((s) => s.delta > 0)).toBe(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    await waitFor(() => t.st().podiumJson !== '', 2000, 'podium patch');
    const podium = JSON.parse(t.st().podiumJson) as PartyPodium;
    expect(podium.players).toHaveLength(3);
    expect((podium.extras as unknown as MpPodiumExtras).showdowns).toBe(3);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements.flat().sort()).toEqual(t.clients.map((c) => c.id()).sort());
    expect(outcomes[0]!.reason).toBe('completed');
    const hall = JSON.parse(t.st().hallJson) as unknown[];
    expect(hall.length).toBeGreaterThanOrEqual(3);
  });

  it('favourite gallery: everyone votes, self-votes refused, duplicates are idempotent, sweep bonus', async () => {
    const t = await setup(4, { votingMode: 'favourite' });
    await start(t);
    await waitFor(() => t.st().perWriter === 1, 2000, 'write patch');
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, t.clients);
    const st = t.st();
    expect(st.answers).toHaveLength(4);
    expect(st.voteKind).toBe('favourite');
    for (const c of t.clients) expect(c.view().canVote).toBe(true);
    // Self-vote refused.
    const [p0, p1, p2, p3] = t.clients as [Client, Client, Client, Client];
    const own = p0.view().ownAnswerIds[0]!;
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [own] });
    await waitFor(() => p0.errors.length > 0, 2000, 'self vote refused');
    expect(p0.errors.at(-1)!.message).toMatch(/own/u);
    // Everyone else (P1..P3) picks P0's answer; P0 picks P1's → P0 sweeps.
    const p1Answer = p1.view().ownAnswerIds[0]!;
    for (const c of [p1, p2, p3]) c.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [own] });
    // Duplicate + changed vote from P1 (changes are off) — no double count.
    p1.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [own] });
    p1.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [p0.view().ownAnswerIds[0] === own ? p1Answer : own] });
    await waitFor(() => t.st().votesIn === 3, 2000, 'three votes');
    await sleep(60);
    expect(t.st().stage).toBe('vote');
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [p1Answer] });
    await waitStage(t, 'reveal');
    await waitFor(() => t.st().answers.every((a) => a.authorId !== ''), 2000, 'revealed');
    const res = Object.fromEntries(t.st().answers.map((a) => [a.authorId, a]));
    expect(res[p0.id()]).toMatchObject({ votes: 3, sweep: true, winner: true, points: 3 * MP_POINTS.vote + MP_POINTS.win + MP_POINTS.sweep });
    expect(res[p1.id()]).toMatchObject({ votes: 1, sweep: false, winner: false, points: MP_POINTS.vote });
    await waitStage(t, 'scores');
    const expected = 3 * MP_POINTS.vote + MP_POINTS.win + MP_POINTS.sweep;
    await waitFor(() => t.st().players[p0.id()]!.score === expected, 2000, 'score patch');
    const events = t.host.events.filter((e) => e.type === 'reveal');
    expect(events.at(-1)).toMatchObject({ sweep: true });
  });

  it('vote changes allowed until lock-in when the host permits it', async () => {
    const t = await setup(3, { votingMode: 'favourite', allowVoteChange: true });
    await start(t);
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, t.clients);
    const st = t.st();
    const [p0, p1, p2] = t.clients as [Client, Client, Client];
    const others = st.answers.map((a) => a.id).filter((id) => !p0.view().ownAnswerIds.includes(id));
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [others[0]] });
    await waitFor(() => p0.view().ballot?.picks[0] === others[0], 2000, 'first ballot');
    expect(p0.view().ballot?.locked).toBe(false);
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [others[1]] });
    await waitFor(() => p0.view().ballot?.picks[0] === others[1], 2000, 'changed ballot');
    await waitFor(() => t.st().votesIn === 1, 2000, 'one ballot');
    await sleep(80);
    expect(t.st().votesIn).toBe(1);
    p0.room.send(MASTERPIECE_MSG.lock, { showdownId: st.showdownId });
    await waitFor(() => p0.view().ballot?.locked === true, 2000, 'locked');
    const errs = p0.errors.length;
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [others[0]] });
    await waitFor(() => p0.errors.length > errs, 2000, 'change after lock refused');
    // Unlocked ballots don't end voting early; locked ones do.
    for (const c of [p1, p2]) voteFirstAllowed(c, st);
    await sleep(100);
    expect(t.st().stage).toBe('vote');
    // Lock without a ballot is refused politely.
    for (const c of [p1, p2]) c.room.send(MASTERPIECE_MSG.lock, { showdownId: st.showdownId });
    await waitStage(t, 'reveal');
    await waitFor(() => t.st().answers.reduce((n, a) => n + a.votes, 0) === 3, 2000, 'three votes counted');
  });

  it('plays several exhibitions with fresh prompts; the final one scores double', async () => {
    const t = await setup(3, { votingMode: 'favourite', rounds: 2, doubleFinal: true });
    await start(t);
    await waitFor(() => t.st().round === 1 && t.st().stage === 'write', 2000, 'round 1 patch');
    expect(t.st()).toMatchObject({ round: 1, totalRounds: 2, multiplier: 1 });
    const firstPrompts = t.clients.map((c) => c.view().assignments[0]!.prompt);
    const playRound = async () => {
      await writeAll(t);
      await waitStage(t, 'vote');
      await waitVoteView(t, t.clients);
      const st = t.st();
      // Everyone votes for P0's answer except P0, who votes for P1's.
      const [p0, p1, p2] = t.clients as [Client, Client, Client];
      const a0 = p0.view().ownAnswerIds[0]!;
      for (const c of [p1, p2]) c.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [a0] });
      p0.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [p1.view().ownAnswerIds[0]!] });
      await waitStage(t, 'reveal');
      await waitFor(() => t.st().answers.every((a) => a.authorId !== ''), 2000, 'revealed');
      return t.st().answers.find((a) => a.id === a0)!.points;
    };
    const round1 = await playRound();
    expect(round1).toBe(2 * MP_POINTS.vote + MP_POINTS.win + MP_POINTS.sweep);
    await waitStage(t, 'intro');
    await waitFor(() => t.st().round === 2, 2000, 'round 2');
    expect(t.st().multiplier).toBe(2);
    await waitStage(t, 'write');
    await waitFor(() => t.clients.every((c) => c.view()?.round === 2 && c.view().assignments.length > 0), 2000, 'round 2 prompts');
    const secondPrompts = t.clients.map((c) => c.view().assignments[0]!.prompt);
    expect(new Set([...firstPrompts, ...secondPrompts]).size).toBe(2); // one gallery prompt per round, never repeated
    const round2 = await playRound();
    expect(round2).toBe(2 * round1);
    await waitFor(() => t.server.state.phase === 'RESULTS', 4000, 'results');
    await waitFor(() => t.st().players[t.clients[0]!.id()]!.score === round1 + round2, 2000, 'final score');
  });

  it('ranked top-three galleries with five writers', async () => {
    const t = await setup(5, { votingMode: 'ranked' });
    await start(t);
    await waitFor(() => t.st().roundKind === 'ranked', 2000, 'ranked round');
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, t.clients);
    const st = t.st();
    expect(st.voteKind).toBe('ranked');
    const [p0] = t.clients as [Client];
    // Two picks is not enough.
    const errs = p0.errors.length;
    voteFirstAllowed(p0, st, 2);
    await waitFor(() => p0.errors.length > errs, 2000, 'two picks refused');
    expect(p0.errors.at(-1)!.message).toMatch(/top 3/u);
    for (const c of t.clients) voteFirstAllowed(c, st, 3);
    await waitStage(t, 'reveal');
    await waitFor(() => t.st().answers.every((a) => a.authorId !== ''), 2000, 'revealed');
    const pts = t.st().answers.reduce((n, a) => n + a.votes, 0);
    expect(pts).toBe(15);
  });
});

describe('DASterpiece — no answers, disconnects, audience', () => {
  it('a writer who never answers never stalls the round (walkovers + blanks)', async () => {
    const t = await setup(3, { votingMode: 'matchups' }, { tune: { writeMsOverride: 400 } });
    await start(t);
    const [p0, p1, p2] = t.clients as [Client, Client, Client];
    await writeAll(t, [p2]);
    await waitFor(() => t.st().written[p0.id()] === 2 && t.st().written[p1.id()] === 2, 2000, 'written');
    expect(t.st().seats[p2.id()]!.answered).toBe(false);
    // Timer ends writing; P2's two matchups become walkovers, P0 vs P1 is voted on by P2.
    const reveals: MasterpiecePublicState[] = [];
    await waitFor(
      () => {
        const s = t.st();
        if (s.stage === 'vote' && !s.walkover && p2.view().canVote && p2.view().showdownId === s.showdownId && !p2.view().ballot) voteFirstAllowed(p2, s);
        if (s.stage === 'reveal' && !reveals.some((r) => r.showdownId === s.showdownId) && s.answers.every((a) => a.authorId)) reveals.push(s);
        return t.server.state.phase === 'RESULTS';
      },
      8000,
      'results',
    );
    const walkovers = reveals.filter((r) => r.walkover);
    expect(walkovers).toHaveLength(2);
    for (const w of walkovers) {
      const blank = w.answers.find((a) => a.blank)!;
      expect(blank.authorId).toBe(p2.id());
      expect(blank.points).toBe(0);
      expect(w.answers.find((a) => !a.blank)).toMatchObject({ winner: true, points: MP_POINTS.walkover });
    }
    await waitFor(() => t.st().phase === 'RESULTS', 2000, 'results patch');
    const final = t.st();
    expect(final.players[p2.id()]!.score).toBe(0);
    expect(final.players[p0.id()]!.score + final.players[p1.id()]!.score).toBe(2 * MP_POINTS.walkover + MP_POINTS.vote + MP_POINTS.win);
  });

  it('nobody answering at all skips straight to the scores', async () => {
    const t = await setup(3, { votingMode: 'favourite' }, { tune: { writeMsOverride: 150 } });
    await start(t);
    await waitStage(t, 'scores', 3000);
    expect(t.st().showdownCount).toBe(0);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
  });

  it('spectators vote as the audience (bonus only) and never receive private writer info', async () => {
    const t = await setup(3, { votingMode: 'favourite' }, { spectators: 1 });
    const [spec] = t.specs as [Client];
    await start(t);
    await waitFor(() => spec.view()?.role === 'audience', 2000, 'audience view');
    expect(spec.view().assignments).toEqual([]);
    // Spectators cannot write.
    const assignment = t.clients[0]!.view().assignments[0]!;
    spec.room.send(MASTERPIECE_MSG.submit, { showdownId: assignment.showdownId, text: 'sneaky' });
    await waitFor(() => spec.errors.length > 0, 2000, 'spectator submit refused');
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, [...t.clients, spec]);
    const st = t.st();
    expect(spec.view()).toMatchObject({ canVote: true, ownAnswerIds: [] });
    // The spectator never saw any answer before voting opened, nor any prompt.
    const specLog = spec.raw.join('\n');
    expect(specLog).not.toContain(assignment.prompt.slice(0, 16));
    // Audience picks answer X; players split their votes.
    const target = st.answers[0]!.id;
    spec.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [target] });
    await waitFor(() => t.st().audienceIn === 1, 2000, 'audience vote in');
    expect(t.st().votesIn).toBe(0);
    for (const c of t.clients) voteFirstAllowed(c, st);
    await waitStage(t, 'reveal');
    await waitFor(() => t.st().answers.every((a) => a.authorId !== ''), 2000, 'revealed');
    const picked = t.st().answers.find((a) => a.id === target)!;
    expect(picked.audienceVotes).toBe(1);
    expect(picked.audiencePick).toBe(true);
    expect(t.st().answers.reduce((n, a) => n + a.votes, 0)).toBe(3);
    // Private writer info never reached the spectator.
    for (const v of spec.views) {
      expect(v.assignments).toEqual([]);
      expect(v.ownAnswerIds).toEqual([]);
    }
  });

  it('a writer cannot give their own answer the audience bonus from a spectator tab (one audience vote per device)', async () => {
    const t = await setup(3, { votingMode: 'favourite' });
    const join = async (name: string, guestId: string, spectator: boolean) =>
      wire(await colyseus.sdk.joinById(t.host.room.roomId, { name, guestId, spectator }), name);
    // P3 plays; "P3 tab" is the same browser (same guest id) watching as a spectator.
    const p3 = await join('P3', 'guest-p3', false);
    t.clients.push(p3);
    const sock = await join('P3 tab', 'guest-p3', true);
    const fan = await join('Fan', 'guest-fan', true);
    const fanTab = await join('Fan tab', 'guest-fan', true);
    await start(t);
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, [...t.clients, sock, fan]);
    const st = t.st();
    await waitFor(() => sock.view()?.voteBlock === 'device', 2000, 'sock blocked in view');
    expect(sock.view().canVote).toBe(false);
    sock.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [st.answers[0]!.id] });
    await waitFor(() => sock.errors.some((e) => /one audience vote per device/.test(e.message)), 2000, 'sock refused');
    fan.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [st.answers[0]!.id] });
    await waitFor(() => t.st().audienceIn === 1, 2000, 'fan counted');
    fanTab.room.send(MASTERPIECE_MSG.vote, { showdownId: st.showdownId, picks: [st.answers[1]!.id] });
    await waitFor(() => fanTab.errors.some((e) => /one audience vote per device/.test(e.message)), 2000, 'second tab refused');
    expect(t.st().audienceIn).toBe(1);
  });

  it('audience voting can be switched off', async () => {
    const t = await setup(3, { votingMode: 'favourite', audienceVote: false }, { spectators: 1 });
    const [spec] = t.specs as [Client];
    await start(t);
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitFor(() => spec.view()?.voteBlock === 'spectator', 2000, 'blocked view');
    spec.room.send(MASTERPIECE_MSG.vote, { showdownId: t.st().showdownId, picks: [t.st().answers[0]!.id] });
    await waitFor(() => spec.errors.length > 0, 2000, 'refused');
    expect(t.st().audienceIn).toBe(0);
  });

  it('reconnect restores assignments and submitted answers; a dropped voter does not stall voting', async () => {
    const t = await setup(3, { votingMode: 'favourite' }, { tune: { voteMsOverride: 20_000 } });
    await start(t);
    const [p0, p1, p2] = t.clients as [Client, Client, Client];
    const a = p1.view().assignments[0]!;
    p1.room.send(MASTERPIECE_MSG.submit, { showdownId: a.showdownId, text: 'remember me' });
    await waitFor(() => p1.view().assignments[0]!.answer === 'remember me', 2000, 'accepted');
    // Duplicate submission is refused, not double-counted.
    p1.room.send(MASTERPIECE_MSG.submit, { showdownId: a.showdownId, text: 'second try' });
    await waitFor(() => p1.errors.length > 0, 2000, 'duplicate refused');
    await waitFor(() => t.st().written[p1.id()] === 1, 2000, 'written 1');
    await sleep(80);
    expect(t.st().written[p1.id()]).toBe(1);

    const token = p1.token();
    p1.room.reconnection.enabled = false;
    (p1.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.st().players[p1.id()]?.connected === false, 3000, 'p1 dropped');
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P1', seatToken: token }), 'P1');
    await waitFor(() => again.views.length > 0, 2000, 'view after rejoin');
    expect(again.id()).toBe(p1.id());
    expect(again.view().assignments[0]).toMatchObject({ showdownId: a.showdownId, answer: 'remember me' });
    t.clients[1] = again;

    for (const c of [p0, p2]) c.room.send(MASTERPIECE_MSG.submit, { showdownId: c.view().assignments[0]!.showdownId, text: `${c.name} words` });
    await waitStage(t, 'vote');
    await waitVoteView(t, [p0, again, p2]);
    // P2 drops for good mid-vote; the others' votes end voting without waiting out 20 s.
    p2.room.reconnection.enabled = false;
    (p2.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.st().players[p2.id()]?.connected === false, 3000, 'p2 dropped');
    const st = t.st();
    for (const c of [p0, again]) voteFirstAllowed(c, st);
    await waitStage(t, 'reveal', 3000);
  });

  it('ends the match cleanly when too few writers remain for another round', async () => {
    const t = await setup(3, { votingMode: 'favourite', rounds: 2 }, { tune: { writeMsOverride: 150 } });
    await start(t);
    await t.clients[2]!.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 5000, 'results');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.reason).toBe('not_enough_players');
  });
});

describe('DASterpiece — host controls, custom prompts, guards', () => {
  it('custom prompts stay private to the host and can run a custom-only match', async () => {
    const t = await setup(3, {});
    const [p0, p1] = t.clients as [Client, Client];
    p0.room.send(MASTERPIECE_MSG.prompts, { prompts: ['Name the office goldfish.', 'name the office goldfish', 'What the shit?', 'Describe {player}’s dream desk.'] });
    await waitFor(() => (p0.prompts.at(-1)?.prompts.length ?? 0) > 0, 2000, 'host copy');
    expect(p0.prompts.at(-1)!.prompts).toEqual(['Name the office goldfish.', 'Describe {player}’s dream desk.']);
    expect(p0.prompts.at(-1)!.report).toMatchObject({ duplicates: 1, filtered: 1 });
    await waitFor(() => t.st().customCount === 2, 2000, 'custom count');
    expect(p1.prompts).toHaveLength(0);
    expect(JSON.stringify(pub(p1))).not.toContain('goldfish');
    // Non-hosts can't set prompts.
    p1.room.send(MASTERPIECE_MSG.prompts, { prompts: ['Hijack?'] });
    await waitFor(() => p1.errors.length > 0, 2000, 'non-host refused');

    p0.room.send('lobby:settings', { settings: { customOnly: true, votingMode: 'favourite' } });
    await waitFor(() => JSON.parse(t.server.state.settingsJson).customOnly === true, 2000, 'custom only');
    await start(t);
    await waitFor(() => t.st().roundType === 'custom', 2000, 'custom theme');
    const prompt = p0.view().assignments[0]!.prompt;
    expect(prompt === 'Name the office goldfish.' || /^Describe P\d’s dream desk\.$/u.test(prompt)).toBe(true);
  });

  it('refuses to start custom-only without prompts', async () => {
    const t = await setup(3, { customOnly: true });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.length > 0, 2000, 'start refused');
    expect(t.host.errors.at(-1)!.message).toMatch(/custom prompt/u);
    expect(t.server.state.phase).toBe('LOBBY');
  });

  it('host skip (kit party:host) moves the show along; non-hosts cannot skip', async () => {
    const t = await setup(3, { votingMode: 'favourite' }, { tune: { writeMsOverride: 30_000, introMs: 30_000 } });
    t.host.room.send('lobby:start', {});
    await waitStage(t, 'intro');
    const [host, p1] = t.clients as [Client, Client];
    p1.room.send('party:host', { action: 'skip' });
    await waitFor(() => p1.errors.length > 0, 2000, 'non-host refused');
    expect(t.server.state.stage).toBe('intro');
    host.room.send('party:host', { action: 'skip' });
    await waitStage(t, 'write');
    host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage !== 'write', 2000, 'writing skipped');
  });

  it('refuses stale, malformed and out-of-phase messages', async () => {
    const t = await setup(3, { votingMode: 'favourite' });
    const [p0] = t.clients as [Client];
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: 'abc', picks: ['x'] });
    await waitFor(() => p0.errors.length > 0, 2000, 'lobby vote refused');
    await start(t);
    const n = p0.errors.length;
    p0.room.send(MASTERPIECE_MSG.submit, { showdownId: 'nope', text: 'hi' });
    p0.room.send(MASTERPIECE_MSG.submit, { showdownId: p0.view().assignments[0]!.showdownId, text: '   ' });
    p0.room.send(MASTERPIECE_MSG.submit, { showdownId: '<script>', text: 'x' });
    p0.room.send(MASTERPIECE_MSG.vote, { showdownId: p0.view().assignments[0]!.showdownId, picks: ['a'] });
    await waitFor(() => p0.errors.length >= n + 4, 2000, 'all refused');
    // Someone else's prompt id is refused too.
    const theirs = t.clients[1]!.view().assignments[0]!.showdownId;
    if (!p0.view().assignments.some((a) => a.showdownId === theirs)) {
      p0.room.send(MASTERPIECE_MSG.submit, { showdownId: theirs, text: 'mine now' });
      await waitFor(() => p0.errors.length >= n + 5, 2000, 'foreign prompt refused');
    }
    expect(t.st().written[p0.id()]).toBe(0);
  });

  it('sanitizes answers (length, whitespace, profanity) before anyone sees them', async () => {
    const t = await setup(3, { votingMode: 'favourite', promptTypes: ['name'] });
    await start(t);
    const [p0, p1, p2] = t.clients as [Client, Client, Client];
    p0.room.send(MASTERPIECE_MSG.submit, { showdownId: p0.view().assignments[0]!.showdownId, text: `  shit   happens ${'x'.repeat(300)}` });
    for (const c of [p1, p2]) c.room.send(MASTERPIECE_MSG.submit, { showdownId: c.view().assignments[0]!.showdownId, text: `${c.name} name` });
    await waitStage(t, 'vote');
    await waitVoteView(t, [p0]);
    const mine = t.st().answers.find((a) => p0.view().ownAnswerIds.includes(a.id))!;
    expect(mine.text.startsWith('s*** happens x')).toBe(true);
    expect(Array.from(mine.text).length).toBeLessThanOrEqual(50);
  });
});

describe('DASterpiece — anonymity under disconnects', () => {
  it('the public voter count never reveals whether a disconnected player is a sitting-out author', async () => {
    const t = await setup(4, { votingMode: 'matchups' }, { tune: { voteMsOverride: 20_000 } });
    await start(t);
    await writeAll(t);
    await waitStage(t, 'vote');
    await waitVoteView(t, t.clients);
    // Drop a player who is NOT an author of the current matchup, and check the count is unchanged.
    // (Never the host: the assertions read the host's synced state.) Two voters per matchup → one is not the host.
    const voter = t.clients.slice(1).find((c) => c.view().canVote)!;
    const before = t.st().votersExpected;
    expect(before).toBe(2);
    voter.room.reconnection.enabled = false;
    (voter.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.st().players[voter.id()]?.connected === false, 3000, 'voter dropped');
    await sleep(100);
    expect(t.st().votersExpected).toBe(before);
    expect(t.server.state.stage).toBe('vote');
  });
});
