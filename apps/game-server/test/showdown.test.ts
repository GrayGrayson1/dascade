/**
 * DAS Survey Showdown integration tests: presenter role + secrecy (sheet, pass, custom rounds never
 * reach anyone else), the round flow (reveal, strike, steal, award, next, undo), stale/duplicate
 * commands, the audience guess game, teams and stage displays, reclaiming / handing over / taking over
 * the presenter role, reconnects, an absent presenter, reactions and the reported outcome.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import {
  SHOWDOWN_MSG,
  type ShowdownActPayload,
  type ShowdownBoardView,
  type ShowdownContentPrivate,
  type ShowdownEvent,
  type ShowdownFinale,
  type ShowdownMe,
  type ShowdownReactions,
  type ShowdownRoundInput,
  type ShowdownSheet,
} from '@dascade/shared/games/showdown';
import { onOutcome } from '../src/platform/hub.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: GameOutcome[] = [];
let stopOutcomes: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['showdown']));
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
  sheets: Array<ShowdownSheet | null>;
  passes: Array<{ pass: string } | null>;
  contents: Array<ShowdownContentPrivate | null>;
  mes: ShowdownMe[];
  events: ShowdownEvent[];
  reactions: ShowdownReactions[];
  cues: Array<{ cue: string; id: number }>;
  /** Every message this client received (leak inspection). */
  all: Array<{ type: string; payload: unknown }>;
}

async function wire(room: SdkRoom, name: string): Promise<Client> {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const all: Client['all'] = [];
  const client: Client = {
    name,
    room,
    id: () => welcomes.at(-1)!.playerId,
    token: () => welcomes.at(-1)!.seatToken,
    errors: collect(room, 'sys:error'),
    sheets: collect(room, SHOWDOWN_MSG.sheet),
    passes: collect(room, SHOWDOWN_MSG.pass),
    contents: collect(room, SHOWDOWN_MSG.content),
    mes: collect(room, SHOWDOWN_MSG.me),
    events: collect(room, SHOWDOWN_MSG.event),
    reactions: collect(room, SHOWDOWN_MSG.reactions),
    cues: collect(room, SHOWDOWN_MSG.cue),
    all,
  };
  quiet(room);
  room.onMessage('*', (type: string | number, payload: unknown) => all.push({ type: String(type), payload }));
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, `welcome ${name}`);
  return client;
}

const json = (c: Client): Json => (c.room.state as unknown as { toJSON(): Json }).toJSON();
const board = (c: Client): ShowdownBoardView => JSON.parse(json(c).boardJson) as ShowdownBoardView;
type Server = Record<string, any>;

/** A custom show with recognisable answers (makes leak checks exact). */
const ROUNDS: ShowdownRoundInput[] = [
  {
    prompt: 'Name something on a messy desk',
    answers: [
      { text: 'Coffee mugs', points: 40, aliases: ['mug'] },
      { text: 'Papers', points: 30 },
      { text: 'Sticky notes', points: 20, aliases: ['post-its'] },
      { text: 'Cables', points: 10 },
    ],
  },
  {
    prompt: 'Name a pizza topping',
    answers: [
      { text: 'Pepperoni', points: 50 },
      { text: 'Mushrooms', points: 30 },
      { text: 'Pineapple', points: 20 },
    ],
  },
];
const SECRETS = ['Coffee mugs', 'Papers', 'Sticky notes', 'Cables', 'Pepperoni', 'Mushrooms', 'Pineapple', 'post-its', '"mug"'];

interface Show {
  server: Server;
  host: Client;
  a: Client;
  b: Client;
  join: (name: string, extra?: Json) => Promise<Client>;
}

