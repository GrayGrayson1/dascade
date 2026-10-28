/**
 * DAS Survey Showdown — two-tier scoring (Brian's Scoring Studio picks): the crowd's called-it points
 * from a positioned Top 10 scorecard, the hot seat's medals, the public scoreboard (revealed answers
 * only), the presenter's scores and export, removing a wrong credit, the paced finale and the black box.
 * Made-up boards only (the test show file).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import {
  SHOWDOWN_MSG,
  type ShowdownBlackBox,
  type ShowdownCrewPrivate,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownMe,
  type ShowdownScoreboard,
  type ShowdownScoresFile,
  type ShowdownScoresView,
} from '@dascade/shared/games/showdown';
import { TEST_SHOW_FILE } from './fixtures/showdownShowFile.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['showdown']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

type Json = Record<string, any>;
interface Client {
  room: SdkRoom;
  id: () => string;
  seatToken: () => string;
  errors: Array<{ type?: string; code: string; message: string }>;
  events: ShowdownEvent[];
  me: ShowdownMe[];
  crew: Array<ShowdownCrewPrivate | null>;
  scores: Array<ShowdownScoresView | null>;
  files: ShowdownScoresFile[];
  boxes: Array<ShowdownBlackBox | null>;
}

async function wire(room: SdkRoom): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const client: Client = {
    room,
    id: () => welcomes.at(-1)!.playerId,
    seatToken: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    events: collect(room, SHOWDOWN_MSG.event),
    me: collect(room, SHOWDOWN_MSG.me),
    crew: collect(room, SHOWDOWN_MSG.crew),
    scores: collect(room, SHOWDOWN_MSG.scores),
    files: collect(room, SHOWDOWN_MSG.scoresExport),
    boxes: collect(room, SHOWDOWN_MSG.blackbox),
  };
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return client;
}

type Server = Record<string, any>;
interface Show {
  server: Server;
  host: Client;
  code: string;
  guests: Client[];
  join: (name: string) => Promise<Client>;
}

/** The DAS-O-Ween preset (scoring on: 10 guesses, medals after each round, gems, pops) with the test show file. */
async function show(names: string[], patch: Json = {}): Promise<Show> {
  const host = await wire(await colyseus.sdk.create('showdown', { name: 'Host' }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  server.sweepMs = { lead: 30, step: 40, suspense: 60, special: 50 };
  const code = host.room.roomId;
  host.room.send(SHOWDOWN_MSG.content, { rounds: TEST_SHOW_FILE });
  await waitFor(() => server.state.customRounds === 2, 2000, 'show file');
  host.room.send(SHOWDOWN_MSG.preset, { id: 'dasoween-2026' });
  await waitFor(() => server.state.event === 'dasoween-2026', 2000, 'event room');
  if (Object.keys(patch).length) {
    host.room.send('lobby:settings', { settings: patch });
    await waitFor(() => Object.entries(patch).every(([k, v]) => JSON.parse(server.state.settingsJson)[k] === v), 2000, 'settings');
  }
  const join = async (name: string) => wire(await colyseus.sdk.joinById(code, { name }));
  const guests: Client[] = [];
  for (const n of names) guests.push(await join(n));
  return { server, host, code, guests, join };
}

const board = (t: Show) => JSON.parse(t.server.state.boardJson);
const scoreboard = (t: Show): ShowdownScoreboard | null => (t.server.state.scoreJson ? JSON.parse(t.server.state.scoreJson) : null);

async function act(t: Show, payload: Json): Promise<void> {
  const rev = t.server.state.rev as number;
  const round = board(t).round as number;
  const body = ['reveal', 'miss', 'sweep'].includes(payload.a) ? { round, ...payload } : { rev, ...payload };
  t.host.room.send(SHOWDOWN_MSG.act, body);
  await waitFor(() => t.server.state.rev !== rev || t.server.state.phase !== 'PLAYING', 2000, `act ${String(payload.a)}`);
}

async function live(t: Show): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.phase === 'PLAYING' && t.server.state.boardJson !== '', 3000, 'started');
  await act(t, { a: 'begin' });
  await act(t, { a: 'question' });
}

/** Locks `text` into spot `pos` (0 = #1) and waits until the guess shows on the phone. */
async function guess(t: Show, c: Client, text: string, pos: number): Promise<void> {
  const before = c.me.at(-1)?.guesses.length ?? 0;
  c.room.send(SHOWDOWN_MSG.guess, { round: board(t).round, text, pos });
  await waitFor(() => (c.me.at(-1)?.guesses.length ?? 0) > before, 2000, `guess ${text}`);
}

