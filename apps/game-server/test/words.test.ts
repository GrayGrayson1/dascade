/**
 * DASwords integration tests: real room + real dictionary, several SDK clients per scenario.
 * Timers are shortened through a test subclass; the tests read the server's (secret) puzzle to pick
 * valid words — exactly what a player would type — and assert that nothing leaks to other players.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import type { PartyPodium } from '@dascade/shared/party';
import { WORDS_MSG, lengthPoints, type WordsPrivate, type WordsReviewItem, type WordsRoundReveal, type ChainLinkReveal } from '@dascade/shared/games/words';
import { categoryKeys, isBlockedWord } from '@dascade/game-core/words';
import { createDascadeServer } from '../src/server.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { WordsRoom } from '../src/rooms/words/WordsRoom.ts';
import { wordsDictionary } from '../src/rooms/words/dictionary.ts';
import { collect, freePort, quiet, sleep, waitFor } from './helpers.ts';

class TestWordsRoom extends WordsRoom {
  protected override firstIntroMs = 150;
  protected override introMs = 120;
  protected override revealMs = 400;
  protected override linkRevealMs = 200;
  protected override playMsOverride: number | null = 2500;
  protected override linkMsOverride: number | null = 2500;
  protected override reviewMsOverride: number | null = 2500;
  protected override chainStarterOverride: string | null = 'lemon';
}

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;
const dict = wordsDictionary();

beforeAll(async () => {
  const port = await freePort();
  const server = await createDascadeServer({ games: [], extraRooms: { words: TestWordsRoom } });
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
  privates: WordsPrivate[];
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
    privates: collect(room, WORDS_MSG.private),
    all,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
// The room under test, including its private puzzle fields (tests peek at the secret board/rack/spec).
type Server = Record<string, any>;

async function setup(n: number, settings: Json = {}, spectators = 0) {
  const host = await wire(await colyseus.sdk.create('words', { name: 'P0' }));
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  if (Object.keys(settings).length) {
    host.room.send('lobby:settings', { settings });
    await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(server.state.settingsJson)[k] === v), 2000, 'settings');
  }
  const clients = [host];
  for (let i = 1; i < n; i++) clients.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `P${i}` })));
  const specs: Client[] = [];
  for (let i = 0; i < spectators; i++) specs.push(await wire(await colyseus.sdk.joinById(host.room.roomId, { name: `S${i}`, spectator: true })));
  return { server, host, clients, specs };
}

async function startAndPlay(t: { server: Server; host: Client; clients: Client[] }, stage = 'play') {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.stage === stage, 3000, `${stage} stage`);
  await waitFor(() => t.clients.every((c) => json(c).stage === stage), 2000, `${stage} synced`);
}

const submit = (c: Client, word: string, round = 1, path?: number[]) => c.room.send(WORDS_MSG.submit, { round, word, ...(path ? { path } : {}) });
const lastPrivate = (c: Client) => c.privates.at(-1);
const entry = (c: Client, word: string) => lastPrivate(c)?.entries.find((e) => e.word === word);

/** Grid solutions sorted longest first (never blocked). */
function gridWords(server: Server): Array<[string, number[]]> {
  return [...(server.grid.solutions as Map<string, number[]>).entries()].filter(([w]) => !isBlockedWord(w)).sort((a, b) => b[0].length - a[0].length);
}