async function setup(opts: { custom?: boolean; settings?: Json } = {}): Promise<Show> {
  const host = await wire(await colyseus.sdk.create('showdown', { name: 'Host' }), 'Host');
  const server = colyseus.getRoomById(host.room.roomId) as unknown as Server;
  if (opts.custom !== false) {
    host.room.send(SHOWDOWN_MSG.content, { rounds: ROUNDS });
    await waitFor(() => server.state.customRounds === ROUNDS.length, 2000, 'custom stored');
  }
  const settings = { ...(opts.custom !== false ? { source: 'custom' } : {}), scoring: 'flat', ...(opts.settings ?? {}) };
  host.room.send('lobby:settings', { settings });
  await waitFor(
    () => Object.entries(settings).every(([k, v]) => JSON.stringify(JSON.parse(server.state.settingsJson)[k]) === JSON.stringify(v)),
    2000,
    'settings',
  );
  const join = async (name: string, extra: Json = {}) => wire(await colyseus.sdk.joinById(host.room.roomId, { name, ...extra }), name);
  const a = await join('Ada');
  const b = await join('Ben');
  return { server, host, a, b, join };
}

async function start(t: Show): Promise<void> {
  t.host.room.send('lobby:start', {});
  await waitFor(() => t.server.state.phase === 'PLAYING' && t.server.state.boardJson !== '', 3000, 'show started');
  await waitFor(() => [t.host, t.a, t.b].every((c) => json(c).boardJson !== ''), 3000, 'clients synced');
  await synced(t);
}

/** Waits until every client has the server's current board revision and phase (patches arrive at 20 Hz). */
async function synced(t: Show, clients: Client[] = [t.host, t.a, t.b]): Promise<void> {
  const rev = t.server.state.rev as number;
  const phase = t.server.state.phase as string;
  await waitFor(() => clients.every((c) => json(c).rev === rev && json(c).phase === phase), 2000, 'clients synced');
}

/** Sends a presenter command against the board revision the server has right now. */
async function act(t: Show, payload: Record<string, unknown> & { a: ShowdownActPayload['a'] }, by: Client = t.host): Promise<void> {
  const rev = t.server.state.rev as number;
  const errors = by.errors.length;
  const withRev = payload.a === 'reveal' ? payload : { ...payload, rev };
  by.room.send(SHOWDOWN_MSG.act, withRev);
  if (by !== t.host && by.id() !== t.server.state.presenterId) return;
  await waitFor(() => t.server.state.rev !== rev || t.server.state.phase !== 'PLAYING' || by.errors.length > errors, 2000, `act ${payload.a}`);
  await synced(t, [t.host, t.a, t.b].filter((c) => c.room.connection.isOpen));
}

const live = async (t: Show, team: 0 | 1 = 0) => {
  await act(t, { a: 'begin' });
  await act(t, { a: 'question' });
  await act(t, { a: 'control', team });
};

