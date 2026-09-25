import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { ChatMessage, WelcomePayload } from '@dascade/shared';
import {
  DASKETCH_MSG,
  SKETCH_CANVAS,
  type SketchCanvasSnapshot,
  type SketchEvent,
  type SketchGameEvent,
  type SketchPrivate,
  type SketchStrokeRelay,
  type SketchWordsPrivate,
} from '@dascade/shared/games/dasketch';
import { collect, freePort, sleep, waitFor, quiet } from './helpers.ts';
import { createDascadeServer } from '../src/server.ts';
import type { DasketchRoom } from '../src/rooms/dasketch/DasketchRoom.ts';

let colyseus: ColyseusTestServer;

/**
 * Like helpers.bootTestServer(['dasketch']), but actually listens on a free port:
 * @colyseus/testing's boot() ignores its port argument for Server instances (always 2568),
 * which collides when several cabinets run their suites at the same time.
 */
async function bootIsolated(): Promise<ColyseusTestServer> {
  const port = await freePort();
  const server = await createDascadeServer({ games: ['dasketch'] });
  await server.listen(port);
  return new ColyseusTestServer(server);
}

beforeAll(async () => {
  colyseus = await bootIsolated();
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

interface TestClient {
  room: SdkRoom;
  name: string;
  me: () => WelcomePayload;
  errors: Array<{ type?: string; code: string; message: string }>;
  privates: SketchPrivate[];
  canvases: SketchCanvasSnapshot[];
  strokes: SketchStrokeRelay[];
  events: SketchGameEvent[];
  chat: ChatMessage[];
  words: SketchWordsPrivate[];
  lastPrivate: () => SketchPrivate | undefined;
}

async function wire(room: SdkRoom, name: string): Promise<TestClient> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const client: TestClient = {
    room,
    name,
    me: () => welcomes[welcomes.length - 1]!,
    errors: collect(room, 'sys:error'),
    privates: collect(room, DASKETCH_MSG.private),
    canvases: collect(room, DASKETCH_MSG.canvas),
    strokes: collect(room, DASKETCH_MSG.stroke),
    events: collect(room, DASKETCH_MSG.event),
    chat: collect(room, 'chat:msg'),
    words: collect(room, DASKETCH_MSG.words),
    lastPrivate: () => client.privates[client.privates.length - 1],
  };
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

/** The live room; tests reach protected tunables (timers) and internals through the index signature. */
type Server = Pick<DasketchRoom, 'state'> & Record<string, any>;

interface Table {
  server: Server;
  host: TestClient;
  clients: TestClient[];
  byId: (id: string) => TestClient;
  artist: () => TestClient;
  guessers: () => TestClient[];
  join: (name: string, extra?: Record<string, unknown>) => Promise<TestClient>;
}

const WORDS = ['pineapple', 'lighthouse', 'kangaroo', 'volcano', 'hedgehog', 'submarine'];

async function setup(names: string[], opts: { settings?: Record<string, unknown>; words?: string[]; spectators?: string[] } = {}): Promise<Table> {
  const hostRoom = await colyseus.sdk.create('dasketch', { name: names[0] });
  const host = await wire(hostRoom, names[0]!);
  const server = colyseus.getRoomById(hostRoom.roomId) as unknown as Server;
  server.countdownMs = 20;
  server.intermissionMs = 250;
  server.choiceMs = 4000;
  server.artistGraceMs = 200;
  server.allGuessedDelayMs = 30;
  host.room.send(DASKETCH_MSG.words, { words: opts.words ?? WORDS });
  host.room.send('lobby:settings', { settings: { customOnly: true, rounds: 1, choiceCount: 3, ...(opts.settings ?? {}) } });
  await waitFor(() => host.words.length > 0 && JSON.parse(server.state.settingsJson).customOnly === true, 3000, 'settings');
  const clients: TestClient[] = [host];
  const join = async (name: string, extra: Record<string, unknown> = {}) => {
    const c = await wire(await colyseus.sdk.joinById(hostRoom.roomId, { name, ...extra }), name);
    clients.push(c);
    return c;
  };
  for (const name of names.slice(1)) await join(name);
  for (const name of opts.spectators ?? []) await join(name, { spectator: true });
  const byId = (id: string) => clients.find((c) => c.me().playerId === id)!;
  return {
    server,
    host,
    clients,
    byId,
    join,
    artist: () => byId(server.state.artistId),
    guessers: () => clients.filter((c) => c.me().playerId !== server.state.artistId && !server.state.players.get(c.me().playerId)?.spectator),
  };
}

async function start(t: Table): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === 'choosing', 3000, 'choosing');
  await waitFor(() => t.artist().lastPrivate()?.choices !== null && t.artist().lastPrivate()?.turn === t.server.state.turn, 3000, 'choices');
}