describe('DASwords — Letter Grid', () => {
  it('validates words server-side, keeps them private until the reveal, scores uniques and shared words', async () => {
    const t = await setup(3, { mode: 'grid', rounds: 1 }, 1);
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.server.state.stage === 'intro', 2000, 'intro');
    // The board is generated but not published during the intro.
    expect(json(t.host).grid).toEqual([]);
    await waitFor(() => t.server.state.stage === 'play', 2000, 'play');
    const [a, b, c] = t.clients as [Client, Client, Client];
    const spec = t.specs[0]!;
    await waitFor(() => json(b).grid.length === 16, 2000, 'grid synced');
    expect(json(b).possible).toBe(t.server.grid.solutions.size);

    const words = gridWords(t.server);
    const [secret, secretPath] = words[0]!; // A's unique long word
    const shared = words[1]![0];
    submit(a, secret, 1, secretPath);
    submit(a, shared);
    submit(b, shared.toUpperCase()); // typed, any case
    await waitFor(() => entry(a, secret)?.status === 'ok' && entry(b, shared)?.status === 'ok', 2000, 'accepted');
    expect(entry(a, secret)).toMatchObject({ points: lengthPoints(secret.length), path: secretPath });
    await waitFor(() => json(c).progress[a.id()]?.found === 2, 2000, 'public count');

    // Duplicate (idempotent), invalid, off-grid, blocked, stale round, spectator.
    submit(a, secret);
    submit(a, 'zzzzq');
    submit(a, 'shit');
    submit(a, secret, 99);
    spec.room.send(WORDS_MSG.submit, { round: 1, word: shared });
    await waitFor(() => entry(a, 's***') !== undefined && a.errors.length >= 1 && spec.errors.length >= 1, 2000, 'rejections');
    const priv = lastPrivate(a)!;
    expect(priv.entries.filter((e) => e.word === secret && e.status === 'ok')).toHaveLength(1);
    expect(priv.entries.find((e) => e.word === secret && e.status === 'rejected')?.reason).toBe('duplicate');
    expect(entry(a, 'zzzzq')).toMatchObject({ status: 'rejected' });
    expect(entry(a, 's***')).toMatchObject({ status: 'rejected', reason: 'blocked' });
    expect(a.errors.some((e) => /earlier round/.test(e.message))).toBe(true);
    expect(spec.errors[0]!.code).toBe('not_allowed');
    expect(json(c).progress[a.id()].found).toBe(2);
    // Nobody else ever saw A's words or the unmasked blocked word.
    for (const other of [b, c, spec]) {
      expect(JSON.stringify(other.all)).not.toContain(secret);
      expect(JSON.stringify(json(other))).not.toContain(secret);
    }
    expect(JSON.stringify(a.all)).not.toMatch(/"shit"/);
    expect(spec.privates).toHaveLength(0);

    // Host ends the round early (party kit skip) → reveal.
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage === 'reveal', 3000, 'reveal');
    // Late submissions are refused.
    submit(b, words[2]![0]);
    await waitFor(() => b.errors.some((e) => e.code === 'wrong_phase'), 2000, 'late refused');
    await waitFor(() => json(b).revealJson !== '', 2000, 'reveal synced');
    const reveal = JSON.parse(json(b).revealJson) as WordsRoundReveal;
    const ra = reveal.players.find((p) => p.id === a.id())!;
    const rb = reveal.players.find((p) => p.id === b.id())!;
    expect(ra.words.find((w) => w.w === secret)).toMatchObject({ p: lengthPoints(secret.length), u: 1 });
    expect(ra.words.find((w) => w.w === shared)).toMatchObject({ s: 1, p: lengthPoints(shared.length) });
    expect(ra.points).toBe(lengthPoints(secret.length) + lengthPoints(shared.length));
    expect(rb.points).toBe(lengthPoints(shared.length));
    expect(reveal.possible).toBe(t.server.grid.solutions.size);
    expect(reveal.found).toBe(2);
    expect(reveal.missed.every((w) => dict.isCommon(w) && w !== secret && w !== shared)).toBe(true);
    await waitFor(() => json(a).players[a.id()].score === ra.points, 2000, 'scores committed');

    await waitFor(() => json(a).phase === 'RESULTS', 3000, 'results');
    const podium = JSON.parse(json(a).podiumJson) as PartyPodium;
    expect(podium.winnerIds).toEqual([a.id()]);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]).toEqual([a.id()]);
    expect(outcomes[0]!.details).toMatchObject({ mode: 'grid' });
  });

  it('"unique words only" crosses out shared words', async () => {
    const t = await setup(2, { mode: 'grid', rounds: 1, uniqueOnly: true });
    await startAndPlay(t);
    const [a, b] = t.clients as [Client, Client];
    const words = gridWords(t.server);
    const shared = words[0]![0];
    const mine = words[1]![0];
    submit(a, shared);
    submit(a, mine);
    submit(b, shared);
    await waitFor(() => entry(a, mine)?.status === 'ok' && entry(b, shared)?.status === 'ok', 2000, 'accepted');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(a).revealJson) as WordsRoundReveal;
    const ra = reveal.players.find((p) => p.id === a.id())!;
    expect(ra.words.find((w) => w.w === shared)).toMatchObject({ p: 0, s: 1 });
    expect(ra.points).toBe(lengthPoints(mine.length));
    expect(reveal.players.find((p) => p.id === b.id())!.points).toBe(0);
  });

  it('a player who left no longer makes anyone’s word "shared" (and a rejoin never counts twice)', async () => {
    const t = await setup(3, { mode: 'grid', rounds: 1, uniqueOnly: true });
    await startAndPlay(t);
    const [a, b, c] = t.clients as [Client, Client, Client];
    const words = gridWords(t.server);
    const word = words[0]![0];
    submit(a, word);
    submit(c, word);
    await waitFor(() => entry(a, word)?.status === 'ok' && entry(c, word)?.status === 'ok', 2000, 'accepted');
    await c.room.leave(true);
    await waitFor(() => json(a).players[c.id()] === undefined, 2000, 'c gone');
    // C rejoins as a new seat and banks the same word again: still one person.
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P2 again' }));
    submit(again, word);
    await waitFor(() => entry(again, word)?.status === 'ok', 2000, 'rejoin accepted');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(a).revealJson) as WordsRoundReveal;
    expect(reveal.players.map((p) => p.id).sort()).toEqual([a.id(), b.id(), again.id()].sort());
    // Shared between A and the rejoined seat only (both present) — never counted against a ghost.
    expect(reveal.players.find((p) => p.id === a.id())!.words.find((w) => w.w === word)).toMatchObject({ p: 0, s: 1 });
    expect(reveal.found).toBe(1);
  });

  it('a departed finder does not cancel the only remaining finder’s unique word', async () => {
    const t = await setup(3, { mode: 'grid', rounds: 1, uniqueOnly: true });
    await startAndPlay(t);
    const [a, , c] = t.clients as [Client, Client, Client];
    const word = gridWords(t.server)[0]![0];
    submit(a, word);
    submit(c, word);
    await waitFor(() => entry(a, word)?.status === 'ok' && entry(c, word)?.status === 'ok', 2000, 'accepted');
    await c.room.leave(true);
    await waitFor(() => json(a).players[c.id()] === undefined, 2000, 'c gone');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(a).revealJson) as WordsRoundReveal;
    const mine = reveal.players.find((p) => p.id === a.id())!.words.find((w) => w.w === word)!;
    expect(mine).toMatchObject({ p: lengthPoints(word.length), u: 1 });
  });

  it('timer end closes the round on its own; reconnect restores my words', async () => {
    const t = await setup(2, { mode: 'grid', rounds: 2 });
    await startAndPlay(t);
    const [a] = t.clients as [Client, Client];
    const [w] = gridWords(t.server)[0]!;
    submit(a, w);
    await waitFor(() => entry(a, w)?.status === 'ok', 2000, 'accepted');
    const token = a.token();
    const id = a.id();
    a.room.reconnection.enabled = false;
    (a.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'P0', seatToken: token }));
    expect(again.id()).toBe(id);
    await waitFor(() => again.privates.length > 0, 2000, 'private resent');
    expect(again.privates.at(-1)!.entries.map((e) => e.word)).toContain(w);
    // No skip: the 2.5 s play timer ends the round.
    await waitFor(() => t.server.state.stage === 'reveal', 5000, 'timer reveal');
    await waitFor(() => t.server.state.stage === 'play' && t.server.state.round === 2, 5000, 'round 2');
    submit(again, w, 1); // stale round
    await waitFor(() => again.errors.some((e) => /earlier round/.test(e.message)), 2000, 'stale refused');
  });
});