describe('DAS Survey Showdown — presenter role and secrecy', () => {
  it('makes the creator the presenter and host; everyone else is balanced into two teams', async () => {
    const t = await setup();
    await waitFor(() => Object.keys(json(t.a).teams).length === 2, 2000, 'teams synced');
    const view = json(t.a);
    expect(view.presenterId).toBe(t.host.id());
    expect(view.hostId).toBe(t.host.id());
    expect(view.teams).toEqual({ [t.a.id()]: 0, [t.b.id()]: 1 });
    expect(view.customRounds).toBe(2);
    // Only the presenter ever gets the pass and the stored rounds.
    expect(t.host.passes.at(-1)?.pass).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(t.host.contents.at(-1)?.rounds).toHaveLength(2);
    for (const c of [t.a, t.b]) {
      expect(c.passes.filter(Boolean)).toEqual([]);
      expect(c.contents.filter(Boolean)).toEqual([]);
      expect(c.sheets.filter(Boolean)).toEqual([]);
    }
  });

  it('never sends hidden answers to the audience — only revealed ones reach their board', async () => {
    const t = await setup();
    const spec = await t.join('Spec', { spectator: true });
    await start(t);
    await live(t);
    await waitFor(() => (t.host.sheets.at(-1)?.answers.length ?? 0) === 4, 2000, 'sheet');
    expect(t.host.sheets.at(-1)!.answers.map((x) => x.text)).toEqual(['Coffee mugs', 'Papers', 'Sticky notes', 'Cables']);
    expect(t.host.sheets.at(-1)!.rundown.map((r) => r.prompt)).toEqual(['Name something on a messy desk', 'Name a pizza topping']);
    for (const c of [t.a, t.b, spec]) {
      expect(JSON.stringify(c.all)).not.toMatch(new RegExp(SECRETS.join('|')));
      expect(JSON.stringify(json(c))).not.toMatch(new RegExp(SECRETS.join('|')));
    }
    await act(t, { a: 'reveal', slot: 1 });
    await waitFor(() => board(t.a).slots[1]?.revealed === true, 2000, 'revealed on audience board');
    expect(board(t.a).slots[1]).toMatchObject({ text: 'Papers', points: 30, by: 0 });
    const others = SECRETS.filter((s) => s !== 'Papers');
    for (const c of [t.a, t.b, spec]) {
      expect(JSON.stringify(c.all)).not.toMatch(new RegExp(others.join('|')));
      expect(JSON.stringify(json(c))).not.toMatch(new RegExp(others.join('|')));
    }
  });

  it('refuses show controls and custom rounds from anyone but the presenter', async () => {
    const t = await setup();
    t.a.room.send(SHOWDOWN_MSG.content, { rounds: ROUNDS });
    await waitFor(() => t.a.errors.some((e) => e.type === SHOWDOWN_MSG.content), 2000, 'content refused');
    await start(t);
    t.a.room.send(SHOWDOWN_MSG.act, { a: 'begin', rev: t.server.state.rev });
    t.b.room.send(SHOWDOWN_MSG.cue, { cue: 'applause' });
    t.a.room.send(SHOWDOWN_MSG.move, { playerId: t.b.id(), team: 0 });
    await waitFor(() => t.a.errors.filter((e) => e.code === 'not_host').length >= 2 && t.b.errors.some((e) => e.code === 'not_host'), 2000, 'refusals');
    expect(board(t.a).stage).toBe('intro');
    expect(t.a.cues).toEqual([]);
  });
});