async function chooseFirst(t: Table): Promise<string> {
  const artist = t.artist();
  const word = artist.lastPrivate()!.choices![0]!.word;
  artist.room.send(DASKETCH_MSG.choose, { index: 0 });
  await waitFor(() => t.server.state.stage === 'drawing', 3000, 'drawing');
  await waitFor(() => artist.lastPrivate()?.word === word, 3000, 'artist word');
  return word;
}

const stroke = (pts: number[]): SketchEvent => ({ k: 'stroke', tool: 'brush', color: '#ff4fd8', size: 9, pts });
const say = (c: TestClient, text: string) => c.room.send('chat:send', { text });
const score = (t: Table, c: TestClient) => t.server.state.players.get(c.me().playerId)!.score;
const publicJson = (t: Table) => {
  const { players: _players, settingsJson: _settings, ...rest } = t.server.state.toJSON() as Record<string, unknown>;
  return JSON.stringify(rest);
};

describe('DASketch room: word choice and secrecy', () => {
  it('offers choices privately to the artist and never puts the word in public state', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy'], { spectators: ['Spec'] });
    await start(t);
    const artist = t.artist();
    const choices = artist.lastPrivate()!.choices!;
    expect(choices).toHaveLength(3);
    for (const c of choices) expect(WORDS).toContain(c.word);
    for (const other of t.clients.filter((c) => c !== artist)) {
      await waitFor(() => other.lastPrivate()?.turn === t.server.state.turn, 2000, 'private');
      expect(other.privates.every((p) => p.choices === null && p.word === null)).toBe(true);
    }
    const spectator = t.clients.find((c) => c.name === 'Spec')!;
    expect(spectator.lastPrivate()!.role).toBe('spectator');

    // Only the artist may choose.
    const guesser = t.guessers()[0]!;
    guesser.room.send(DASKETCH_MSG.choose, { index: 0 });
    await waitFor(() => guesser.errors.some((e) => e.code === 'not_your_turn'));

    const word = await chooseFirst(t);
    expect(t.server.state.hint).toBe('_'.repeat(word.length));
    expect(t.server.state.word).toBe('');
    expect(publicJson(t)).not.toContain(word);
    await sleep(80);
    for (const other of t.clients.filter((c) => c !== artist)) {
      expect(other.privates.some((p) => p.word !== null)).toBe(false);
      expect(JSON.stringify(other.chat)).not.toContain(word);
    }
  });

  it('keeps custom words private to the host and publishes only counts', async () => {
    const t = await setup(['Ada', 'Bo'], { words: ['Alpha Launch', 'alpha launch', 'shit', 'Quarterly Review', '!!'] });
    const guest = t.clients[1]!;
    await waitFor(() => t.host.words.at(-1)?.words.length === 3);
    expect(t.host.words.at(-1)!.words).toEqual(['alpha launch', 'shit', 'quarterly review']);
    expect(t.host.words.at(-1)!.report).toMatchObject({ duplicates: 1, invalid: 1, filtered: 1 });
    expect(t.server.state.customCount).toBe(2);
    expect(t.server.state.customFiltered).toBe(1);
    expect(guest.words).toHaveLength(0);
    expect(JSON.stringify(t.server.state.toJSON())).not.toContain('quarterly');

    // Non-hosts cannot change the list.
    guest.room.send(DASKETCH_MSG.words, { words: ['hijack'] });
    await waitFor(() => guest.errors.some((e) => e.code === 'not_host'));

    // Turning the profanity filter off makes the filtered word usable again.
    t.host.room.send('lobby:settings', { settings: { filterProfanity: false } });
    await waitFor(() => t.server.state.customCount === 3);

    // A new host receives the list privately.
    t.host.room.send('lobby:transferHost', { playerId: guest.me().playerId });
    await waitFor(() => guest.words.length > 0);
    expect(guest.words.at(-1)!.words).toContain('quarterly review');
  });

  it('refuses to start with an empty word pool', async () => {
    const t = await setup(['Ada', 'Bo'], { words: [] });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => e.code === 'not_allowed' && /word list is empty/i.test(e.message)));
    expect(t.server.state.phase).toBe('LOBBY');
  });

  it('auto-picks a word when the artist runs out of time to choose', async () => {
    const t = await setup(['Ada', 'Bo']);
    t.server.choiceMs = 150;
    await start(t);
    await waitFor(() => t.server.state.stage === 'drawing', 2000, 'auto pick');
    const artist = t.artist();
    await waitFor(() => artist.lastPrivate()?.word !== null);
    expect(WORDS).toContain(artist.lastPrivate()!.word);
  });

  it('keeps word choices secret if the artist types one while choosing', async () => {
    const t = await setup(['Ada', 'Bo']);
    await start(t);
    const artist = t.artist();
    const guesser = t.guessers()[0]!;
    say(artist, `I will draw ${artist.lastPrivate()!.choices![1]!.word}`);
    await waitFor(() => artist.chat.some((m) => m.kind === 'close' && /secret/i.test(m.text)));
    await sleep(60);
    expect(guesser.chat.some((m) => m.playerId === artist.me().playerId)).toBe(false);
  });
});

