/**
 * DAStravaganza Trivia — server integration tests.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  TRIVIA_MSG,
  type TriviaPack,
  type TriviaPackEcho,
  type TriviaPrivate,
  type TriviaQuestion,
  type TriviaQuestionView,
  type TriviaRevealView,
} from '@dascade/shared/games/trivia';
import type { PartyPodium } from '@dascade/shared/party';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import type { TriviaRoom } from '../src/rooms/trivia/TriviaRoom.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stop: () => void = () => undefined;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['trivia'] });
  await server.listen(port);
  colyseus = new ColyseusTestServer(server);
  stop = onOutcome((o, ctx) => {
    if (ctx.gameId === 'trivia') outcomes.push(o);
  });
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  stop();
  await colyseus.shutdown();
});

type Json = Record<string, any>;
interface Client {
  room: SdkRoom;
  name: string;
  id: () => string;
  token: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: TriviaPrivate[];
  echoes: TriviaPackEcho[];
  /** Every message received (type + payload) — for leak checks. */
  traffic: Array<{ type: string; payload: unknown }>;
}

async function wire(room: SdkRoom, name: string): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const traffic: Client['traffic'] = [];
  const client: Client = {
    room,
    name,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    privates: collect(room, TRIVIA_MSG.private),
    echoes: collect(room, TRIVIA_MSG.packEcho),
    traffic,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => traffic.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
/** The live room; tests reach protected tunables (timers) and internals through the index signature. */
type Server = Pick<TriviaRoom, 'state'> & Record<string, any>;

const SECRET = 'Zebrafishtopia';
const PACK: TriviaPack = {
  title: 'Test pack',
  questions: [
    {
      category: 'custom',
      difficulty: 'easy',
      type: 'mc',
      prompt: 'Which is a fruit?',
      options: ['Apple', 'Brick', 'Cloud', 'Spoon'],
      correct: 0,
    },
    { category: 'custom', difficulty: 'easy', type: 'text', prompt: 'Name the secret town.', accept: [SECRET] },
    { category: 'custom', difficulty: 'easy', type: 'number', prompt: 'How many legs on a spider?', correct: 8 },
  ],
};

async function setup(names: string[], settings: Json = {}, opts: { spectators?: string[]; pack?: TriviaPack | null } = {}) {
  const host = await wire(await colyseus.sdk.create('trivia', { name: names[0] }), names[0]!);
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.countdownMs = 0;
  server.introMs = 30;
  server.revealMs = 80;
  server.scoresMs = 60;
  server.soloScoresMs = 40;
  server.wagerMs = 5000;
  server.allAnsweredDelayMs = 20;
  server.answerMsOverride = 8000;
  const pack = opts.pack === undefined ? PACK : opts.pack;
  if (pack) {
    host.room.send(TRIVIA_MSG.pack, { pack });
    await waitFor(() => host.echoes.some((e) => e.pack !== null), 3000, 'pack echo');
  }
  const full = { pack: 'custom', questionCount: 3, speedBonus: false, streakBonus: false, finalWager: false, ...settings };
  host.room.send('lobby:settings', { settings: full });
  await waitFor(
    () => Object.entries(full).every(([k, v]) => JSON.stringify(JSON.parse(server.state.settingsJson)[k]) === JSON.stringify(v)),
    3000,
    'settings',
  );
  const clients = [host];
  for (const n of names.slice(1)) clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: n }), n));
  const specs: Client[] = [];
  for (const n of opts.spectators ?? [])
    specs.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: n, spectator: true }), n));
  return { server, host, clients, specs };
}

async function startAndWaitQuestion(t: { server: Server; host: Client }) {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'question', 4000, 'question stage');
}

/** Waits until every client has the current question view, returns it. */
async function questionOn(c: Client, seq?: number): Promise<TriviaQuestionView> {
  await waitFor(
    () => {
      const q = json(c).questionJson;
      return Boolean(q) && (seq === undefined || JSON.parse(q).seq === seq) && json(c).stage === 'question';
    },
    4000,
    `question on ${c.name}`,
  );
  return JSON.parse(json(c).questionJson) as TriviaQuestionView;
}