describe('DAS Survey Showdown — the round', () => {
  it('runs a round: reveals bank points, three strikes open a steal, a steal takes the bank', async () => {
    const t = await setup();
    await start(t);
    expect(t.a.events.at(-1)?.type).toBe('intro');
    await act(t, { a: 'begin' });
    expect(board(t.host)).toMatchObject({ stage: 'title', round: 0, prompt: '' });
    await act(t, { a: 'question' });
    await waitFor(() => board(t.a).prompt === 'Name something on a messy desk', 2000, 'prompt');
    await act(t, { a: 'control', team: 0 });
    await act(t, { a: 'reveal', slot: 0 });
    await waitFor(() => t.a.events.some((e) => e.type === 'reveal'), 2000, 'reveal event');
    expect(t.a.events.find((e) => e.type === 'reveal')).toMatchObject({ slot: 0, points: 40, top: true, late: false });
    await act(t, { a: 'strike' });
    await act(t, { a: 'strike' });
    await act(t, { a: 'strike' });
    await waitFor(() => board(t.b).stage === 'steal', 2000, 'steal');
    expect(board(t.b)).toMatchObject({ strikes: 3, bank: 40, control: 0 });
    await act(t, { a: 'reveal', slot: 2 });
    await waitFor(() => board(t.b).stage === 'done', 2000, 'stolen');
    expect(board(t.b)).toMatchObject({ scores: [0, 60], roundWinner: 1, roundHow: 'steal', bank: 0 });
    expect(t.b.events.filter((e) => e.type === 'award').at(-1)).toMatchObject({ team: 1, points: 60, how: 'steal' });
    // Reveal the rest for show: no points move; the board clear is announced.
    await act(t, { a: 'reveal', slot: 1 });
    await act(t, { a: 'reveal', slot: 3 });
    await waitFor(() => t.a.events.some((e) => e.type === 'reveal' && e.cleared), 2000, 'cleared');
    expect(board(t.a).scores).toEqual([0, 60]);
  });

  it('ignores stale and duplicate commands, so a double click never strikes twice', async () => {
    const t = await setup();
    await start(t);
    await live(t);
    const rev = t.server.state.rev;
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'strike', rev });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'strike', rev });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 3 });
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'reveal', slot: 3 });
    await sleep(150);
    expect(t.server.state.rev).toBe(rev + 2);
    expect(board(t.host)).toMatchObject({ strikes: 1, bank: 10 });
    expect(t.host.errors).toEqual([]);
    // A command the stage can't take is answered with a reason.
    await act(t, { a: 'award', team: 0 });
    await act(t, { a: 'award', team: 1 });
    await waitFor(() => t.host.errors.length > 0, 2000, 'refused award');
    expect(t.host.errors[0]!.message).toMatch(/already been decided/);
  });

  it('undo restores the board exactly (scores, strikes, called-it points) and revisions keep rising', async () => {
    const t = await setup();
    await start(t);
    await live(t);
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'papers' });
    await waitFor(() => (t.a.mes.at(-1)?.guesses.length ?? 0) === 1, 2000, 'guess echo');
    await act(t, { a: 'reveal', slot: 1 });
    await waitFor(() => t.a.mes.at(-1)?.points === 30, 2000, 'called it');
    await act(t, { a: 'award', team: 0 });
    expect(board(t.host).scores).toEqual([30, 0]);
    const before = t.server.state.rev;
    await act(t, { a: 'undo' });
    await act(t, { a: 'undo' });
    await waitFor(() => board(t.a).slots[1]?.revealed === false, 2000, 'unrevealed');
    expect(t.server.state.rev).toBe(before + 2);
    expect(board(t.a)).toMatchObject({ scores: [0, 0], bank: 0, stage: 'live' });
    await waitFor(() => t.a.mes.at(-1)?.points === 0, 2000, 'called-it points taken back');
    expect(t.a.events.filter((e) => e.type === 'undo')).toHaveLength(2);
  });

  it('plays to the end: next round, finish, finale and the reported outcome', async () => {
    const t = await setup();
    await start(t);
    await live(t, 1);
    for (const slot of [0, 1, 2, 3]) await act(t, { a: 'reveal', slot });
    await waitFor(() => board(t.a).roundHow === 'sweep', 2000, 'sweep');
    expect(board(t.a).scores).toEqual([0, 100]);
    await act(t, { a: 'next' });
    expect(board(t.a)).toMatchObject({ round: 1, stage: 'title', multiplier: 1 });
    await act(t, { a: 'question' });
    await act(t, { a: 'control', team: 0 });
    await act(t, { a: 'reveal', slot: 1 });
    await act(t, { a: 'award', team: 0 });
    await act(t, { a: 'next' });
    await waitFor(() => t.server.state.phase === 'RESULTS', 2000, 'results');
    await waitFor(() => json(t.a).finaleJson !== '', 2000, 'finale synced');
    const finale = JSON.parse(json(t.a).finaleJson) as ShowdownFinale;
    expect(finale).toMatchObject({ winner: 1, scores: [30, 100], names: ['Team Delta', 'Team Sierra'], members: [['Ada'], ['Ben']] });
    expect(finale.results.map((r) => r.how)).toEqual(['sweep', 'manual']);
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements).toEqual([[t.b.id()], [t.a.id()]]);
    expect(outcomes[0]!.scores).toEqual({ [t.a.id()]: 30, [t.b.id()]: 100 });
    // The presenter isn't placed: they ran the show.
    expect(outcomes[0]!.placements.flat()).not.toContain(t.host.id());
  });

  it('a show ended before round 1 reports nothing; a tie places everyone together', async () => {
    const t = await setup();
    await start(t);
    await act(t, { a: 'finish' });
    await waitFor(() => t.server.state.phase === 'RESULTS', 2000, 'results');
    await sleep(50);
    expect(outcomes).toEqual([]);
    t.host.room.send('lobby:toLobby', {});
    await waitFor(() => t.server.state.phase === 'LOBBY', 2000, 'lobby');
    expect(t.server.state.boardJson).toBe('');
    await start(t);
    await live(t);
    await act(t, { a: 'finish' });
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]!.placements).toEqual([[t.a.id(), t.b.id()]]);
  });

  it('refuses to start a custom show with no rounds', async () => {
    const t = await setup({ custom: false, settings: { source: 'custom' } });
    t.host.room.send('lobby:start', {});
    await waitFor(() => t.host.errors.some((e) => e.type === 'lobby:start'), 2000, 'refused');
    expect(t.server.state.phase).toBe('LOBBY');
  });

  it('draws a show from the question packs', async () => {
    const t = await setup({ custom: false, settings: { packs: ['tech'], rounds: 3, scoring: 'rising' } });
    await start(t);
    await act(t, { a: 'begin' });
    await waitFor(() => (t.host.sheets.at(-1)?.rundown.length ?? 0) === 3, 2000, 'rundown');
    const sheet = t.host.sheets.at(-1)!;
    expect(sheet.rundown.map((r) => r.multiplier)).toEqual([1, 2, 3]);
    expect(board(t.a)).toMatchObject({ totalRounds: 3, stage: 'title' });
    expect(board(t.a).slots.length).toBe(sheet.answers.length);
    for (const answer of sheet.rundown.flatMap((r) => r.answers)) expect(JSON.stringify(t.a.all)).not.toContain(`"${answer.text}"`);
  });
});

