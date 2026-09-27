/**
 * DAS Survey integration tests: anonymous answers, predictions, reveals, scoring, voiding,
 * custom surveys, reconnects, late joiners, spectators, host controls and a 30-player burst.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { PartyPodium } from '@dascade/shared/party';
import {
  SURVEY_MSG,
  type SurveyCustomPrivate,
  type SurveyCustomQuestionInput,
  type SurveyEvent,
  type SurveyPodiumExtras,
  type SurveyPrivate,
  type SurveyResult,
} from '@dascade/shared/games/survey';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import type { SurveyRoom } from '../src/rooms/survey/SurveyRoom.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['survey'] });
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
  name: string;
  room: SdkRoom;
  id: () => string;
  token: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: SurveyPrivate[];
  custom: SurveyCustomPrivate[];
  events: SurveyEvent[];
  /** Every message this client received (for leak inspection). */
  all: Array<{ type: string; payload: unknown }>;
  last: () => SurveyPrivate | undefined;
}

async function wire(room: SdkRoom, name: string): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const all: Client['all'] = [];
  const privates = collect<SurveyPrivate>(room, SURVEY_MSG.private);
  const client: Client = {
    name,
    room,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    privates,
    custom: collect(room, SURVEY_MSG.custom),
    events: collect(room, SURVEY_MSG.event),
    all,
    last: () => privates.at(-1),
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
/** The live room; tests reach protected tunables and internals through the index signature. */
type Server = Pick<SurveyRoom, 'state'> & Record<string, any>;

interface Table {
  server: Server;
  host: Client;
  clients: Client[];
  specs: Client[];
  join: (name: string, extra?: Json) => Promise<Client>;
}

const CUSTOM: SurveyCustomQuestionInput[] = [
  { mode: 'majority', prompt: 'Coffee or tea?', options: ['Coffee', 'Tea', 'Neither'] },
  { mode: 'percent', prompt: 'Do you cycle to work?', options: ['Yes', 'No'] },
  { mode: 'rank', prompt: 'Best snack?', options: ['Crisps', 'Fruit', 'Nuts'] },
];

async function setup(
  n: number,
  opts: {
    custom?: SurveyCustomQuestionInput[];
    settings?: Json;
    spectators?: number;
    answerMs?: number;
    predictMs?: number;
    revealMs?: number;
  } = {},
): Promise<Table> {
  const host = await wire(await colyseus.sdk.create('survey', { name: 'P0' }), 'P0');
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.countdownMs = 20;
  server.allAnsweredDelayMs = 30;
  server.answerMsOverride = opts.answerMs ?? 6000;
  server.predictMsOverride = opts.predictMs ?? 6000;
  server.revealMsOverride = opts.revealMs ?? 150;
  if (opts.custom !== undefined) {
    host.room.send(SURVEY_MSG.custom, { questions: opts.custom });
    await waitFor(
      () => server.state.customCount === opts.custom!.length && (host.custom.at(-1)?.questions.length ?? 0) === opts.custom!.length,
      2000,
      'custom stored',
    );
  }
  const settings = { ...(opts.custom ? { mode: 'custom' } : {}), ...(opts.settings ?? {}) };
  if (Object.keys(settings).length) {
    host.room.send('lobby:settings', { settings });
    await waitFor(
      () => Object.entries(settings).every(([k, v]) => JSON.stringify(JSON.parse(server.state.settingsJson)[k]) === JSON.stringify(v)),
      2000,
      'settings',
    );
  }
  const clients = [host];
  const join = async (name: string, extra: Json = {}) => wire(await colyseus.sdk.joinById(host.room.roomId, { name, ...extra }), name);
  for (let i = 1; i < n; i++) clients.push(await join(`P${i}`));
  const specs: Client[] = [];
  for (let i = 0; i < (opts.spectators ?? 0); i++) specs.push(await join(`S${i}`, { spectator: true }));
  return { server, host, clients, specs, join };
}

async function start(t: Table): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'answer', 3000, 'answer stage');
  // Every client (not just the server) has the first question before the test reads their views.
  await waitFor(() => [...t.clients, ...t.specs].every((c) => json(c).stage === 'answer' && json(c).round === 1), 3000, 'clients synced');
}