describe('DASwords — Anagram Sprint + teams', () => {
  it('rack letters are enforced; teammates share a word once; uniqueness is across teams', async () => {
    const t = await setup(4, { mode: 'anagram', rounds: 1, teams: 2, rackSize: 7 });
    await startAndPlay(t);
    await waitFor(() => json(t.host).rack.length === 7, 2000, 'rack');
    const rack = t.server.rack as { letters: string; seeds: string[]; solutions: string[] };
    expect(json(t.host).rack).toBe(rack.letters);
    // The seed (long word) is never published before the reveal.
    expect(JSON.stringify(json(t.host))).not.toContain(rack.seeds[0]);
    const teamOf = (c: Client) => json(t.host).seats[c.id()].teamId as string;
    const [a, ...rest] = t.clients as [Client, Client, Client, Client];
    const mate = rest.find((c) => teamOf(c) === teamOf(a))!;
    const rival = rest.find((c) => teamOf(c) !== teamOf(a))!;
    const words = rack.solutions.filter((w) => w.length >= 4 && w.length < 7 && !isBlockedWord(w));
    const [w1, w2] = words;
    submit(a, w1!);
    await waitFor(() => entry(a, w1!)?.status === 'ok', 2000, 'a w1');
    submit(mate, w1!); // teammate, later → no extra team points
    submit(rival, w1!); // other team → shared
    submit(a, w2!); // unique for A's team
    submit(a, rack.seeds[0]!); // full rack
    submit(a, 'qqqq'); // letters not on the rack
    await waitFor(() => entry(mate, w1!)?.status === 'ok' && entry(rival, w1!)?.status === 'ok' && entry(a, 'qqqq') !== undefined, 2000, 'all submitted');
    expect(entry(a, 'qqqq')).toMatchObject({ status: 'rejected', reason: 'letters' });
    expect(entry(a, rack.seeds[0]!)).toMatchObject({ status: 'ok', full: true });
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => json(a).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(a).revealJson) as WordsRoundReveal;
    expect(reveal.seeds).toContain(rack.seeds[0]);
    const byId = (c: Client) => reveal.players.find((p) => p.id === c.id())!;
    expect(byId(mate).words.find((w) => w.w === w1)).toMatchObject({ t: 1, p: 0 });
    expect(byId(a).words.find((w) => w.w === w1)).toMatchObject({ s: 1 });
    expect(byId(a).words.find((w) => w.w === w2)!.u).toBe(1);
    expect(byId(a).words.find((w) => w.w === rack.seeds[0])!.f).toBe(1);
    await waitFor(() => json(a).phase === 'RESULTS', 3000, 'results');
    const final = json(a);
    const teamScore = final.teams[teamOf(a)].score;
    expect(teamScore).toBe(byId(a).points + byId(mate).points);
    expect(byId(a).points).toBeGreaterThan(byId(rival).points);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]!.sort()).toEqual([a.id(), mate.id()].sort());
  });
});