describe('DAS Survey Showdown — audience', () => {
  it('keeps guesses private until the answer flips, then scores the callers', async () => {
    const t = await setup();
    await start(t);
    await act(t, { a: 'begin' });
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'mug' });
    await waitFor(() => t.a.errors.some((e) => e.code === 'wrong_phase'), 2000, 'no guesses before the question');
    await act(t, { a: 'question' });
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'mug' });
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Stapler' });
    t.b.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Coffee mugs' });
    t.host.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'papers' });
    await waitFor(() => t.server.state.guessesIn === 3, 2000, 'guesses in');
    await waitFor(() => (t.a.mes.at(-1)?.guesses.length ?? 0) === 2, 2000, 'echo');
    // The guesser sees their guess, but not whether it's on the board.
    expect(t.a.mes.at(-1)!.guesses).toEqual([
      { text: 'mug', slot: -1, points: 0 },
      { text: 'Stapler', slot: -1, points: 0 },
    ]);
    expect(t.host.errors.some((e) => /audience/.test(e.message))).toBe(true);
    // Nobody else sees someone's guesses.
    expect(JSON.stringify(t.b.all)).not.toMatch(/Stapler|"mug"/);
    // The presenter sees the cloud and which answers the audience is going for.
    await waitFor(() => (t.host.sheets.at(-1)?.cloud.length ?? 0) === 2, 2000, 'cloud');
    expect(t.host.sheets.at(-1)!.cloud).toEqual([
      { text: 'Coffee mugs', count: 2, slot: 0 },
      { text: 'Stapler', count: 1, slot: -1 },
    ]);
    expect(t.host.sheets.at(-1)!.answers[0]!.guessed).toBe(2);
    await act(t, { a: 'control', team: 0 });
    await act(t, { a: 'reveal', slot: 0 });
    await waitFor(() => t.a.mes.at(-1)?.points === 40 && t.b.mes.at(-1)?.points === 40, 2000, 'called it');
    expect(t.a.mes.at(-1)!.guesses[0]).toEqual({ text: 'mug', slot: 0, points: 40 });
    expect(board(t.a).slots[0]!.callers).toBe(2);
    expect(t.a.events.find((e) => e.type === 'reveal')).toMatchObject({ callers: 2 });
    // Already on the board → refused; the per-round limit holds.
    t.b.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'coffee mug' });
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Lamp' });
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'Pens' });
    await waitFor(() => t.b.errors.some((e) => /already on the board/.test(e.message)), 2000, 'revealed refusal');
    await waitFor(() => t.a.errors.some((e) => /all 3 guesses/.test(e.message)), 2000, 'limit');
    // A guess for an old question is refused.
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 5, text: 'x' });
    await waitFor(() => t.a.errors.filter((e) => e.code === 'wrong_phase').length === 2, 2000, 'stale round');
  });

  it('turns guesses off with the audience setting', async () => {
    const t = await setup({ settings: { audience: false } });
    await start(t);
    await live(t);
    t.a.room.send(SHOWDOWN_MSG.guess, { round: 0, text: 'mug' });
    await waitFor(() => t.a.errors.some((e) => /off for this show/.test(e.message)), 2000, 'off');
  });

  it('cheers fill the team hype meter and reach every screen in batches', async () => {
    const t = await setup();
    await start(t);
    for (let i = 0; i < 6; i++) t.a.room.send(SHOWDOWN_MSG.react, { r: 1 });
    t.b.room.send(SHOWDOWN_MSG.react, { r: 0 });
    await waitFor(() => t.host.reactions.length > 0, 2000, 'reactions');
    const total = t.host.reactions.reduce((n, r) => n + r.k[1]!, 0);
    expect(total).toBe(6);
    await waitFor(() => json(t.b).hype0 > 0, 2000, 'hype');
    expect(json(t.b).hype0).toBeGreaterThan(json(t.b).hype1);
  });

  it('teams: free to switch until round 1, then only the presenter moves people; screens join no team', async () => {
    const t = await setup();
    t.a.room.send(SHOWDOWN_MSG.team, { team: 1 });
    await waitFor(() => json(t.host).teams[t.a.id()] === 1, 2000, 'switched');
    t.host.room.send(SHOWDOWN_MSG.team, { team: 0 });
    await waitFor(() => t.host.errors.some((e) => /neutral/.test(e.message)), 2000, 'presenter stays neutral');
    const tv = await t.join('Big screen');
    await waitFor(() => json(t.host).teams[tv.id()] !== undefined, 2000, 'tv team');
    expect(json(t.host).teams[tv.id()]).toBe(0);
    tv.room.send(SHOWDOWN_MSG.screen, { on: true });
    await waitFor(() => json(t.host).screens[tv.id()] === true && json(t.host).teams[tv.id()] === undefined, 2000, 'screen');
    await start(t);
    t.b.room.send(SHOWDOWN_MSG.team, { team: 0 });
    await waitFor(() => json(t.host).teams[t.b.id()] === 0, 2000, 'switch during the intro');
    await act(t, { a: 'begin' });
    t.b.room.send(SHOWDOWN_MSG.team, { team: 1 });
    await waitFor(() => t.b.errors.some((e) => /lock/.test(e.message)), 2000, 'locked');
    t.host.room.send(SHOWDOWN_MSG.move, { playerId: t.b.id(), team: 1 });
    await waitFor(() => json(t.a).teams[t.b.id()] === 1, 2000, 'moved');
    tv.room.send(SHOWDOWN_MSG.react, { r: 2 });
    await sleep(400);
    expect(json(t.host).hype0 + json(t.host).hype1).toBe(0);
    // A late joiner lands on the smaller team and plays along.
    const late = await t.join('Late');
    await waitFor(() => json(t.host).teams[late.id()] !== undefined, 2000, 'late joiner team');
  });
});