describe('DASketch room: drawing', () => {
  it('relays artist strokes with sequence numbers and rejects everyone else', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy'], { spectators: ['Spec'] });
    await start(t);
    await chooseFirst(t);
    const artist = t.artist();
    const [g1, g2] = t.guessers();
    const spectator = t.clients.find((c) => c.name === 'Spec')!;
    const turn = t.server.state.turn;

    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([100, 100, 120, 130])] });
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'pts', pts: [140, 150, 160, 170] }, { k: 'fill', color: '#22d3ee', pts: [600, 450] }] });
    for (const c of [g1!, g2!, spectator]) await waitFor(() => c.strokes.length === 2, 2000, `relay to ${c.name}`);
    expect(g1!.strokes.map((s) => s.seq)).toEqual([1, 2]);
    expect(g1!.strokes[1]!.events).toHaveLength(2);
    expect(artist.strokes).toHaveLength(0);

    // A non-drawer and a spectator cannot draw.
    g1!.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([1, 1])] });
    spectator.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([2, 2])] });
    await waitFor(() => g1!.errors.some((e) => e.code === 'not_your_turn' && e.type === DASKETCH_MSG.draw));
    // Out-of-bounds, malformed and stale-turn events are dropped.
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'fill', color: '#000000', pts: [SKETCH_CANVAS.width + 10, 5] }] });
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'pts', pts: [1, 2, 3] }] });
    artist.room.send(DASKETCH_MSG.draw, { turn: turn + 7, events: [stroke([5, 5])] });
    await sleep(120);
    expect(g2!.strokes).toHaveLength(2);
    const board = t.server['board'];
    expect(board.ops.map((o: { tool: string }) => o.tool)).toEqual(['brush', 'fill']);
    expect(board.ops[0].points).toEqual([100, 100, 120, 130, 140, 150, 160, 170]);

    // Undo and clear are relayed as ops too.
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [{ k: 'undo' }, { k: 'clear' }] });
    await waitFor(() => g2!.strokes.length === 3);
    expect(board.ops.map((o: { tool: string }) => o.tool)).toEqual(['brush', 'clear']);
  });

  it('rate-limits drawing messages', async () => {
    const t = await setup(['Ada', 'Bo']);
    await start(t);
    await chooseFirst(t);
    const artist = t.artist();
    const guesser = t.guessers()[0]!;
    const turn = t.server.state.turn;
    for (let i = 0; i < 150; i++) artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([i % 1200, 10])] });
    await sleep(400);
    expect(guesser.strokes.length).toBeGreaterThan(40);
    expect(guesser.strokes.length).toBeLessThan(150);
    expect(artist.errors.some((e) => e.type === DASKETCH_MSG.draw)).toBe(false);
  });

  it('drops the artist’s late strokes after the turn ends without error noise', async () => {
    const t = await setup(['Ada', 'Bo']);
    t.server.drawMsFor = () => 300;
    await start(t);
    await chooseFirst(t);
    const artist = t.artist();
    const guesser = t.guessers()[0]!;
    const turn = t.server.state.turn;
    await waitFor(() => t.server.state.stage === 'reveal', 3000, 'time up');
    const opsBefore = t.server['board'].ops.length;
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([10, 10])] });
    artist.room.send(DASKETCH_MSG.draw, { turn: turn - 1, events: [stroke([10, 10])] });
    await sleep(120);
    expect(t.server['board'].ops.length).toBe(opsBefore);
    expect(guesser.strokes).toHaveLength(0);
    expect(artist.errors.some((e) => e.type === DASKETCH_MSG.draw)).toBe(false);
  });

  it('rebuilds the canvas for late joiners and reconnecting artists', async () => {
    const t = await setup(['Ada', 'Bo']);
    await start(t);
    const word = await chooseFirst(t);
    const artist = t.artist();
    const turn = t.server.state.turn;
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([10, 10, 50, 50]), { k: 'shape', tool: 'rect', color: '#000000', size: 4, pts: [0, 0, 300, 200] }] });
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([400, 400])] });
    await waitFor(() => t.server['board'].ops.length === 3);

    const late = await t.join('Late');
    await waitFor(() => late.canvases.some((c) => c.turn === turn && c.ops.length === 3), 2000, 'late snapshot');
    const snap = late.canvases.at(-1)!;
    expect(snap.seq).toBe(2);
    expect(snap.open).toBe(true);
    expect(snap.ops.map((o) => o.tool)).toEqual(['brush', 'rect', 'brush']);
    expect(late.lastPrivate()!.word).toBeNull();
    await waitFor(() => t.server.state.sketch.has(late.me().playerId));
    expect(t.server['order'].pending).toContain(late.me().playerId);

    // The artist drops and auto-reconnects within the grace period: word + canvas come back.
    t.server.artistGraceMs = 5000;
    artist.room.reconnection.minUptime = 0;
    const before = artist.privates.length;
    const reconnected = new Promise<void>((r) => artist.room.onReconnect(() => r()));
    (artist.room as any).connection.transport.ws.close(4010);
    await reconnected;
    await waitFor(() => artist.privates.length > before && artist.lastPrivate()!.word === word, 3000, 'private after reconnect');
    await waitFor(() => artist.canvases.at(-1)?.ops.length === 3);
    expect(t.server.state.stage).toBe('drawing');

    // Anyone can ask for a fresh snapshot.
    const count = late.canvases.length;
    late.room.send(DASKETCH_MSG.sync, {});
    await waitFor(() => late.canvases.length === count + 1);
  });
});