describe('DASwords — Word Chain', () => {
  function nextWord(server: Server, exclude: string[] = [], minLen = 5): string {
    const chain = server.chain;
    return dict.wordsWithPrefix(chain.prefix, (w) => w.length >= minLen && dict.isCommon(w) && !chain.burned.has(w) && !exclude.includes(w) && !isBlockedWord(w))[0]!;
  }

  it('simultaneous links: rule checks, hearts, eliminations, longest answer links on, no repeats', async () => {
    const t = await setup(3, { mode: 'chain', rounds: 1, chainLives: 1, chainLinks: 5 }, 1);
    await startAndPlay(t, 'link');
    const [a, b, c] = t.clients as [Client, Client, Client];
    expect(json(a).chainWord).toBe('lemon');
    expect(json(a).chainPrefix).toBe('n');
    // A long answer that ends in "n" keeps the next link on "n", so the short answer is burned there.
    const long = dict.wordsWithPrefix('n', (w) => w.length >= 7 && w.endsWith('n') && dict.isCommon(w) && !isBlockedWord(w))[0]!;
    const short = dict.wordsWithPrefix('n', (w) => w.length === 4 && dict.isCommon(w) && !isBlockedWord(w))[0]!;
    submit(a, 'zebra'); // wrong start
    submit(a, 'lemon'); // wrong start + burned
    await waitFor(() => lastPrivate(a)?.entries.length === 2, 2000, 'rejections');
    expect(lastPrivate(a)!.entries.map((e) => e.reason)).toEqual(['wrong_start', 'wrong_start']);
    submit(a, long);
    submit(b, short);
    await waitFor(() => json(c).seats[a.id()]?.answered && json(c).seats[b.id()]?.answered, 2000, 'answered flags');
    // Answers stay private until the link closes.
    expect(JSON.stringify(c.all)).not.toContain(long);
    expect(JSON.stringify(t.specs[0]!.all)).not.toContain(long);
    submit(a, nextWord(t.server, [long])); // one answer per link
    await waitFor(() => lastPrivate(a)!.entries.some((e) => e.reason === 'answered'), 2000, 'second answer refused');
    // C never answers: the 2.5 s link timer closes it.
    await waitFor(() => t.server.state.stage === 'linkReveal', 4000, 'link reveal');
    const link = JSON.parse(json(c).linkJson) as ChainLinkReveal;
    expect(link.next).toBe(long);
    expect(link.missed).toEqual([c.id()]);
    expect(link.eliminated).toEqual([c.id()]);
    expect(link.answers.find((x) => x.playerId === a.id())).toMatchObject({ maker: true, points: lengthPoints(long.length) + 2 });
    await waitFor(() => json(c).progress[c.id()]?.out === true, 2000, 'c out');

    await waitFor(() => t.server.state.stage === 'link' && t.server.state.chainLink === 2, 3000, 'link 2');
    expect(json(a).chainWord).toBe(long);
    submit(c, nextWord(t.server)); // eliminated
    submit(b, short); // burned
    await waitFor(() => Boolean(lastPrivate(c)?.entries.some((e) => e.reason === 'eliminated') && lastPrivate(b)?.entries.some((e) => e.reason === 'used')), 2000, 'refusals');
    // Both alive players answer → the link ends early (well before the 2.5 s timer).
    const w2 = nextWord(t.server);
    const started = Date.now();
    submit(a, w2);
    submit(b, nextWord(t.server, [w2]));
    await waitFor(() => t.server.state.stage === 'linkReveal', 2000, 'early close');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('chain ends when one player is left; survivors score; outcome reported', async () => {
    const t = await setup(2, { mode: 'chain', rounds: 1, chainLives: 1, chainLinks: 10 });
    await startAndPlay(t, 'link');
    const [a] = t.clients as [Client, Client];
    submit(a, nextWord(t.server));
    await waitFor(() => t.server.state.stage === 'reveal' || json(a).phase === 'RESULTS', 5000, 'chain over');
    await waitFor(() => json(a).phase === 'RESULTS', 3000, 'results');
    const reveal = JSON.parse(json(a).revealJson) as WordsRoundReveal;
    expect(reveal.survivors).toEqual([a.id()]);
    expect(reveal.links).toBe(1);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements[0]).toEqual([a.id()]);
  });

  it('a disconnected player never stalls a link', async () => {
    const t = await setup(3, { mode: 'chain', rounds: 1, chainLives: 3 });
    await startAndPlay(t, 'link');
    const [a, b, c] = t.clients as [Client, Client, Client];
    submit(a, nextWord(t.server));
    submit(b, nextWord(t.server, [t.server.chain.answerOf(a.id()) ?? '']));
    await waitFor(() => t.server.state.answeredCount === 2, 2000, 'two answered');
    c.room.reconnection.enabled = false;
    (c.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await waitFor(() => t.server.state.stage === 'linkReveal', 2000, 'closed without c');
  });
});

describe('DASwords — Forbidden Letter', () => {
  it('automatic letter + dictionary checks; known answers auto-approved; host reviews the rest anonymously', async () => {
    const t = await setup(3, { mode: 'forbidden', rounds: 1, review: 'host' }, 1);
    await startAndPlay(t);
    const [host, b, c] = t.clients as [Client, Client, Client];
    const spec = t.server.spec as { category: { members: string[] }; letter: string };
    await waitFor(() => json(b).forbidden === spec.letter && json(b).category !== '', 2000, 'prompt');
    const keys = categoryKeys(spec.category as never);
    const known = spec.category.members.find((m) => !m.includes(spec.letter) && !m.includes(' ') && dict.has(m) && !isBlockedWord(m))!;
    const withLetter = spec.category.members.find((m) => m.includes(spec.letter) && !m.includes(' '))!;
    const unknown = dict.ofLength(6).find((w) => dict.isCommon(w) && !w.includes(spec.letter) && !keys.has(w) && !isBlockedWord(w) && !keys.has(w.replace(/s$/, '')))!;
    submit(b, known);
    submit(b, withLetter);
    submit(c, unknown);
    submit(c, 'qwxzv');
    await waitFor(() => entry(b, known) !== undefined && entry(b, withLetter) !== undefined && entry(c, unknown) !== undefined && entry(c, 'qwxzv') !== undefined, 2000, 'verdicts');
    expect(entry(b, known)).toMatchObject({ status: 'ok', known: true });
    expect(entry(b, withLetter)).toMatchObject({ status: 'rejected', reason: 'forbidden_letter' });
    expect(entry(c, unknown)).toMatchObject({ status: 'pending' });
    expect(entry(c, 'qwxzv')).toMatchObject({ status: 'rejected', reason: 'not_word' });

    host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage === 'review', 3000, 'review');
    await waitFor(() => json(b).reviewJson !== '[]', 2000, 'review synced');
    const items = JSON.parse(json(b).reviewJson) as WordsReviewItem[];
    expect(items).toEqual([{ id: 'r1', text: unknown, count: 1, status: 'pending' }]);
    // Anonymous: the review list never says who wrote it.
    expect(json(b).reviewJson).not.toContain(c.id());
    // Only the host decides.
    b.room.send(WORDS_MSG.review, { round: 1, id: 'r1', verdict: 'accept' });
    await waitFor(() => b.errors.some((e) => e.code === 'not_host'), 2000, 'not host');
    host.room.send(WORDS_MSG.review, { round: 1, id: 'r1', verdict: 'reject' });
    await waitFor(() => entry(c, unknown)?.status === 'rejected', 2000, 'author sees the verdict');
    expect(entry(c, unknown)!.reason).toBe('category');
    // Everything decided → the review ends early and the round is revealed.
    await waitFor(() => t.server.state.stage === 'reveal' || json(b).phase === 'RESULTS', 3000, 'reveal');
    // The server's stage can change a patch before b's copy of revealJson arrives.
    await waitFor(() => json(b).revealJson !== '', 2000, 'reveal synced');
    const reveal = JSON.parse(json(b).revealJson) as WordsRoundReveal;
    expect(reveal.players.find((p) => p.id === b.id())!.words.find((w) => w.w === known)).toMatchObject({ u: 1, p: 4 });
    expect(reveal.players.find((p) => p.id === c.id())!.words.find((w) => w.w === unknown)).toMatchObject({ x: 1, p: 0 });
    expect(reveal.forbidden).toBe(spec.letter);
    expect(t.specs[0]!.privates).toHaveLength(0);
  });

  it('answers the host never reviews are accepted when the review timer ends', async () => {
    const t = await setup(2, { mode: 'forbidden', rounds: 1, review: 'host' });
    await startAndPlay(t);
    const [, b] = t.clients as [Client, Client];
    const spec = t.server.spec as { category: { members: string[] }; letter: string };
    const keys = categoryKeys(spec.category as never);
    const unknown = dict.ofLength(6).find((w) => dict.isCommon(w) && !w.includes(spec.letter) && !keys.has(w) && !isBlockedWord(w) && !keys.has(w.replace(/s$/, '')))!;
    submit(b, unknown);
    await waitFor(() => entry(b, unknown)?.status === 'pending', 2000, 'pending');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage === 'review', 3000, 'review');
    // Nobody decides: the 2.5 s review timer approves it.
    await waitFor(() => entry(b, unknown)?.status === 'ok', 5000, 'auto-approved');
    await waitFor(() => json(b).revealJson !== '', 3000, 'reveal');
    const reveal = JSON.parse(json(b).revealJson) as WordsRoundReveal;
    expect(reveal.players.find((p) => p.id === b.id())!.words.find((w) => w.w === unknown)).toMatchObject({ h: 1, p: 4 });
  });

  it('trust mode accepts dictionary-valid answers without a review', async () => {
    const t = await setup(2, { mode: 'forbidden', rounds: 1, review: 'trust' });
    await startAndPlay(t);
    const [a] = t.clients as [Client, Client];
    const spec = t.server.spec as { category: { members: string[] }; letter: string };
    const keys = categoryKeys(spec.category as never);
    const unknown = dict.ofLength(6).find((w) => dict.isCommon(w) && !w.includes(spec.letter) && !keys.has(w) && !isBlockedWord(w))!;
    submit(a, unknown);
    await waitFor(() => entry(a, unknown)?.status === 'ok', 2000, 'trusted');
    t.host.room.send('party:host', { action: 'skip' });
    await waitFor(() => t.server.state.stage === 'reveal', 3000, 'straight to reveal');
  });
});