const A = TEST_SHOW_FILE[0]!.answers.map((a) => a.text);

describe('the crowd: Called it on a Top 10 scorecard', () => {
  it('scores a tile’s value when it flips, +1 in the right spot; a used or flipped spot is refused; Undo takes it back', async () => {
    const t = await show(['Ada', 'Ben']);
    const [ada, ben] = t.guests as [Client, Client];
    await live(t);
    await guess(t, ada, A[0]!, 0); // #1 in spot #1
    await guess(t, ada, A[2]!, 5); // #3 in spot #6
    await guess(t, ben, A[2]!, 2); // #3 in spot #3
    // Secret until the flip: nothing public, nothing private.
    expect(scoreboard(t)?.top).toEqual([]);
    expect(ada.me.at(-1)!.score).toMatchObject({ points: 0, rank: 0 });
    expect(JSON.stringify(t.server.state.scoreJson)).not.toContain(A[0]!);
    // A spot can hold one guess.
    ada.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Anything', pos: 0 });
    await waitFor(
      () => ada.errors.some((e) => e.type === SHOWDOWN_MSG.guess && /already have a guess in that spot/.test(e.message)),
      2000,
      'used spot',
    );

    await act(t, { a: 'reveal', slot: 2 });
    await waitFor(() => (ben.me.at(-1)?.score?.points ?? 0) === 9, 2000, 'Ben: 8 + 1');
    await waitFor(() => (ada.me.at(-1)?.score?.points ?? 0) === 8, 2000, 'Ada: 8');
    expect(ben.me.at(-1)!.guesses[0]).toMatchObject({ slot: 2, points: 8, bonus: 1, pos: 2 });
    expect(ben.me.at(-1)!.score).toMatchObject({ rank: 1, of: 2, positionHits: 1 });
    expect(scoreboard(t)!.top.map((r) => [r.name, r.points, r.rank])).toEqual([
      ['Ben', 9, 1],
      ['Ada', 8, 2],
    ]);
    // The flipped answer's spot is closed now.
    ben.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Something', pos: 2 });
    await waitFor(
      () => ben.errors.some((e) => e.type === SHOWDOWN_MSG.guess && /spot’s answer is already on the board/.test(e.message)),
      2000,
      'flipped spot',
    );
    // The public scoreboard never names an answer still hidden.
    expect(t.server.state.scoreJson).not.toContain(A[0]!);

    await act(t, { a: 'reveal', slot: 0 });
    await waitFor(() => (ada.me.at(-1)?.score?.points ?? 0) === 19, 2000, 'Ada: 8 + 10 + 1');
    await act(t, { a: 'undo' });
    await waitFor(() => (ada.me.at(-1)?.score?.points ?? 0) === 8, 2000, 'undo takes it back');
    expect(scoreboard(t)!.top[0]).toMatchObject({ name: 'Ben', points: 9 });
  });

  it('Reveal remaining pays hidden gems double; a duplicate message never scores twice', async () => {
    const t = await show(['Ada']);
    const ada = t.guests[0]!;
    await live(t);
    await guess(t, ada, A[9]!, 9); // #10 in spot #10
    ada.room.send(SHOWDOWN_MSG.guess, { round: 0, text: A[9]!, pos: 8 });
    await act(t, { a: 'reveal', slot: 0 });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'sweep', round: 0 });
    await waitFor(() => board(t).slots.every((s: Json) => s.revealed), 5000, 'swept');
    // #10 found by nobody: 1 × 2 = 2, +1 spot.
    await waitFor(() => ada.me.at(-1)?.score?.points === 3, 2000, 'gem');
    expect(ada.me.at(-1)!.score).toMatchObject({ gems: 1, positionHits: 1 });
    expect(ada.me.at(-1)!.guesses).toHaveLength(1);
  });

  it('Score the crowd off: no scoreboard, no score — the show runs as before', async () => {
    const t = await show(['Ada'], { points: false, medals: 'never' });
    const ada = t.guests[0]!;
    await live(t);
    ada.room.send(SHOWDOWN_MSG.guess, { round: 0, text: A[1]!, pos: 1 });
    await waitFor(() => (ada.me.at(-1)?.guesses.length ?? 0) === 1, 2000, 'guess');
    await act(t, { a: 'reveal', slot: 1 });
    await sleep(100);
    expect(t.server.state.scoreJson).toBe('');
    expect(ada.me.at(-1)!.score).toBeUndefined();
    expect(t.host.scores.filter(Boolean)).toEqual([]);
  });
});