describe('DASketch room: guessing and scoring', () => {
  it('scores correct guesses, hides the answer and near-misses, and blocks repeat scoring', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy'], { spectators: ['Spec'] });
    await start(t);
    const word = await chooseFirst(t);
    const artist = t.artist();
    const [bo, cy] = t.guessers() as [TestClient, TestClient];
    const spectator = t.clients.find((c) => c.name === 'Spec')!;

    // A wrong guess is an ordinary public chat line.
    say(bo, 'banana split');
    for (const c of [artist, cy, spectator]) await waitFor(() => c.chat.some((m) => m.text === 'banana split'));

    // A near miss reaches only the guesser (plus people who know the word).
    const typo = `${word}x`;
    say(bo, typo);
    await waitFor(() => bo.chat.some((m) => m.kind === 'close' && m.text.includes(typo)));
    await waitFor(() => artist.chat.some((m) => m.kind === 'guess' && m.text === typo));
    await sleep(60);
    expect(cy.chat.some((m) => m.text.includes(typo))).toBe(false);
    expect(spectator.chat.some((m) => m.text.includes(typo))).toBe(false);

    // Spectator chat never reaches players who are still guessing.
    say(spectator, 'spectator thoughts');
    await waitFor(() => artist.chat.some((m) => m.text === 'spectator thoughts'));
    await sleep(60);
    expect(bo.chat.some((m) => m.text === 'spectator thoughts')).toBe(false);

    // Correct guess: announced without the word; only the guesser learns it.
    const artistBefore = score(t, artist);
    say(bo, word.toUpperCase());
    await waitFor(() => cy.chat.some((m) => m.kind === 'correct' && m.playerId === bo.me().playerId));
    await waitFor(() => bo.lastPrivate()?.word === word && bo.lastPrivate()?.guessed === true);
    expect(score(t, bo)).toBeGreaterThan(0);
    expect(score(t, artist)).toBeGreaterThan(artistBefore);
    expect(t.server.state.sketch.get(bo.me().playerId)!.guessed).toBe(true);
    expect(t.server.state.sketch.get(bo.me().playerId)!.rank).toBe(1);
    expect(t.server.state.guessedCount).toBe(1);
    expect(cy.privates.some((p) => p.word)).toBe(false);
    for (const c of [cy, spectator]) expect(JSON.stringify(c.chat)).not.toContain(word);
    expect(bo.events.some((e) => e.type === 'correct' && e.playerId === bo.me().playerId)).toBe(true);

    // Guessing again scores nothing, and the message stays among players who know the word.
    const boScore = score(t, bo);
    say(bo, word);
    say(bo, 'ha, easy one');
    await waitFor(() => artist.chat.some((m) => m.text === 'ha, easy one' && m.kind === 'guess'));
    await sleep(80);
    expect(score(t, bo)).toBe(boScore);
    expect(cy.chat.some((m) => m.text === 'ha, easy one')).toBe(false);
    expect(t.server.state.guessedCount).toBe(1);

    // The last guesser ends the turn early: the word is revealed to everyone.
    say(cy, word);
    await waitFor(() => t.server.state.phase === 'INTERMISSION', 3000, 'reveal');
    expect(t.server.state.stage).toBe('reveal');
    expect(t.server.state.word).toBe(word);
    expect(t.server.state.revealReason).toBe('all');
    expect(t.server.state.sketch.get(cy.me().playerId)!.rank).toBe(2);
    expect(score(t, bo)).toBeGreaterThan(score(t, cy));
    const history = JSON.parse(t.server.state.historyJson);
    expect(history[0]).toMatchObject({ word, guessers: 2, reason: 'all' });
  });

  it('rate-limits guesses', async () => {
    const t = await setup(['Ada', 'Bo']);
    await start(t);
    await chooseFirst(t);
    const guesser = t.guessers()[0]!;
    const artist = t.artist();
    for (let i = 0; i < 12; i++) say(guesser, `wild guess ${i}`);
    await waitFor(() => guesser.errors.some((e) => e.code === 'rate_limited'));
    await sleep(150);
    const seen = artist.chat.filter((m) => m.text.startsWith('wild guess')).length;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(12);
  });
});