describe('DASwords — platform rules', () => {
  it('late joiners can play the open round; solo rooms ignore team settings', async () => {
    const t = await setup(1, { mode: 'grid', rounds: 1 });
    await startAndPlay(t);
    const late = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'Late' }));
    await waitFor(() => json(late).progress[late.id()] !== undefined, 2000, 'late progress');
    const [w] = gridWords(t.server)[0]!;
    submit(late, w);
    await waitFor(() => entry(late, w)?.status === 'ok', 2000, 'late word accepted');

    const solo = await wire(await colyseus.sdk.create('words', { name: 'Solo', solo: true, settings: { teams: 2, rounds: 1 } }));
    const soloServer = colyseus.getRoomById(solo.room.roomId) as unknown as Server;
    solo.room.send('lobby:start', {});
    await waitFor(() => soloServer.state.stage === 'intro' || soloServer.state.stage === 'play', 3000, 'solo started');
    expect(soloServer.state.teamMode).toBe(false);
  });

  it('rate-limits submission floods and never double-counts a word', async () => {
    const t = await setup(1, { mode: 'grid', rounds: 1 });
    await startAndPlay(t);
    const a = t.clients[0]!;
    const [w] = gridWords(t.server)[0]!;
    for (let i = 0; i < 30; i++) submit(a, w);
    await waitFor(() => a.errors.some((e) => e.code === 'rate_limited'), 2000, 'rate limited');
    await sleep(150);
    expect(lastPrivate(a)!.entries.filter((e) => e.status === 'ok')).toHaveLength(1);
    expect(json(a).progress[a.id()].found).toBe(1);
  });

  it('team mode needs enough players; back to lobby resets everything', async () => {
    const t = await setup(1, { teams: 2 });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => /needs at least 2 players/.test(e.message)), 2000, 'blocked');
    t.host.room.send('lobby:settings', { settings: { teams: 0, rounds: 1 } });
    await waitFor(() => JSON.parse(t.server.state.settingsJson).teams === 0, 2000, 'ffa');
    await startAndPlay(t);
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => json(t.host).phase === 'LOBBY', 2000, 'lobby');
    expect(json(t.host)).toMatchObject({ stage: 'idle', grid: [], rack: '', revealJson: '', round: 0 });
  });
});