describe('the hot seat: medals', () => {
  async function pick(t: Show): Promise<Extract<ShowdownEvent, { type: 'pick' }>> {
    const drawNo = t.server.state.drawNo as number;
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'pick', round: board(t).round, drawNo });
    await waitFor(() => t.host.events.some((e) => e.type === 'pick' && e.drawNo === drawNo + 1), 2000, 'pick');
    return t.host.events.find((e) => e.type === 'pick' && e.drawNo === drawNo + 1) as Extract<ShowdownEvent, { type: 'pick' }>;
  }
  async function done(t: Show, drawNo: number): Promise<void> {
    t.host.room.send(SHOWDOWN_MSG.pick, { a: 'done', drawNo });
    await waitFor(() => t.server.state.hotSeat === '', 2000, 'done');
  }

  it('a find pins its medal (🎃 for the special #5); a turn with no find is a Brave ribbon; a wrong credit comes off, audited', async () => {
    const t = await show(['Ada']);
    const ada = t.guests[0]!;
    await live(t);
    const first = await pick(t);
    await act(t, { a: 'reveal', slot: 4 }); // the special #5
    await act(t, { a: 'reveal', slot: 1 });
    await done(t, first.drawNo);
    await waitFor(() => scoreboard(t)?.stars[0]?.medals.pumpkin === 1, 2000, 'pumpkin');
    expect(scoreboard(t)!.stars[0]).toMatchObject({ name: 'Ada', medals: { pumpkin: 1, gold: 1, ribbon: 0 } });
    await waitFor(() => ada.me.at(-1)?.score?.medals.pumpkin === 1, 2000, 'Ada sees her medals');
    // Medals and points never touch.
    expect(ada.me.at(-1)!.score!.points).toBe(0);
    const second = await pick(t);
    await done(t, second.drawNo);
    await waitFor(() => scoreboard(t)?.stars[0]?.medals.ribbon === 1, 2000, 'ribbon');
    // The presenter's Scores tab lists the credited tiles; a guest gets nothing.
    await waitFor(() => (t.host.scores.at(-1)?.credits.length ?? 0) === 2, 2000, 'credits listed');
    expect(ada.scores.filter(Boolean)).toEqual([]);
    ada.room.send(SHOWDOWN_MSG.credit, { round: 0, slot: 1 });
    await waitFor(() => ada.errors.some((e) => e.type === SHOWDOWN_MSG.credit), 2000, 'guest refused');
    t.host.room.send(SHOWDOWN_MSG.credit, { round: 0, slot: 1 });
    await waitFor(() => scoreboard(t)?.stars[0]?.medals.gold === 0, 2000, 'gold gone');
    expect(board(t).slots[1].calledBy).toBeUndefined();
    expect((t.server.audit.all() as Json[]).find((e) => e.action === 'credit.remove')).toMatchObject({
      actorId: t.host.id(),
      targetName: 'Ada',
    });
  });
});

describe('the standings card', () => {
  it('goes up between rounds, comes down with the next round and the finale; refused with scoring off', async () => {
    const t = await show(['Ada']);
    await live(t);
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'standings' });
    await waitFor(() => t.server.state.card === 'standings', 2000, 'standings up');
    await act(t, { a: 'next' });
    await waitFor(() => t.server.state.card === '', 2000, 'down for round 2');
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'standings' });
    await waitFor(() => t.server.state.card === 'standings', 2000, 'up again');
    await act(t, { a: 'finish' });
    await waitFor(() => t.server.state.phase === 'RESULTS' && t.server.state.card === '', 2000, 'down for the finale');
    // Holding cards still stay up as before.
    t.host.room.send(SHOWDOWN_MSG.card, { card: 'prizes' });
    await waitFor(() => t.server.state.card === 'prizes', 2000, 'prize time');

    const off = await show([], { points: false, medals: 'never' });
    off.host.room.send(SHOWDOWN_MSG.card, { card: 'standings' });
    await waitFor(() => off.host.errors.some((e) => e.type === SHOWDOWN_MSG.card), 2000, 'refused');
    expect(off.server.state.card).toBe('');
  });
});