const correctMc = (server: Server) => server.current.key.correctIndex as number;

describe('DAStravaganza Trivia room', () => {
  it('plays a question: private locks, public "answered", reveal, scores, distribution', async () => {
    const t = await setup(['Host', 'Ana', 'Bo'], { questionCount: 3 }, { spectators: ['Spec'] });
    // Force the multiple-choice question first.
    await startAndWaitQuestion(t);
    const [host, ana, bo] = t.clients as [Client, Client, Client];
    const view = await questionOn(ana);
    expect(view.total).toBe(3);
    expect(Object.keys(view)).not.toContain('correct');
    expect(json(ana).revealJson).toBe('');
    const server = t.server;
    const answerFor = (right: boolean) => {
      const v = server.current.view as TriviaQuestionView;
      if (v.type === 'mc') return { kind: 'mc', index: right ? correctMc(server) : (correctMc(server) + 1) % 4 };
      if (v.type === 'text') return { kind: 'text', text: right ? SECRET.toUpperCase() : 'Nowhere' };
      return { kind: 'number', value: right ? 8 : 80 };
    };
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(true) });
    ana.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(false) });
    await waitFor(() => json(bo).seats[host.id()]?.answered && json(bo).seats[ana.id()]?.answered, 2000, 'answered flags');
    expect(json(bo).answeredCount).toBe(2);
    expect(json(bo).revealJson).toBe('');
    // Own locked answer comes back privately; others and spectators get nothing private.
    await waitFor(() => host.privates.some((p) => p.seq === view.seq && p.answer !== null), 2000, 'host private');
    expect(bo.privates.length).toBe(0);
    expect(t.specs[0]!.privates.length).toBe(0);
    // Duplicate answer rejected.
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(false) });
    await waitFor(() => host.errors.some((e) => /already locked/i.test(e.message)), 2000, 'duplicate');
    // Spectator cannot answer.
    t.specs[0]!.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(true) });
    await waitFor(() => t.specs[0]!.errors.some((e) => e.code === 'not_allowed'), 2000, 'spectator');
    // Stale seq rejected.
    bo.room.send(TRIVIA_MSG.answer, { seq: view.seq + 99, answer: answerFor(true) });
    await waitFor(() => bo.errors.some((e) => /earlier question/.test(e.message)), 2000, 'stale');
    bo.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(true) });
    // Everyone answered → early reveal.
    await waitFor(() => json(bo).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(bo).revealJson) as TriviaRevealView;
    expect(reveal.seq).toBe(view.seq);
    expect(reveal.answeredCount).toBe(3);
    expect(reveal.correctCount).toBe(2);
    expect(reveal.results[host.id()]).toMatchObject({ correct: true, points: 500 });
    expect(reveal.results[ana.id()]).toMatchObject({ correct: false });
    if (reveal.distribution) expect(reveal.distribution.reduce((a, b) => a + b, 0)).toBe(3);
    await waitFor(() => json(bo).players[host.id()].score === 500, 2000, 'score');
    expect(json(bo).seats[host.id()].delta).toBe(500);
    // Result arrives privately too.
    await waitFor(() => host.privates.some((p) => p.seq === view.seq && p.result?.correct === true), 2000, 'private result');
    // Late answer after the reveal is rejected.
    ana.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: answerFor(true) });
    await waitFor(() => ana.errors.some((e) => e.code === 'wrong_phase'), 2000, 'late');
  });

  it('never leaks the answer key before the reveal (state, broadcasts, other players, spectators)', async () => {
    const onlyText: TriviaPack = {
      title: 'Secret',
      questions: [
        PACK.questions[1]!,
        { ...PACK.questions[1]!, prompt: 'Again: name the secret town.' } as TriviaQuestion,
        { ...PACK.questions[1]!, prompt: 'Once more: the secret town?' } as TriviaQuestion,
      ],
    };
    const t = await setup(['Host', 'Ana'], { questionCount: 3 }, { spectators: ['Spec'], pack: onlyText });
    // The host editor echo (lobby only, host only) is the one legit place the pack travels.
    const [host, ana] = t.clients as [Client, Client];
    expect(ana.echoes.length).toBe(0);
    expect(t.specs[0]!.echoes.length).toBe(0);
    const hostTrafficBefore = host.traffic.length;
    await startAndWaitQuestion(t);
    const view = await questionOn(ana);
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: { kind: 'text', text: 'wrong guess' } });
    await sleep(150);
    const lower = SECRET.toLowerCase();
    for (const c of [ana, t.specs[0]!]) {
      expect(JSON.stringify(json(c)).toLowerCase()).not.toContain(lower);
      expect(JSON.stringify(c.traffic).toLowerCase()).not.toContain(lower);
    }
    expect(JSON.stringify(host.traffic.slice(hostTrafficBefore)).toLowerCase()).not.toContain(lower);
    // After the reveal the answer is public.
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(ana).revealJson !== '', 2000, 'reveal');
    expect(JSON.parse(json(ana).revealJson).correctText).toBe(SECRET);
  });

  it('reconnect (seat-token rejoin) restores the locked answer', async () => {
    const t = await setup(['Host', 'Ana']);
    await startAndWaitQuestion(t);
    const [, ana] = t.clients as [Client, Client];
    const view = await questionOn(ana);
    const answer =
      view.type === 'mc'
        ? { kind: 'mc', index: 2 }
        : view.type === 'text'
          ? { kind: 'text', text: 'Somewhere' }
          : { kind: 'number', value: 3 };
    ana.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer });
    await waitFor(() => ana.privates.some((p) => p.answer !== null), 2000, 'locked');
    ana.room.reconnection.enabled = false;
    (ana.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(80);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'Ana', seatToken: ana.token() }), 'Ana2');
    expect(again.id()).toBe(ana.id());
    await waitFor(() => again.privates.length > 0, 2000, 'private restored');
    expect(again.privates.at(-1)).toMatchObject({ seq: view.seq, answer });
    // Still locked: a second answer is refused.
    again.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer });
    await waitFor(() => again.errors.some((e) => /already locked/i.test(e.message)), 2000, 'still locked');
  });

  it('rejects invalid answers for the question type', async () => {
    const t = await setup(['Host']);
    await startAndWaitQuestion(t);
    const [host] = t.clients as [Client];
    const view = await questionOn(host);
    const wrongKind = view.type === 'mc' ? { kind: 'tf', value: true } : { kind: 'mc', index: 0 };
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: wrongKind });
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: { kind: 'text', text: '​​' } });
    await waitFor(() => host.errors.filter((e) => e.code === 'invalid_payload').length >= 2, 2000, 'invalid');
    expect(json(host).seats[host.id()].answered).toBe(false);
  });

  it('full match: every question, podium, reportOutcome with correctByPlayer, back to lobby', async () => {
    const t = await setup(['Host', 'Ana'], { questionCount: 3 });
    await startAndWaitQuestion(t);
    const [host, ana] = t.clients as [Client, Client];
    for (let i = 0; i < 3; i++) {
      await waitFor(() => t.server.state.stage === 'question', 4000, `question ${i}`);
      const view = t.server.current.view as TriviaQuestionView;
      const right =
        view.type === 'mc'
          ? { kind: 'mc', index: correctMc(t.server) }
          : view.type === 'text'
            ? { kind: 'text', text: SECRET }
            : { kind: 'number', value: 7 };
      host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: right });
      ana.room.send(TRIVIA_MSG.answer, {
        seq: view.seq,
        answer:
          view.type === 'number'
            ? { kind: 'number', value: 100 }
            : view.type === 'text'
              ? { kind: 'text', text: 'nope' }
              : { kind: 'mc', index: (correctMc(t.server) + 1) % 4 },
      });
      await waitFor(() => t.server.state.stage !== 'question', 4000, `revealed ${i}`);
    }
    await waitFor(() => json(ana).phase === 'RESULTS' && json(ana).podiumJson !== '', 4000, 'results');
    const podium = JSON.parse(json(ana).podiumJson) as PartyPodium;
    expect(podium.winnerIds).toEqual([host.id()]);
    expect(podium.players[0]).toMatchObject({ id: host.id(), score: 1500, place: 1 });
    expect(JSON.parse(json(ana).correctJson)).toEqual({ [host.id()]: 3, [ana.id()]: 0 });
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements).toEqual([[host.id()], [ana.id()]]);
    expect(outcomes[0]!.details).toMatchObject({
      correctByPlayer: { [host.id()]: 3, [ana.id()]: 0 },
      questions: 3,
      playerStats: { [host.id()]: { correctAnswers: 3, bestStreak: 3 }, [ana.id()]: { correctAnswers: 0, bestStreak: 0 } },
    });
    // The host gets the pack echo back in RESULTS (editor), the player never does.
    expect(ana.echoes.length).toBe(0);
    host.room.send('lobby:toLobby', {});
    await waitFor(() => json(ana).phase === 'LOBBY', 2000, 'lobby');
    expect(json(ana)).toMatchObject({ questionJson: '', revealJson: '', stage: 'idle' });
  });

  it('closest number wins with ties sharing full points', async () => {
    const numbers: TriviaPack = {
      questions: [
        PACK.questions[2]!,
        { ...PACK.questions[2]!, prompt: 'Legs on two spiders?', correct: 16 } as TriviaQuestion,
        { ...PACK.questions[2]!, prompt: 'Legs on three spiders?', correct: 24 } as TriviaQuestion,
      ],
    };
    const t = await setup(['Host', 'Ana', 'Bo'], { questionCount: 3 }, { pack: numbers });
    await startAndWaitQuestion(t);
    const [host, ana, bo] = t.clients as [Client, Client, Client];
    const view = await questionOn(host);
    const target = t.server.current.key.correctNumber as number;
    host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: { kind: 'number', value: target - 2 } });
    ana.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: { kind: 'number', value: target + 2 } });
    bo.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: { kind: 'number', value: target + 50 } });
    await waitFor(() => json(host).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(host).revealJson) as TriviaRevealView;
    expect(reveal.closest!.ids.sort()).toEqual([host.id(), ana.id()].sort());
    expect(reveal.results[host.id()]!.points).toBe(500);
    expect(reveal.results[ana.id()]!.points).toBe(500);
    expect(reveal.results[bo.id()]!.points).toBe(0);
  });

  it('team mode: balanced teams and team totals', async () => {
    const t = await setup(['Host', 'Ana', 'Bo', 'Cy'], { mode: 'teams', teamCount: 2, teamScoring: 'sum' });
    await startAndWaitQuestion(t);
    await waitFor(() => json(t.host).teamMode && Object.keys(json(t.host).teams).length === 2, 2000, 'teams');
    const teams = json(t.host).teams as Record<string, { size: number }>;
    expect(Object.values(teams).map((x) => x.size)).toEqual([2, 2]);
    const view = await questionOn(t.host);
    const hostTeam = json(t.host).seats[t.host.id()].teamId as string;
    const right =
      view.type === 'mc'
        ? { kind: 'mc', index: correctMc(t.server) }
        : view.type === 'text'
          ? { kind: 'text', text: SECRET }
          : { kind: 'number', value: 8 };
    t.host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: right });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'answered');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => (json(t.host).teams[hostTeam]?.score ?? 0) === 500, 3000, 'team score');
    // Team mode needs one player per team.
  });

  it('team mode start is blocked with fewer players than teams', async () => {
    const t = await setup(['Host'], { mode: 'teams', teamCount: 3 });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => /needs at least 3 players/.test(e.message)), 2000, 'blocked');
  });

  it('final wager: private wager stage, bounds, +wager on a correct final', async () => {
    const t = await setup(['Host', 'Ana'], { questionCount: 3, finalWager: true });
    await startAndWaitQuestion(t);
    const [host, ana] = t.clients as [Client, Client];
    // Two regular questions: host right both times (1000 pts), Ana wrong.
    for (let i = 0; i < 2; i++) {
      await waitFor(() => t.server.state.stage === 'question', 4000, `q${i}`);
      const view = t.server.current.view as TriviaQuestionView;
      expect(view.isFinal).toBe(false);
      const right =
        view.type === 'mc'
          ? { kind: 'mc', index: correctMc(t.server) }
          : view.type === 'text'
            ? { kind: 'text', text: SECRET }
            : { kind: 'number', value: t.server.current.key.correctNumber };
      host.room.send(TRIVIA_MSG.answer, { seq: view.seq, answer: right });
      await waitFor(() => t.server.state.answeredCount === 1, 2000, `answered ${i}`);
      host.room.send('party:host', { action: 'skip' });
      await waitFor(() => t.server.state.stage !== 'question', 3000, `revealed ${i}`);
    }
    await waitFor(() => t.server.state.stage === 'wager', 4000, 'wager');
    // The client sees only the final's category — never its question — while wagering.
    await waitFor(() => json(host).stage === 'wager' && json(host).finalCategory !== '', 2000, 'wager synced');
    expect(json(host).questionJson).toBe('');
    await waitFor(() => host.privates.some((p) => p.wager && !p.wager.locked) && ana.privates.some((p) => p.wager), 2000, 'wager private');
    const hostWager = host.privates.at(-1)!.wager!;
    expect(hostWager.max).toBe(1000);
    expect(ana.privates.at(-1)!.wager!.max).toBe(500); // base points floor
    const seq = host.privates.at(-1)!.seq;
    host.room.send(TRIVIA_MSG.wager, { seq, amount: 5000 });
    await waitFor(() => host.errors.some((e) => /Wager between 0 and 1,000/.test(e.message)), 2000, 'too big');
    host.room.send(TRIVIA_MSG.wager, { seq, amount: 700 });
    ana.room.send(TRIVIA_MSG.wager, { seq, amount: 300 });
    // Both wagered → the final question opens early.
    await waitFor(() => t.server.state.stage === 'question', 3000, 'final question');
    const view = t.server.current.view as TriviaQuestionView;
    expect(view.isFinal).toBe(true);
    expect(view.seq).toBe(seq);
    const right =
      view.type === 'mc'
        ? { kind: 'mc', index: correctMc(t.server) }
        : view.type === 'text'
          ? { kind: 'text', text: SECRET }
          : { kind: 'number', value: t.server.current.key.correctNumber };
    host.room.send(TRIVIA_MSG.answer, { seq, answer: right });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'final answered');
    host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(host).phase === 'RESULTS' && json(host).podiumJson !== '', 4000, 'results');
    expect(json(host).players[host.id()].score).toBe(1700);
    expect(json(host).players[ana.id()].score).toBe(0); // no answer: −300, floored at 0
  });

  it('custom packs: host only, validated with errors, never sent to players; custom-only start needs a pack', async () => {
    const t = await setup(['Host', 'Ana'], { pack: 'custom' }, { pack: null });
    const [host, ana] = t.clients as [Client, Client];
    host.room.send('lobby:start', {});
    await waitFor(() => host.errors.some((e) => /custom question pack/.test(e.message)), 2000, 'needs pack');
    ana.room.send(TRIVIA_MSG.pack, { pack: PACK });
    await waitFor(() => ana.errors.some((e) => e.code === 'not_host'), 2000, 'not host');
    host.room.send(TRIVIA_MSG.pack, {
      pack: { questions: [{ type: 'mc', category: 'custom', difficulty: 'easy', prompt: 'x', options: ['one'], correct: 0 }] },
    });
    await waitFor(() => host.echoes.some((e) => e.errors.length > 0), 2000, 'errors echoed');
    expect(host.echoes.at(-1)!.errors[0]).toMatch(/^Question 1/);
    host.room.send(TRIVIA_MSG.pack, { pack: PACK });
    await waitFor(() => JSON.parse(json(ana).packInfoJson).custom?.total === 3, 2000, 'pack info');
    expect(ana.echoes.length).toBe(0);
    expect(JSON.stringify(ana.traffic)).not.toContain(SECRET);
    host.room.send(TRIVIA_MSG.pack, { pack: null });
    await waitFor(() => JSON.parse(json(ana).packInfoJson).custom === null, 2000, 'cleared');
  });

  it('custom pack answers stay with the host who wrote it, even when the host role moves', async () => {
    const t = await setup(['Host', 'Ana']);
    const [host, ana] = t.clients as [Client, Client];
    const hostEchoes = host.echoes.length;
    host.room.send('lobby:transferHost', { playerId: ana.id() });
    await waitFor(() => ana.echoes.length > 0, 2000, 'new host echo');
    expect(ana.echoes.at(-1)).toMatchObject({ pack: null, hidden: { title: 'Test pack', total: 3 } });
    expect(JSON.stringify(ana.traffic)).not.toContain(SECRET);
    // The new host may clear or replace it (never read it)…
    ana.room.send(TRIVIA_MSG.pack, { pack: { ...PACK, title: 'Ana pack', questions: [PACK.questions[0]!] } });
    await waitFor(() => ana.echoes.at(-1)?.pack?.title === 'Ana pack', 2000, 'ana pack echo');
    // …and the original author only sees a pack again when it is theirs.
    ana.room.send('lobby:transferHost', { playerId: host.id() });
    await waitFor(() => host.echoes.length > hostEchoes, 2000, 'echo back to host');
    expect(host.echoes.at(-1)).toMatchObject({ pack: null, hidden: { title: 'Ana pack', total: 1 } });
    // Automatic migration (the host leaves) behaves the same way.
    host.room.send(TRIVIA_MSG.pack, { pack: PACK });
    await waitFor(() => host.echoes.at(-1)?.pack?.title === 'Test pack', 2000, 'host pack again');
    const anaEchoes = ana.echoes.length;
    await host.room.leave(true);
    await waitFor(() => ana.echoes.length > anaEchoes, 3000, 'migration echo');
    expect(ana.echoes.at(-1)).toMatchObject({ pack: null, hidden: { total: 3 } });
    expect(JSON.stringify(ana.traffic)).not.toContain(SECRET);
  });

  it('starter pack: publishes counts and plays a starter question', async () => {
    const t = await setup(['Host'], { pack: 'starter', categories: ['science'], questionCount: 5 }, { pack: null });
    const info = JSON.parse(json(t.host).packInfoJson);
    expect(info.starter.total).toBeGreaterThanOrEqual(400);
    expect(info.starter.byCategory.science).toBeGreaterThan(0);
    await startAndWaitQuestion(t);
    const view = await questionOn(t.host);
    expect(view.category).toBe('science');
    expect(view.total).toBe(5);
  });

  it('disconnect of the last pending player reveals early (never stalls)', async () => {
    const t = await setup(['Host', 'Ana']);
    await startAndWaitQuestion(t);
    const [host, ana] = t.clients as [Client, Client];
    const view = await questionOn(host);
    host.room.send(TRIVIA_MSG.answer, {
      seq: view.seq,
      answer:
        view.type === 'mc' ? { kind: 'mc', index: 0 } : view.type === 'text' ? { kind: 'text', text: 'x' } : { kind: 'number', value: 1 },
    });
    await waitFor(() => t.server.state.answeredCount === 1, 2000, 'one answered');
    await ana.room.leave(true);
    await waitFor(() => t.server.state.revealJson !== '', 2000, 'revealed');
  });
});