describe('DASketch room: turn flow', () => {
  it('reveals hints over time, times out, rotates artists and ends with results', async () => {
    const t = await setup(['Ada', 'Bo'], { settings: { hints: 'fast' } });
    t.server.drawMsFor = () => 700;
    await start(t);
    const first = t.artist();
    const word = await chooseFirst(t);
    await waitFor(() => first.events.some((e) => e.type === 'hint'), 2000, 'hint');
    expect(t.server.state.hint.replace(/_/g, '').length).toBeGreaterThan(0);
    expect(t.server.state.hint.length).toBe(word.length);
    await waitFor(() => t.server.state.stage === 'reveal', 3000, 'time up');
    expect(t.server.state.revealReason).toBe('time');
    expect(t.server.state.word).toBe(word);

    await waitFor(() => t.server.state.stage === 'choosing' && t.server.state.turn === 2, 3000, 'second turn');
    expect(t.artist()).not.toBe(first);
    expect(t.server.state.word).toBe('');
    await waitFor(() => t.artist().lastPrivate()?.turn === 2 && t.artist().lastPrivate()?.choices !== null);
    const second = await chooseFirst(t);
    expect(second).not.toBe(word);
    await waitFor(() => t.server.state.phase === 'RESULTS', 4000, 'results');
    expect(t.server.state.stage).toBe('final');
    expect(JSON.parse(t.server.state.historyJson)).toHaveLength(2);
    expect(Array.isArray(JSON.parse(t.server.state.awardsJson))).toBe(true);

    // Play again resets everything.
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => t.server.state.phase === 'LOBBY');
    expect(t.server.state.stage).toBe('idle');
    expect(t.server.state.turn).toBe(0);
    expect(t.server.state.sketch.size).toBe(0);
  });

  it('ends the turn early when the artist leaves and keeps the match going', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy'], { settings: { rounds: 2 } });
    await start(t);
    const word = await chooseFirst(t);
    const artist = t.artist();
    const artistId = artist.me().playerId;
    await artist.room.leave(true);
    await waitFor(() => t.server.state.stage === 'reveal', 3000, 'reveal after leave');
    expect(t.server.state.revealReason).toBe('artist_left');
    expect(t.server.state.word).toBe(word);
    await waitFor(() => t.server.state.stage === 'choosing', 3000, 'next turn');
    expect(t.server.state.artistId).not.toBe(artistId);
    expect(t.server.state.players.has(artistId)).toBe(false);
  });

  it('skips an artist who disconnects while choosing', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy']);
    await start(t);
    const artist = t.artist();
    const turn = t.server.state.turn;
    artist.room.reconnection.enabled = false;
    (artist.room as any).connection.transport.ws.close(4010);
    await waitFor(() => t.server.state.turn === turn + 1 && t.server.state.stage === 'choosing', 3000, 'skip');
    expect(t.server.state.artistId).not.toBe(artist.me().playerId);
  });

  it('finishes the match when too few players remain', async () => {
    const t = await setup(['Ada', 'Bo'], { settings: { rounds: 3 } });
    await start(t);
    await chooseFirst(t);
    const guesser = t.guessers()[0]!;
    await guesser.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'results');
    const [remaining] = [...t.server.state.players.values()];
    expect(remaining).toBeDefined();
  });
});