describe('the finale, the export and the black box', () => {
  it('the finale carries the podium and the stars; the presenter steps through it once each; guests can’t', async () => {
    const t = await show(['Ada', 'Ben', 'Cy']);
    const [ada, ben, cy] = t.guests as [Client, Client, Client];
    await live(t);
    await guess(t, ada, A[0]!, 0);
    await guess(t, ben, A[0]!, 1);
    await guess(t, cy, A[3]!, 3);
    await act(t, { a: 'reveal', slot: 0 });
    await act(t, { a: 'reveal', slot: 3 });
    await act(t, { a: 'finish' });
    await waitFor(() => t.server.state.phase === 'RESULTS', 2000, 'results');
    const finale = JSON.parse(t.server.state.finaleJson) as ShowdownFinale;
    expect(finale.podium!.map((p) => [p.name, p.points, p.rank])).toEqual([
      ['Ada', 11, 1],
      ['Ben', 10, 2],
      ['Cy', 8, 3],
    ]);
    expect(finale.medals).toBe('round');
    expect(t.server.state.finaleStep).toBe(0);
    ada.room.send(SHOWDOWN_MSG.finale, { step: 1 });
    await waitFor(() => ada.errors.some((e) => e.type === SHOWDOWN_MSG.finale), 2000, 'guest refused');
    for (const step of [1, 1, 2, 3]) t.host.room.send(SHOWDOWN_MSG.finale, { step });
    await waitFor(() => t.server.state.finaleStep === 3, 2000, 'stepped');
    await sleep(100);
    const steps = ada.events.filter((e) => e.type === 'finale') as Array<Extract<ShowdownEvent, { type: 'finale' }>>;
    // No medals were won, so the steps are wrap → 3rd → 2nd → 1st; a repeated step plays once.
    expect(steps.map((e) => e.kind)).toEqual(['third', 'second', 'first']);
  });

  it('the export never carries an unrevealed answer; only the presenter and producer may download it', async () => {
    const t = await show(['Ada']);
    const ada = t.guests[0]!;
    await live(t);
    await guess(t, ada, A[6]!, 6);
    await act(t, { a: 'reveal', slot: 6 });
    ada.room.send(SHOWDOWN_MSG.scoresExport, {});
    await waitFor(() => ada.errors.some((e) => e.type === SHOWDOWN_MSG.scoresExport), 2000, 'guest refused');
    t.host.room.send(SHOWDOWN_MSG.scoresExport, {});
    await waitFor(() => t.host.files.length > 0, 2000, 'file');
    const file = t.host.files.at(-1)!;
    expect(file.rounds[0]!.answers).toEqual([expect.objectContaining({ pos: 6, text: A[6], value: 4, callers: 1 })]);
    expect(file.people[0]).toMatchObject({ name: 'Ada', points: 5, rank: 1, positionHits: 1, rounds: [5, 0] });
    const text = JSON.stringify(file);
    for (const [i, answer] of A.entries()) if (i !== 6) expect(text).not.toContain(answer);
    expect(text).not.toContain(TEST_SHOW_FILE[1]!.answers[0]!.text);
  });

  it('after a restart the black box brings back guesses, positions and scores', async () => {
    const t = await show(['Ada']);
    const ada = t.guests[0]!;
    await live(t);
    await guess(t, ada, A[1]!, 1);
    await guess(t, ada, A[7]!, 4);
    await act(t, { a: 'reveal', slot: 1 });
    await waitFor(() => ada.me.at(-1)?.score?.points === 10, 2000, 'scored');
    await sleep(1200);
    await waitFor(() => Boolean(t.host.boxes.filter(Boolean).at(-1)), 3000, 'box');
    const box = t.host.boxes.filter(Boolean).at(-1)!;
    const tokens = { host: t.host.seatToken(), ada: ada.seatToken() };
    await t.server.disconnect();
    await waitFor(() => !colyseus.getRoomById(t.code), 3000, 'room gone');
    const host2 = await wire(await colyseus.sdk.create('showdown', { name: 'Host', restore: box.blob, seatToken: tokens.host }));
    const server2 = colyseus.getRoomById(t.code) as unknown as Server;
    expect(host2.room.roomId).toBe(t.code);
    expect(JSON.parse(server2.state.scoreJson).top).toEqual([expect.objectContaining({ name: 'Ada', points: 10 })]);
    const ada2 = await wire(await colyseus.sdk.joinById(t.code, { name: 'Ada', seatToken: tokens.ada }));
    await waitFor(() => ada2.me.at(-1)?.score?.points === 10, 2000, 'score back');
    expect(ada2.me.at(-1)!.guesses.map((g) => [g.text, g.pos])).toEqual([
      [A[1], 1],
      [A[7], 4],
    ]);
    // The book still knows the spots: #5 is taken.
    ada2.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Another', pos: 4 });
    await waitFor(() => ada2.errors.some((e) => e.type === SHOWDOWN_MSG.guess && /that spot/.test(e.message)), 2000, 'spot kept');
  });
});