const q = (t: Table) => t.server.state.q as number;
const waitStage = (t: Table, stage: string, ms = 4000) => waitFor(() => t.server.state.stage === stage, ms, `stage ${stage}`);
/** Waits for the reveal of the current question as seen by client `c` (not just the server). */
async function revealed(t: Table, c: Client, ms = 4000): Promise<SurveyResult> {
  await waitStage(t, 'reveal', ms);
  const serial = t.server.state.q;
  await waitFor(() => json(c).resultJson !== '' && JSON.parse(json(c).resultJson).q === serial, 2000, 'client reveal');
  return JSON.parse(json(c).resultJson) as SurveyResult;
}

describe('DAS Survey — anonymous answers + predictions', () => {
  it('plays a full custom survey: answers stay private, predictions score, podium + outcome at the end', async () => {
    const t = await setup(3, { custom: CUSTOM, spectators: 1 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const spec = t.specs[0]!;
    const view = json(b);
    expect(view.round).toBe(1);
    expect(view.totalRounds).toBe(3);
    expect(JSON.parse(view.questionJson)).toMatchObject({ mode: 'majority', prompt: 'Coffee or tea?' });

    // --- Q1 Majority Mind: A says Neither (2), B and C say Coffee (0).
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 2 });
    await waitFor(() => json(b).progress[a.id()]?.answered === true, 2000, 'answered flag');
    // Public state says THAT A answered, never WHAT: no tallies before answering closes.
    const mid = json(b);
    expect(mid.progress[a.id()]).toEqual({ answered: true, predicted: false });
    expect(mid.resultJson).toBe('');
    expect(mid.answersIn).toBe(1);
    expect(mid.seats[a.id()].answered).toBe(true);
    await waitFor(() => a.last()?.answer === 2, 2000, 'own echo');
    expect(a.last()).toMatchObject({ q: s1, answered: true, answer: 2, sealed: false });

    // A may predict right away; B may not before answering.
    a.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    b.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    await waitFor(() => b.errors.length > 0, 2000, 'answer-first rejection');
    expect(b.errors[0]!.message).toMatch(/answer the question/i);
    await waitFor(() => json(c).progress[a.id()]?.predicted === true, 2000, 'predicted flag');

    b.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    c.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    // Everyone answered → answering seals → predict stage for B and C.
    await waitStage(t, 'predict');
    // Sealed: the server has forgotten who answered what.
    const book = t.server.book;
    for (const p of [a, b, c]) expect(book.answerOf(p.id())).toBeUndefined();
    await waitFor(() => a.last()?.sealed === true, 2000, 'sealed private');
    expect(a.last()).toMatchObject({ answered: true, answer: null, prediction: { kind: 'majority', option: 0 } });
    // Late answers are refused.
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 1 });
    await waitFor(() => b.errors.length > 1, 2000, 'late answer');
    expect(b.errors[1]!.message).toMatch(/closed/i);

    b.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    c.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 2 });
    const r1 = await revealed(t, b);
    expect(r1).toMatchObject({
      voided: false,
      respondents: 3,
      counts: [2, 0, 1],
      leaders: [0],
      predictors: 3,
      predictionCounts: [2, 0, 1],
    });
    expect(r1.percents).toEqual([66.7, 0, 33.3]);
    const pts = Object.fromEntries(r1.scores.map((s) => [s.playerId, s.points]));
    expect(pts[a.id()]).toBe(1000);
    expect(pts[b.id()]).toBe(1000);
    expect(pts[c.id()]).toBe(0);
    await waitFor(() => json(a).players[a.id()].score === 1000, 2000, 'scores committed');
    expect(json(a).seats[c.id()].delta).toBe(0);

    // Leak inspection: nobody else ever received A's private payload, and the spectator got none.
    for (const other of [b, c]) {
      for (const p of other.privates) expect(p.answer === null || p.answer === 0).toBe(true);
    }
    expect(spec.privates).toHaveLength(0);
    expect(spec.all.some((m) => m.type === SURVEY_MSG.private)).toBe(false);
    // The result mentions players only through their prediction scores — no answer attributions.
    expect(Object.keys(r1)).not.toContain('answers');
    for (const s of r1.scores) expect(Object.keys(s).sort()).toEqual(['base', 'bonus', 'bonusLabel', 'hit', 'off', 'playerId', 'points']);

    // --- Q2 Guess the Percentage: 1 of 3 says Yes (33.3%).
    await waitStage(t, 'answer');
    const s2 = q(t);
    expect(s2).toBe(s1 + 1);
    a.room.send(SURVEY_MSG.answer, { q: s2, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s2, option: 1 });
    c.room.send(SURVEY_MSG.answer, { q: s2, option: 1 });
    await waitStage(t, 'predict');
    a.room.send(SURVEY_MSG.predict, { q: s2, kind: 'percent', percent: 33 });
    b.room.send(SURVEY_MSG.predict, { q: s2, kind: 'percent', percent: 50 });
    c.room.send(SURVEY_MSG.predict, { q: s2, kind: 'percent', percent: 10 });
    const r2 = await revealed(t, a);
    expect(r2.actual).toBe(33.3);
    expect(r2.closest).toEqual([a.id()]);
    expect(r2.predictedPercents).toEqual([10, 33, 50]);
    const pts2 = Object.fromEntries(r2.scores.map((s) => [s.playerId, s.points]));
    expect(pts2[a.id()]).toBe(993 + 250);

    // --- Q3 Rank the Room: votes Crisps, Crisps, Fruit → Crisps 1st, Fruit 2nd, Nuts 3rd.
    await waitStage(t, 'answer');
    const s3 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s3, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s3, option: 0 });
    c.room.send(SURVEY_MSG.answer, { q: s3, option: 1 });
    await waitStage(t, 'predict');
    a.room.send(SURVEY_MSG.predict, { q: s3, kind: 'rank', order: [0, 1, 2] });
    b.room.send(SURVEY_MSG.predict, { q: s3, kind: 'rank', order: [2, 1, 0] });
    c.room.send(SURVEY_MSG.predict, { q: s3, kind: 'rank', order: [0, 1, 1] }); // not a permutation
    await waitFor(() => c.errors.length > 0, 2000, 'invalid order');
    expect(c.errors[0]!.code).toBe('invalid_payload');
    c.room.send(SURVEY_MSG.predict, { q: s3, kind: 'rank', order: [1, 0, 2] });
    const r3 = await revealed(t, a);
    expect(r3.ranking.map((s) => s.option)).toEqual([0, 1, 2]);
    const pts3 = Object.fromEntries(r3.scores.map((s) => [s.playerId, s.points]));
    expect(pts3[a.id()]).toBe(1250);
    expect(pts3[b.id()]).toBe(0);
    expect(pts3[c.id()]).toBe(500);

    // --- Final: podium, awards, recap, outcome.
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    // The server switched phase; the client's copy of the podium arrives with the next patch.
    await waitFor(() => Boolean(json(a).podiumJson), 3000, 'podium synced');
    const podium = JSON.parse(json(a).podiumJson) as PartyPodium;
    expect(podium.winnerIds).toEqual([a.id()]);
    const extras = podium.extras as unknown as SurveyPodiumExtras;
    expect(extras.questions).toBe(3);
    expect(extras.voided).toBe(0);
    expect(extras.awards.find((w) => w.id === 'barometer')?.playerIds).toEqual([a.id()]);
    expect(Array.isArray(extras.recap)).toBe(true);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]).toEqual([a.id()]);
    expect(outcomes[0]!.scores?.[a.id()]).toBe(1000 + 1243 + 1250);
    expect(outcomes[0]!.details).toMatchObject({ questions: 3, voided: 0, mode: 'custom' });
    // Across the whole game, the spectator never received a private payload.
    expect(spec.all.some((m) => m.type === SURVEY_MSG.private)).toBe(false);
  });

  it('rejects duplicates, stale and out-of-range answers, and spectators', async () => {
    const t = await setup(3, { custom: CUSTOM, spectators: 1 });
    await start(t);
    const [a] = t.clients as [Client];
    const spec = t.specs[0]!;
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 1 });
    await waitFor(() => a.last()?.answered === true, 2000, 'answered');
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 1 });
    await waitFor(() => a.errors.length >= 2, 2000, 'duplicates');
    expect(a.errors.every((e) => /already locked/i.test(e.message))).toBe(true);
    expect(t.server.state.answersIn).toBe(1);
    expect(t.server.book.respondents).toBe(1);

    a.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 1 });
    a.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 2 });
    await waitFor(() => a.errors.length >= 3, 2000, 'duplicate prediction');
    expect(t.server.book.predictionOf(a.id())).toEqual({ kind: 'majority', option: 1 });

    const [, b] = t.clients as [Client, Client];
    b.room.send(SURVEY_MSG.answer, { q: s1 - 1, option: 0 }); // stale
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 3 }); // option out of range for 3 options
    b.room.send(SURVEY_MSG.predict, { q: s1, kind: 'percent', percent: 40 }); // wrong kind
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 1, extra: 'x' }); // unknown key
    await waitFor(() => b.errors.length >= 4, 2000, 'b rejections');
    expect(b.errors.map((e) => e.code)).toEqual(['wrong_phase', 'invalid_payload', 'invalid_payload', 'invalid_payload']);
    expect(t.server.book.hasAnswered(b.id())).toBe(false);

    spec.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    spec.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    await waitFor(() => spec.errors.length >= 2, 2000, 'spectator rejected');
    expect(spec.errors.every((e) => e.code === 'not_allowed')).toBe(true);
    expect(t.server.state.answersIn).toBe(1);
  });

  it('voids a question with fewer than 3 answers: no tallies, no points', async () => {
    const t = await setup(3, { custom: CUSTOM });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 1 });
    c.room.send(SURVEY_MSG.answer, { q: s1, skip: true });
    a.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    // Everyone is done answering, only 2 real answers → voided straight to the reveal.
    const r = await revealed(t, a);
    expect(r).toMatchObject({ voided: true, respondents: 2, counts: [], percents: [], leaders: [], scores: [] });
    expect(json(a).players[a.id()].score).toBe(0);
    await waitFor(() => c.last()?.sealed === true, 2000, 'sealed');
    expect(c.last()).toMatchObject({ answered: true, skipped: false, answer: null });
  });

  it('waits for a briefly disconnected player instead of voiding early, and never stalls', async () => {
    const t = await setup(3, { custom: CUSTOM, answerMs: 900, predictMs: 700 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    c.room.reconnection.enabled = false;
    (c.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => json(a).players[c.id()]?.connected === false, 2000, 'c dropped');
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    await sleep(250);
    // Both present players answered but the anonymity floor isn't met: keep waiting for C.
    expect(t.server.state.stage).toBe('answer');
    // Nobody else acts: the timers carry the game on (voided) without stalling.
    expect((await revealed(t, a, 3000)).voided).toBe(true);
    await waitFor(() => t.server.state.q === s1 + 1 && t.server.state.stage === 'answer', 3000, 'next question');
  });

  it('restores a reconnecting player’s answer and prediction', async () => {
    const t = await setup(3, { custom: CUSTOM });
    await start(t);
    const [a] = t.clients as [Client];
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 2 });
    a.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 1 });
    await waitFor(() => a.last()?.prediction !== null && a.last()?.prediction !== undefined, 2000, 'prediction echo');
    const token = a.token();
    const id = a.id();
    a.room.reconnection.enabled = false;
    (a.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P0', seatToken: token }), 'P0b');
    expect(again.id()).toBe(id);
    await waitFor(() => again.privates.length > 0, 2000, 'private resent');
    expect(again.last()).toMatchObject({ q: s1, answered: true, answer: 2, prediction: { kind: 'majority', option: 1 }, sealed: false });
    expect(json(again).progress[id]).toEqual({ answered: true, predicted: true });
  });

  it('never hands a reconnecting player their raw answer after the question is sealed', async () => {
    const t = await setup(3, { custom: CUSTOM });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const s1 = q(t);
    for (const cl of [a, b, c]) cl.room.send(SURVEY_MSG.answer, { q: s1, option: 1 });
    await waitStage(t, 'predict');
    const token = a.token();
    a.room.reconnection.enabled = false;
    (a.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P0', seatToken: token }), 'P0c');
    await waitFor(() => again.privates.length > 0, 2000, 'private resent');
    expect(again.last()).toMatchObject({ q: s1, answered: true, answer: null, skipped: false, sealed: true });
    expect(JSON.stringify(again.all)).not.toMatch(/"answer":1/);
  });

  it('ends the game cleanly when fewer than 3 players remain', async () => {
    const t = await setup(3, { custom: CUSTOM, answerMs: 4000 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    await c.room.leave(true);
    const s1 = q(t);
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    // Everyone still seated answered but only 2 answers exist → voided, then the game wraps up.
    expect((await revealed(t, a)).voided).toBe(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.reason).toBe('not_enough_players');
    expect(outcomes[0]!.placements.flat().sort()).toEqual([a.id(), b.id()].sort());
  });

  it('lets a late joiner answer the open question and score', async () => {
    const t = await setup(3, { custom: CUSTOM });
    await start(t);
    const [a, b] = t.clients as [Client, Client, Client];
    const late = await t.join('Late');
    await waitFor(() => json(a).progress[late.id()] !== undefined, 2000, 'late progress');
    expect(json(a).seats[late.id()].eligible).toBe(true);
    const s1 = q(t);
    for (const cl of [...t.clients, late]) cl.room.send(SURVEY_MSG.answer, { q: s1, option: cl === late ? 1 : 0 });
    await waitStage(t, 'predict');
    for (const cl of [...t.clients, late]) cl.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    const r = await revealed(t, b);
    expect(r.respondents).toBe(4);
    expect(r.scores.find((s) => s.playerId === late.id())?.points).toBe(1000);
  });

  it('leaving and rejoining (a new seat) never adds a second answer to the anonymous tally', async () => {
    const t = await setup(3, { custom: CUSTOM, answerMs: 8000 });
    await start(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const s1 = q(t);
    // C answers "Neither", leaves, rejoins as a brand-new seat and answers "Neither" again.
    c.room.send(SURVEY_MSG.answer, { q: s1, option: 2 });
    await waitFor(() => t.server.state.answersIn === 1, 2000, 'c answered');
    await c.room.leave(true);
    await waitFor(() => t.server.state.answersIn === 0, 2000, 'leaver withdrawn');
    const again = await t.join('P2 again');
    again.room.send(SURVEY_MSG.answer, { q: s1, option: 2 });
    a.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    b.room.send(SURVEY_MSG.answer, { q: s1, option: 0 });
    await waitStage(t, 'predict');
    for (const cl of [a, b, again]) cl.room.send(SURVEY_MSG.predict, { q: s1, kind: 'majority', option: 0 });
    const r = await revealed(t, a);
    // Three people in the room → three answers, never four.
    expect(r.respondents).toBe(3);
    expect(r.counts).toEqual([2, 0, 1]);
  });

  it('host can skip a stage and pause/resume (kit host controls); players cannot', async () => {
    const t = await setup(3, { custom: CUSTOM });
    await start(t);
    const [, b] = t.clients as [Client, Client];
    b.room.send('party:host', { action: 'skip' });
    await waitFor(() => b.errors.length > 0, 2000, 'not host');
    expect(b.errors[0]!.code).toBe('not_host');
    t.host.room.send('party:host', { action: 'pause' });
    await waitFor(() => t.server.state.paused === true, 2000, 'paused');
    t.host.room.send('party:host', { action: 'resume' });
    await waitFor(() => t.server.state.paused === false, 2000, 'resumed');
    t.host.room.send('party:host', { action: 'skip' });
    // Skipping answering with nobody answering voids the question.
    expect((await revealed(t, b)).voided).toBe(true);
  });
});

describe('DAS Survey — custom surveys', () => {
  it('validates the host’s survey privately and keeps it out of public state', async () => {
    const t = await setup(3);
    const [, b] = t.clients as [Client, Client];
    t.host.room.send(SURVEY_MSG.custom, {
      questions: [
        { mode: 'majority', prompt: 'Top secret question?', options: ['Alpha', 'Beta'] },
        { mode: 'rank', prompt: 'Too few', options: ['A', 'B'] },
        { mode: 'majority', prompt: 'Dupes?', options: ['Same', 'same'] },
      ],
    });
    await waitFor(() => t.host.custom.at(-1)?.dropped === 2, 2000, 'report');
    const report = t.host.custom.at(-1)!;
    expect(report.questions.map((x) => x.prompt)).toEqual(['Top secret question?']);
    expect(report.issues.map((i) => i.index)).toEqual([1, 2]);
    expect(report.dropped).toBe(2);
    await waitFor(() => json(b).customCount === 1, 2000, 'count');
    expect(JSON.stringify(json(b))).not.toContain('Top secret');
    expect(JSON.stringify(b.all)).not.toContain('Top secret');
    expect(b.custom).toHaveLength(0);

    // Non-hosts can't write the survey; oversized payloads are refused.
    b.room.send(SURVEY_MSG.custom, { questions: [] });
    await waitFor(() => b.errors.length > 0, 2000, 'not host');
    expect(b.errors[0]!.code).toBe('not_host');
    t.host.room.send(SURVEY_MSG.custom, { questions: [{ mode: 'majority', prompt: 'x'.repeat(401), options: ['a', 'b'] }] });
    await waitFor(() => t.host.errors.length > 0, 2000, 'invalid');
    expect(t.host.errors[0]!.code).toBe('invalid_payload');
    expect(t.server.state.customCount).toBe(1);
  });

  it('refuses to start a custom game without questions, and a pack game without packs', async () => {
    const t = await setup(3, { settings: { mode: 'custom' } });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.length > 0, 2000, 'blocked');
    expect(t.host.errors[0]!.message).toMatch(/Custom Survey editor/);
    t.host.room.send('lobby:settings', { settings: { mode: 'mixed', packs: [] } });
    await waitFor(() => JSON.parse(t.server.state.settingsJson).packs.length === 0, 2000, 'no packs');
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.length > 1, 2000, 'blocked again');
    expect(t.host.errors[1]!.message).toMatch(/question pack/);
    expect(t.server.state.phase).toBe('LOBBY');
  });

  it('plays built-in packs in mixed mode and returns to a clean lobby', async () => {
    const t = await setup(3, { settings: { mode: 'mixed', questions: 3 } });
    await start(t);
    expect(t.server.state.totalRounds).toBe(3);
    const modes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await waitFor(() => t.server.state.stage === 'answer' && t.server.state.round === i + 1, 3000, `q${i + 1}`);
      const question = JSON.parse(t.server.state.questionJson);
      modes.add(question.mode);
      for (const cl of t.clients) cl.room.send(SURVEY_MSG.answer, { q: q(t), option: 0 });
      await waitStage(t, 'predict');
      const n = question.options.length;
      for (const cl of t.clients) {
        const payload =
          question.mode === 'majority'
            ? { kind: 'majority', option: 0 }
            : question.mode === 'rank'
              ? { kind: 'rank', order: Array.from({ length: n }, (_, k) => k) }
              : { kind: 'percent', percent: 100 };
        cl.room.send(SURVEY_MSG.predict, { q: q(t), ...payload });
      }
      await waitStage(t, i === 2 ? 'final' : 'reveal');
    }
    expect([...modes].sort()).toEqual(['majority', 'percent', 'rank']);
    await waitFor(() => t.server.state.phase === 'RESULTS', 2000, 'results');
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => json(t.host).phase === 'LOBBY' && json(t.host).stage === 'idle', 2000, 'lobby');
    const lobby = json(t.host);
    expect(lobby).toMatchObject({ stage: 'idle', questionJson: '', resultJson: '', historyJson: '[]', podiumJson: '' });
    expect(lobby.progress).toEqual({});
  });
});

describe('DAS Survey — scale', () => {
  it('handles 30 simultaneous answers and predictions', async () => {
    const t = await setup(30, { settings: { mode: 'percent', questions: 3 } });
    await start(t);
    const s1 = q(t);
    t.clients.forEach((cl, i) => cl.room.send(SURVEY_MSG.answer, { q: s1, option: i % 3 === 0 ? 0 : 1 }));
    await waitStage(t, 'predict', 5000);
    expect(t.server.state.answersIn).toBe(30);
    t.clients.forEach((cl, i) => cl.room.send(SURVEY_MSG.predict, { q: s1, kind: 'percent', percent: i * 3 }));
    const r = await revealed(t, t.host, 5000);
    expect(r).toMatchObject({ respondents: 30, predictors: 30, actual: 33.3 });
    expect(r.closest).toEqual([t.clients[11]!.id()]);
    expect(t.clients.every((cl) => cl.errors.length === 0)).toBe(true);
  }, 30_000);
});