describe('DAS Survey Showdown — keeping the show running', () => {
  it('the presenter pass reclaims the role on another device and wipes the old console', async () => {
    const t = await setup();
    await start(t);
    await live(t);
    const pass = t.host.passes.at(-1)!.pass;
    const laptop = await t.join('Host laptop');
    laptop.room.send(SHOWDOWN_MSG.claim, { pass: 'x'.repeat(24) });
    await waitFor(() => laptop.errors.some((e) => /not valid/.test(e.message)), 2000, 'bad pass');
    laptop.room.send(SHOWDOWN_MSG.claim, { pass });
    await waitFor(() => json(t.a).presenterId === laptop.id() && json(t.a).hostId === laptop.id(), 2000, 'claimed');
    await waitFor(() => (laptop.sheets.at(-1)?.answers.length ?? 0) === 4, 2000, 'sheet on the new device');
    await waitFor(() => t.host.sheets.at(-1) === null && t.host.passes.at(-1) === null, 2000, 'old console wiped');
    // The new presenter left their team; the old one runs nothing any more.
    expect(json(t.a).teams[laptop.id()]).toBeUndefined();
    t.host.room.send(SHOWDOWN_MSG.act, { a: 'strike', rev: t.server.state.rev });
    await waitFor(() => t.host.errors.some((e) => e.code === 'not_host'), 2000, 'old presenter refused');
  });

  it('hands the show over explicitly', async () => {
    const t = await setup();
    t.host.room.send(SHOWDOWN_MSG.handover, { playerId: t.a.id() });
    await waitFor(() => json(t.b).presenterId === t.a.id(), 2000, 'handover');
    await waitFor(() => (t.a.contents.at(-1)?.rounds.length ?? 0) === 2 && t.a.passes.at(-1) !== null, 2000, 'private data moved');
    expect(t.host.contents.at(-1)).toBeNull();
    expect(json(t.b).teams[t.a.id()]).toBeUndefined();
    expect(json(t.b).teams[t.host.id()]).toBeDefined();
  });

  it('restores the presenter console after a reconnect', async () => {
    const t = await setup();
    await start(t);
    await live(t);
    const token = t.host.token();
    const id = t.host.id();
    t.host.room.reconnection.enabled = false;
    (t.host.room.connection as unknown as { transport: { ws: { close(code: number): void } } }).transport.ws.close(4010);
    await sleep(100);
    const again = await wire(await colyseus.sdk.joinById(t.host.room.roomId, { name: 'Host', seatToken: token }), 'Host again');
    expect(again.id()).toBe(id);
    await waitFor(() => (again.sheets.at(-1)?.answers.length ?? 0) === 4 && again.passes.at(-1) !== null, 2000, 'console restored');
    expect(json(again).hostId).toBe(id);
  });

  it('ends the show when the presenter is gone for good, and lets someone else run the next one', async () => {
    const t = await setup();
    t.server.presenterAwayMs = 200;
    await start(t);
    await live(t);
    await act(t, { a: 'reveal', slot: 0 });
    await act(t, { a: 'award', team: 0 });
    await t.host.room.leave(true);
    await waitFor(() => t.server.state.phase === 'RESULTS', 3000, 'auto-finished');
    await waitFor(() => outcomes.length === 1, 2000, 'outcome');
    expect(outcomes[0]).toMatchObject({ reason: 'presenter_left', placements: [[t.a.id()], [t.b.id()]] });
    // Nobody may take over in the middle of a show, but between shows anyone can.
    expect(json(t.a).presenterId).toBe('');
    t.a.room.send(SHOWDOWN_MSG.takeover, {});
    await waitFor(() => json(t.b).presenterId === t.a.id() && json(t.b).hostId === t.a.id(), 2000, 'takeover');
    // The previous presenter's prepared rounds don't carry over.
    expect(json(t.b).customRounds).toBe(0);
    await waitFor(() => t.a.contents.at(-1)?.rounds.length === 0, 2000, 'clean slate');
    t.b.room.send(SHOWDOWN_MSG.takeover, {});
    await waitFor(() => t.b.errors.some((e) => /already has a presenter/.test(e.message)), 2000, 'second takeover refused');
  });

  it('presenter cues reach every screen', async () => {
    const t = await setup();
    await start(t);
    t.host.room.send(SHOWDOWN_MSG.cue, { cue: 'drumroll' });
    await waitFor(() => t.a.cues.length === 1 && t.b.cues.length === 1, 2000, 'cue');
    expect(t.a.cues[0]).toMatchObject({ cue: 'drumroll' });
  });

  it('reports invalid custom rounds back to the presenter only', async () => {
    const t = await setup({ custom: false });
    t.host.room.send(SHOWDOWN_MSG.content, {
      rounds: [ROUNDS[0], { prompt: 'Hi', answers: [{ text: 'A', points: 1 }] }],
    });
    await waitFor(() => (t.host.contents.at(-1)?.issues.length ?? 0) === 1, 2000, 'issues');
    expect(t.host.contents.at(-1)).toMatchObject({ dropped: 1, rounds: [{ prompt: 'Name something on a messy desk' }] });
    expect(t.server.state.customRounds).toBe(1);
  });
});