describe('DASketch room: audit regressions', () => {
  it('never hands the custom word list to a player who becomes host mid-match', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy']);
    await start(t);
    await chooseFirst(t);
    const heir = t.guessers().find((c) => c !== t.host)!;
    // Host hands over mid-turn.
    t.host.room.send('lobby:transferHost', { playerId: heir.me().playerId });
    await waitFor(() => t.server.state.hostId === heir.me().playerId, 3000, 'transfer');
    await sleep(120);
    expect(heir.words).toHaveLength(0);

    // The author leaving mid-match (host migration) doesn't leak it either.
    heir.room.send('lobby:transferHost', { playerId: t.host.me().playerId });
    await waitFor(() => t.server.state.hostId === t.host.me().playerId, 3000, 'transfer back');
    await t.host.room.leave(true);
    await waitFor(() => t.server.state.hostId !== '' && !t.server.state.players.has(t.host.me().playerId), 3000, 'migration');
    const next = t.byId(t.server.state.hostId);
    await sleep(120);
    expect(next.words).toHaveLength(0);
    expect(t.server.state.phase).not.toBe('LOBBY');

    // Back in the lobby the host gets the list again so they can edit it.
    next.room.send('lobby:toLobby', {});
    await waitFor(() => t.server.state.phase === 'LOBBY', 3000, 'lobby');
    await waitFor(() => next.words.length > 0, 3000, 'words in lobby');
    expect(next.words.at(-1)!.words).toEqual(WORDS);
  });

  it('does not keep the artist choosing and drawing for nobody when the last guesser leaves', async () => {
    const t = await setup(['Ada', 'Bo'], { settings: { rounds: 3 } });
    await start(t);
    const guesser = t.guessers()[0]!;
    expect(t.server.state.stage).toBe('choosing');
    await guesser.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 1500, 'results');
    expect(t.server.state.stage).toBe('final');
  });

  it('keeps a two-letter answer out of public chat when it is typed inside a sentence', async () => {
    const t = await setup(['Ada', 'Bo', 'Cy'], { words: ['tv'], settings: { choiceCount: 1 } });
    await start(t);
    const word = await chooseFirst(t);
    expect(word).toBe('tv');
    const [bo, cy] = t.guessers() as [TestClient, TestClient];
    say(bo, 'is it a tv');
    await waitFor(() => bo.chat.some((m) => m.kind === 'close'), 2000, 'close note');
    await sleep(80);
    expect(cy.chat.some((m) => m.text.includes('tv'))).toBe(false);
    // Full-width input scores like the plain answer instead of being broadcast.
    say(cy, 'ｔｖ');
    await waitFor(() => t.server.state.sketch.get(cy.me().playerId)?.guessed === true, 2000, 'full-width guess');
  });

  it('rejects draw messages whose events carry more points in total than one message allows', async () => {
    const t = await setup(['Ada', 'Bo']);
    await start(t);
    await chooseFirst(t);
    const artist = t.artist();
    const guesser = t.guessers()[0]!;
    const turn = t.server.state.turn;
    const pts = Array.from({ length: 1200 }, (_, i) => (i * 7) % 900);
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke(pts), ...Array.from({ length: 23 }, () => ({ k: 'pts', pts }))] });
    artist.room.send(DASKETCH_MSG.draw, { turn, events: [stroke([5, 5, 6, 6])] });
    await waitFor(() => guesser.strokes.length > 0, 2000, 'relay');
    await sleep(80);
    expect(guesser.strokes).toHaveLength(1);
    expect(t.server['board'].points).toBe(2);
  });
});

describe('DASketch room: returning to the lobby', () => {
  it('does not replay game flow (or record a match) while away players are cleared on the way to the lobby', async () => {
    const t = await setup(['Ada', 'Bo']);
    t.server.reconnectGraceSeconds = 0.3;
    let ended = 0;
    const endMatch = t.server.endMatch.bind(t.server);
    t.server.endMatch = (...args: unknown[]) => {
      ended++;
      return endMatch(...args);
    };
    await start(t);
    const bo = t.clients[1]!;
    const boId = bo.me().playerId;
    bo.room.reconnection.enabled = false;
    (bo.room as any).connection.transport.ws.close(4010);
    await waitFor(() => t.server['players'].get(boId)?.away === true, 3000, 'away');
    await waitFor(() => t.server.state.stage === 'choosing' && t.server.state.artistId === t.host.me().playerId, 3000, 'host choosing');
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => t.server.state.phase === 'LOBBY', 3000, 'lobby');
    await sleep(80);
    expect(ended).toBe(0);
    expect(t.host.chat.some((m) => /not enough players/i.test(m.text))).toBe(false);
    expect(t.server.state.stage).toBe('idle');
  });
});
